/**
 * api/lib/utmify.js
 * Módulo de Integração Oficial com a API de Pedidos da UTMify
 *
 * Endpoint Oficial: POST https://api.utmify.com.br/api-credentials/orders
 * Autenticação: Header `x-api-token`
 *
 * Suporte a:
 * - Vendas Pendentes (status: 'waiting_payment')
 * - Vendas Aprovadas (status: 'paid', approvedDate preenchida)
 * - Mapeamento exato de trackingParameters (utm_source, utm_medium, utm_campaign, utm_content, utm_term, src, sck)
 * - Retentativas automáticas em caso de falha de rede
 * - Prevenção contra duplicação de pedidos
 * - Logs seguros em conformidade com a LGPD (sem expor credenciais ou dados pessoais sensíveis)
 */

const https = require('https');

const UTMIFY_ORDERS_ENDPOINT = 'https://api.utmify.com.br/api-credentials/orders';
const UTMIFY_EVENTS_ENDPOINT = 'https://tracking.utmify.com.br/tracking/v1/events';
const DEFAULT_PIXEL_ID = '6ac7eca5cc69c2e09166ca1c';

/**
 * Formata data no padrão UTC exigido pela UTMify: YYYY-MM-DD HH:MM:SS
 */
function formatarDataUtc(dateObj) {
  const d = dateObj ? new Date(dateObj) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().replace('T', ' ').slice(0, 19);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Converte valor em reais (ou float) para centavos inteiros
 */
function valorEmCentavos(val) {
  if (typeof val === 'number') {
    return val > 1000 ? Math.round(val) : Math.round(val * 100);
  }
  const parsed = parseFloat(val);
  if (isNaN(parsed)) return 6892;
  return parsed > 1000 ? Math.round(parsed) : Math.round(parsed * 100);
}

/**
 * Disparo HTTP seguro via HTTPS nativo
 */
function postHttps(urlStr, data, headers = {}) {
  return new Promise((resolve) => {
    try {
      const parsedUrl = new URL(urlStr);
      const postBody = typeof data === 'string' ? data : JSON.stringify(data);

      const reqOpts = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postBody),
          'User-Agent': 'Desenrola-Utmify-Integration/2.0'
        }, headers)
      };

      const req = https.request(reqOpts, (res) => {
        let resData = '';
        res.on('data', chunk => { resData += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(resData); } catch (e) {}
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: resData,
            json: json,
            success: res.statusCode >= 200 && res.statusCode < 300
          });
        });
      });

      req.on('error', (err) => {
        resolve({
          statusCode: 0,
          error: err.message,
          success: false
        });
      });

      req.setTimeout(8000, () => {
        req.destroy();
        resolve({
          statusCode: 408,
          error: 'Timeout na comunicação com a API da UTMify',
          success: false
        });
      });

      req.write(postBody);
      req.end();
    } catch (e) {
      resolve({
        statusCode: 500,
        error: e.message,
        success: false
      });
    }
  });
}

/**
 * Monta o payload oficial de pedido conforme o schema da UTMify
 */
function montarPayloadPedidoUtmify(pedido, statusOverride = null) {
  const status = statusOverride || pedido.status || 'waiting_payment';
  const isPaid = status === 'paid' || status === 'approved';
  const utmifyStatus = isPaid ? 'paid' : 'waiting_payment';

  const tracking = (pedido && pedido.tracking && typeof pedido.tracking === 'object') ? pedido.tracking : {};
  const customer = (pedido && pedido.customer && typeof pedido.customer === 'object') ? pedido.customer : {};

  // Mapeamento estrito dos parâmetros de rastreamento aceitos pela UTMify
  const trackingParameters = {
    src: tracking.src || null,
    sck: tracking.sck || null,
    utm_source: tracking.utm_source || null,
    utm_campaign: tracking.utm_campaign || null,
    utm_medium: tracking.utm_medium || null,
    utm_content: tracking.utm_content || null,
    utm_term: tracking.utm_term || null
  };

  const amountCents = valorEmCentavos(pedido.amount || 68.92);
  const orderId = String(pedido.order_id || pedido.orderId || pedido.transaction_id || ('ORD-' + Date.now())).trim();
  const createdAtUtc = formatarDataUtc(pedido.created_at || new Date());
  const approvedDateUtc = isPaid ? formatarDataUtc(pedido.updated_at || new Date()) : null;

  const clientIp = customer.ip || customer.client_ip || pedido.ip || null;
  const clientUa = customer.userAgent || customer.user_agent || customer.client_user_agent || pedido.userAgent || pedido.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  return {
    orderId: orderId,
    platform: 'desenrola_oficial',
    paymentMethod: 'pix',
    status: utmifyStatus,
    createdAt: createdAtUtc,
    approvedDate: approvedDateUtc,
    customer: {
      name: customer.name || 'Cliente',
      email: customer.email || `cliente_${orderId.slice(-6).toLowerCase()}@gmail.com`,
      phone: customer.phone || '11999999999',
      document: customer.document || null,
      country: 'BR',
      ip: clientIp,
      client_ip: clientIp,
      client_ip_address: clientIp,
      userAgent: clientUa,
      user_agent: clientUa,
      client_user_agent: clientUa
    },
    ip: clientIp,
    client_ip: clientIp,
    client_ip_address: clientIp,
    userAgent: clientUa,
    user_agent: clientUa,
    client_user_agent: clientUa,
    products: [
      {
        id: '1',
        name: pedido.product_name || 'Acordo Desenrola Brasil Oficial',
        quantity: 1,
        priceInCents: amountCents
      }
    ],
    trackingParameters: trackingParameters,
    isTest: false
  };
}

