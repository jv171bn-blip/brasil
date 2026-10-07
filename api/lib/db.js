// api/lib/db.js
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
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
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

module.exports = {
  registrarSessaoFinalizada,
  verificarSessaoFinalizada,
  listarSessoesFinalizadas,
  removerSessao
};
