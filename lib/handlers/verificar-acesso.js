// lib/handlers/verificar-acesso.js
const { getClientIp } = require('../ip.js');
const { verificarSessaoFinalizada } = require('../db.js');

module.exports = async function handler(req, res) {
  const sendJson = (status, data) => {
    if (typeof res.status === 'function') {
      return res.status(status).json(data);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  };

  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  try {
    const query = req.query || {};
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { body = {}; }
    }

    const deviceId = (query.deviceId || query.device_id || body.deviceId || body.device_id || '').trim();
    const clientIp = getClientIp(req);

    // Verificação via Cookie de redundância
    const cookieHeader = req.headers['cookie'] || '';
    const hasFunnelCookie = cookieHeader.includes('__funnel_completed=1');

    // Consulta na base de dados indexada de sessões finalizadas
    const resultado = await verificarSessaoFinalizada({
      ip: clientIp,
      deviceId: deviceId
    });

    if (resultado.bloqueado) {
      return sendJson(200, {
        bloqueado: true,
        motivo: resultado.motivo,
        ip: clientIp,
        deviceId: deviceId,
        redirecionarPara: '/404.html'
      });
    }

    if (hasFunnelCookie) {
      return sendJson(200, {
        bloqueado: true,
        motivo: 'COOKIE_IDENTIFICADO',
        ip: clientIp,
        deviceId: deviceId,
        redirecionarPara: '/404.html'
      });
    }

    return sendJson(200, {
      bloqueado: false,
      motivo: null,
      ip: clientIp,
      deviceId: deviceId
    });
  } catch (error) {
    console.error('[Segurança] Erro ao verificar acesso:', error);
    return sendJson(500, {
      bloqueado: false,
      error: 'internal_error',
      message: 'Falha na verificação de acesso.'
    });
  }
};
