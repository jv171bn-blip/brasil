// api/consultar-cpf.js
// Serverless Function: Consulta Oficial de CPF (Serasa / APIsegura) com Fallback Resiliente
const consultarCpfHandler = require('../lib/handlers/consultar-cpf.js');

module.exports = async function handler(req, res) {
  return consultarCpfHandler(req, res);
};
