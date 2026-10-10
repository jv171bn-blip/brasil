// lib/handlers/finalizar-jornada.js
const { getClientIp } = require('../ip.js');
const { registrarSessaoFinalizada } = require('../db.js');

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

  if (req.method !== 'POST') {
    return sendJson(405, { error: 'method_not_allowed', message: 'Método não permitido. Utilize POST.' });
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch(e) { body = {}; }
    }

    const deviceId = (body.deviceId || body.device_id || '').trim();
    const metadata = body.metadata || {};
    const userAgent = req.headers['user-agent'] || '';
    const clientIp = getClientIp(req);

    if (!deviceId && !clientIp) {
      return sendJson(400, {
        success: false,
        error: 'missing_identifiers',
        message: 'Identificadores técnicos ausentes (IP e Device ID).'
      });
    }

    // Registra a restrição na tabela de sessões finalizadas
    const registro = await registrarSessaoFinalizada({
      ip: clientIp,
      deviceId: deviceId,
      userAgent: userAgent,
      metadata: metadata
    });

    console.log(`[Segurança] Jornada finalizada registrada com sucesso: IP=${clientIp} | DeviceID=${deviceId}`);

    // Cookie de contingência (expira em 1 ano)
    const cookieHeader = `__funnel_completed=1; Path=/; Max-Age=31536000; SameSite=Lax`;
    if (typeof res.setHeader === 'function') {
      res.setHeader('Set-Cookie', cookieHeader);
    }

    return sendJson(200, {
      success: true,
      message: 'Jornada finalizada e restrição ativada.',
      data: {
        ip: clientIp,
        deviceId: deviceId,
        criadoEm: registro.created_at
      }
    });
  } catch (error) {
    console.error('[Segurança] Erro ao registrar finalização da jornada:', error);
    return sendJson(500, {
      success: false,
      error: 'internal_error',
      message: 'Erro interno ao registrar bloqueio de segurança.'
    });
  }
};
