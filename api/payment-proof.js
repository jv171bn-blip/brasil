// api/payment-proof.js
// Serverless Function: Upload de Comprovante PIX e Encaminhamento ao Discord
const paymentProofHandler = require('../lib/handlers/payment-proof.js');

module.exports = async function handler(req, res) {
  return paymentProofHandler(req, res);
};

// Desativa o bodyParser automático do Vercel para permitir streaming de multipart/form-data
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
