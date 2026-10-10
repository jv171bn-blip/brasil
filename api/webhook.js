// api/webhook.js
// Serverless Function consolidada: Webhooks de Pagamento (Blackcat & Flevo)
// Agrupa: webhook-blackcat, webhook-flevo, webhook-pagamento, webhook
const webhookBlackcatHandler = require('../lib/handlers/webhook-blackcat.js');

module.exports = async function handler(req, res) {
  // Webhooks de pagamento compartilham o pipeline unificado com UTMify
  return webhookBlackcatHandler(req, res);
};
