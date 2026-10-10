// api/pix.js
// Serverless Function consolidada: Pagamentos PIX & Pedidos
// Agrupa: gerar-pix, verificar-pix, pedidos
const gerarPixHandler = require('../lib/handlers/gerar-pix.js');
const verificarPixHandler = require('../lib/handlers/verificar-pix.js');
const pedidosHandler = require('../lib/handlers/pedidos.js');

module.exports = async function handler(req, res) {
  const query = req.query || {};
  const pathname = (req.url || '').split('?')[0].toLowerCase();

  // Identificação da ação via query param (?action=...) ou fallback pelo caminho
  let action = String(query.action || '').toLowerCase().trim();
  if (!action) {
    if (pathname.includes('verificar') || pathname.includes('check-payment')) {
      action = 'verificar';
    } else if (pathname.includes('pedidos') || pathname.includes('orders')) {
      action = 'pedidos';
    } else {
      action = 'gerar';
    }
  }

  // Roteamento interno
  if (action === 'verificar' || action === 'check' || action === 'status') {
    return verificarPixHandler(req, res);
  }

  if (action === 'pedidos' || action === 'orders') {
    return pedidosHandler(req, res);
  }

  return gerarPixHandler(req, res);
};
