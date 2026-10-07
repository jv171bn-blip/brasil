// api/verificar-pix.js
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  const queryParams = req.query || {};
  let bodyData = {};
  if (req.body) {
    if (typeof req.body === 'string') {
      try { bodyData = JSON.parse(req.body); } catch(e) {}
    } else {
      bodyData = req.body;
    }
  }

  const transactionId = queryParams.id || queryParams.transaction_id || bodyData.id || bodyData.transaction_id;

  if (!transactionId) {
    return sendJson(400, {
      success: false,
      error: 'missing_id',
      message: 'ID da transação não fornecido.'
    });
  }

  const apiKey = process.env.FLEVO_API_KEY || 'flevopay_sk_dd9fb7509dcce89edf735124eae99a93140a9cd57b3c023025a6c3397f35e5f4';

  return new Promise((resolve) => {
    const options = {
      hostname: 'app.flevopay.com.br',
      path: `/api/v1/query?action=get_transaction&id=${encodeURIComponent(transactionId)}`,
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let responseBody = '';
      apiRes.on('data', chunk => { responseBody += chunk; });
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody);
          const currentStatus = String(parsed.status || '').toLowerCase();
          const isPaid = currentStatus === 'approved' || currentStatus === 'paid';

          sendJson(apiRes.statusCode || 200, {
            success: true,
            id: parsed.id || transactionId,
            status: currentStatus,
            paid: isPaid,
            amount: parsed.amount
          });
        } catch (e) {
          sendJson(502, {
            success: false,
            message: 'Falha ao processar status da transação.',
            raw: responseBody
          });
        }
        resolve();
      });
    });

    apiReq.on('error', (err) => {
      console.error('Erro ao consultar status na FlevoPay:', err);
      sendJson(502, {
        success: false,
        error: 'gateway_connection_failed',
        message: err.message
      });
      resolve();
    });

    apiReq.end();
  });
};
