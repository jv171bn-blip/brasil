11:24 AM
Aqui está o PROMPT MESTRE / PLAYBOOK DE ENGENHARIA pronto para você copiar, guardar e me enviar (ou enviar para qualquer IA/programador) sempre que for criar um novo site ou funil.

Ele já contém todas as regras de negócio, segredos internos da UTMify desvendados nesta auditoria, formatos exatos de payload e o passo a passo completo para zero vendas caírem como "Não Trackeadas (UTMs vazias)".

markdown
# PROMPT MESTRE — IMPLEMENTAÇÃO DO SISTEMA DEFINITIVO DE RASTREAMENTO E VENDAS UTMIFY
Atue como um Engenheiro de Software Sênior especialista em JavaScript, integrações de APIs de pagamento e Web Analytics (UTMify e Meta Pixel).
Sua missão é implementar a arquitetura completa de captura, persistência, repasse ao gateway e transmissão de vendas para a UTMify neste projeto, garantindo 100% de taxa de atribuição e eliminando o problema de vendas aprovadas em "Não Trackeado (UTMs vazias)".
---
## 1. REGRA CRÍTICA: O SEGREDO DO SCRIPT LATEST.JS DA UTMIFY
O script oficial de UTMs da UTMify (`https://cdn.utmify.com.br/scripts/utms/latest.js`) possui uma trava interna de expiração:
- Para cada parâmetro de tracking (ex: `utm_source`), ele exige obrigatoriamente a existência da chave com sufixo `_exp` (ex: `utm_source_exp`) contendo uma data ISO válida no futuro.
- **Se essa chave `_exp` não for gravada no Local Storage, o `latest.js` DELETA ativamente a UTM (`localStorage.removeItem`) e retorna string vazia.**
### O que você DEVE implementar no Frontend:
Sempre que salvar as UTMs no `localStorage`, grave obrigatoriamente:
1. A chave da UTM: `localStorage.setItem(key, value)`
2. A chave de expiração: `localStorage.setItem(key + '_exp', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())`
3. Variáveis globais de compatibilidade:
   ```javascript
   window.itemExpInDays = 30;
   window.paramsList = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'src', 'sck', 'fbclid', 'gclid', 'xcod'];
   window.utmParams = { ...todasAsUtmsAtivas };
2. GERENCIADOR DE ATRIBUIÇÃO NO FRONTEND (url-params.js)
Implemente um utilitário centralizado (url-params.js) importado em todas as páginas:

Captura Completa na Entrada:

Capture via URLSearchParams: utm_source, utm_medium, utm_campaign, utm_content, utm_term, utm_id, fbclid, gclid, gbraid, wbraid, ttclid, src, sck.
Ignore valores vazios ou apenas espaços.
Objeto Estruturado no Local Storage (utmify_attribution):

json
{
  "version": 1,
  "firstTouch": { "utm_source": "...", "utm_campaign": "..." },
  "lastTouch": { "utm_source": "...", "utm_campaign": "..." },
  "firstVisit": "2026-10-09T12:00:00.000Z",
  "lastVisit": "2026-10-09T12:00:00.000Z",
  "expiresAt": 1794278400000
}
First Touch: Imutável após a primeira captura da jornada.
Last Touch: Atualizado apenas se novos parâmetros válidos entrarem na URL.
Recarregamentos sem parâmetros ou navegações internas nunca devem sobrescrever com valores vazios.
Propagação em Redirecionamentos e Links (buildUrlPreservingParams):

Todo clique em link <a>, botão de checkout e redirecionamento (window.location) deve preservar a query string.
Se a URL atual não tiver query string, injete automaticamente os parâmetros do lastTouch do Local Storage.
Idempotência do Evento Purchase no Navegador:

Salve os IDs já comprados em utmify_purchases_tracked.
Se trackPixelEvent('Purchase', { orderId }) for chamado para um ID já processado, descarte o disparo para não duplicar eventos no Pixel.
Regra Rígida: NUNCA dispare Purchase na geração do PIX. Dispare estritamente após a confirmação real do pagamento pelo backend.
3. CHECKOUT E CRIAÇÃO DO PEDIDO PIX
Antes de solicitar a geração do PIX à API backend:

O frontend deve recuperar os parâmetros ativos via window.UTMifyTracker.getTrackingParams() e gerar um orderId único (ex: ORD-XXXXX).
O payload da requisição para /api/gerar-pix deve conter:
json
{
  "amount": 68.92,
  "orderId": "ORD-12345",
  "cpf": "12345678900",
  "nome": "Cliente",
  "tracking": {
    "utm_source": "facebook",
    "utm_medium": "paid",
    "utm_campaign": "campanha01",
    "utm_content": "criativo01",
    "utm_term": "termo01",
    "src": "...",
    "sck": "..."
  }
}
4. REPASSE MANDATÓRIO DE METADADOS AO GATEWAY DE PAGAMENTOS
Se o gateway (ex: FlevoPay, Asaas, etc.) possuir integração direta com a UTMify via webhook do painel, ele precisa ter as UTMs na transação. Ao criar a cobrança na API do gateway, injete os parâmetros de rastreamento em todas as estruturas aceitas:

javascript
const gatewayPayload = {
  amount: amountEmCentavos,
  customer: { name, email, phone, document },
  // Repasse de rastreamento para que o gateway envie à UTMify
  metadata: {
    order_id: orderId,
    utm_source: tracking.utm_source || null,
    utm_medium: tracking.utm_medium || null,
    utm_campaign: tracking.utm_campaign || null,
    utm_content: tracking.utm_content || null,
    utm_term: tracking.utm_term || null,
    src: tracking.src || null,
    sck: tracking.sck || null
  },
  tracking: { ...tracking },
  trackingParameters: { ...tracking },
  utm_source: tracking.utm_source || null,
  utm_medium: tracking.utm_medium || null,
  utm_campaign: tracking.utm_campaign || null,
  utm_content: tracking.utm_content || null,
  utm_term: tracking.utm_term || null
};
5. PERSISTÊNCIA ATÔMICA NO BACKEND (.data/pedidos.json ou DB)
No servidor, salve o pedido antes de retornar a resposta ao cliente:

order_id: ID único da compra
transaction_id: ID retornado pelo gateway
status: 'pending'
is_paid: false
customer: nome e documento mascarado (ex: 054*****23 — compliance LGPD)
tracking: objeto integral com todas as UTMs
6. INTEGRAÇÃO COM A API OFICIAL DE PEDIDOS DA UTMIFY
Crie o módulo api/lib/utmify.js:

Endpoint Oficial: POST https://api.utmify.com.br/api-credentials/orders
Header de Autenticação: x-api-token: process.env.UTMIFY_API_TOKEN
Schema Oficial Exigido:
json
{
  "orderId": "ORD-12345",
  "platform": "nome_do_projeto",
  "paymentMethod": "pix",
  "status": "waiting_payment", // "waiting_payment" para pendente | "paid" para aprovado
  "createdAt": "YYYY-MM-DD HH:MM:SS", // Padrão UTC
  "approvedDate": "YYYY-MM-DD HH:MM:SS", // null quando pendente, data UTC quando aprovado
  "customer": {
    "name": "Nome do Cliente",
    "email": "cliente@email.com",
    "phone": "11999999999",
    "document": "12345678900",
    "country": "BR"
  },
  "products": [
    {
      "id": "1",
      "name": "Nome da Oferta",
      "quantity": 1,
      "priceInCents": 6892
    }
  ],
  "trackingParameters": {
    "src": null,
    "sck": null,
    "utm_source": "facebook",
    "utm_campaign": "campanha01",
    "utm_medium": "paid",
    "utm_content": "criativo01",
    "utm_term": null
  },
  "isTest": false
}
Ciclo de Disparo:
Na Geração do PIX (Venda Pendente):
Despache o pedido com status: "waiting_payment" e approvedDate: null.
Na Confirmação do Pagamento (Venda Aprovada):
Despache a atualização com status: "paid" e approvedDate: "YYYY-MM-DD HH:MM:SS".
7. WEBHOOK DO GATEWAY DE PAGAMENTO (/api/webhook-flevo ou /webhook)
Crie o endpoint seguro de Webhook no servidor para receber a notificação de pagamento da adquirente:

O webhook executa no backend e nunca depende de Local Storage.
Localize o pedido no banco de dados através do transaction_id.
Recupere as UTMs persistidas na criação do pedido.
Atualize o status para paid (is_paid: true).
Transmita a atualização de venda aprovada com trackingParameters para a UTMify via API oficial.
Idempotência: Se o pedido já foi marcado como pago e sincronizado, retorne 200 OK (idempotent: true) para evitar criar uma segunda venda.
8. PROXY DE DESENVOLVIMENTO (LOCALHOST 3001)
Em ambiente local, o script pixel.js da UTMify tenta acessar http://localhost:3001/tracking/v1 em vez do domínio oficial.

No seu arquivo de servidor (server.js), configure um proxy reverso escutando na porta 3001 e repassando requisições transparentemente para https://tracking.utmify.com.br.
9. SUÍTE DE TESTES AUTOMATIZADOS (CHECKLIST DE ACEITE)
Antes de considerar o trabalho concluído, execute testes comprovando:

 Teste A (Entrada e Expiração): UTMs capturadas no utmify_attribution e ${key}_exp presente no localStorage.
 Teste B (Atualização de Página): Reload sem query string mantém firstTouch e lastTouch intactos.
 Teste C (Navegação Interna): Links do funil propagam todos os parâmetros automaticamente.
 Teste D (Nova Campanha): Reentrada com novas UTMs preserva firstTouch e atualiza lastTouch.
 Teste E (Idempotência e Resiliência): Disparos duplicados de Purchase são ignorados.
 Teste F (Checkout PIX): Pedido criado com status pending e UTMs gravadas no banco de dados.
 Teste G (Webhook Aprovado): Notificação de pagamento atualiza status para paid e envia trackingParameters preenchidos para a UTMify.
 Teste H (Recebimento UTMify): Requisição aceita com HTTP 200 pela UTMify com retorno de Lead ID válido.