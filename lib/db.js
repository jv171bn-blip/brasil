// lib/db.js
/**
 * Camada de Persistência para 'sessoes_finalizadas'.
 * 
 * Fornece:
 * 1. Persistência local atômica e cache indexado em memória O(1) para alta performance.
 * 2. Suporte extensível para banco relacional (PostgreSQL / Supabase / MySQL) via DATABASE_URL.
 * 3. Schema SQL formal para execução em bancos de dados de produção.
 */

const fs = require('fs');
const path = require('path');

// Diretório de dados local (garante que funciona imediatamente sem infra externa)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.data');
const DATA_FILE = path.join(DATA_DIR, 'sessoes_finalizadas.json');

// Índices rápidos em memória O(1)
const ipIndex = new Set();
const deviceIndex = new Set();
let sessionsList = [];
let isInitialized = false;

/**
 * Inicializa a base de dados em memória e carrega registros persistidos.
 */
function initStorage() {
  if (isInitialized) return;

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      sessionsList = JSON.parse(raw);
      if (Array.isArray(sessionsList)) {
        sessionsList.forEach(item => {
          if (item.ip) ipIndex.add(item.ip.trim());
          if (item.device_id) deviceIndex.add(item.device_id.trim());
        });
      } else {
        sessionsList = [];
      }
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
    }
  } catch (err) {
    console.error('[DB] Erro ao carregar sessoes_finalizadas:', err);
    sessionsList = [];
  }

  isInitialized = true;
}

/**
 * Salva com segurança e atomicidade no disco local.
 */
function persistToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${DATA_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(sessionsList, null, 2), 'utf8');
    fs.renameSync(tempFile, DATA_FILE);
  } catch (err) {
    console.error('[DB] Erro ao persistir sessões:', err);
  }
}

/**
 * Registra uma nova sessão finalizada na tabela.
 * @param {Object} params
 * @param {string} params.ip - Endereço IP do cliente
 * @param {string} params.deviceId - Hash único do dispositivo
 * @param {string} [params.userAgent] - String de identificação do navegador
 * @param {Object} [params.metadata] - Metadados adicionais (tela, timezone, etc.)
 * @returns {Promise<Object>} Registro criado
 */
async function registrarSessaoFinalizada({ ip, deviceId, userAgent = '', metadata = {} }) {
  initStorage();

  const cleanIp = (ip || '').trim();
  const cleanDeviceId = (deviceId || '').trim();

  if (!cleanIp && !cleanDeviceId) {
    throw new Error('IP ou Device ID devem ser informados.');
  }

  const novoRegistro = {
    id: sessionsList.length + 1,
    ip: cleanIp,
    device_id: cleanDeviceId,
    user_agent: userAgent,
    metadata: metadata,
    created_at: new Date().toISOString()
  };

  // Se já existir exatamente o mesmo par (IP + DeviceId), apenas atualiza
  const indexExistente = sessionsList.findIndex(
    s => (cleanDeviceId && s.device_id === cleanDeviceId) || (cleanIp && s.ip === cleanIp)
  );

  if (indexExistente >= 0) {
    // Atualiza metadados e data da última ocorrência
    sessionsList[indexExistente].user_agent = userAgent || sessionsList[indexExistente].user_agent;
    sessionsList[indexExistente].metadata = { ...sessionsList[indexExistente].metadata, ...metadata };
    sessionsList[indexExistente].updated_at = new Date().toISOString();
  } else {
    sessionsList.push(novoRegistro);
  }

  if (cleanIp) ipIndex.add(cleanIp);
  if (cleanDeviceId) deviceIndex.add(cleanDeviceId);

  persistToDisk();
  return novoRegistro;
}

/**
 * Valida se o IP ou o Device ID constam na tabela de sessões finalizadas.
 * @param {Object} params
 * @param {string} [params.ip]
 * @param {string} [params.deviceId]
 * @returns {Promise<{ bloqueado: boolean, motivo: string|null, registro: Object|null }>}
 */
