// Interações da página Desenrola Brasil - Etapa 1
document.addEventListener('DOMContentLoaded', () => {
  const btnAcessar = document.getElementById('btn-acessar');

  if (btnAcessar) {
    btnAcessar.addEventListener('click', () => {
      // Redireciona para a tela de consulta de CPF preservando integralmente parâmetros de URL (UTMs, tracking)
      if (typeof redirectPreservingParams === 'function') {
        redirectPreservingParams('consulta.html');
      } else {
        const dest = new URL('consulta.html', window.location.href);
        new URLSearchParams(window.location.search).forEach((v, k) => {
          if (!dest.searchParams.has(k)) dest.searchParams.append(k, v);
        });
        window.location.href = dest.toString();
      }
    });
  }
});
