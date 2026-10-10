// api/payment-proof.js
// Endpoint seguro para validação e encaminhamento de comprovante PIX ao Discord
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuração do Vercel Serverless (caso use bodyParser desativado para multipart)
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

// Rate limiting simples em memória (IP -> { count, expiresAt })
const rateLimitMap = new Map();
const MAX_UPLOADS_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MS = 3 * 60 * 1000; // 3 minutos

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.expiresAt) {
    rateLimitMap.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_UPLOADS_PER_WINDOW) {
    return false;
  }
  entry.count++;
  return true;
}

// Limpeza periódica do mapa de rate limit
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.expiresAt) rateLimitMap.delete(ip);
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket ? req.socket.remoteAddress : '127.0.0.1';
}

function getWebhookUrl() {
  if (process.env.DISCORD_PAYMENT_WEBHOOK_URL && process.env.DISCORD_PAYMENT_WEBHOOK_URL.trim() !== '') {
    return process.env.DISCORD_PAYMENT_WEBHOOK_URL.trim();
  }
  // Tentar recarregar do .env se foi adicionado recentemente
  try {
    ['.env', '.env.local'].forEach(file => {
      const fullPath = path.join(__dirname, '..', file);
      if (fs.existsSync(fullPath)) {
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        for (const line of lines) {
          const parts = line.trim().split('=');
          if (parts[0] && parts[0].trim() === 'DISCORD_PAYMENT_WEBHOOK_URL' && parts.slice(1).join('=').trim()) {
            process.env.DISCORD_PAYMENT_WEBHOOK_URL = parts.slice(1).join('=').trim();
            return process.env.DISCORD_PAYMENT_WEBHOOK_URL;
          }
        }
      }
    });
  } catch (e) {}

  return process.env.DISCORD_PAYMENT_WEBHOOK_URL || '';
}

// Leitor de Stream de requisição caso o body não esteja bufferizado
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.rawBuffer && Buffer.isBuffer(req.rawBuffer)) {
      return resolve(req.rawBuffer);
    }
    if (req.body && Buffer.isBuffer(req.body)) {
      return resolve(req.body);
    }
    if (req.body && typeof req.body === 'string') {
      return resolve(Buffer.from(req.body, 'binary'));
    }
    if (req.readableEnded || req.complete) {
      if (req.body) {
        return resolve(Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body), 'binary'));
      }
      return resolve(Buffer.alloc(0));
    }

    const chunks = [];
    req.on('data', chunk => { chunks.push(chunk); });
    req.on('end', () => { resolve(Buffer.concat(chunks)); });
    req.on('error', err => { reject(err); });
  });
}

// Parser Multipart/form-data robusto e nativo usando Buffer
function parseMultipartBuffer(bodyBuffer, boundary) {
  const boundaryBuffer = Buffer.from('--' + boundary);
  const results = { fields: {}, files: [] };
  let start = 0;

  while (start < bodyBuffer.length) {
    const boundaryIndex = bodyBuffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;

    const nextBoundaryIndex = bodyBuffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextBoundaryIndex === -1) break;

    let partStart = boundaryIndex + boundaryBuffer.length;
    if (bodyBuffer[partStart] === 0x0D && bodyBuffer[partStart + 1] === 0x0A) partStart += 2;
    else if (bodyBuffer[partStart] === 0x0A) partStart += 1;

    let partEnd = nextBoundaryIndex;
    if (partEnd >= 2 && bodyBuffer[partEnd - 2] === 0x0D && bodyBuffer[partEnd - 1] === 0x0A) partEnd -= 2;
    else if (partEnd >= 1 && bodyBuffer[partEnd - 1] === 0x0A) partEnd -= 1;

    const partBuffer = bodyBuffer.slice(partStart, partEnd);
    const headerSep = Buffer.from('\r\n\r\n');
    let headerSepIndex = partBuffer.indexOf(headerSep);
    let sepLength = 4;
    if (headerSepIndex === -1) {
      headerSepIndex = partBuffer.indexOf(Buffer.from('\n\n'));
      sepLength = 2;
    }

    if (headerSepIndex !== -1) {
      const headerText = partBuffer.slice(0, headerSepIndex).toString('utf8');
      const bodyData = partBuffer.slice(headerSepIndex + sepLength);
      const dispMatch = headerText.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);

      if (dispMatch) {
        const fieldName = dispMatch[1];
        const filename = dispMatch[2];

        if (filename !== undefined && filename !== '') {
          const typeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);
          const mimeType = typeMatch ? typeMatch[1].trim() : 'application/octet-stream';
          results.files.push({
            fieldName,
            filename: path.basename(filename),
            mimeType,
            buffer: bodyData,
            size: bodyData.length
          });
        } else {
          results.fields[fieldName] = bodyData.toString('utf8');
        }
      }
    }

    start = nextBoundaryIndex;
  }

  return results;
}

