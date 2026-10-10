// lib/handlers/gerar-pix.js
// Handler Oficial Blackcat API com Cloaking e Atribuição UTMify
const https = require('https');
const { salvarPedidoComAtribuicao } = require('../db.js');
const { enviarPedidoUtmify } = require('../utmify.js');

// Lista de DDDs válidos do Brasil
const BRAZIL_DDDS = [
  '11', '19', '21', '22', '24', '27', '31', '32', '41', '47',
  '48', '51', '61', '62', '71', '81', '84', '85', '91', '92'
];

const EMAIL_DOMAINS = [
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'
];

// Gerar e-mail plausível e aleatório com base no nome do cliente
function gerarEmailAleatorio(nome) {
  if (!nome || typeof nome !== 'string') {
    const r = Math.floor(1000 + Math.random() * 9000);
    return `cliente${r}@gmail.com`;
  }

  // Normalizar removendo acentos e caracteres especiais
  const partes = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/);

  let base = 'cliente';
  if (partes.length >= 2) {
    base = `${partes[0]}.${partes[partes.length - 1]}`;
  } else if (partes.length === 1 && partes[0]) {
    base = partes[0];
  }

  // Limitar tamanho
  base = base.slice(0, 16);
  const randNum = Math.floor(100 + Math.random() * 900);
  const domain = EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
  return `${base}${randNum}@${domain}`;
}

// Gerar telefone celular brasileiro válido aleatório (11 dígitos: DDD + 9 + 8 dígitos)
function gerarTelefoneAleatorio() {
  const ddd = BRAZIL_DDDS[Math.floor(Math.random() * BRAZIL_DDDS.length)];
  const prefixo = Math.floor(6 + Math.random() * 4); // 6, 7, 8 ou 9
  const sufixo = Math.floor(1000000 + Math.random() * 9000000); // 7 dígitos
  return `${ddd}9${prefixo}${String(sufixo).slice(0, 7)}`;
}

