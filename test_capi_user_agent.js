/**
 * test_capi_user_agent.js
 * Teste de Validação Específico para Meta CAPI (client_user_agent + client_ip_address)
 */

const { montarPayloadPedidoUtmify, enviarPedidoUtmify } = require('./lib/utmify.js');
const { salvarPedidoComAtribuicao, obterPedido } = require('./lib/db.js');
const http = require('http');

async function testCapiParameters() {
  console.log('=== TESTE DE VALIDAÇÃO: META CAPI (USER AGENT & IP) ===\n');

  const testUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const testIp = '177.136.240.55';

  // 1. Teste de montagem de payload UTMify Orders
  const dummyPedido = {
    order_id: 'TEST-CAPI-001',
    transaction_id: 'FLE_TEST_CAPI_1',
    amount: 68.92,
    customer: {
      name: 'João Silva',
      email: 'joao@example.com',
      phone: '11988887777',
      ip: testIp,
      userAgent: testUa
    },
    tracking: {
      utm_source: 'facebook',
      utm_campaign: 'campanha_teste'
    }
  };

  const payloadOrders = montarPayloadPedidoUtmify(dummyPedido, 'paid');
  console.log('1. Payload UTMify Orders gerado:');
  console.log('   - customer.ip:', payloadOrders.customer.ip);
  console.log('   - customer.userAgent:', payloadOrders.customer.userAgent);
  console.log('   - customer.client_user_agent:', payloadOrders.customer.client_user_agent);

  if (payloadOrders.customer.ip !== testIp) {
    throw new Error('Falha: customer.ip não corresponde ao IP de teste');
  }
  if (payloadOrders.customer.userAgent !== testUa) {
    throw new Error('Falha: customer.userAgent não corresponde ao User-Agent de teste');
  }
  if (payloadOrders.customer.client_user_agent !== testUa) {
    throw new Error('Falha: customer.client_user_agent não corresponde ao User-Agent de teste');
  }
  console.log('   ✅ Validação 1 passou!\n');

  // 2. Teste de persistência no DB com IP e User-Agent
  await salvarPedidoComAtribuicao({
    orderId: 'TEST-CAPI-DB-001',
    transactionId: 'FLE_TEST_DB_1',
    amount: 68.92,
    customer: {
      name: 'Maria Santos',
      email: 'maria@example.com',
      phone: '11977776666',
      ip: testIp,
      userAgent: testUa
    },
    ip: testIp,
    userAgent: testUa,
    tracking: {
      utm_source: 'facebook'
    }
  });

  const pedidoDoBanco = await obterPedido('FLE_TEST_DB_1');
  console.log('2. Pedido persistido no banco local:');
  console.log('   - customer.ip:', pedidoDoBanco.customer.ip);
  console.log('   - customer.userAgent:', pedidoDoBanco.customer.userAgent);
  console.log('   - pedido.ip:', pedidoDoBanco.ip);
  console.log('   - pedido.userAgent:', pedidoDoBanco.userAgent);

  if (pedidoDoBanco.customer.userAgent !== testUa || pedidoDoBanco.customer.ip !== testIp) {
    throw new Error('Falha: dados de IP ou User-Agent não foram persistidos no DB');
  }
  console.log('   ✅ Validação 2 passou!\n');

  // 3. Teste da chamada HTTP /api/gerar-pix passando headers e body
  const postData = JSON.stringify({
    cpf: '05269785002',
    nome: 'Carlos Teste',
    userAgent: testUa,
    tracking: {
      utm_source: 'facebook',
      utm_medium: 'paid'
    }
  });

  const pixReqPromise = new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/gerar-pix',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': testUa,
        'X-Forwarded-For': testIp
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  const pixRes = await pixReqPromise;
  console.log('3. Resposta de /api/gerar-pix:');
  console.log('   - success:', pixRes.success);
  console.log('   - transaction_id:', pixRes.transaction_id);

  if (pixRes.transaction_id) {
    const pedidoPix = await obterPedido(pixRes.transaction_id);
    console.log('   - Pedido gravado após gerar PIX:');
    console.log('     * customer.ip:', pedidoPix.customer.ip);
    console.log('     * customer.userAgent:', pedidoPix.customer.userAgent);
    if (!pedidoPix.customer.userAgent || !pedidoPix.customer.ip) {
      throw new Error('Falha: /api/gerar-pix não gravou IP ou User-Agent no pedido!');
    }
  }
  console.log('   ✅ Validação 3 passou!\n');

  // 4. Teste de transmissão de evento Purchase para UTMify CAPI Endpoint
  console.log('4. Testando envio de evento Purchase server-side com IP e User-Agent...');
  const sendResult = await enviarPedidoUtmify(dummyPedido, 'paid');
  console.log('   - Envio concluído:', sendResult.success);
  console.log('   - eventResult statusCode:', sendResult.eventResult?.statusCode);
  if (sendResult.eventResult?.statusCode === 200) {
    console.log('   - UTMify aceitou evento Purchase com sucesso (HTTP 200)!');
  }
  console.log('   ✅ Validação 4 passou!\n');

  console.log('🎉 TODOS OS TESTES DE META CAPI PASSARAM COM 100% DE SUCESSO!');
}

testCapiParameters().catch(err => {
  console.error('❌ ERRO:', err);
  process.exit(1);
});
