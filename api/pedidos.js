// api/pedidos.js
// Endpoint seguro para consulta de pedidos com dados de atribuição (UTMify)
const { listarPedidos } = require('./lib/db.js');

module.exports = async function handler(req, res) {
  const sendJson = (status, data) => {
    if (typeof res.status === 'function') {
      return res.status(status).json(data);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  try {
    const pedidos = await listarPedidos();
    return sendJson(200, {
      success: true,
      total: pedidos.length,
      pedidos: pedidos
    });
  } catch (err) {
    return sendJson(500, {
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
};
