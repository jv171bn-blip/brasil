// api/acesso.js
// Serverless Function consolidada: Controle de Acesso, Anti-Fraude e Desbloqueio
// Agrupa: verificar-acesso, finalizar-jornada, desbloquear
const verificarAcessoHandler = require('../lib/handlers/verificar-acesso.js');
const finalizarJornadaHandler = require('../lib/handlers/finalizar-jornada.js');
const desbloquearHandler = require('../lib/handlers/desbloquear.js');

module.exports = async function handler(req, res) {
  const query = req.query || {};
  const pathname = (req.url || '').split('?')[0].toLowerCase();

  // Identificação da ação via query param (?action=...) ou fallback pelo caminho
  let action = String(query.action || '').toLowerCase().trim();
  if (!action) {
    if (pathname.includes('finalizar')) {
      action = 'finalizar';
    } else if (pathname.includes('desbloquear')) {
      action = 'desbloquear';
    } else {
      action = 'verificar';
    }
  }

  // Roteamento interno
  if (action === 'finalizar') {
    return finalizarJornadaHandler(req, res);
  }

  if (action === 'desbloquear') {
    return desbloquearHandler(req, res);
  }

  return verificarAcessoHandler(req, res);
};
