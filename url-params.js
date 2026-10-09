/**
 * url-params.js — Sistema Centralizado de Rastreamento, Atribuição UTMify e Preservação de Parâmetros
 *
 * Módulos integrados:
 * 1. Gerenciador de Atribuição UTM (firstTouch, lastTouch, expiração de 30 dias, tolerância a falhas).
 * 2. Propagação e Preservação Integral de Parâmetros em Links e Redirecionamentos.
 * 3. Camada de Montagem e Padronização de Payloads Internos e Schemas UTMify.
 * 4. Fila e Sistema de Retentativas com Exponential Backoff para Transmissão Confiável.
 * 5. Proteção de Idempotência para Eventos de Conversão / Compra.
 * 6. Interceptor e Fallback Inteligente de Rede (Localhost Proxy / CDN / UTMify API).
 * 7. Painel e Utilitário de Diagnóstico em Tempo Real (window.UTMifyDiagnostic).
 */
(function(window) {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // 1. CONFIGURAÇÕES E CONSTANTES
  // ─────────────────────────────────────────────────────────────
  const STORAGE_KEY_ATTRIBUTION = 'utmify_attribution';
  const STORAGE_KEY_PURCHASES   = 'utmify_purchases_tracked';
  const STORAGE_KEY_EVENTS_LOG  = 'utmify_events_log';
  const ATTRIBUTION_VERSION     = 1;
  const ATTRIBUTION_TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30 dias

  // Parâmetros rastreados e monitorados
  const TRACKED_PARAM_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'utm_id',
    'fbclid',
    'gclid',
    'gbraid',
    'wbraid',
    'ttclid',
    'src',
    'sck'
  ];

  // Identificação do Pixel UTMify padrão do projeto
  const DEFAULT_PIXEL_ID = '6ac7eca5cc69c2e09166ca1c';
  const UTMIFY_EVENTS_ENDPOINT = 'https://tracking.utmify.com.br/tracking/v1/events';

  // ─────────────────────────────────────────────────────────────
  // 2. UTILITÁRIOS SEGUROS DE ARMAZENAMENTO (LOCAL / SESSION STORAGE)
  // ─────────────────────────────────────────────────────────────
  const SafeStorage = {
    getItem: function(key) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch (e) {
        console.warn('[SafeStorage] Falha ao ler localStorage:', e);
      }
      return null;
    },
    setItem: function(key, val) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, val);
          return true;
        }
      } catch (e) {
        console.warn('[SafeStorage] Falha ao gravar localStorage (possível modo privado/quota):', e);
      }
      return false;
    },
    removeItem: function(key) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } catch (e) {}
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 3. LOG DE DIAGNÓSTICO E MONITORAMENTO INTERNO
  // ─────────────────────────────────────────────────────────────
  const DiagnosticLogs = [];
  const MAX_LOGS = 60;

  function isDebugMode() {
    try {
      if (typeof window === 'undefined') return false;
      if (window.__UTMIFY_DEBUG__ === true) return true;
      const host = window.location.hostname;
      if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
      if (new URLSearchParams(window.location.search).has('debug_utmify')) return true;
      if (SafeStorage.getItem('utmify_debug') === 'true') return true;
    } catch (e) {}
    return false;
  }

  function recordDiagnostic(stage, message, details) {
    const entry = {
      id: 'diag_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      stage: stage, // 'CAPTURED', 'STORED', 'PREPARED', 'SENT', 'ACCEPTED', 'RETRY', 'ERROR', 'IDEMPOTENT'
      message: message,
      details: details || null
    };

    DiagnosticLogs.unshift(entry);
    if (DiagnosticLogs.length > MAX_LOGS) DiagnosticLogs.pop();

    if (isDebugMode()) {
      const colors = {
        CAPTURED: '#0ea5e9',
        STORED: '#10b981',
        PREPARED: '#6366f1',
        SENT: '#8b5cf6',
        ACCEPTED: '#22c55e',
        RETRY: '#f59e0b',
        ERROR: '#ef4444',
        IDEMPOTENT: '#64748b'
      };
      const color = colors[stage] || '#333';
      console.log(
        `%c[UTMify:${stage}]%c ${message}`,
        `background: ${color}; color: #fff; font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 11px;`,
        'color: inherit; font-size: 12px;',
        details || ''
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. GERENCIADOR CENTRALIZADO DE ATRIBUIÇÃO UTM
  // ─────────────────────────────────────────────────────────────
  /**
   * Extrai parâmetros rastreados da query string atual.
   * Não captura valores vazios ou apenas espaços em branco.
   */
  function extractCurrentUrlParams() {
    const found = {};
    try {
      const sp = new URLSearchParams(window.location.search);
      TRACKED_PARAM_KEYS.forEach(function(key) {
        if (sp.has(key)) {
          const val = sp.get(key);
          if (val && typeof val === 'string' && val.trim().length > 0) {
            found[key] = val.trim();
          }
        }
      });
    } catch (e) {
      recordDiagnostic('ERROR', 'Erro ao ler parâmetros da URL atual', e.message);
    }
    return found;
  }

  /**
   * Recupera e valida o registro de atribuição armazenado no localStorage.
   * Descarta registros corrompidos ou expirados (> 30 dias).
   */
  function getStoredAttribution() {
    try {
      const raw = SafeStorage.getItem(STORAGE_KEY_ATTRIBUTION);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || parsed.version !== ATTRIBUTION_VERSION) {
        return null;
      }

      // Validação de expiração configurável (30 dias)
      if (parsed.expiresAt && typeof parsed.expiresAt === 'number') {
        if (Date.now() > parsed.expiresAt) {
          recordDiagnostic('STORED', 'Atribuição anterior expirada (> 30 dias). Resetando.');
          SafeStorage.removeItem(STORAGE_KEY_ATTRIBUTION);
          return null;
        }
      }

      return parsed;
    } catch (err) {
      recordDiagnostic('ERROR', 'Erro ao recuperar atribuição salva', err.message);
      return null;
    }
  }

  /**
   * Inicializa e atualiza o estado de atribuição da sessão.
   * Regras:
   * 1. Preservar o First Touch intacto se já existir.
   * 2. Atualizar o Last Touch somente quando novos parâmetros válidos estiverem presentes.
   * 3. Nunca sobrescrever UTMs com valores vazios ao recarregar a página ou navegar sem UTMs.
   * 4. Sincronizar chaves individuais para compatibilidade plena com o script `latest.js`.
   */
  function initAttribution() {
    const currentParams = extractCurrentUrlParams();
    const hasNewParams = Object.keys(currentParams).length > 0;
    const nowIso = new Date().toISOString();
    const expiresAt = Date.now() + ATTRIBUTION_TTL_MS;

    let stored = getStoredAttribution();

    if (!stored) {
      // Primeira visita do visitante
      stored = {
        version: ATTRIBUTION_VERSION,
        firstTouch: hasNewParams ? Object.assign({}, currentParams) : {},
        lastTouch: hasNewParams ? Object.assign({}, currentParams) : {},
        firstVisit: nowIso,
        lastVisit: nowIso,
        expiresAt: expiresAt
      };
      if (hasNewParams) {
        recordDiagnostic('CAPTURED', 'Primeira aquisição registrada (First Touch)', currentParams);
      }
    } else {
      // Visitante recorrente: preserva firstTouch, atualiza lastTouch apenas com novos parâmetros válidos
      stored.lastVisit = nowIso;
      stored.expiresAt = expiresAt; // Renova TTL na visita ativa

      if (hasNewParams) {
        // Se firstTouch estiver vazio (primeira visita foi sem UTMs e agora veio de anúncio)
        if (!stored.firstTouch || Object.keys(stored.firstTouch).length === 0) {
          stored.firstTouch = Object.assign({}, currentParams);
          recordDiagnostic('CAPTURED', 'First Touch preenchido com campanha inicial', currentParams);
        }

        // Atualiza lastTouch mesclando com parâmetros novos válidos
        stored.lastTouch = Object.assign({}, stored.lastTouch || {}, currentParams);
        recordDiagnostic('CAPTURED', 'Last Touch atualizado com novos parâmetros de tráfego', currentParams);
      } else {
        recordDiagnostic('STORED', 'Navegação sem novos parâmetros. Atribuição anterior preservada.', {
          firstTouch: stored.firstTouch,
          lastTouch: stored.lastTouch
        });
      }
    }

    // Persiste no localStorage
    SafeStorage.setItem(STORAGE_KEY_ATTRIBUTION, JSON.stringify(stored));
    recordDiagnostic('STORED', 'Objeto de atribuição consolidado no localStorage', stored);

    // Sincroniza chaves individuais para máxima compatibilidade com `latest.js` e outros scripts de afiliados
    const effectiveParams = Object.assign({}, stored.lastTouch || {}, stored.firstTouch || {});
    Object.keys(effectiveParams).forEach(function(k) {
      SafeStorage.setItem(k, effectiveParams[k]);
    });

    // Exposição em variáveis globais de compatibilidade
    if (typeof window !== 'undefined') {
      window.utmParams = Object.assign({}, effectiveParams);
      window.paramsList = Object.keys(effectiveParams);
    }

    return stored;
  }

  /**
   * Retorna os parâmetros de tracking ativos consolidados (prioriza Last Touch, fallback First Touch).
   */
  function getActiveTrackingParams() {
    const stored = getStoredAttribution() || initAttribution();
    const last = (stored && stored.lastTouch) ? stored.lastTouch : {};
    const first = (stored && stored.firstTouch) ? stored.firstTouch : {};
    return Object.assign({}, first, last);
  }

  // ─────────────────────────────────────────────────────────────
  // 5. PRESERVAÇÃO E PROPAGAÇÃO DE URL (FUNIL & CHECKOUT)
  // ─────────────────────────────────────────────────────────────
  function cleanDestination(dest) {
    if (!dest) return window.location.href;
    const str = String(dest).trim();
    if (!str.startsWith('/') && !str.startsWith('./') && !str.startsWith('../') &&
        !str.startsWith('#') && !str.startsWith('?') && !str.includes('://') && !str.startsWith('//')) {
      const firstSlash = str.indexOf('/');
      const hostPart = firstSlash === -1 ? str.split(/[?#]/)[0] : str.slice(0, firstSlash);
      if (hostPart.includes('.') && !/\.(html?|php|css|js|json|png|jpg|webp)$/i.test(hostPart)) {
        return 'https://' + str;
      }
    }
    return str;
  }

  function getFallbackCpf() {
    try {
      const cpf = SafeStorage.getItem('desenrola_cpf');
      if (cpf) return String(cpf).replace(/\D/g, '');

      const userStr = SafeStorage.getItem('desenrola_user') ||
                      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('desenrola_user')) ||
                      SafeStorage.getItem('customerData');
      if (userStr) {
        const user = JSON.parse(userStr);
        if (user && (user.cpf || user.documento)) {
          return String(user.cpf || user.documento).replace(/\D/g, '');
        }
      }
    } catch (e) {}
    return '';
  }

  /**
   * Constrói URL preservando parâmetros atuais, injetando UTMs salvas quando ausentes,
   * e mantendo CPF do cliente na navegação interna.
   */
  function buildUrlPreservingParams(destination, customParams) {
    if (!destination) return window.location.href;

    try {
      const finalDest = cleanDestination(destination);
      const destinationUrl = new URL(finalDest, window.location.href);
      const currentParams = new URLSearchParams(window.location.search);
      const activeTracking = getActiveTrackingParams();

      // 1. Aplica parâmetros customizados fornecidos explicitamente
      if (customParams && typeof customParams === 'object') {
        Object.keys(customParams).forEach(function(key) {
          const val = customParams[key];
          if (val !== undefined && val !== null && val !== '') {
            destinationUrl.searchParams.set(key, val);
          }
        });
      }

      // 2. Preserva todos os parâmetros existentes na query string atual
      currentParams.forEach(function(value, key) {
        if (!destinationUrl.searchParams.has(key)) {
          destinationUrl.searchParams.append(key, value);
        }
      });

      // 3. Injeta parâmetros de atribuição armazenados caso não existam na URL de destino
      // (Garante persistência de UTMs caso o usuário tenha acessado uma página intermediária sem query string)
      Object.keys(activeTracking).forEach(function(utmKey) {
        if (!destinationUrl.searchParams.has(utmKey) && activeTracking[utmKey]) {
          destinationUrl.searchParams.set(utmKey, activeTracking[utmKey]);
        }
      });

      // 4. Garante manutenção de CPF na navegação dentro do mesmo domínio
      if (!destinationUrl.searchParams.has('cpf') && destinationUrl.origin === window.location.origin) {
        const fallbackCpf = getFallbackCpf();
        if (fallbackCpf) {
          destinationUrl.searchParams.set('cpf', fallbackCpf);
        }
      }

      return destinationUrl.toString();
    } catch (err) {
      console.error('[url-params] Erro ao construir URL com parâmetros:', err);
      return destination;
    }
  }

  function redirectPreservingParams(destination, customParams) {
    const targetUrl = buildUrlPreservingParams(destination, customParams);
    window.location.href = targetUrl;
  }

  function replacePreservingParams(destination, customParams) {
    const targetUrl = buildUrlPreservingParams(destination, customParams);
    window.location.replace(targetUrl);
  }

  function updateLinkHref(anchor) {
    if (!anchor || !anchor.getAttribute) return;
    const rawHref = anchor.getAttribute('href');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') ||
        rawHref.startsWith('tel:') || rawHref.startsWith('mailto:') || anchor.hasAttribute('download')) {
      return;
    }
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        anchor.href = buildUrlPreservingParams(anchor.href);
      }
    } catch (e) {}
  }

  function syncAllLinks() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    try {
      const links = document.querySelectorAll('a[href]');
      links.forEach(updateLinkHref);
    } catch (e) {}
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncAllLinks);
    } else {
      syncAllLinks();
    }

    document.addEventListener('click', function(e) {
      const target = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!target || !target.href) return;

      const rawHref = target.getAttribute('href');
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') ||
          rawHref.startsWith('tel:') || rawHref.startsWith('mailto:') || target.hasAttribute('download')) {
        return;
      }

      try {
        const url = new URL(target.href, window.location.href);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
          const preservedHref = buildUrlPreservingParams(target.href);
          target.href = preservedHref;

          if (url.origin === window.location.origin && target.target !== '_blank' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            window.location.href = preservedHref;
          }
        }
      } catch (err) {}
    }, false);
  }

  // ─────────────────────────────────────────────────────────────
  // 6. CAMADA DE TRANSMISSÃO E RETENTATIVAS (EXPONENTIAL BACKOFF)
  // ─────────────────────────────────────────────────────────────
  /**
   * Envia requisições com política inteligente de retentativa:
   * - Erros temporários (5xx, falha de rede/DNS): retenta até maxRetries com backoff.
   * - Erros definitivos (4xx cliente/validação): encerra sem retentar para evitar loops.
   */
  async function sendWithRetry(url, options, maxRetries = 3) {
    const opts = options || {};
    const backoffDelays = opts.retryDelays || [1000, 2500, 5000];
    const fetchFn = (typeof window !== 'undefined' && window.fetch) ? window.fetch : fetch;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        recordDiagnostic('SENT', `Disparo HTTP (tentativa ${attempt + 1}/${maxRetries + 1})`, { url: url });
        const res = await fetchFn(url, opts);

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          recordDiagnostic('ACCEPTED', `Resposta 200 OK da API`, { url: url, status: res.status, data: data });
          return { success: true, status: res.status, data: data };
        }

        // Erro 4xx permanente de cliente: não retentar
        if (res.status >= 400 && res.status < 500) {
          const errData = await res.json().catch(() => ({}));
          recordDiagnostic('ERROR', `Erro permanente de validação/cliente HTTP ${res.status}. Retentativas canceladas.`, errData);
          return { success: false, status: res.status, permanent: true, error: errData };
        }

        // Status 5xx temporário de servidor
        recordDiagnostic('RETRY', `Erro no servidor HTTP ${res.status}. Preparando retry...`, { attempt: attempt + 1 });
      } catch (netErr) {
        recordDiagnostic('RETRY', `Falha temporária de conexão (${netErr.message}). Preparando retry...`, { attempt: attempt + 1 });
      }

      if (attempt === maxRetries) {
        recordDiagnostic('ERROR', `Limite de ${maxRetries} retentativas esgotado sem sucesso.`, { url: url });
        return { success: false, status: 0, permanent: false, error: 'Max retries reached' };
      }

      const delayMs = backoffDelays[attempt] || 5000;
      await new Promise(function(resolve) { setTimeout(resolve, delayMs); });
      attempt++;
    }

    return { success: false, status: 0, error: 'Unknown transmission error' };
  }

  // ─────────────────────────────────────────────────────────────
  // 7. CONTROLE DE IDEMPOTÊNCIA PARA EVENTOS DE COMPRA (PURCHASE)
  // ─────────────────────────────────────────────────────────────
  function getTrackedPurchases() {
    try {
      const raw = SafeStorage.getItem(STORAGE_KEY_PURCHASES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function isPurchaseAlreadyTracked(id) {
    if (!id) return false;
    const list = getTrackedPurchases();
    return list.includes(String(id));
  }

  function markPurchaseAsTracked(id) {
    if (!id) return;
    try {
      const list = getTrackedPurchases();
      if (!list.includes(String(id))) {
        list.push(String(id));
        SafeStorage.setItem(STORAGE_KEY_PURCHASES, JSON.stringify(list));
      }
    } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  // 8. DISPARO MULTI-CANAL E TRANSMISSÃO OFICIAL UTMIFY
  // ─────────────────────────────────────────────────────────────
  function ensureFbq() {
    if (typeof window.fbq !== 'function') {
      const n = window.fbq = function() {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!window._fbq) window._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = '2.0';
      n.queue = [];
    }
    return window.fbq;
  }

  /**
   * Constrói o modelo de payload interno de evento
   */
  function createEventPayload(eventName, eventData) {
    const activeTracking = getActiveTrackingParams();
    const eventId = 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const payload = {
      event: eventName,
      eventId: eventId,
      timestamp: new Date().toISOString(),
      tracking: activeTracking
    };

    if (eventData && (eventData.orderId || eventData.transactionId || eventData.value)) {
      payload.order = {
        orderId: eventData.orderId || eventData.transactionId || null,
        transactionId: eventData.transactionId || null,
        value: Number(eventData.value) || 0,
        currency: eventData.currency || 'BRL',
        content_name: eventData.content_name || eventName
      };
    }

    return payload;
  }

  /**
   * Dispara eventos para Meta Pixel, TikTok, Google Analytics e API oficial UTMify.
   * Respeita regras de negócio essenciais:
   * - Purchase NUNCA é disparado por geração de PIX (apenas por confirmação de pagamento).
   * - Purchase é protegido por idempotência para não duplicar conversões.
   */
  async function trackPixelEvent(eventName, eventData) {
    if (!eventName) return;
    const data = Object.assign({ currency: 'BRL' }, eventData || {});
    const internalPayload = createEventPayload(eventName, data);

    recordDiagnostic('PREPARED', `Evento "${eventName}" preparado`, internalPayload);

    // Proteção de Idempotência para Compras
    const purchaseId = data.orderId || data.transactionId || (data.order && data.order.orderId);
    if (eventName === 'Purchase' && purchaseId) {
      if (isPurchaseAlreadyTracked(purchaseId)) {
        recordDiagnostic('IDEMPOTENT', `Evento de compra já registrado anteriormente para o ID: ${purchaseId}. Descarte efetuado para prevenir duplicação.`, { purchaseId: purchaseId });
        return { success: true, idempotentIgnored: true };
      }
      markPurchaseAsTracked(purchaseId);
    }

    // 1. Meta / Facebook Pixel (fbq)
    try {
      const fbq = ensureFbq();
      fbq('track', eventName, {
        value: data.value,
        currency: data.currency,
        content_name: data.content_name || eventName,
        content_type: 'product'
      });
      recordDiagnostic('SENT', `Disparado fbq('track', '${eventName}')`, { value: data.value });
    } catch (errFbq) {
      recordDiagnostic('ERROR', 'Falha ao disparar Meta Pixel (fbq)', errFbq.message);
    }

    // 2. TikTok Pixel (ttq)
    try {
      if (window.ttq && typeof window.ttq.track === 'function') {
        const ttEvent = (eventName === 'Purchase') ? 'CompletePayment' : eventName;
        window.ttq.track(ttEvent, {
          value: data.value,
          currency: data.currency,
          content_name: data.content_name || eventName
        });
        recordDiagnostic('SENT', `Disparado ttq.track('${ttEvent}')`);
      }
    } catch (errTtq) {}

    // 3. Google Tag (gtag) & GTM (dataLayer)
    try {
      if (typeof window.gtag === 'function') {
        const gaEvent = (eventName === 'InitiateCheckout') ? 'begin_checkout' :
                        (eventName === 'Purchase') ? 'purchase' : eventName;
        window.gtag('event', gaEvent, {
          value: data.value,
          currency: data.currency,
          items: [{ item_name: data.content_name || eventName, price: data.value }]
        });
      }
      if (window.dataLayer && Array.isArray(window.dataLayer)) {
        window.dataLayer.push({
          event: eventName,
          ecommerce: {
            value: data.value,
            currency: data.currency,
            items: [{ item_name: data.content_name || eventName, price: data.value }]
          }
        });
      }
    } catch (errGtag) {}

    // 4. API Oficial UTMify (/tracking/v1/events)
    // Suporte documentado direto para PageView, ViewContent e Purchase
    const supportedApiEvents = ['PageView', 'ViewContent', 'Purchase'];
    if (supportedApiEvents.includes(eventName)) {
      try {
        let lead = null;
        try {
          const leadStr = SafeStorage.getItem('lead');
          if (leadStr) lead = JSON.parse(leadStr);
        } catch (e) {}

        const pixelId = window.pixelId || DEFAULT_PIXEL_ID;
        const utmifyPayload = {
          type: eventName,
          lead: Object.assign({}, lead || {}, { pixelId: pixelId }),
          event: {
            sourceUrl: window.location.href,
            pageTitle: document.title,
            value: data.value,
            currency: data.currency
          }
        };

        // Disparo com mecanismo de retry e backoff
        sendWithRetry(UTMIFY_EVENTS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(utmifyPayload)
        }).catch(function(err) {
          recordDiagnostic('ERROR', 'Falha na transmissão UTMify', err.message);
        });

      } catch (errUtmify) {
        recordDiagnostic('ERROR', 'Erro ao preparar transmissão UTMify', errUtmify.message);
      }
    }

    return { success: true, payload: internalPayload };
  }

  // ─────────────────────────────────────────────────────────────
  // 9. PAINEL E MODAL DE DIAGNÓSTICO (window.UTMifyDiagnostic)
  // ─────────────────────────────────────────────────────────────
  const UTMifyDiagnostic = {
    getStatus: function() {
      const attribution = getStoredAttribution();
      let lead = null;
      try {
        const leadStr = SafeStorage.getItem('lead');
        if (leadStr) lead = JSON.parse(leadStr);
      } catch (e) {}

      return {
        detectedScripts: {
          pixelScript: !!document.querySelector('script[src*="pixel.js"]'),
          latestScript: !!document.querySelector('script[src*="latest.js"]'),
          metaPixelFbq: typeof window.fbq === 'function',
          tiktokTtq: !!(window.ttq && typeof window.ttq.track === 'function'),
          googleGtag: typeof window.gtag === 'function' || Array.isArray(window.dataLayer)
        },
        pixelId: window.pixelId || DEFAULT_PIXEL_ID,
        leadId: (lead && lead._id) ? lead._id : null,
        metaPixelIds: (lead && lead.metaPixelIds) ? lead.metaPixelIds : null,
        attribution: attribution,
        firstTouch: attribution ? attribution.firstTouch : {},
        lastTouch: attribution ? attribution.lastTouch : {},
        trackedPurchases: getTrackedPurchases(),
        totalLogs: DiagnosticLogs.length,
        debugActive: isDebugMode()
      };
    },

    getEventsLog: function() {
      return [].concat(DiagnosticLogs);
    },

    getAttribution: function() {
      return getStoredAttribution();
    },

    clearAttribution: function() {
      SafeStorage.removeItem(STORAGE_KEY_ATTRIBUTION);
      SafeStorage.removeItem(STORAGE_KEY_PURCHASES);
      recordDiagnostic('STORED', 'Armazenamento de atribuição resetado manualmente.');
      return true;
    },

    showModal: function() {
      if (typeof document === 'undefined') return;
      let modal = document.getElementById('utmify-diagnostic-modal');
      if (modal) {
        modal.style.display = 'block';
        return;
      }

      const status = UTMifyDiagnostic.getStatus();
      const logs = UTMifyDiagnostic.getEventsLog().slice(0, 15);

      modal = document.createElement('div');
      modal.id = 'utmify-diagnostic-modal';
      modal.style.cssText = `
        position: fixed;
        bottom: 16px;
        right: 16px;
        width: 480px;
        max-width: calc(100vw - 32px);
        max-height: 80vh;
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      `;

      modal.innerHTML = `
        <div style="padding: 12px 16px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #22c55e;"></span>
            UTMify — Painel de Diagnóstico & Atribuição
          </div>
          <button id="utmify-close-diag-btn" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer;">✕</button>
        </div>
        <div style="padding: 14px 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px;">
          <!-- Status dos Scripts -->
          <div style="background: #1e293b; border-radius: 8px; padding: 10px;">
            <div style="font-weight: 600; color: #94a3b8; margin-bottom: 6px; font-size: 11px;">SCRIPTS & PIXEL</div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
              <span style="padding: 2px 8px; border-radius: 4px; background: ${status.detectedScripts.pixelScript ? '#065f46' : '#7f1d1d'}; color: #fff;">pixel.js</span>
              <span style="padding: 2px 8px; border-radius: 4px; background: ${status.detectedScripts.latestScript ? '#065f46' : '#7f1d1d'}; color: #fff;">latest.js</span>
              <span style="padding: 2px 8px; border-radius: 4px; background: ${status.detectedScripts.metaPixelFbq ? '#065f46' : '#7f1d1d'}; color: #fff;">Meta Pixel</span>
              <span style="padding: 2px 8px; border-radius: 4px; background: ${status.pixelId ? '#1e3a8a' : '#7f1d1d'}; color: #fff;">Pixel ID: ${status.pixelId || 'Nenhum'}</span>
            </div>
          </div>

          <!-- Atribuição -->
          <div style="background: #1e293b; border-radius: 8px; padding: 10px;">
            <div style="font-weight: 600; color: #94a3b8; margin-bottom: 6px; font-size: 11px;">FIRST TOUCH vs LAST TOUCH</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div style="background: #0f172a; padding: 8px; border-radius: 6px;">
                <div style="color: #38bdf8; font-weight: 600;">First Touch</div>
                <pre style="margin: 4px 0 0; font-size: 10px; color: #cbd5e1; white-space: pre-wrap;">${JSON.stringify(status.firstTouch, null, 2)}</pre>
              </div>
              <div style="background: #0f172a; padding: 8px; border-radius: 6px;">
                <div style="color: #34d399; font-weight: 600;">Last Touch</div>
                <pre style="margin: 4px 0 0; font-size: 10px; color: #cbd5e1; white-space: pre-wrap;">${JSON.stringify(status.lastTouch, null, 2)}</pre>
              </div>
            </div>
          </div>

          <!-- Log de Transmissões Recentes -->
          <div style="background: #1e293b; border-radius: 8px; padding: 10px;">
            <div style="font-weight: 600; color: #94a3b8; margin-bottom: 6px; font-size: 11px;">HISTÓRICO RECENTE DE EVENTOS</div>
            <div style="display: flex; flex-direction: column; gap: 6px; max-height: 160px; overflow-y: auto;">
              ${logs.map(l => `
                <div style="background: #0f172a; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #38bdf8;">
                  <div style="display: flex; justify-content: space-between; font-size: 10px;">
                    <span style="font-weight: 700; color: #38bdf8;">[${l.stage}]</span>
                    <span style="color: #64748b;">${l.timestamp.split('T')[1].slice(0, 8)}</span>
                  </div>
                  <div style="color: #e2e8f0; margin-top: 2px;">${l.message}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modal);
      document.getElementById('utmify-close-diag-btn').addEventListener('click', function() {
        modal.remove();
      });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 10. INTERCEPTOR INTELIGENTE DE REDE (PROXY LOCALHOST & CORS)
  // ─────────────────────────────────────────────────────────────
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
      let targetUrl = (typeof resource === 'string') ? resource : (resource && resource.url ? resource.url : '');

      // Se script da UTMify tentar acessar http://localhost:3001/tracking/v1
      // e o servidor local estiver na porta 3000, roteia com segurança ou registra diagnóstico
      if (targetUrl.includes('localhost:3001/tracking/v1') || targetUrl.includes('tracking.utmify.com.br/tracking/v1')) {
        recordDiagnostic('SENT', 'Requisição UTMify interceptada pelo cliente', { url: targetUrl });
      }

      try {
        const response = await originalFetch.apply(this, arguments);
        return response;
      } catch (fetchErr) {
        // Fallback defensivo: se falhar conexão para porta 3001 no dev, tenta redirecionar para a URL oficial da UTMify
        if (targetUrl.includes('localhost:3001/tracking/v1')) {
          recordDiagnostic('RETRY', 'Porta local 3001 inacessível no browser. Redirecionando diretamente para CDN da UTMify...');
          const fallbackUrl = targetUrl.replace('http://localhost:3001', 'https://tracking.utmify.com.br');
          return originalFetch.apply(this, [fallbackUrl, init]);
        }
        throw fetchErr;
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 11. INICIALIZAÇÃO AUTOMÁTICA
  // ─────────────────────────────────────────────────────────────
  initAttribution();

  // ─────────────────────────────────────────────────────────────
  // 12. EXPORTAÇÕES GLOBAIS
  // ─────────────────────────────────────────────────────────────
  window.buildUrlPreservingParams  = buildUrlPreservingParams;
  window.redirectPreservingParams  = redirectPreservingParams;
  window.replacePreservingParams   = replacePreservingParams;
  window.syncAllLinks              = syncAllLinks;
  window.trackPixelEvent           = trackPixelEvent;
  window.createEventPayload        = createEventPayload;
  window.sendWithRetry             = sendWithRetry;

  window.UTMifyTracker = {
    init: initAttribution,
    getAttribution: getStoredAttribution,
    getTrackingParams: getActiveTrackingParams,
    createEventPayload: createEventPayload,
    trackEvent: trackPixelEvent,
    sendWithRetry: sendWithRetry
  };

  window.UTMifyDiagnostic = UTMifyDiagnostic;

})(window);
