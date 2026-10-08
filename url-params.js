/**
 * url-params.js
 * Utilitário de Preservação Integral de Parâmetros de URL (UTMs, Tracking, CPF)
 * e Navegação Segura entre Etapas do Funil.
 */
(function(window) {
  'use strict';

  /**
   * Normaliza o destino caso seja fornecido um domínio sem protocolo
   * Ex: "checkout.com/oferta" -> "https://checkout.com/oferta"
   * Mantém caminhos relativos e locais intactos (ex: "/upsell1", "atendimento.html").
   */
  function cleanDestination(dest) {
    if (!dest) return window.location.href;
    const str = String(dest).trim();
    if (!str.startsWith('/') && !str.startsWith('./') && !str.startsWith('../') && !str.includes('://') && !str.startsWith('//')) {
      if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,6}(\/|\?|#|$)/.test(str) && !str.includes('.html')) {
        return 'https://' + str;
      }
    }
    return str;
  }

  /**
   * Obtém o CPF salvo no armazenamento local caso não conste na query string atual.
   */
  function getFallbackCpf() {
    try {
      if (typeof localStorage !== 'undefined') {
        const cpf = localStorage.getItem('desenrola_cpf');
        if (cpf) return String(cpf).replace(/\D/g, '');

        const userStr = localStorage.getItem('desenrola_user') ||
                        sessionStorage.getItem('desenrola_user') ||
                        localStorage.getItem('customerData');
        if (userStr) {
          const user = JSON.parse(userStr);
          if (user && (user.cpf || user.documento)) {
            return String(user.cpf || user.documento).replace(/\D/g, '');
          }
        }
      }
    } catch (e) {}
    return '';
  }

  /**
   * Constrói uma URL de destino preservando todos os parâmetros atuais da URL,
   * preservando parâmetros já existentes no destino, preservando fragmentos (#hash)
   * e garantindo a manutenção do CPF da consulta.
   *
   * @param {string} destination - Caminho ou URL de destino (relativo ou absoluto)
   * @param {object} [customParams] - Parâmetros adicionais/substitutos opcionais
   * @returns {string} URL completa formatada com todos os parâmetros preservados
   */
  function buildUrlPreservingParams(destination, customParams) {
    if (!destination) return window.location.href;

    try {
      const finalDest = cleanDestination(destination);
      const destinationUrl = new URL(finalDest, window.location.href);
      const currentParams = new URLSearchParams(window.location.search);

      // 1. Aplica parâmetros customizados fornecidos explicitamente (se houver)
      if (customParams && typeof customParams === 'object') {
        Object.keys(customParams).forEach(key => {
          const val = customParams[key];
          if (val !== undefined && val !== null && val !== '') {
            destinationUrl.searchParams.set(key, val);
          }
        });
      }

      // 2. Preserva todos os parâmetros existentes na URL atual que não estejam definidos no destino
      currentParams.forEach((value, key) => {
        if (!destinationUrl.searchParams.has(key)) {
          destinationUrl.searchParams.append(key, value);
        }
      });

      // 3. Garante que o CPF da consulta seja mantido na URL
      if (!destinationUrl.searchParams.has('cpf')) {
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

  /**
   * Redireciona para o destino preservando todos os parâmetros de URL e CPF.
   *
   * @param {string} destination - Caminho ou URL de destino
   * @param {object} [customParams] - Parâmetros opcionais
   */
  function redirectPreservingParams(destination, customParams) {
    const targetUrl = buildUrlPreservingParams(destination, customParams);
    window.location.href = targetUrl;
  }

  // Intercepta cliques em links internos <a> para garantir propagação automática
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
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
        // Aplica a links internos do mesmo domínio
        if (url.origin === window.location.origin) {
          e.preventDefault();
          redirectPreservingParams(target.href);
        }
      } catch (err) {}
    }, false);
  }

  /**
   * Garante a fila do fbq caso o script ainda esteja carregando
   */
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
   * Dispara eventos de rastreamento para pixels instalados
   * (Meta/Facebook fbq, TikTok ttq, Google Ads/Analytics gtag/dataLayer e UTMify API).
   *
   * @param {string} eventName - Nome do evento ('InitiateCheckout', 'Purchase', etc.)
   * @param {object} [eventData] - Dados do evento (ex: { value: 68.92, currency: 'BRL', content_name: 'Acordo Desenrola Brasil' })
   */
  function trackPixelEvent(eventName, eventData) {
    if (!eventName) return;
    const data = Object.assign({ currency: 'BRL' }, eventData || {});

    try {
      console.log('[Tracking] Disparando evento:', eventName, data);

      // 1. Meta / Facebook Pixel (fbq)
      try {
        const fbq = ensureFbq();
        fbq('track', eventName, {
          value: data.value,
          currency: data.currency,
          content_name: data.content_name || eventName,
          content_type: 'product'
        });
      } catch (errFbq) {
        console.warn('[Tracking] Falha ao disparar fbq:', errFbq);
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

      // 4. UTMify Tracking API direta
      try {
        const leadStr = localStorage.getItem('lead');
        const pixelId = window.pixelId || '6ac721d68c7ca797856a1563';
        if (leadStr && typeof fetch === 'function') {
          const lead = JSON.parse(leadStr);
          if (lead && (lead._id || lead.pixelId || pixelId)) {
            fetch('https://tracking.utmify.com.br/tracking/v1/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: eventName,
                lead: Object.assign({}, lead, { pixelId: pixelId }),
                event: {
                  sourceUrl: window.location.href,
                  pageTitle: document.title,
                  value: data.value,
                  currency: data.currency
                }
              })
            }).catch(() => {});
          }
        }
      } catch (errUtmify) {}

    } catch (e) {
      console.warn('[Tracking] Erro geral ao disparar evento:', e);
    }
  }

  // Exporta globalmente no window
  window.buildUrlPreservingParams = buildUrlPreservingParams;
  window.redirectPreservingParams = redirectPreservingParams;
  window.trackPixelEvent = trackPixelEvent;

})(window);