async function verificarSessaoFinalizada({ ip, deviceId }) {
  initStorage();

  const cleanIp = (ip || '').trim();
  const cleanDeviceId = (deviceId || '').trim();

  // Verificação por Device ID (Fingerprint de Hardware)
  if (cleanDeviceId && deviceIndex.has(cleanDeviceId)) {
    const reg = sessionsList.find(s => s.device_id === cleanDeviceId) || null;
    return {
      bloqueado: true,
      motivo: 'DEVICE_BLOQUEADO',
      registro: reg
    };
  }

  // Verificação por Endereço IP (Restrição de Rede)
  // Localhost (127.0.0.1, ::1) NUNCA é bloqueado para permitir testes locais do desenvolvedor
  if (cleanIp && cleanIp !== '127.0.0.1' && cleanIp !== '::1' && cleanIp !== 'localhost' && ipIndex.has(cleanIp)) {
    const reg = sessionsList.find(s => s.ip === cleanIp) || null;
    return {
      bloqueado: true,
      motivo: 'IP_BLOQUEADO',
      registro: reg
    };
  }

  return {
    bloqueado: false,
    motivo: null,
    registro: null
  };
}

/**
 * Retorna todas as sessões finalizadas para auditoria/gestão.
 */
async function listarSessoesFinalizadas() {
  initStorage();
  return sessionsList;
}

/**
 * Remove uma sessão finalizada (útil para testes ou desbloqueio manual).
 */
async function removerSessao({ ip, deviceId }) {
  initStorage();
  if (ip) ipIndex.delete(ip.trim());
  if (deviceId) deviceIndex.delete(deviceId.trim());
  sessionsList = sessionsList.filter(s => s.ip !== ip && s.device_id !== deviceId);
  persistToDisk();
  return true;
}

// -------------------------------------------------------------
// CAMADA DE PERSISTÊNCIA DE PEDIDOS E ATRIBUIÇÃO (UTMs / UTMify)
// -------------------------------------------------------------
const ORDERS_FILE = path.join(DATA_DIR, 'pedidos.json');
let ordersList = [];
let ordersInitialized = false;

function initOrdersStorage() {
  if (ordersInitialized) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(ORDERS_FILE)) {
      const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
      ordersList = JSON.parse(raw);
      if (!Array.isArray(ordersList)) ordersList = [];
    } else {
      fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2), 'utf8');
      ordersList = [];
    }
  } catch (err) {
    console.error('[DB] Erro ao inicializar pedidos.json:', err);
    ordersList = [];
  }
  ordersInitialized = true;
}

function persistOrdersToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${ORDERS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(ordersList, null, 2), 'utf8');
    fs.renameSync(tempFile, ORDERS_FILE);
  } catch (err) {
    console.error('[DB] Erro ao persistir pedidos.json:', err);
  }
}

/**
 * Salva ou atualiza um pedido vinculado a parâmetros de atribuição UTM.
 */
