// lib/handlers/verificar-pix.js
// Consulta de status oficial via Blackcat API
const https = require('https');
const { atualizarStatusPedido, obterPedido } = require('../db.js');
const { enviarPedidoUtmify } = require('../utmify.js');

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

  const apiKey = process.env.BLACKCAT_API_KEY ||
                 process.env.BLACKCAT_SECRET_KEY ||
                 process.env.FLEVO_API_KEY ||
                 'sk_live_b1802bc43e0e87989c22d837fdbe9f688ff3c9ef2f6fbff4f820693d0ab32666';

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.blackcatoficial.com',
      path: `/api/sales/${encodeURIComponent(transactionId)}/status`,
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        'Accept': 'application/json'
      }
    };

    const apiReq = https.request(options, (apiRes) => {
      let responseBody = '';
      apiRes.on('data', chunk => { responseBody += chunk; });
      apiRes.on('end', async () => {
        try {
          const parsed = JSON.parse(responseBody);
          const data = parsed.data || {};
          const statusRaw = String(data.status || parsed.status || '').toLowerCase();
          const isPaid = statusRaw === 'approved' || statusRaw === 'paid';

          let pedido = null;
          try {
            if (isPaid) {
              pedido = await atualizarStatusPedido(transactionId, 'paid');
              if (pedido && !pedido.utmify_paid_synced) {
                pedido.utmify_paid_synced = true;
                if (!pedido.customer) pedido.customer = {};
                if (!pedido.customer.userAgent && !pedido.userAgent) {
                  pedido.customer.userAgent = req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
                  pedido.userAgent = pedido.customer.userAgent;
                }
                if (!pedido.customer.ip && !pedido.ip) {
                  pedido.customer.ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() || null;
                  pedido.ip = pedido.customer.ip;
                }
                enviarPedidoUtmify(pedido, 'paid').catch(e => {
                  console.warn('[verificar-pix] Erro ao sincronizar venda aprovada com UTMify:', e.message);
                });
              }
            } else {
              pedido = await obterPedido(transactionId);
            }
          } catch (eDb) {}

          sendJson(apiRes.statusCode || 200, {
            success: true,
            id: data.transactionId || parsed.id || transactionId,
            transaction_id: data.transactionId || parsed.id || transactionId,
            order_id: pedido ? pedido.order_id : null,
            status: statusRaw,
            paid: isPaid,
            amount: data.amount || parsed.amount
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
      console.error('Erro ao consultar status na Blackcat:', err);
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
