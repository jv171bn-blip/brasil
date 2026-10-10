// lib/handlers/webhook-blackcat.js
// Endpoint seguro para recebimento e processamento de webhooks da adquirente Blackcat / UTMify
const { obterPedido, atualizarStatusPedido, salvarPedidoComAtribuicao } = require('../db.js');
const { enviarPedidoUtmify } = require('../utmify.js');

module.exports = async function handler(req, res) {
  const sendJson = (status, data) => {
    if (typeof res.status === 'function') {
      return res.status(status).json(data);
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  };

  // Suporte a CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature, Authorization, X-API-Key, X-Webhook-Event, X-Webhook-Source');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  if (req.method === 'GET') {
    return sendJson(200, {
      service: 'Webhook Pagamento Blackcat / UTMify',
      status: 'active',
      timestamp: new Date().toISOString()
    });
  }

  try {
    let payload = {};
    if (req.body) {
      if (typeof req.body === 'string') {
        try { payload = JSON.parse(req.body); } catch (e) { payload = {}; }
      } else {
        payload = req.body;
      }
    }

    console.log('[Webhook Blackcat] Payload recebido:', JSON.stringify(payload));

    const webhookEvent = String(req.headers['x-webhook-event'] || payload.event || '').toLowerCase().trim();

    // Extração flexível dos identificadores da transação
    const transactionId = String(
      payload.transactionId ||
      payload.transaction_id ||
      payload.id ||
      (payload.data && (payload.data.transactionId || payload.data.transaction_id || payload.data.id)) ||
      (payload.transaction && (payload.transaction.id || payload.transaction.transaction_id)) ||
      payload.externalReference ||
      payload.reference ||
      ''
    ).trim();

    const rawStatus = String(
      payload.status ||
      (payload.data && payload.data.status) ||
      (payload.transaction && payload.transaction.status) ||
      webhookEvent ||
      ''
    ).toLowerCase().trim();

    const isPaid = (
      rawStatus === 'paid' ||
      rawStatus === 'approved' ||
      rawStatus === 'pago' ||
      rawStatus === 'transaction.paid' ||
      rawStatus === 'payment.confirmed' ||
      webhookEvent === 'transaction.paid'
    );

    if (!transactionId) {
      console.warn('[Webhook Blackcat] Notificação recebida sem identificador de transação válido.');
      return sendJson(400, { success: false, error: 'missing_transaction_id' });
    }

    // Localiza o pedido original registrado com suas respectivas UTMs
    let pedido = await obterPedido(transactionId);

    const ref = payload.externalReference || payload.externalRef || payload.reference;
    if (!pedido && ref) {
      pedido = await obterPedido(ref);
    }

    const payloadUtm = payload.utm || payload.metadata || payload.tracking || (payload.data && payload.data.utm) || {};

    if (!pedido) {
      console.warn(`[Webhook Blackcat] Pedido com ID "${transactionId}" não localizado no banco local. Criando registro com tracking fallback.`);
      const fallbackIp = (
        (payload.customer && (payload.customer.ip || payload.customer.client_ip)) ||
        (payloadUtm && (payloadUtm.ip || payloadUtm.client_ip)) ||
        (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '').split(',')[0].trim() ||
        null
      );
      const fallbackUa = (
        (payload.customer && (payload.customer.userAgent || payload.customer.user_agent || payload.customer.client_user_agent)) ||
        (payloadUtm && (payloadUtm.userAgent || payloadUtm.user_agent || payloadUtm.client_user_agent)) ||
        payload.client_user_agent ||
        payload.userAgent ||
        req.headers['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      const parsedAmount = payload.amount || (payload.data && payload.data.amount) || 6892;

      pedido = await salvarPedidoComAtribuicao({
        orderId: ref || ('ORD-' + transactionId),
        transactionId: transactionId,
        amount: parsedAmount,
        status: isPaid ? 'paid' : 'pending',
        customer: {
          name: (payload.customer && payload.customer.name) || 'Cliente',
          email: (payload.customer && payload.customer.email) || null,
          phone: (payload.customer && payload.customer.phone) || null,
          ip: fallbackIp,
          userAgent: fallbackUa,
          user_agent: fallbackUa
        },
        ip: fallbackIp,
        userAgent: fallbackUa,
        user_agent: fallbackUa,
        tracking: payloadUtm
      });
    } else {
      // Garante que IP e User-Agent estão preenchidos
      if (!pedido.customer) pedido.customer = {};
      if (!pedido.customer.userAgent && !pedido.userAgent) {
        const foundUa = (
          (payload.customer && (payload.customer.userAgent || payload.customer.user_agent || payload.customer.client_user_agent)) ||
          (payloadUtm && (payloadUtm.userAgent || payloadUtm.user_agent || payloadUtm.client_user_agent)) ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );
        pedido.customer.userAgent = foundUa;
        pedido.customer.user_agent = foundUa;
        pedido.userAgent = foundUa;
        pedido.user_agent = foundUa;
      }
      if (!pedido.customer.ip && !pedido.ip) {
        const foundIp = (
          (payload.customer && (payload.customer.ip || payload.customer.client_ip)) ||
          (payloadUtm && (payloadUtm.ip || payloadUtm.client_ip)) ||
          null
        );
        if (foundIp) {
          pedido.customer.ip = foundIp;
          pedido.ip = foundIp;
        }
      }
    }

    // Se o pagamento foi confirmado
    if (isPaid) {
      // Prevenção contra duplicação (idempotência)
      if (pedido.status === 'paid' && pedido.is_paid && pedido.utmify_paid_synced) {
        console.log(`[Webhook Blackcat] Pedido "${pedido.order_id}" já foi previamente homologado e sincronizado. Descarte de duplicação efetuado.`);
        return sendJson(200, {
          success: true,
          idempotent: true,
          order_id: pedido.order_id,
          status: 'paid'
        });
      }

      // Atualiza status do pedido no backend
      const pedidoAtualizado = await atualizarStatusPedido(transactionId, 'paid');
      if (pedidoAtualizado) {
        pedidoAtualizado.utmify_paid_synced = true;
      }

      // Transmite a atualização oficial para a UTMify
      const utmifyRes = await enviarPedidoUtmify(pedidoAtualizado || pedido, 'paid');

      console.log(`[Webhook Blackcat] Venda confirmada e transmitida à UTMify: Pedido "${pedido.order_id}"`, utmifyRes);

      return sendJson(200, {
        success: true,
        order_id: pedido.order_id,
        transaction_id: transactionId,
        status: 'paid',
        utmify_sync: utmifyRes
      });
    }

    // Transação ainda pendente ou outro status
    return sendJson(200, {
      success: true,
      transaction_id: transactionId,
      status: rawStatus || 'pending'
    });

  } catch (err) {
    console.error('[Webhook Blackcat] Erro no processamento:', err);
    return sendJson(500, {
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
};