// Validação rigorosa de Tipo e Magic Bytes (segurança)
function validarArquivo(buffer, filename) {
  if (!buffer || buffer.length < 4) {
    return { valido: false, erro: 'Arquivo vazio ou corrompido.' };
  }

  const maxBytes = 10 * 1024 * 1024; // 10MB
  if (buffer.length > maxBytes) {
    return { valido: false, erro: 'O arquivo excede o limite máximo permitido de 10MB.' };
  }

  const ext = path.extname(filename || '').toLowerCase();
  const extensoesPermitidas = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  if (!extensoesPermitidas.includes(ext)) {
    return { valido: false, erro: 'Formato não permitido. Aceito somente PDF, JPG, PNG e WEBP.' };
  }

  // Bloquear executáveis (MZ para Windows EXE/DLL, ELF para Linux)
  if (buffer[0] === 0x4D && buffer[1] === 0x5A) {
    return { valido: false, erro: 'Arquivos executáveis não são permitidos.' };
  }
  if (buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46) {
    return { valido: false, erro: 'Arquivos executáveis não são permitidos.' };
  }

  // Magic bytes
  const isPDF = buffer.slice(0, 5).toString('ascii').startsWith('%PDF-');
  const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isWEBP = buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP';

  if (ext === '.pdf' && isPDF) {
    return { valido: true, mimeType: 'application/pdf', isImage: false };
  }
  if ((ext === '.jpg' || ext === '.jpeg') && isJPEG) {
    return { valido: true, mimeType: 'image/jpeg', isImage: true };
  }
  if (ext === '.png' && isPNG) {
    return { valido: true, mimeType: 'image/png', isImage: true };
  }
  if (ext === '.webp' && isWEBP) {
    return { valido: true, mimeType: 'image/webp', isImage: true };
  }

  return { valido: false, erro: 'O conteúdo do arquivo não corresponde a uma imagem ou PDF válido.' };
}

