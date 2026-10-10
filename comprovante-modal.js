// ═════════════════════════════════════════════════════════════════
// COMPROVANTE MODAL & UPLOAD PIX INTEGRADO AO BACKEND / DISCORD
// ═════════════════════════════════════════════════════════════════

(function () {
  let arquivoSelecionado = null;
  let enviando = false;

  function criarEstruturaModal() {
    if (document.getElementById('comprovanteModalBackdrop')) return;

    const modalHTML = `
      <div class="comprovante-modal-backdrop" id="comprovanteModalBackdrop" onclick="fecharModalComprovanteSeFora(event)">
        <div class="comprovante-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="comprovanteModalTitle">
          <button type="button" class="comprovante-modal-close" onclick="fecharModalComprovante()" aria-label="Fechar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div class="comprovante-badge">PAGAMENTO EM PROCESSAMENTO</div>
          
          <h3 class="comprovante-title" id="comprovanteModalTitle">Anexe seu Comprovante Pix</h3>
          
          <p class="comprovante-desc" id="comprovanteDesc">
            Seu pagamento ainda não foi identificado automaticamente ou está sendo compensado pelo banco. Anexe o comprovante Pix abaixo para solicitar a verificação.
          </p>

          <!-- Corpo do formulário (Upload) -->
          <div id="comprovanteBodyUpload">
            <div class="comprovante-dropzone" id="comprovanteDropzone" onclick="clicarSelecionarComprovante(event)">
              <input type="file" id="comprovanteFileInput" accept=".pdf,image/jpeg,image/png,image/webp" style="display:none;" onchange="aoSelecionarArquivoComprovante(event)">
              
              <div id="dropzoneEmptyState">
                <svg class="comprovante-upload-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <div class="comprovante-drop-text">
                  Arraste o arquivo aqui ou <span class="comprovante-drop-highlight">clique para selecionar</span>
                </div>
                <div class="comprovante-drop-sub">PDF, JPG, PNG ou WEBP (máx. 10MB)</div>
              </div>

              <div id="dropzoneSelectedState" style="display: none;">
                <div class="comprovante-file-preview">
                  <div class="comprovante-file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1351B4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                  </div>
                  <div class="comprovante-file-info">
                    <div class="comprovante-file-name" id="comprovanteFileName">comprovante.pdf</div>
                    <div class="comprovante-file-size" id="comprovanteFileSize">1.2 MB</div>
                  </div>
                  <button type="button" class="comprovante-remove-file" onclick="removerArquivoComprovante(event)" title="Remover ou substituir arquivo">
                    &times;
                  </button>
                </div>
              </div>
            </div>

            <!-- Caixa de Mensagem / Alerta de Erro -->
            <div id="comprovanteMsgBox" class="comprovante-msg-box" style="display: none;"></div>

            <!-- Botão Validar Comprovante (Inicialmente Desabilitado) -->
            <button type="button" class="btn-validar-comprovante" id="btnValidarComprovante" onclick="submeterComprovante()" disabled>
              <span id="btnValidarComprovanteText">Validar Comprovante</span>
            </button>
          </div>

          <!-- Estado de Sucesso pós-envio -->
          <div id="comprovanteBodySuccess" style="display: none;">
            <div class="comprovante-success-card">
              <div class="comprovante-success-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              <h4 class="comprovante-success-title">Comprovante Recebido!</h4>
              <p class="comprovante-success-desc">
                Comprovante recebido com sucesso! Nossa equipe verificará seu pagamento.
              </p>
              <div class="comprovante-success-info">
                <span>🟡 Status:</span> <strong>Aguardando verificação</strong>
              </div>
              <button type="button" class="btn-fechar-sucesso" onclick="fecharModalComprovante()">
                Fechar
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    const div = document.createElement('div');
    div.innerHTML = modalHTML;
    document.body.appendChild(div.firstElementChild);

    configurarDragAndDrop();
  }

  function configurarDragAndDrop() {
    const dropzone = document.getElementById('comprovanteDropzone');
    if (!dropzone) return;

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      }, false);
    });

    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt ? dt.files : null;
      if (files && files.length > 0) {
        processarArquivo(files[0]);
      }
    }, false);
  }

  function processarArquivo(file) {
    ocultarMensagem();

    if (!file) return;

    // Validação de Tamanho (Máx 10MB)
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      exibirMensagem('O arquivo selecionado é maior que o limite de 10MB.', 'erro');
      animarErroDropzone();
      desabilitarBotaoValidar();
      return;
    }

    // Validação de Extensão / Tipo MIME
    const extensoesValidas = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const nome = (file.name || '').toLowerCase();
    const ehValido = extensoesValidas.some(ext => nome.endsWith(ext)) ||
      ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type);

    if (!ehValido) {
      exibirMensagem('Formato inválido. Por favor, envie um arquivo PDF, JPG, PNG ou WEBP.', 'erro');
      animarErroDropzone();
      desabilitarBotaoValidar();
      return;
    }

    arquivoSelecionado = file;

    // Atualizar UI
    const emptyState = document.getElementById('dropzoneEmptyState');
    const selectedState = document.getElementById('dropzoneSelectedState');
    const nameEl = document.getElementById('comprovanteFileName');
    const sizeEl = document.getElementById('comprovanteFileSize');

    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) sizeEl.textContent = formatarTamanho(file.size);

    if (emptyState) emptyState.style.display = 'none';
    if (selectedState) selectedState.style.display = 'block';

    // Habilitar botão "Validar Comprovante"
    habilitarBotaoValidar();
  }

  function habilitarBotaoValidar() {
    const btnValidar = document.getElementById('btnValidarComprovante');
    if (btnValidar) {
      btnValidar.disabled = false;
      btnValidar.classList.add('ativo');
    }
  }

  function desabilitarBotaoValidar() {
    const btnValidar = document.getElementById('btnValidarComprovante');
    if (btnValidar) {
      btnValidar.disabled = true;
      btnValidar.classList.remove('ativo');
    }
  }

  function formatarTamanho(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function animarErroDropzone() {
    const dropzone = document.getElementById('comprovanteDropzone');
    if (dropzone) {
      dropzone.classList.remove('shake');
      void dropzone.offsetWidth; // trigger reflow
      dropzone.classList.add('shake');
    }
  }

  function exibirMensagem(texto, tipo = 'aviso') {
    const msgBox = document.getElementById('comprovanteMsgBox');
    if (!msgBox) return;
    msgBox.textContent = texto;
    msgBox.className = `comprovante-msg-box ${tipo}`;
    msgBox.style.display = 'block';
  }

  function ocultarMensagem() {
    const msgBox = document.getElementById('comprovanteMsgBox');
    if (msgBox) {
      msgBox.className = 'comprovante-msg-box';
      msgBox.style.display = 'none';
      msgBox.textContent = '';
    }
  }

  // Funções Globais expostas
  window.abrirModalComprovante = function () {
    criarEstruturaModal();
    const backdrop = document.getElementById('comprovanteModalBackdrop');
    if (backdrop) {
      backdrop.classList.add('ativo');
      document.body.style.overflow = 'hidden';
    }
  };

  window.fecharModalComprovante = function () {
    const backdrop = document.getElementById('comprovanteModalBackdrop');
    if (backdrop) {
      backdrop.classList.remove('ativo');
      document.body.style.overflow = '';
    }
  };

  window.fecharModalComprovanteSeFora = function (e) {
    if (e.target && e.target.id === 'comprovanteModalBackdrop') {
      window.fecharModalComprovante();
    }
  };

  window.clicarSelecionarComprovante = function (e) {
    if (e && e.target && e.target.closest('.comprovante-remove-file')) return;
    const input = document.getElementById('comprovanteFileInput');
    if (input) input.click();
  };

  window.aoSelecionarArquivoComprovante = function (e) {
    const file = e.target.files && e.target.files[0];
    if (file) {
      processarArquivo(file);
    }
  };

  window.removerArquivoComprovante = function (e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    arquivoSelecionado = null;
    const input = document.getElementById('comprovanteFileInput');
    if (input) input.value = '';

    const emptyState = document.getElementById('dropzoneEmptyState');
    const selectedState = document.getElementById('dropzoneSelectedState');

    if (emptyState) emptyState.style.display = 'block';
    if (selectedState) selectedState.style.display = 'none';

    desabilitarBotaoValidar();
    ocultarMensagem();
  };

  window.submeterComprovante = async function () {
    if (enviando) return;

    if (!arquivoSelecionado) {
      exibirMensagem('Por favor, selecione seu comprovante Pix antes de validar.', 'aviso');
      animarErroDropzone();
      desabilitarBotaoValidar();
      const input = document.getElementById('comprovanteFileInput');
      if (input) input.click();
      return;
    }

    const btn = document.getElementById('btnValidarComprovante');
    const btnText = document.getElementById('btnValidarComprovanteText');
    const originalText = 'Validar Comprovante';

    enviando = true;
    if (btn) btn.disabled = true;
    if (btnText) {
      btnText.innerHTML = '<span class="comprovante-btn-spinner"></span> Enviando comprovante...';
    }
    ocultarMensagem();

    try {
      // Metadados internos (sem expor campos adicionais ao cliente)
      let nome = (window.dadosConsulta && window.dadosConsulta.nome) ||
        (window.userData && window.userData.nome) ||
        new URLSearchParams(window.location.search).get('nome') ||
        '';

      if (!nome) {
        try {
          const u1 = JSON.parse(localStorage.getItem('desenrola_user') || sessionStorage.getItem('desenrola_user') || '{}');
          if (u1 && u1.nome) nome = u1.nome;
        } catch(e) {}
      }
      if (!nome) {
        try {
          const u2 = JSON.parse(localStorage.getItem('customerData') || '{}');
          if (u2 && u2.nome) nome = u2.nome;
        } catch(e) {}
      }
      if (!nome) {
        const el = document.getElementById('confirmNome') ||
                   document.getElementById('display-name') ||
                   document.getElementById('userChipName');
        if (el && el.textContent) nome = el.textContent.trim();
      }

      const txId = window._currentTransactionId ||
        (window.dadosConsulta && window.dadosConsulta.transactionId) ||
        localStorage.getItem('desenrola_transaction_id') ||
        '';

      const orderId = window._currentOrderId ||
        (window.dadosConsulta && window.dadosConsulta.orderId) ||
        localStorage.getItem('desenrola_order_id') ||
        '';

      const cpf = (window.dadosConsulta && window.dadosConsulta.cpf) ||
        localStorage.getItem('desenrola_cpf') ||
        '';

      const formData = new FormData();
      formData.append('comprovante', arquivoSelecionado);
      if (nome) formData.append('nome', nome);
      if (txId) formData.append('transactionId', txId);
      if (orderId) formData.append('orderId', orderId);
      if (cpf) formData.append('cpf', cpf);

      const response = await fetch('/api/payment-proof', {
        method: 'POST',
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        // Estado de Sucesso: exibe mensagem e botão "Fechar"
        const bodyUpload = document.getElementById('comprovanteBodyUpload');
        const bodySuccess = document.getElementById('comprovanteBodySuccess');
        const descEl = document.getElementById('comprovanteDesc');

        if (bodyUpload) bodyUpload.style.display = 'none';
        if (bodySuccess) bodySuccess.style.display = 'block';
        if (descEl) descEl.style.display = 'none';

        // Dispara evento global
        window.dispatchEvent(new CustomEvent('comprovanteEnviado', {
          detail: {
            fileName: arquivoSelecionado.name,
            fileSize: arquivoSelecionado.size,
            transactionId: txId || orderId
          }
        }));

      } else {
        // Mensagem de Erro
        const msgErro = data.message || 'Não foi possível enviar seu comprovante. Tente novamente.';
        exibirMensagem(msgErro, 'erro');
        animarErroDropzone();

        // Permite nova tentativa sem perder o arquivo selecionado
        if (btn) {
          btn.disabled = false;
          btn.classList.add('ativo');
        }
        if (btnText) btnText.textContent = originalText;
      }

    } catch (err) {
      console.error('Erro ao enviar comprovante:', err);
      exibirMensagem('Não foi possível enviar seu comprovante. Tente novamente.', 'erro');
      animarErroDropzone();

      if (btn) {
        btn.disabled = false;
        btn.classList.add('ativo');
      }
      if (btnText) btnText.textContent = originalText;

    } finally {
      enviando = false;
    }
  };

  // Tecla ESC fecha o modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      window.fecharModalComprovante();
    }
  });

  // Inicializar no carregamento do DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', criarEstruturaModal);
  } else {
    criarEstruturaModal();
  }
})();
