// Interações da página Desenrola Brasil - Etapa 1
document.addEventListener('DOMContentLoaded', () => {
  const btnAcessar = document.getElementById('btn-acessar');

  if (btnAcessar) {
    btnAcessar.addEventListener('click', () => {
      // Redireciona para a tela de consulta de CPF preservando parâmetros de URL (UTMs)
      const currentQuery = window.location.search;
      window.location.href = 'consulta.html' + currentQuery;
    });
  }
});