// Envio ao Discord Webhook com anexo multipart/form-data
function enviarAoDiscord(webhookUrl, file, meta = {}) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(webhookUrl);
      const discordBoundary = '--------------------------' + crypto.randomBytes(16).toString('hex');
      const safeFilename = (file.filename || 'comprovante').replace(/[^a-zA-Z0-9._-]/g, '_');

      const nowFormatted = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'medium'
      });

      const fields = [
        { name: '📎 Arquivo', value: safeFilename, inline: true },
        { name: '🕒 Recebido em', value: nowFormatted, inline: true },
        { name: '🟡 Status', value: 'Aguardando verificação', inline: true }
      ];

      if (meta.nome) {
        fields.push({
          name: '👤 Nome do Cliente',
          value: meta.nome,
          inline: true
        });
      }

      if (meta.cpf) {
        fields.push({
          name: '📄 CPF do Cliente',
          value: `\`${meta.cpf}\``,
          inline: true
        });
      }

      if (meta.orderId || meta.transactionId) {
        fields.push({
          name: '🆔 ID do Pedido / Transação',
          value: `\`${meta.orderId || meta.transactionId}\``,
          inline: true
        });
      }

      const clientHeader = meta.nome ? `\n👤 **Cliente:** **${meta.nome}**` : '';
      const cpfHeader = meta.cpf ? `\n📄 **CPF:** \`${meta.cpf}\`` : '';
      const orderHeader = (meta.orderId || meta.transactionId) ? `\n🆔 **ID do Pedido:** \`${meta.orderId || meta.transactionId}\`` : '';

      const discordPayload = {
        content: `📩 **NOVO COMPROVANTE PIX RECEBIDO**${clientHeader}\n📎 **Arquivo:** \`${safeFilename}\`\n🕒 **Recebido em:** ${nowFormatted}\n🟡 **Status:** Aguardando verificação${cpfHeader}${orderHeader}`,
        embeds: [
          {
            title: '📩 Novo Comprovante PIX Recebido',
            color: 15844367, // Dourado / Amarelo (#F1C40F - Aguardando verificação)
            fields: fields,
            image: file.isImage ? { url: `attachment://${safeFilename}` } : undefined,
            footer: {
              text: 'Programa Desenrola Brasil • Central de Verificação'
            },
            timestamp: new Date().toISOString()
          }
        ]
      };

      const parts = [];

      // Parte 1: payload_json
      const payloadStr = JSON.stringify(discordPayload);
      parts.push(Buffer.from(
        `--${discordBoundary}\r\n` +
        `Content-Disposition: form-data; name="payload_json"\r\n` +
        `Content-Type: application/json; charset=utf-8\r\n\r\n` +
        payloadStr + `\r\n`
      ));

      // Parte 2: files[0]
      parts.push(Buffer.from(
        `--${discordBoundary}\r\n` +
        `Content-Disposition: form-data; name="files[0]"; filename="${safeFilename}"\r\n` +
        `Content-Type: ${file.mimeType}\r\n\r\n`
      ));
      parts.push(file.buffer);
      parts.push(Buffer.from(`\r\n--${discordBoundary}--\r\n`));

      const fullDiscordBody = Buffer.concat(parts);

      const reqOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${discordBoundary}`,
          'Content-Length': fullDiscordBody.length,
          'User-Agent': 'DesenrolaBrasil-PaymentProof/1.0'
        },
        timeout: 12000
      };

      const request = https.request(reqOptions, (response) => {
        let resBody = '';
        response.on('data', chunk => { resBody += chunk; });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ success: true, status: response.statusCode });
          } else {
            console.error(`[PaymentProof] Discord respondeu com HTTP ${response.statusCode}`);
            reject(new Error(`Discord status ${response.statusCode}`));
          }
        });
      });

      request.on('error', (err) => {
        console.error('[PaymentProof] Falha na requisição HTTPS ao Discord:', err.message);
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        console.error('[PaymentProof] Timeout ao contatar Discord Webhook');
        reject(new Error('Timeout'));
      });

      request.write(fullDiscordBody);
      request.end();

    } catch (err) {
      reject(err);
    }
  });
}

// Handler Principal compatível com Node HTTP e Vercel
module.exports = async function handler(req, res) {
  const sendJson = (status, data) => {
    if (typeof res.status === 'function') {
      return res.status(status).json(data);
    }
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(data));
  };

  // Cabeçalhos CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(405, {
      success: false,
      error: 'method_not_allowed',
      message: 'Método não permitido. Utilize POST.'
    });
  }

  // Rate Limiting por IP
  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return sendJson(429, {
      success: false,
      error: 'rate_limited',
      message: 'Muitas tentativas de envio. Por favor, aguarde alguns minutos antes de tentar novamente.'
    });
  }

  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return sendJson(400, {
        success: false,
        error: 'invalid_content_type',
        message: 'Requisição deve ser enviada como multipart/form-data.'
      });
    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      return sendJson(400, {
        success: false,
        error: 'missing_boundary',
        message: 'Boundary de multipart não encontrado.'
      });
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const rawBuffer = await readRequestBody(req);
    if (!rawBuffer || rawBuffer.length === 0) {
      return sendJson(400, {
        success: false,
        error: 'empty_body',
        message: 'Nenhum dado recebido.'
      });
    }

    const parsed = parseMultipartBuffer(rawBuffer, boundary);
    if (!parsed.files || parsed.files.length === 0) {
      return sendJson(400, {
        success: false,
        error: 'file_missing',
        message: 'Nenhum comprovante foi anexado. Selecione um arquivo válido.'
      });
    }

    const file = parsed.files[0];
    const validacao = validarArquivo(file.buffer, file.filename);
    if (!validacao.valido) {
      return sendJson(400, {
        success: false,
        error: 'invalid_file',
        message: validacao.erro || 'Arquivo inválido. Aceito somente PDF, JPG, PNG e WEBP (máx. 10MB).'
      });
    }

    file.mimeType = validacao.mimeType;
    file.isImage = validacao.isImage;

    // Metadados opcionais da sessão (sem pedir nada ao cliente)
    const meta = {
      nome: parsed.fields.nome || (req.query && req.query.nome) || null,
      orderId: parsed.fields.orderId || parsed.fields.transactionId || (req.query && req.query.id) || null,
      transactionId: parsed.fields.transactionId || null,
      cpf: parsed.fields.cpf || (req.query && req.query.cpf) || null
    };

    const webhookUrl = getWebhookUrl();
    if (webhookUrl) {
      try {
        await enviarAoDiscord(webhookUrl, file, meta);
        console.log(`[PaymentProof] Comprovante '${file.filename}' encaminhado com sucesso ao Discord`);
      } catch (discordErr) {
        // Se o Discord falhou, registramos o erro sanitizado sem quebrar o fluxo do usuário
        console.error('[PaymentProof] Falha ao enviar para Discord Webhook');
        return sendJson(502, {
          success: false,
          error: 'discord_unavailable',
          message: 'Não foi possível enviar seu comprovante. Tente novamente.'
        });
      }
    } else {
      console.warn('[PaymentProof] DISCORD_PAYMENT_WEBHOOK_URL não configurada no ambiente. Comprovante validado com sucesso.');
    }

    // Regra 8: O comprovante é apenas uma solicitação de verificação.
    // Retorna confirmação de recebimento para verificação da equipe, sem aprovar financeiramente o pedido.
    return sendJson(200, {
      success: true,
      message: 'Comprovante recebido com sucesso! Nossa equipe verificará seu pagamento.'
    });

  } catch (err) {
    console.error('[PaymentProof] Erro interno:', err.message);
    return sendJson(500, {
      success: false,
      error: 'internal_error',
      message: 'Não foi possível enviar seu comprovante. Tente novamente.'
    });
  }
};
