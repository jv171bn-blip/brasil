// api/consultar-cpf.js
// Vercel Serverless Function & Node.js HTTP compatible handler
// Consulta oficial de CPF com failover resiliente para o funil de vendas
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

  // Objeto de fallback garantido para nunca travar o funil de vendas
  const fallbackData = {
    tipo: 'pessoa_fisica',
    documento: rawCpf,
    nome: 'Beneficiário',
    nascimento: '',
    situacao_receita: 'REGULAR',
    from_fallback: true
  };

  if (!apiKey) {
    console.warn('[consultar-cpf] Chave APISEGURA_KEY não configurada. Utilizando fallback.');
    return sendJson(200, fallbackData);
  }

  return new Promise((resolve) => {
    let resolved = false;

    const finalize = (statusCode, data) => {
      if (resolved) return;
      resolved = true;
      sendJson(statusCode, data);
      resolve();
    };

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
          if (apiRes.statusCode === 200 && parsed && parsed.nome) {
            // Sucesso na consulta oficial da base Serasa
            finalize(200, parsed);
          } else {
            // CPF não encontrado no Serasa (404) ou erro da base externa:
            // Não bloqueia o lead: responde 200 com fallback para prosseguir ao atendimento e PIX
            console.warn(`[consultar-cpf] Base externa retornou status ${apiRes.statusCode} para CPF ${rawCpf}. Aplicando fallback de continuidade.`);
            finalize(200, Object.assign({}, fallbackData, {
              external_status: apiRes.statusCode,
              external_message: parsed.message || parsed.error || null
            }));
          }
        } catch (e) {
          finalize(200, fallbackData);
        }
      });
    });

    // Timeout de 5 segundos para nunca deixar o botão travado em "Aguarde"
    apiReq.setTimeout(5000, () => {
      console.warn('[consultar-cpf] Timeout na consulta APIsegura (5s). Prosseguindo com fallback.');
      apiReq.destroy();
      finalize(200, fallbackData);
    });

    apiReq.on('error', (err) => {
      console.error('[consultar-cpf] Erro na requisição para APIsegura:', err.message);
      finalize(200, fallbackData);
    });

    apiReq.end();
  });
};
