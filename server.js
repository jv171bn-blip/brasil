const http = require('http');
const fs = require('fs');
const path = require('path');

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

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

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
  if (decodedUrl === '/atendimento') decodedUrl = '/atendimento.html';
  let filePath = path.join(__dirname, decodedUrl === '/' ? 'index.html' : decodedUrl);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
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
