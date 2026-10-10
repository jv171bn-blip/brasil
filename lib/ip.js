// lib/ip.js
/**
 * Utilitário seguro para extração e normalização do endereço IP do cliente.
 * Compatível com proxies reversos, CDNs (Cloudflare, Vercel, AWS) e conexões diretas.
 */

function getClientIp(req) {
  if (!req) return '127.0.0.1';

  // 1. Headers comuns fornecidos por CDNs e Proxies
  const headers = req.headers || {};
  
  const cfIp = headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') {
    return cleanIp(cfIp);
  }

  const xRealIp = headers['x-real-ip'];
  if (xRealIp && typeof xRealIp === 'string') {
    return cleanIp(xRealIp);
  }

  const xForwardedFor = headers['x-forwarded-for'];
  if (xForwardedFor && typeof xForwardedFor === 'string') {
    // Pode vir como uma lista: "client, proxy1, proxy2"
    const clientIp = xForwardedFor.split(',')[0].trim();
    if (clientIp) {
      return cleanIp(clientIp);
    }
  }

  // 2. Conexão direta via socket
  const socketIp = req.socket?.remoteAddress || 
                   req.connection?.remoteAddress || 
                   req.connection?.socket?.remoteAddress;

  if (socketIp && typeof socketIp === 'string') {
    return cleanIp(socketIp);
  }

  return '127.0.0.1';
}

function cleanIp(ip) {
  let cleaned = String(ip).trim();

  // Se tiver porta inclusa (ex: 192.168.0.1:4532 ou [2001:db8::1]:80)
  if (cleaned.startsWith('[') && cleaned.includes(']:')) {
    cleaned = cleaned.substring(1, cleaned.indexOf(']:'));
  } else if (!cleaned.includes(':') && cleaned.includes(':')) {
    cleaned = cleaned.split(':')[0];
  }

  // Remove prefixo IPv4 mapeado em IPv6 (ex: ::ffff:192.168.1.1)
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.replace('::ffff:', '');
  }

  // Normaliza localhost IPv6 para IPv4 legível
  if (cleaned === '::1') {
    cleaned = '127.0.0.1';
  }

  return cleaned;
}

module.exports = {
  getClientIp,
  cleanIp
};
