const http = require('http');
const fs = require('fs');
const path = require('path');
const { getClientIp } = require('./api/lib/ip.js');
const { verificarSessaoFinalizada } = require('./api/lib/db.js');

const PORT = 3000;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg'
};

// Carregar variáveis do .env se existir
try {
  if (fs.existsSync(path.join(__dirname, '.env'))) {
    const envLines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n');
    envLines.forEach(line => {
      const parts = line.trim().split('=');
      if (parts[0] && parts[1] && !process.env[parts[0].trim()]) {
        process.env[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    });
  }
} catch (e) {}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // Trava de Segurança e Prevenção de Fraudes: Filtro de Entrada
  const rotasFunilProtegidas = [
    '/',
    '/index.html',
    '/verificacao',
    '/verificacao.html',
    '/atendimento',
    '/atendimento.html',
    '/consulta',
    '/consulta.html',
    '/negociacao',
    '/negociacao.html',
    '/upsell1',
    '/upsell1.html',
    '/upsell2',
    '/upsell2.html',
    '/upsell3',
    '/upsell3.html'
  ];

  // Rota de Desbloqueio e Modo Desenvolvedor
  if (pathname === '/desbloquear' || pathname.startsWith('/desbloquear')) {
    delete require.cache[require.resolve('./api/desbloquear.js')];
    const handler = require('./api/desbloquear.js');
    req.query = Object.fromEntries(urlObj.searchParams);
    req.body = {};
    return handler(req, res);
  }

  // Verificação de Modo Administrador / Bypass (?admin=1 ou cookie __admin_bypass)
  const cookieHeader = req.headers['cookie'] || '';
  const isAdminBypass = cookieHeader.includes('__admin_bypass=1') || 
                        urlObj.searchParams.has('admin') || 
                        urlObj.searchParams.has('bypass');

  if (isAdminBypass) {
    if (urlObj.searchParams.has('admin') || urlObj.searchParams.has('bypass')) {
      res.setHeader('Set-Cookie', '__admin_bypass=1; Path=/; Max-Age=31536000; SameSite=Lax');
    }
    // Desenvolvedor liberado sem restrições
  } else if (rotasFunilProtegidas.includes(pathname)) {
    const clientIp = getClientIp(req);
    const hasCompletedCookie = cookieHeader.includes('__funnel_completed=1');

    const responder404 = () => {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      const p404 = path.join(__dirname, '404.html');
      if (fs.existsSync(p404)) {
        return fs.createReadStream(p404).pipe(res);
      }
      return res.end('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>');
    };

    if (hasCompletedCookie) {
      return responder404();
    }

    try {
      const statusBloqueio = await verificarSessaoFinalizada({ ip: clientIp });
      if (statusBloqueio && statusBloqueio.bloqueado) {
        return responder404();
      }
    } catch (err) {
      console.error('[Middleware] Erro na validação de sessão finalizada:', err);
    }
  }



  // Rotas de Webhook de Pagamento (FlevoPay / Gateway PIX -> UTMify)
  if (pathname === '/webhook' || pathname === '/webhook-flevo' || pathname === '/webhook-pagamento') {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      try { req.body = rawBody ? JSON.parse(rawBody) : {}; } catch(e) { req.body = {}; }
      req.query = Object.fromEntries(urlObj.searchParams);
      delete require.cache[require.resolve('./api/webhook-flevo.js')];
      const handler = require('./api/webhook-flevo.js');
      return handler(req, res);
    });
    return;
  }

  // Rotas compatíveis com polling de pagamento dos upsells
  if (pathname.startsWith('/check-payment')) {
    const parts = pathname.replace('/check-payment', '').split('/').filter(Boolean);
    const idFromPath = parts[0] || '';
    req.query = Object.fromEntries(urlObj.searchParams);
    if (idFromPath) req.query.id = idFromPath;
    req.body = {};
    delete require.cache[require.resolve('./api/verificar-pix.js')];
    const handler = require('./api/verificar-pix.js');
    return handler(req, res);
  }

  // Rotas compatíveis com geração de PIX dos upsells
  if (pathname.startsWith('/generate-pix')) {
    let defaultAmount = 68.92;
    if (pathname === '/generate-pix-upsell2') defaultAmount = 27.65;
    else if (pathname === '/generate-pix-upsell3') defaultAmount = 37.82;
    else if (pathname === '/generate-pix-upsell4') defaultAmount = 19.92;

    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      try { req.body = rawBody ? JSON.parse(rawBody) : {}; } catch(e) { req.body = {}; }
      req.query = Object.fromEntries(urlObj.searchParams);
      if (!req.body.amount) req.body.amount = defaultAmount;
      delete require.cache[require.resolve('./api/gerar-pix.js')];
      const handler = require('./api/gerar-pix.js');
      return handler(req, res);
    });
    return;
  }

  // Rotas automáticas para funções serverless em /api/
  if (pathname.startsWith('/api/')) {
    const apiName = pathname.replace('/api/', '').split('/')[0];
    const apiFilePath = path.join(__dirname, 'api', `${apiName}.js`);
    if (fs.existsSync(apiFilePath)) {
      const executeHandler = () => {
        try {
          delete require.cache[require.resolve(apiFilePath)];
          const handler = require(apiFilePath);
          return handler(req, res);
        } catch (err) {
          console.error(`Erro na API ${apiName}:`, err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
      };

      req.query = Object.fromEntries(urlObj.searchParams);

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        let rawBody = '';
        req.on('data', chunk => { rawBody += chunk; });
        req.on('end', () => {
          try {
            req.body = rawBody ? JSON.parse(rawBody) : {};
          } catch(e) {
            req.body = rawBody;
          }
          executeHandler();
        });
        return;
      } else {
        req.body = {};
        return executeHandler();
      }
    }
  }

  let decodedUrl = pathname;
  if (decodedUrl === '/favicon.ico') {
    res.writeHead(204);
    return res.end();
  }
  if (decodedUrl === '/verificacao') decodedUrl = '/verificacao.html';
  if (decodedUrl === '/politica-de-privacidade' || decodedUrl === '/politica-privacidade') decodedUrl = '/politica-de-privacidade.html';
  if (decodedUrl === '/termos-de-uso' || decodedUrl === '/termos-uso') decodedUrl = '/termos-de-uso.html';
  if (decodedUrl === '/atendimento') decodedUrl = '/atendimento.html';
  if (decodedUrl === '/consulta') decodedUrl = '/consulta.html';
  if (decodedUrl === '/upsell1') decodedUrl = '/upsell1.html';
  if (decodedUrl === '/upsell2') decodedUrl = '/upsell2.html';
  if (decodedUrl === '/upsell3') decodedUrl = '/upsell3.html';
  if (decodedUrl === '/negociacao') decodedUrl = '/negociacao.html';
  if (decodedUrl === '/obrigado') decodedUrl = '/obrigado.html';
  if (decodedUrl === '/404') decodedUrl = '/404.html';
  let filePath = path.join(__dirname, decodedUrl === '/' ? 'index.html' : decodedUrl);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const p404 = path.join(__dirname, '404.html');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      if (fs.existsSync(p404)) {
        return fs.createReadStream(p404).pipe(res);
      }
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    let contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Suporte robusto para streaming de mídia (MP4, MP3, WAV - Range requests)
    if (ext === '.mp4' || ext === '.mp3' || ext === '.wav' || ext === '.ogg') {
      if (ext === '.mp3') {
        try {
          const fd = fs.openSync(filePath, 'r');
          const buf = Buffer.alloc(4);
          fs.readSync(fd, buf, 0, 4, 0);
          fs.closeSync(fd);
          if (buf.toString('ascii') === 'RIFF') {
            contentType = 'audio/wav';
          }
        } catch (e) {}
      }

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      } else {
        res.writeHead(200, {
          'Content-Length': stats.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        const stream = fs.createReadStream(filePath);
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }
    }

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Proxy de compatibilidade local para UTMify
// (O script pixel.js da UTMify tenta contatar http://localhost:3001/tracking/v1 quando em ambiente local)
const https = require('https');
const UTMIFY_PROXY_PORT = 3001;
const utmifyProxy = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);
    const targetUrl = new URL(req.url, 'https://tracking.utmify.com.br');

    const pReq = https.request({
      hostname: 'tracking.utmify.com.br',
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Content-Length': bodyBuf.length,
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
      }
    }, pRes => {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.pipe(res);
    });

    pReq.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    pReq.write(bodyBuf);
    pReq.end();
  });
});

utmifyProxy.on('error', err => {
  if (err.code !== 'EADDRINUSE') {
    console.warn('[UTMify Proxy 3001] Aviso:', err.message);
  }
});

try {
  utmifyProxy.listen(UTMIFY_PROXY_PORT, () => {
    console.log(`[UTMify Proxy] Ativo na porta ${UTMIFY_PROXY_PORT} -> https://tracking.utmify.com.br`);
  });
} catch (e) {}
