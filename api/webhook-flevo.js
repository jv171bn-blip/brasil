// api/webhook-flevo.js
// Endpoint seguro para recebimento e processamento de webhooks da adquirente (FlevoPay / Gateway PIX)
const { obterPedido, atualizarStatusPedido, salvarPedidoComAtribuicao } = require('./lib/db.js');
const { enviarPedidoUtmify } = require('./lib/utmify.js');

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Signature, Authorization');

  if (req.method === 'OPTIONS') {
    if (typeof res.status === 'function') return res.status(200).end();
    res.writeHead(200);
    return res.end();
  }

  if (req.method === 'GET') {
    return sendJson(200, {
      service: 'Webhook Pagamento FlevoPay / UTMify',
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

    console.log('[Webhook Pagamento] Payload recebido:', JSON.stringify(payload));

    // Extração flexível dos identificadores da transação
    const transactionId = String(
      payload.transaction_id ||
      payload.id ||
      (payload.data && (payload.data.transaction_id || payload.data.id)) ||
      (payload.transaction && (payload.transaction.id || payload.transaction.transaction_id)) ||
      payload.reference ||
      ''
    ).trim();

    const rawStatus = String(
      payload.status ||
      (payload.data && payload.data.status) ||
      (payload.transaction && payload.transaction.status) ||
      payload.event ||
      ''
    ).toLowerCase().trim();

    const isPaid = (
      rawStatus === 'paid' ||
      rawStatus === 'approved' ||
      rawStatus === 'pago' ||
      rawStatus === 'transaction.paid' ||
      rawStatus === 'payment.confirmed'
    );

    if (!transactionId) {
      console.warn('[Webhook Pagamento] Notificação recebida sem identificador de transação válido.');
      return sendJson(400, { success: false, error: 'missing_transaction_id' });
    }

    // Localiza o pedido original registrado com suas respectivas UTMs
    let pedido = await obterPedido(transactionId);

    if (!pedido && payload.reference) {
      pedido = await obterPedido(payload.reference);
    }

    if (!pedido) {
      console.warn(`[Webhook Pagamento] Pedido com ID "${transactionId}" não localizado no banco local. Criando registro com tracking fallback.`);
      pedido = await salvarPedidoComAtribuicao({
        orderId: 'ORD-' + transactionId,
        transactionId: transactionId,
        amount: payload.amount || (payload.data && payload.data.amount) || 68.92,
        status: isPaid ? 'paid' : 'pending',
        tracking: (payload.metadata || payload.tracking || (payload.data && payload.data.metadata) || {})
      });
    }

    // Se o pagamento foi confirmado
    if (isPaid) {
      // Prevenção contra duplicação: se já foi sincronizado como pago, confirma idempotência
      if (pedido.status === 'paid' && pedido.is_paid && pedido.utmify_paid_synced) {
        console.log(`[Webhook Pagamento] Pedido "${pedido.order_id}" já foi previamente homologado e sincronizado. Descarte de duplicação efetuado.`);
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

      console.log(`[Webhook Pagamento] Venda confirmada e transmitida à UTMify: Pedido "${pedido.order_id}"`, utmifyRes);

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
    console.error('[Webhook Pagamento] Erro no processamento:', err);
    return sendJson(500, {
      success: false,
      error: 'internal_error',
      message: err.message
    });
  }
};