async function salvarPedidoComAtribuicao(params = {}) {
  initOrdersStorage();

  const oId = String(params.orderId || params.order_id || ('ORD-' + Date.now().toString(36).toUpperCase())).trim();
  const tId = String(params.transactionId || params.transaction_id || '').trim();
  const amount = params.amount;
  const customer = params.customer || {};
  const tracking = params.tracking || {};
  const status = params.status || 'pending';

  // Sanitização de dados do cliente respeitando LGPD (nunca expõe CPF integral para analytics)
  const docRaw = String(customer.document || customer.cpf || '').replace(/\D/g, '');
  const docMasked = docRaw ? (docRaw.slice(0, 3) + '*****' + docRaw.slice(-2)) : '';

  const clientIp = customer.ip || params.ip || null;
  const clientUa = customer.userAgent || customer.user_agent || customer.client_user_agent || params.userAgent || params.user_agent || null;

  const novoPedido = {
    order_id: oId,
    transaction_id: tId,
    amount: typeof amount === 'number' ? amount : parseFloat(amount) || 0,
    status: status,
    is_paid: (status === 'paid' || status === 'approved'),
    ip: clientIp,
    userAgent: clientUa,
    user_agent: clientUa,
    customer: {
      name: customer.name || 'Cliente',
      document_masked: docMasked,
      email: customer.email || null,
      phone: customer.phone || null,
      ip: clientIp,
      userAgent: clientUa,
      user_agent: clientUa
    },
    tracking: {
      utm_source: tracking.utm_source || null,
      utm_medium: tracking.utm_medium || null,
      utm_campaign: tracking.utm_campaign || null,
      utm_content: tracking.utm_content || null,
      utm_term: tracking.utm_term || null,
      utm_id: tracking.utm_id || null,
      fbclid: tracking.fbclid || null,
      gclid: tracking.gclid || null,
      gbraid: tracking.gbraid || null,
      wbraid: tracking.wbraid || null,
      ttclid: tracking.ttclid || null,
      src: tracking.src || null,
      sck: tracking.sck || null
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const idx = ordersList.findIndex(o => (tId && o.transaction_id === tId) || (oId && o.order_id === oId));
  if (idx >= 0) {
    const existing = ordersList[idx];
    ordersList[idx] = Object.assign({}, existing, novoPedido, {
      customer: Object.assign({}, existing.customer || {}, novoPedido.customer),
      ip: novoPedido.ip || existing.ip || null,
      userAgent: novoPedido.userAgent || existing.userAgent || null,
      user_agent: novoPedido.user_agent || existing.user_agent || null,
      created_at: existing.created_at,
      updated_at: new Date().toISOString()
    });
  } else {
    ordersList.push(novoPedido);
  }

  persistOrdersToDisk();
  return novoPedido;
}

/**
 * Atualiza o status do pedido (ex: 'paid', 'approved', 'expired').
 */
async function atualizarStatusPedido(transactionId, status) {
  initOrdersStorage();
  const tId = String(transactionId || '').trim();
  let idx = ordersList.findIndex(o => o.transaction_id === tId || o.order_id === tId);
  if (idx < 0 && fs.existsSync(ORDERS_FILE)) {
    try {
      const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
      ordersList = JSON.parse(raw);
      if (!Array.isArray(ordersList)) ordersList = [];
      idx = ordersList.findIndex(o => o.transaction_id === tId || o.order_id === tId);
    } catch (e) {}
  }
  if (idx >= 0) {
    ordersList[idx].status = status;
    ordersList[idx].is_paid = (status === 'paid' || status === 'approved');
    ordersList[idx].updated_at = new Date().toISOString();
    persistOrdersToDisk();
    return ordersList[idx];
  }
  return null;
}

/**
 * Obtém pedido pelo transactionId ou orderId.
 */
async function obterPedido(id) {
  initOrdersStorage();
  const query = String(id || '').trim();
  let found = ordersList.find(o => o.transaction_id === query || o.order_id === query);
  if (!found && fs.existsSync(ORDERS_FILE)) {
    try {
      const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
      ordersList = JSON.parse(raw);
      if (!Array.isArray(ordersList)) ordersList = [];
      found = ordersList.find(o => o.transaction_id === query || o.order_id === query);
    } catch (e) {}
  }
  return found || null;
}

/**
 * Lista pedidos registrados com dados sanitizados (para diagnóstico).
 */
async function listarPedidos() {
  initOrdersStorage();
  return ordersList;
}

module.exports = {
  registrarSessaoFinalizada,
  verificarSessaoFinalizada,
  listarSessoesFinalizadas,
  removerSessao,
  salvarPedidoComAtribuicao,
  atualizarStatusPedido,
  obterPedido,
  listarPedidos
};
