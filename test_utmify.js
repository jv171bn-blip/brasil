/**
 * test_utmify.js
 * Suíte de Testes Automatizados de Ponta a Ponta para o Sistema de Rastreamento e Atribuição UTMify
 *
 * Cenários Testados:
 * - Teste A: Entrada com UTMs (Captura, First Touch, Last Touch, Sincronização LocalStorage)
 * - Teste B: Atualização de página (Preservação sem sobrescrever com valores vazios)
 * - Teste C: Navegação interna (Propagação entre páginas do funil e checkout)
 * - Teste D: Nova campanha (Preservação de First Touch e atualização de Last Touch)
 * - Teste E: Falha de rede e resiliência (Exponential Backoff e Idempotência)
 * - Teste F: Checkout PIX (Persistência no backend e associação com pedido)
 * - Teste G: Pagamento aprovado (Disparo de Purchase condicionado estritamente à confirmação)
 * - Teste H: Recebimento e validação oficial pela API da UTMify
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Simulação de ambiente de navegador para testes unitários da camada url-params.js
class MockLocalStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return this.store.hasOwnProperty(key) ? this.store[key] : null;
  }
  setItem(key, val) {
    this.store[key] = String(val);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
}

// Utilitário de requisição HTTP/HTTPS
function makeRequest(urlStr, options = {}, postData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (postData) {
      const dataBuf = Buffer.isBuffer(postData) ? postData : Buffer.from(typeof postData === 'string' ? postData : JSON.stringify(postData));
      reqOpts.headers['Content-Length'] = dataBuf.length;
      if (!reqOpts.headers['Content-Type']) reqOpts.headers['Content-Type'] = 'application/json';
    }

    const req = lib.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        let parsedJson = null;
        try { parsedJson = JSON.parse(bodyStr); } catch (e) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: bodyStr,
          json: parsedJson
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(Buffer.isBuffer(postData) ? postData : Buffer.from(typeof postData === 'string' ? postData : JSON.stringify(postData)));
    }
    req.end();
  });
}

const RESULTS = [];
function reportTest(code, title, passed, details = null) {
  RESULTS.push({ code, title, passed, details });
  const icon = passed ? '✅ [PASSOU]' : '❌ [FALHOU]';
  console.log(`${icon} ${code}: ${title}`);
  if (details) {
    console.log(`   Detalhes: ${typeof details === 'object' ? JSON.stringify(details, null, 2) : details}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🚀 INICIANDO AUDITORIA E TESTES AUTOMATIZADOS DO SISTEMA UTMIFY');
  console.log('================================================================\n');

  // Carrega lógica de url-params.js em sandbox DOM
  const urlParamsCode = fs.readFileSync(path.join(__dirname, 'url-params.js'), 'utf8');

  // Ambiente mock para Testes A, B, C, D
  const mockStorage = new MockLocalStorage();
  const mockWindow = {
    location: {
      origin: 'https://desenrolabrasil.site',
      href: 'https://desenrolabrasil.site/?utm_source=facebook&utm_medium=paid&utm_campaign=teste123&utm_content=criativo01&utm_term=termo01&fbclid=fb_test_123',
      search: '?utm_source=facebook&utm_medium=paid&utm_campaign=teste123&utm_content=criativo01&utm_term=termo01&fbclid=fb_test_123',
      hostname: 'desenrolabrasil.site'
    },
    localStorage: mockStorage,
    sessionStorage: mockStorage,
    pixelId: '6ac7eca5cc69c2e09166ca1c'
  };

  const evalContext = new Function('window', 'document', 'localStorage', 'sessionStorage', urlParamsCode);
  evalContext(mockWindow, {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    readyState: 'complete'
  }, mockStorage, mockStorage);

  // -------------------------------------------------------------------------
  // TESTE A: Entrada com UTMs e Sincronização de Expiração para latest.js
  // -------------------------------------------------------------------------
  try {
    const rawAttribution = mockStorage.getItem('utmify_attribution');
    const parsedAttribution = JSON.parse(rawAttribution);

    const utmSource = parsedAttribution.firstTouch.utm_source;
    const utmCampaign = parsedAttribution.firstTouch.utm_campaign;
    const fbclid = parsedAttribution.firstTouch.fbclid;
    const hasSync = mockStorage.getItem('utm_source') === 'facebook';
    const hasExpSync = !!mockStorage.getItem('utm_source_exp'); // Exigido pelo latest.js da UTMify

    const ok = utmSource === 'facebook' && utmCampaign === 'teste123' && fbclid === 'fb_test_123' && hasSync && hasExpSync;
    reportTest('Teste A', 'Entrada com UTMs (Captura, Persistência LocalStorage e TTL para latest.js)', ok, {
      firstTouch: parsedAttribution.firstTouch,
      lastTouch: parsedAttribution.lastTouch,
      storageSync: {
        utm_source: mockStorage.getItem('utm_source'),
        utm_source_exp: mockStorage.getItem('utm_source_exp')
      }
    });
  } catch (err) {
    reportTest('Teste A', 'Entrada com UTMs', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE B: Atualização de página sem UTMs
  // -------------------------------------------------------------------------
  try {
    // Simula reload sem query params
    mockWindow.location.href = 'https://desenrolabrasil.site/atendimento.html';
    mockWindow.location.search = '';

    // Roda inicialização de navegação
    mockWindow.UTMifyTracker.init();

    const storedAfterReload = JSON.parse(mockStorage.getItem('utmify_attribution'));
    const preservedSource = storedAfterReload.firstTouch.utm_source;
    const preservedCampaign = storedAfterReload.lastTouch.utm_campaign;

    const ok = preservedSource === 'facebook' && preservedCampaign === 'teste123';
    reportTest('Teste B', 'Atualização de página (Preservação íntegra de First Touch e Last Touch)', ok, {
      preservedFirstTouch: storedAfterReload.firstTouch,
      preservedLastTouch: storedAfterReload.lastTouch
    });
  } catch (err) {
    reportTest('Teste B', 'Atualização de página', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE C: Navegação interna e propagação de parâmetros
  // -------------------------------------------------------------------------
  try {
    const builtUrl = mockWindow.buildUrlPreservingParams('/upsell1.html', { step: 'confirm' });
    const parsedBuilt = new URL(builtUrl, 'https://desenrolabrasil.site');

    // Confirma se UTMs armazenadas e parâmetros extras foram inseridos na URL de destino
    const hasUtmSource = parsedBuilt.searchParams.get('utm_source') === 'facebook';
    const hasStep = parsedBuilt.searchParams.get('step') === 'confirm';

    const ok = hasUtmSource && hasStep;
    reportTest('Teste C', 'Navegação interna (Propagação dinâmica de parâmetros via buildUrlPreservingParams)', ok, {
      destinationBuilt: builtUrl
    });
  } catch (err) {
    reportTest('Teste C', 'Navegação interna', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE D: Nova campanha (First Touch vs Last Touch)
  // -------------------------------------------------------------------------
  try {
    // Simula reentrada por novo anúncio no Google
    mockWindow.location.href = 'https://desenrolabrasil.site/?utm_source=google&utm_medium=cpc&utm_campaign=campanha_nova&gclid=gcl_999';
    mockWindow.location.search = '?utm_source=google&utm_medium=cpc&utm_campaign=campanha_nova&gclid=gcl_999';

    mockWindow.UTMifyTracker.init();

    const storedNewCampaign = JSON.parse(mockStorage.getItem('utmify_attribution'));

    const firstTouchSource = storedNewCampaign.firstTouch.utm_source; // Deve ser facebook!
    const lastTouchSource = storedNewCampaign.lastTouch.utm_source;   // Deve ser google!
    const lastTouchGclid = storedNewCampaign.lastTouch.gclid;         // Deve ser gcl_999!

    const ok = (firstTouchSource === 'facebook') && (lastTouchSource === 'google') && (lastTouchGclid === 'gcl_999');
    reportTest('Teste D', 'Nova campanha (Preserva First Touch e atualiza Last Touch)', ok, {
      firstTouch: storedNewCampaign.firstTouch,
      lastTouch: storedNewCampaign.lastTouch
    });
  } catch (err) {
    reportTest('Teste D', 'Nova campanha', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE E: Falha de rede e proteção contra duplicidade (Idempotência)
  // -------------------------------------------------------------------------
  try {
    // 1. Teste de retentativa inteligente (sendWithRetry)
    let callCount = 0;
    const mockFetch = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Falha simulada de rede (Connection reset)');
      }
      return { ok: true, status: 200, json: async () => ({ success: true, attempt: callCount }) };
    };

    mockWindow.fetch = mockFetch;
    const retryResult = await mockWindow.sendWithRetry('https://tracking.utmify.com.br/test', {
      retryDelays: [10, 20, 30]
    }, 3);
    const retryAttempts = callCount;

    // 2. Teste de Idempotência do evento Purchase
    const p1 = await mockWindow.trackPixelEvent('Purchase', { orderId: 'ord_teste_idemp_101', value: 68.92 });
    const p2 = await mockWindow.trackPixelEvent('Purchase', { orderId: 'ord_teste_idemp_101', value: 68.92 });

    const ok = retryResult.success === true && retryAttempts === 3 && p1.success === true && p2.idempotentIgnored === true;
    reportTest('Teste E', 'Resiliência a falhas de rede (Retry Exponential Backoff) e Idempotência de Compra', ok, {
      totalAttemptsBeforeSuccess: retryAttempts,
      firstPurchaseDispatched: p1.success,
      duplicatePurchaseIgnored: p2.idempotentIgnored
    });
  } catch (err) {
    reportTest('Teste E', 'Falha de rede e Idempotência', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE F: Checkout PIX com parâmetros exatos solicitados no prompt
  // -------------------------------------------------------------------------
  let generatedTransactionId = null;
  const testOrderId = 'order_test_audit_' + Date.now().toString(36);

  try {
    const pixResponse = await makeRequest('http://localhost:3000/api/gerar-pix', {
      method: 'POST'
    }, {
      cpf: '05499211023',
      nome: 'Carlos Eduardo da Silva',
      amount: 68.92,
      orderId: testOrderId,
      tracking: {
        utm_source: 'facebook',
        utm_medium: 'paid',
        utm_campaign: 'teste123',
        utm_content: 'criativo01'
      }
    });

    generatedTransactionId = pixResponse.json ? (pixResponse.json.transaction_id || pixResponse.json.id) : null;
    const pixOk = pixResponse.statusCode === 200 && !!generatedTransactionId;

    // Consulta endpoint de pedidos para verificar persistência no banco
    const pedidosResponse = await makeRequest('http://localhost:3000/api/pedidos', { method: 'GET' });
    const pedidoSalvo = pedidosResponse.json && pedidosResponse.json.pedidos
      ? pedidosResponse.json.pedidos.find(p => p.order_id === testOrderId)
      : null;

    const dbOk = pedidoSalvo &&
                 pedidoSalvo.tracking &&
                 pedidoSalvo.tracking.utm_source === 'facebook' &&
                 pedidoSalvo.tracking.utm_campaign === 'teste123' &&
                 pedidoSalvo.tracking.utm_content === 'criativo01' &&
                 pedidoSalvo.status === 'pending';

    const ok = pixOk && dbOk;
    reportTest('Teste F', 'Checkout PIX com UTMs exatas preservadas no Backend (.data/pedidos.json)', ok, {
      transactionId: generatedTransactionId,
      status: pedidoSalvo ? pedidoSalvo.status : null,
      savedInDatabase: !!pedidoSalvo,
      persistedTracking: pedidoSalvo ? pedidoSalvo.tracking : null,
      cpfMasked: pedidoSalvo ? pedidoSalvo.cpf_mascarado : null
    });
  } catch (err) {
    reportTest('Teste F', 'Checkout PIX com backend', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE G: Webhook de Pagamento Aprovado e Sincronização Oficial com UTMify
  // -------------------------------------------------------------------------
  try {
    const txIdToPay = generatedTransactionId || ('TX_TEST_' + Date.now().toString(36));

    // 1. Simula envio de webhook oficial do gateway de pagamentos
    const webhookRes = await makeRequest('http://localhost:3000/api/webhook-flevo', {
      method: 'POST'
    }, {
      transaction_id: txIdToPay,
      status: 'paid',
      amount: 68.92
    });

    const webhookOk = webhookRes.statusCode === 200 && webhookRes.json && webhookRes.json.status === 'paid';

    // 2. Consulta banco de dados para confirmar transição atômica
    const db = require('./api/lib/db.js');
    const pedidoAposWebhook = await db.obterPedido(txIdToPay);
    const dbPaidOk = pedidoAposWebhook && pedidoAposWebhook.status === 'paid' && pedidoAposWebhook.is_paid === true;

    // 3. Validação do schema oficial do payload que vai para a UTMify
    const utmifyLib = require('./api/lib/utmify.js');
    const payloadMontado = utmifyLib.montarPayloadPedidoUtmify(pedidoAposWebhook, 'paid');
    const schemaOk = payloadMontado.orderId &&
                     payloadMontado.status === 'paid' &&
                     payloadMontado.approvedDate !== null &&
                     payloadMontado.trackingParameters &&
                     payloadMontado.trackingParameters.utm_source === 'facebook' &&
                     payloadMontado.trackingParameters.utm_campaign === 'teste123' &&
                     payloadMontado.trackingParameters.utm_content === 'criativo01';

    // 4. Teste de Idempotência do Webhook (reenvio não deve duplicar)
    const duplicateWebhookRes = await makeRequest('http://localhost:3000/api/webhook-flevo', {
      method: 'POST'
    }, {
      transaction_id: txIdToPay,
      status: 'paid',
      amount: 68.92
    });
    const idempotencyOk = duplicateWebhookRes.statusCode === 200 && duplicateWebhookRes.json && duplicateWebhookRes.json.idempotent === true;

    const ok = webhookOk && dbPaidOk && schemaOk && idempotencyOk;
    reportTest('Teste G', 'Webhook de Pagamento Aprovado (Recuperação de UTMs, Schema Oficial e Idempotência)', ok, {
      webhookStatus: webhookRes.statusCode,
      orderStatus: pedidoAposWebhook ? pedidoAposWebhook.status : null,
      isPaid: pedidoAposWebhook ? pedidoAposWebhook.is_paid : null,
      utmifyTrackingParams: payloadMontado.trackingParameters,
      idempotencyWorking: idempotencyOk
    });
  } catch (err) {
    reportTest('Teste G', 'Pagamento Aprovado e Webhook', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TESTE H: Recebimento e validação oficial pela API da UTMify
  // -------------------------------------------------------------------------
  try {
    const pixelId = '6ac7eca5cc69c2e09166ca1c';

    // 1. Transmissão de PageView para UTMify
    const pageViewPayload = {
      type: 'PageView',
      lead: { pixelId: pixelId },
      event: {
        sourceUrl: 'https://desenrolabrasil.site/?utm_source=facebook&utm_campaign=teste123',
        pageTitle: 'Programa Desenrola Brasil Oficial',
        currency: 'BRL'
      }
    };

    const utmifyRes = await makeRequest('https://tracking.utmify.com.br/tracking/v1/events', {
      method: 'POST'
    }, pageViewPayload);

    // 2. Transmissão via Proxy Localhost 3001
    const proxyRes = await makeRequest('http://localhost:3001/tracking/v1/events', {
      method: 'POST'
    }, pageViewPayload);

    const directOk = utmifyRes.statusCode === 200 && utmifyRes.json && utmifyRes.json.lead && utmifyRes.json.lead._id;
    const proxyOk = proxyRes.statusCode === 200 && proxyRes.json && proxyRes.json.lead && proxyRes.json.lead._id;

    const ok = !!(directOk && proxyOk);
    reportTest('Teste H', 'Recebimento e Validação Oficial pela API da UTMify (Direto e Proxy Localhost 3001)', ok, {
      directStatus: utmifyRes.statusCode,
      proxyStatus: proxyRes.statusCode,
      createdLeadId: utmifyRes.json && utmifyRes.json.lead ? utmifyRes.json.lead._id : null,
      metaPixelIds: utmifyRes.json && utmifyRes.json.lead ? utmifyRes.json.lead.metaPixelIds : null
    });
  } catch (err) {
    reportTest('Teste H', 'Recebimento UTMify', false, err.message);
  }

  console.log('\n================================================================');
  console.log('📊 RESUMO DA AUDITORIA');
  console.log('================================================================');
  const passedCount = RESULTS.filter(r => r.passed).length;
  console.log(`Total de Testes: ${RESULTS.length}`);
  console.log(`Aprovados: ${passedCount}`);
  console.log(`Falhas: ${RESULTS.length - passedCount}`);
  console.log('================================================================\n');

  if (passedCount === RESULTS.length) {
    console.log('🎯 TODOS OS TESTES PASSARAM COM SUCESSO! SISTEMA 100% OPERACIONAL.');
    process.exit(0);
  } else {
    console.error('⚠️ ALGUNS TESTES FALHARAM. VERIFIQUE O LOG ACIMA.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal ao executar testes:', err);
  process.exit(1);
});