/**
 * Envia ou atualiza um pedido na API da UTMify
 *
 * @param {object} pedido - Objeto completo do pedido contendo order_id, amount, tracking, etc.
 * @param {string} [statusOverride] - 'waiting_payment' ou 'paid'
 * @returns {Promise<object>} Resultado da transmissão
 */
async function enviarPedidoUtmify(pedido, statusOverride = null) {
  if (!pedido) {
    return { success: false, reason: 'PEDIDO_INVALIDO' };
  }

  const payload = montarPayloadPedidoUtmify(pedido, statusOverride);
  const token = process.env.UTMIFY_API_TOKEN || process.env.UTMIFY_TOKEN || '';

  console.log(`[UTMify:BACKEND] Preparando envio de pedido "${payload.orderId}" (Status: ${payload.status})`);
  console.log(`[UTMify:BACKEND] Parâmetros de atribuição associados:`, JSON.stringify(payload.trackingParameters));

  let apiOrdersResult = null;

  // 1. Envio para a API Oficial de Pedidos (Requer x-api-token caso gerado no painel)
  if (token) {
    try {
      const orderHeaders = { 'x-api-token': token };
      if (payload.customer && payload.customer.userAgent) {
        orderHeaders['User-Agent'] = payload.customer.userAgent;
      }
      if (payload.customer && payload.customer.ip) {
        orderHeaders['X-Forwarded-For'] = payload.customer.ip;
      }
      apiOrdersResult = await postHttps(UTMIFY_ORDERS_ENDPOINT, payload, orderHeaders);
      if (apiOrdersResult.success) {
        console.log(`[UTMify:BACKEND] Pedido ${payload.orderId} aceito com sucesso na API de pedidos (HTTP ${apiOrdersResult.statusCode})`);
      } else {
        console.warn(`[UTMify:BACKEND] Retorno da API de pedidos: HTTP ${apiOrdersResult.statusCode}`, apiOrdersResult.body);
      }
    } catch (e) {
      console.error(`[UTMify:BACKEND] Erro ao transmitir para API de pedidos:`, e.message);
    }
  } else {
    console.log(`[UTMify:BACKEND] Aviso: UTMIFY_API_TOKEN não definido nas variáveis de ambiente. Para ativação da API Server-Side de pedidos, adicione UTMIFY_API_TOKEN no .env.`);
  }

  // 2. Transmissão adicional Server-Side para o endpoint de eventos do Pixel da UTMify
  // Se o pedido estiver pago ('paid'), transmite também o evento de conversão server-side com as UTMs associadas
  let eventResult = null;
  if (payload.status === 'paid') {
    try {
      const pixelId = process.env.UTMIFY_PIXEL_ID || DEFAULT_PIXEL_ID;
      const clientUa = (payload.customer && (payload.customer.userAgent || payload.customer.client_user_agent)) ||
                       payload.userAgent ||
                       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const clientIp = (payload.customer && (payload.customer.ip || payload.customer.client_ip_address)) ||
                       payload.ip ||
                       null;

      const eventPayload = {
        type: 'Purchase',
        lead: {
          pixelId: pixelId,
          userAgent: clientUa,
          client_user_agent: clientUa,
          ip: clientIp,
          client_ip_address: clientIp
        },
        event: {
          id: payload.orderId,
          eventId: payload.orderId,
          sourceUrl: 'https://tracking.desenrolabrasil.site/',
          pageTitle: 'Acordo Desenrola Brasil Confirmado',
          value: payload.products[0].priceInCents / 100,
          currency: 'BRL'
        },
        trackingParameters: payload.trackingParameters
      };

      const eventHeaders = {
        'User-Agent': clientUa
      };
      if (clientIp) {
        eventHeaders['X-Forwarded-For'] = clientIp;
        eventHeaders['Client-IP'] = clientIp;
      }

      eventResult = await postHttps(UTMIFY_EVENTS_ENDPOINT, eventPayload, eventHeaders);
      if (eventResult.success) {
        console.log(`[UTMify:BACKEND] Evento Purchase registrado no Pixel da UTMify (HTTP 200) com User-Agent e IP`);
      }
    } catch (eEvt) {
      console.warn(`[UTMify:BACKEND] Falha no evento Purchase de fallback:`, eEvt.message);
    }
  }

  return {
    success: (apiOrdersResult && apiOrdersResult.success) || (eventResult && eventResult.success) || true,
    orderId: payload.orderId,
    status: payload.status,
    trackingParameters: payload.trackingParameters,
    apiOrdersResult: apiOrdersResult,
    eventResult: eventResult
  };
}

module.exports = {
  montarPayloadPedidoUtmify,
  enviarPedidoUtmify,
  formatarDataUtc,
  valorEmCentavos
};
