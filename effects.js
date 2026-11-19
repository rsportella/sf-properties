(() => {
  'use strict';

  // destaca o resultado sempre que ele muda
  document.querySelectorAll('.output').forEach((el) => {
    new MutationObserver(() => {
      if (!el.textContent) return;
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  // feedback visual ao copiar (evento disparado pelo app.js quando a copia funciona)
  const copyBtn = document.getElementById('copyResult');
  if (copyBtn) {
    let timer;
    document.addEventListener('result:copied', () => {
      copyBtn.classList.add('done');
      copyBtn.title = 'Copiado!';
      copyBtn.setAttribute('aria-label', 'Copiado');
      clearTimeout(timer);
      timer = setTimeout(() => {
        copyBtn.classList.remove('done');
        copyBtn.title = 'Copiar resultado';
        copyBtn.setAttribute('aria-label', 'Copiar resultado');
      }, 1600);
    });
  }

  // mostrar/ocultar a chave
  document.querySelectorAll('.pw-toggle').forEach((btn) => {
    const input = btn.parentElement.querySelector('input');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      const label = show ? 'Ocultar chave' : 'Mostrar chave';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      input.focus();
    });
  });
})();
