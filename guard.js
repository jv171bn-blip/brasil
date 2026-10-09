/**
 * guard.js - Sistema de Prevenção de Abusos e Trava de Jornada
 * Fingerprinting de dispositivo de alta fidelidade + Validação de Entrada
 */

(function (window) {
  'use strict';

  const STORAGE_KEY = '__desenrola_completed';
  const COOKIE_NAME = '__funnel_completed';
  const BYPASS_KEY = '__admin_bypass';
  const REDIRECT_URL = '/404.html';

  /**
   * Verifica se o navegador está em modo desenvolvedor / administrador bypass.
   * Ativado automaticamente em localhost ou via parâmetro ?admin=1 na URL.
   */
  function isAdminBypass() {
    try {
      const search = window.location.search || '';
      if (search.includes('admin=1') || search.includes('bypass=1') || search.includes('preview=1')) {
        localStorage.setItem(BYPASS_KEY, 'true');
        localStorage.removeItem(STORAGE_KEY);
        const d = new Date();
        d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
        document.cookie = `__admin_bypass=1; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
        document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        return true;
      }

      if (localStorage.getItem(BYPASS_KEY) === 'true') {
        localStorage.removeItem(STORAGE_KEY);
        return true;
      }

      if (document.cookie.includes('__admin_bypass=1')) {
        return true;
      }

      const host = window.location.hostname || '';
      const proto = window.location.protocol || '';
      if (proto === 'file:' || host === 'localhost' || host === '127.0.0.1') {
        return true;
      }
    } catch (e) {}
    return false;
  }



  /**
   * Converte ArrayBuffer para string hexadecimal (SHA-256).
   */
  function bufferToHex(buffer) {
    const byteArray = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < byteArray.length; i++) {
      hex += byteArray[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * Algoritmo de hash de fallback rápido se Web Crypto não estiver disponível.
   */
  function fallbackHash(str) {
    let hash1 = 0xdeadbeef, hash2 = 0x41c64e6d;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash1 = Math.imul(hash1 ^ ch, 2654435761);
      hash2 = Math.imul(hash2 ^ ch, 1597334677);
    }
    hash1 = Math.imul(hash1 ^ (hash1 >>> 16), 2246822507);
    hash1 ^= Math.imul(hash2 ^ (hash2 >>> 13), 3266489909);
    hash2 = Math.imul(hash2 ^ (hash2 >>> 16), 2246822507);
    hash2 ^= Math.imul(hash1 ^ (hash1 >>> 13), 3266489909);
    const part1 = (hash1 >>> 0).toString(16).padStart(8, '0');
    const part2 = (hash2 >>> 0).toString(16).padStart(8, '0');
    return (part1 + part2 + part1 + part2 + part1 + part2 + part1 + part2).slice(0, 64);
  }

  /**
   * Coleta Canvas Fingerprint
   */
  function getCanvasFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 60;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 'no_canvas';

      // Desenho complexo que varia conforme renderizador da GPU e rasterizador do SO
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial', 'Helvetica', sans-serif";
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);

      ctx.fillStyle = '#069';
      ctx.fillText('Desenrola-Brasil.gov.br#123@!', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Seguranca&Oferta*456~', 4, 35);

      // Curva Bézier
      ctx.strokeStyle = '#3cb043';
      ctx.beginPath();
      ctx.arc(50, 45, 12, 0, Math.PI * 2, true);
      ctx.stroke();

      return canvas.toDataURL();
    } catch (e) {
      return 'canvas_error';
    }
  }

  /**
   * Coleta WebGL Fingerprint (GPU Vendor e Renderer desmascarados)
   */
  function getWebGLFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { vendor: 'no_webgl', renderer: 'no_webgl' };

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) {
        return {
          vendor: gl.getParameter(gl.VENDOR) || 'unknown',
          renderer: gl.getParameter(gl.RENDERER) || 'unknown'
        };
      }

      return {
        vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '',
        renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || ''
      };
    } catch (e) {
      return { vendor: 'webgl_err', renderer: 'webgl_err' };
    }
  }

  /**
   * Coleta AudioContext Fingerprint
   */
  function getAudioFingerprint() {
    return new Promise((resolve) => {
      try {
        const AudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!AudioContext) return resolve('no_audio');

        const context = new AudioContext(1, 44100, 44100);
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(10000, context.currentTime);

        const compressor = context.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-50, context.currentTime);
        compressor.knee.setValueAtTime(40, context.currentTime);
        compressor.ratio.setValueAtTime(12, context.currentTime);
        compressor.attack.setValueAtTime(0, context.currentTime);
        compressor.release.setValueAtTime(0.25, context.currentTime);

        oscillator.connect(compressor);
        compressor.connect(context.destination);
        oscillator.start(0);

        context.oncomplete = function (event) {
          try {
            const samples = event.renderedBuffer.getChannelData(0);
            let sum = 0;
            for (let i = 4500; i < 5000; i++) {
              sum += Math.abs(samples[i]);
            }
            resolve(String(sum));
          } catch (e) {
            resolve('audio_calc_err');
          }
        };

        context.startRendering();
      } catch (e) {
        resolve('audio_error');
      }
    });
  }

  /**
   * Gera o hash único do dispositivo (Device ID).
   */
  async function generateDeviceId() {
    const canvasData = getCanvasFingerprint();
    const webglData = getWebGLFingerprint();
    let audioData = 'skipped';
    
    try {
      // Timeout seguro para áudio caso demore
      audioData = await Promise.race([
        getAudioFingerprint(),
        new Promise(r => setTimeout(() => r('audio_timeout'), 500))
      ]);
    } catch(e) {}

    const components = [
      // Resolução e Pixel Ratio
      screen.width || 0,
      screen.height || 0,
      screen.colorDepth || 0,
      window.devicePixelRatio || 1,
      // Hardware
      navigator.hardwareConcurrency || 0,
      navigator.deviceMemory || 0,
      navigator.maxTouchPoints || 0,
      navigator.platform || '',
      // Localização e Idioma
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      new Date().getTimezoneOffset(),
      navigator.language || '',
      (navigator.languages || []).join(';'),
      // GPU
      webglData.vendor,
      webglData.renderer,
      // Renderização visual e áudio
      canvasData,
      audioData
    ];

    const rawString = components.join('###');

    if (window.crypto && window.crypto.subtle) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(rawString);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        return bufferToHex(hashBuffer);
      } catch (e) {
        return fallbackHash(rawString);
      }
    }

    return fallbackHash(rawString);
  }

  /**
   * Helper para salvar cookie localmente
   */
  function setGuardCookie() {
    try {
      const d = new Date();
      d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
      document.cookie = `${COOKIE_NAME}=1; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
    } catch (e) {}
  }

  /**
   * Helper para ler cookie
   */
  function hasGuardCookie() {
    try {
      return document.cookie.split(';').some(c => c.trim().startsWith(`${COOKIE_NAME}=`));
    } catch (e) {
      return false;
    }
  }

  /**
   * Marca a jornada como concluída. Chamado na página de agradecimento (obrigado.html).
   */
  async function registrarConclusao() {
    if (isAdminBypass()) {
      console.log('[FunnelGuard] Modo Desenvolvedor ativo: registro de trava ignorado.');
      return { success: true, bypass: true };
    }

    try {
      // 1. Marcação imediata local (redundância)
      localStorage.setItem(STORAGE_KEY, 'true');
      setGuardCookie();

      // 2. Coleta de Fingerprint
      const deviceId = await generateDeviceId();
      localStorage.setItem('__desenrola_device_id', deviceId);

      const payload = {
        deviceId: deviceId,
        metadata: {
          screen: `${screen.width}x${screen.height}`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          timestamp: Date.now()
        }
      };

      // 3. Envio para o backend salvar na tabela de restrição
      const response = await fetch('/api/finalizar-jornada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();
      console.log('[FunnelGuard] Jornada marcada como concluída no servidor:', resData);
      return resData;
    } catch (err) {
      console.error('[FunnelGuard] Falha ao registrar finalização:', err);
    }
  }

  function resolveGuardRedirect(destination) {
    if (typeof window.buildUrlPreservingParams === 'function') {
      return window.buildUrlPreservingParams(destination);
    }
    try {
      const destUrl = new URL(destination, window.location.href);
      const currentParams = new URLSearchParams(window.location.search);
      currentParams.forEach((val, key) => {
        if (!destUrl.searchParams.has(key)) {
          destUrl.searchParams.append(key, val);
        }
      });
      return destUrl.toString();
    } catch (e) {
      return destination;
    }
  }

  /**
   * Middleware de frontend para verificação de acesso.
   * Redireciona imediatamente caso o dispositivo ou IP já tenham concluído a jornada.
   */
  async function verificarAcesso() {
    // 0. Se estiver em Modo Desenvolvedor / Bypass / Localhost, libera totalmente
    if (isAdminBypass()) {
      console.log('[FunnelGuard] Acesso liberado (Modo Desenvolvedor / Admin).');
      return;
    }

    // 1. Verificação instantânea local (Sem delay de rede)
    if (localStorage.getItem(STORAGE_KEY) === 'true' || hasGuardCookie()) {
      console.warn('[FunnelGuard] Acesso bloqueado por identificação local.');
      window.location.replace(resolveGuardRedirect(REDIRECT_URL));
      return;
    }

    // 2. Verificação assíncrona robusta via API (Contra limpeza de cache / aba anônima)
    try {
      const deviceId = await generateDeviceId();

      const res = await fetch(`/api/verificar-acesso?deviceId=${encodeURIComponent(deviceId)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!res.ok) return;

      const data = await res.json();
      if (data && data.bloqueado) {
        console.warn(`[FunnelGuard] Acesso restrito detectado pelo backend: ${data.motivo}`);
        
        // Reativa proteções locais para barrar requisições futuras instantaneamente
        localStorage.setItem(STORAGE_KEY, 'true');
        setGuardCookie();
        
        window.location.replace(resolveGuardRedirect(data.redirecionarPara || REDIRECT_URL));
      }
    } catch (err) {
      // Em caso de falha de conexão com a API, segue fluxo normal
      console.warn('[FunnelGuard] Verificação de integridade offline/indisponível:', err);
    }
  }

  /**
   * Desbloqueio manual no console do navegador (Ex: FunnelGuard.desbloquear())
   */
  function desbloquear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('__desenrola_device_id');
      localStorage.setItem(BYPASS_KEY, 'true');
      document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      const d = new Date();
      d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
      document.cookie = `__admin_bypass=1; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
      console.log('%c[FunnelGuard] Dispositivo desbloqueado com sucesso! Modo Admin ativado.', 'color: green; font-weight: bold;');
      return 'Desbloqueado com sucesso!';
    } catch(e) {
      return 'Erro ao desbloquear';
    }
  }

  // Exporta objeto global
  window.FunnelGuard = {
    getDeviceId: generateDeviceId,
    registrarConclusao: registrarConclusao,
    verificarAcesso: verificarAcesso,
    desbloquear: desbloquear,
    isAdmin: isAdminBypass
  };

})(window);

