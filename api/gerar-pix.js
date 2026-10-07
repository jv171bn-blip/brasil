// api/gerar-pix.js
// Vercel Serverless Function & Node.js HTTP compatible handler
const https = require('https');

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
  // Celulares no Brasil começam com 9 e dígitos seguintes 6, 7, 8 ou 9
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

  // Chave da API FlevoPay - estritamente no backend
  const apiKey = process.env.FLEVO_API_KEY || 'flevopay_sk_dd9fb7509dcce89edf735124eae99a93140a9cd57b3c023025a6c3397f35e5f4';

  if (!apiKey) {
    return sendJson(500, {
      success: false,
      error: 'config_error',
      message: 'Chave FLEVO_API_KEY não configurada no servidor.'
    });
  }

  // --- REGRAS MANDATÓRIAS DE MASCARAMENTO & CLOAKING ---
  // 1. Substituição de Metadados: description FIXADA estritamente como "Kit Novo"
  // 2. Limpeza de Payload: nenhum metadado de oferta, dívida, URL ou campanha é repassado
  // 3. Referência externa aleatória
  // 4. E-mail e Telefone gerados dinamicamente se não informados
  const reference = 'KN-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(1000 + Math.random() * 9000);
  const email = gerarEmailAleatorio(nomeCliente);
  const phone = gerarTelefoneAleatorio();

  // Valor da proposta: R$ 68,92 -> 6892 centavos
  const amount = 6892;

  const flevoPayload = JSON.stringify({
    amount: amount,
    description: 'Kit Novo', // HARDCODED SERVER-SIDE
    reference: reference,
    source: 'api_externa',
    customer: {
      name: nomeCliente || 'Cliente',
      email: email,
      phone: phone,
      document: rawCpf || '05269785002'
    }
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'app.flevopay.com.br',
      path: '/api/v1/transaction',
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(flevoPayload)
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let responseBody = '';
      apiRes.on('data', chunk => { responseBody += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);

          if (parsed && (parsed.status === 'success' || parsed.qr_code)) {
            sendJson(200, {
              success: true,
              transaction_id: parsed.transaction_id,
              id: parsed.id,
              qr_code: parsed.qr_code,
              qr_code_base64: parsed.qr_code_base64 || null,
              amount: parsed.amount || amount,
              acquirer: parsed.acquirer || 'Instituição Autorizada Banco Central',
              expires_at: parsed.expires_at || null
            });
          } else {
            console.error('Resposta de erro da FlevoPay:', responseBody);
            sendJson(apiRes.statusCode || 400, {
              success: false,
              message: parsed.message || 'Erro ao processar transação PIX na adquirente.',
              details: parsed
            });
          }
        } catch (e) {
          console.error('Falha ao processar resposta da FlevoPay:', e, responseBody);
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
      console.error('Erro na requisição para FlevoPay:', err);
      sendJson(502, {
        success: false,
        error: 'gateway_connection_failed',
        message: err.message
      });
      resolve();
    });

    apiReq.write(flevoPayload);
    apiReq.end();
  });
};
