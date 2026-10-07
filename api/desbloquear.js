// api/desbloquear.js
const { getClientIp } = require('./lib/ip.js');
const { removerSessao } = require('./lib/db.js');

module.exports = async function handler(req, res) {
  const clientIp = getClientIp(req);
  const query = req.query || {};
  const deviceId = query.deviceId || query.device_id || '';

  // Remove o IP e o Device ID da tabela de bloqueios
  await removerSessao({ ip: clientIp, deviceId: deviceId });

  // Limpa cookie de bloqueio e ativa o cookie permanente de Admin Bypass
  const headersCookie = [
    '__funnel_completed=; Path=/; Max-Age=0',
    '__admin_bypass=1; Path=/; Max-Age=31536000; SameSite=Lax'
  ];

  if (typeof res.setHeader === 'function') {
    res.setHeader('Set-Cookie', headersCookie);
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Modo Desenvolvedor / Desbloqueio</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f0fdf4; color: #166534; text-align: center; padding: 20px; }
    .card { background: #fff; padding: 36px 30px; border-radius: 12px; box-shadow: 0 4px 14px rgba(0,0,0,0.08); max-width: 450px; border: 1px solid #bbf7d0; }
    h2 { margin: 0 0 10px; font-size: 22px; color: #15803d; }
    p { font-size: 14px; color: #374151; line-height: 1.5; margin-bottom: 20px; }
    .badge { background: #dcfce7; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-family: monospace; }
  </style>
</head>
<body>
  <div class="card">
    <h2>🔓 Dispositivo Desbloqueado!</h2>
    <p>O <strong>Modo Administrador / Bypass</strong> foi ativado com sucesso para o seu navegador e conexão IP (<span class="badge">${clientIp}</span>).</p>
    <p style="font-size: 13px; color: #6b7280;">Você nunca mais será bloqueado nesta máquina enquanto o bypass estiver ativo.</p>
    <p>Redirecionando para a página inicial...</p>
  </div>
  <script>
    try {
      localStorage.removeItem('__desenrola_completed');
      localStorage.setItem('__admin_bypass', 'true');
    } catch(e) {}
    setTimeout(() => { window.location.href = '/'; }, 1800);
  </script>
</body>
</html>`;

  if (typeof res.status === 'function') {
    return res.status(200).send(html);
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(html);
};
