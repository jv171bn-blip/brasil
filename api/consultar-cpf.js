// api/consultar-cpf.js
// Vercel Serverless Function & Node.js HTTP compatible handler
const https = require('https');

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  // Obter CPF por Query ou Body
  const cpfParam = req.query?.cpf || (req.body && req.body.cpf) || '';
  const rawCpf = String(cpfParam).replace(/\D/g, '');

  if (!rawCpf || rawCpf.length !== 11) {
    return sendJson(400, {
      error: 'invalid_cpf',
      message: 'CPF deve conter exatamente 11 dígitos numéricos.'
    });
  }

  const apiKey = process.env.APISEGURA_KEY || process.env.API_KEY || 'sk_live_L72_HvdV4rvva1Z4TLQG_z3c3btXIWse';

  if (!apiKey) {
    return sendJson(500, {
      error: 'config_error',
      message: 'Chave APISEGURA_KEY não configurada nas variáveis de ambiente.'
    });
  }

  return new Promise((resolve) => {
    const options = {
      hostname: 'search.apisegura.cloud',
      path: `/cpf?cpf=${rawCpf}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let body = '';
      apiRes.on('data', chunk => { body += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          sendJson(apiRes.statusCode || 200, parsed);
        } catch (e) {
          if (typeof res.status === 'function') {
            res.status(apiRes.statusCode || 200).send(body);
          } else {
            res.writeHead(apiRes.statusCode || 200, { 'Content-Type': 'text/plain' });
            res.end(body);
          }
        }
        resolve();
      });
    });

    apiReq.on('error', (err) => {
      console.error('Erro na requisição para APIsegura:', err);
      sendJson(502, { error: 'bad_gateway', message: err.message });
      resolve();
    });

    apiReq.end();
  });
};
