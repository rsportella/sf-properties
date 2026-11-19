(() => {
  'use strict';
  document.querySelectorAll('pre.code').forEach((pre) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-code';
    btn.textContent = 'Copiar';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code').textContent);
        btn.textContent = 'Copiado!';
        setTimeout(() => (btn.textContent = 'Copiar'), 1500);
      } catch { btn.textContent = 'Selecione e copie'; }
    });
    pre.appendChild(btn);
  });
})();