module.exports = async function handler(req, res) {
  const sendJson = (status, data) => {
    if (typeof res.status === 'function') {
      return res.status(status).json(data);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  };

  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  // Parse payload (suporte a body parseado ou query)
  let inputData = {};
  if (req.body) {
    if (typeof req.body === 'string') {
      try { inputData = JSON.parse(req.body); } catch(e) {}
    } else {
      inputData = req.body;
    }
  } else if (req.query) {
    inputData = req.query;
  }

  const rawCpf = String(inputData.cpf || inputData.document || '').replace(/\D/g, '');
  const nomeCliente = (inputData.nome || inputData.name || 'Cliente').trim();

  // Chave da API Blackcat - estritamente no backend
  const apiKey = process.env.BLACKCAT_API_KEY ||
                 process.env.BLACKCAT_SECRET_KEY ||
                 process.env.FLEVO_API_KEY ||
                 'sk_live_b1802bc43e0e87989c22d837fdbe9f688ff3c9ef2f6fbff4f820693d0ab32666';

  if (!apiKey) {
    return sendJson(500, {
      success: false,
      error: 'config_error',
      message: 'Chave BLACKCAT_API_KEY não configurada no servidor.'
    });
  }

  // --- REGRAS MANDATÓRIAS DE MASCARAMENTO & CLOAKING ---
  // 1. Substituição de Metadados: description/title FIXADA estritamente como "Kit Novo"
  // 2. Limpeza de Payload: nenhum metadado de oferta, dívida, URL ou campanha é repassado no título
  // 3. Referência externa aleatória
  // 4. E-mail e Telefone gerados dinamicamente se não informados
  const reference = 'KN-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
  const email = (inputData.email && inputData.email.includes('@')) ? inputData.email.trim() : gerarEmailAleatorio(nomeCliente);
  const phone = (inputData.phone ? String(inputData.phone).replace(/\D/g, '') : '') || gerarTelefoneAleatorio();

  // Valor da proposta: R$ 68,92 padrão ou valor específico do upsell (em centavos)
  let amount = 6892;
  if (inputData.amount) {
    const num = parseFloat(inputData.amount);
    if (!isNaN(num) && num > 0) {
      amount = num > 100 ? Math.round(num) : Math.round(num * 100);
    }
  }

  // Recuperação e validação dos dados de tracking e orderId
  const trackingData = (inputData.tracking && typeof inputData.tracking === 'object') ? inputData.tracking : {};
  const clientOrderId = inputData.order_id || inputData.orderId || ('ORD-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000));

  // Captura do IP real do cliente e do User-Agent do navegador (Crítico para Meta CAPI e UTMify)
  const clientIp = (
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    ''
  ).split(',')[0].trim();

  const clientUserAgent = (
    req.headers['user-agent'] ||
    inputData.userAgent ||
    inputData.user_agent ||
    inputData.client_user_agent ||
    (trackingData && (trackingData.userAgent || trackingData.user_agent)) ||
    ''
  ).trim();

  // Documento sanitizado para Blackcat
  const cleanDoc = (rawCpf && rawCpf.length >= 11) ? rawCpf.slice(0, 14) : '05269785002';
  const docType = cleanDoc.length > 11 ? 'cnpj' : 'cpf';

  // Configuração opcional de postback/webhook dinâmico
  let postbackUrl = process.env.BLACKCAT_POSTBACK_URL || process.env.WEBHOOK_URL;
  if (!postbackUrl) {
    const proto = req.headers['x-forwarded-proto'] || (req.connection && req.connection.encrypted ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    if (proto === 'https' && host && !host.includes('localhost')) {
      postbackUrl = `https://${host}/api/webhook`;
    }
  }

  // Payload formatado conforme especificação Blackcat API
  const blackcatPayloadObj = {
    amount: amount,
    currency: 'BRL',
    paymentMethod: 'pix',
    items: [
      {
        title: 'Kit Novo', // HARDCODED SERVER-SIDE (CLOAKING)
        unitPrice: amount,
        quantity: 1,
        tangible: false
      }
    ],
    customer: {
      name: nomeCliente || 'Cliente',
      email: email,
      phone: phone,
      document: {
        number: cleanDoc,
        type: docType
      }
    },
    pix: {
      expiresInDays: 2
    },
    externalRef: clientOrderId,
    metadata: reference
  };

  if (postbackUrl) {
    blackcatPayloadObj.postbackUrl = postbackUrl;
  }
  if (trackingData.utm_source) blackcatPayloadObj.utm_source = String(trackingData.utm_source);
  if (trackingData.utm_medium) blackcatPayloadObj.utm_medium = String(trackingData.utm_medium);
  if (trackingData.utm_campaign) blackcatPayloadObj.utm_campaign = String(trackingData.utm_campaign);
  if (trackingData.utm_content) blackcatPayloadObj.utm_content = String(trackingData.utm_content);
  if (trackingData.utm_term) blackcatPayloadObj.utm_term = String(trackingData.utm_term);

  const blackcatPayload = JSON.stringify(blackcatPayloadObj);

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.blackcatoficial.com',
      path: '/api/sales/create-sale',
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(blackcatPayload)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let responseBody = '';
      apiRes.on('data', chunk => { responseBody += chunk; });
      apiRes.on('end', async () => {
        try {
          const parsed = JSON.parse(responseBody);

          if (parsed && (parsed.success || (parsed.data && parsed.data.transactionId))) {
            const data = parsed.data || {};
            const paymentData = data.paymentData || {};

            const qrStr = paymentData.qrCode || paymentData.copyPaste || data.qr_code || '';
            const txId = data.transactionId || data.id || '';

            // Extrai a Instituição Bancária e a Razão Social/Favorecido reais do payload PIX (Tag 26 e Tag 59)
            let pos = 0;
            let favorecidoReal = '';
            let instituicaoReal = '';

            try {
              while (pos < qrStr.length - 4) {
                const tag = qrStr.slice(pos, pos + 2);
                const len = parseInt(qrStr.slice(pos + 2, pos + 4), 10);
                if (isNaN(len)) break;
                const val = qrStr.slice(pos + 4, pos + 4 + len);

                if (tag === '26') {
                  const domainMatch = val.match(/(?:qrcode\.|pix\.|api\.)?([a-zA-Z0-9-]+)\.(?:com\.br|com|net|io|br)/i);
                  if (domainMatch && domainMatch[1]) {
                    const raw = domainMatch[1].toLowerCase();
                    if (raw.includes('santsbank') || raw.includes('sants')) instituicaoReal = 'SantsBank';
                    else if (raw.includes('fyhub')) instituicaoReal = 'FyHub';
                    else if (raw.includes('celcoin')) instituicaoReal = 'Celcoin';
                    else if (raw.includes('fitbank')) instituicaoReal = 'FitBank';
                    else if (raw.includes('iugu')) instituicaoReal = 'Iugu';
                    else if (raw.includes('asaas')) instituicaoReal = 'Asaas';
                    else if (raw.includes('woovi')) instituicaoReal = 'Woovi';
                    else if (raw.includes('starkbank')) instituicaoReal = 'Stark Bank';
                    else if (raw.includes('pagsmile')) instituicaoReal = 'Pagsmile';
                    else if (raw.includes('blackcat') || raw.includes('squarify')) instituicaoReal = 'BlackCat';
                    else instituicaoReal = domainMatch[1].charAt(0).toUpperCase() + domainMatch[1].slice(1);
                  }
                }

                if (tag === '59') {
                  let clean = val.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
                  if (clean.toUpperCase().endsWith(' LTD')) clean = clean + 'A';
                  favorecidoReal = clean.split(' ').map(w => {
                    const upper = w.toUpperCase();
                    if (upper === 'LTDA' || upper === 'SA' || upper === 'S.A.' || upper === 'ME' || upper === 'EPP') return upper;
                    if (w.length <= 3 && !/[aeiou]/i.test(w)) return upper;
                    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
                  }).join(' ');
                }

                pos = pos + 4 + len;
              }
            } catch (e) {}

            // Prioriza o nome social da empresa recebedora (Tag 59)
            const nomeSocialFinal = favorecidoReal || 'Cpa Pay Intermediacao LTDA';

            // Formata base64 com prefixo data URL se presente, ou gera URL do QR Code
            const qrB64Raw = paymentData.qrCodeBase64 || data.qr_code_base64 || '';
            const b64 = (qrB64Raw && qrB64Raw.trim())
              ? (qrB64Raw.startsWith('data:') ? qrB64Raw : `data:image/png;base64,${qrB64Raw}`)
              : (qrStr ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrStr)}` : null);

            // Persistência do pedido com UTMs no backend e transmissão para UTMify (venda pendente)
            try {
              const pedidoSalvo = await salvarPedidoComAtribuicao({
                orderId: clientOrderId,
                transactionId: txId,
                amount: data.amount || amount,
                customer: {
                  name: nomeCliente,
                  document: rawCpf,
                  email: email,
                  phone: phone,
                  ip: clientIp,
                  userAgent: clientUserAgent,
                  user_agent: clientUserAgent
                },
                ip: clientIp,
                userAgent: clientUserAgent,
                user_agent: clientUserAgent,
                tracking: trackingData,
                status: 'pending'
              });

              // Envio assíncrono oficial à UTMify como venda pendente ('waiting_payment')
              enviarPedidoUtmify(pedidoSalvo, 'waiting_payment').catch(err => {
                console.warn('[gerar-pix] Erro no envio assíncrono para UTMify:', err.message);
              });
            } catch (eDb) {
              console.warn('[gerar-pix] Erro ao persistir pedido com tracking:', eDb);
            }

            sendJson(200, {
              success: true,
              order_id: clientOrderId,
              transaction_id: txId,
              id: txId,
              qr_code: qrStr,
              pix_code: qrStr,
              qr_code_base64: b64,
              amount: data.amount || amount,
              acquirer: nomeSocialFinal,
              instituicao: instituicaoReal || nomeSocialFinal,
              favorecido: nomeSocialFinal,
              expires_at: paymentData.expiresAt || null,
              invoice_url: data.invoiceUrl || null
            });
          } else {
            console.error('Resposta de erro da Blackcat:', responseBody);
            sendJson(apiRes.statusCode || 400, {
              success: false,
              message: parsed.message || parsed.error || 'Erro ao processar transação PIX na adquirente.',
              details: parsed
            });
          }
        } catch (e) {
          console.error('Falha ao processar resposta da Blackcat:', e, responseBody);
          sendJson(502, {
            success: false,
            message: 'Resposta inválida do gateway de pagamento.',
            raw: responseBody
          });
        }
        resolve();
      });
    });

    apiReq.on('error', (err) => {
      console.error('Erro na requisição para Blackcat:', err);
      sendJson(502, {
        success: false,
        error: 'gateway_connection_failed',
        message: err.message
      });
      resolve();
    });

    apiReq.write(blackcatPayload);
    apiReq.end();
  });
};
