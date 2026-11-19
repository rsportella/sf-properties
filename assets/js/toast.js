(() => {
  'use strict';

  const ICONS = {
    error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5v7.5M12 17.6v.2"/></svg>',
  };
  const DEFAULT_TITLE = { error: 'Não foi possível concluir', warning: 'Atenção' };
  const MAX_VISIBLE = 3;

  let host;
  function getHost() {
    if (host) return host;
    host = document.createElement('div');
    host.id = 'toasts';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'Notificações');
    document.body.appendChild(host);
    return host;
  }

  function dismiss(el) {
    if (!el.isConnected || el.classList.contains('out')) return;
    el.classList.add('out');
    clearTimeout(el._timer);
    const remove = () => el.remove();
    el.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 450);
  }

  function show({ type = 'error', title, message, duration = 6000 }) {
    const container = getHost();

    // mesma mensagem ainda na tela: reinicia o tempo em vez de empilhar
    const same = [...container.children].find((t) => t._key === type + title + message && !t.classList.contains('out'));
    if (same) {
      same.classList.remove('bump');
      void same.offsetWidth;
      same.classList.add('bump');
      armTimer(same, duration);
      return same;
    }

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el._key = type + title + message;
    el.innerHTML =
      `<span class="toast-icon">${ICONS[type] || ICONS.error}</span>` +
      '<div class="toast-body"><strong></strong><span></span></div>' +
      '<button type="button" class="toast-close" aria-label="Fechar notificação">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button>';
    el.querySelector('strong').textContent = title;
    el.querySelector('.toast-body span').textContent = message;
    el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));
    el.addEventListener('mouseenter', () => clearTimeout(el._timer));
    el.addEventListener('mouseleave', () => armTimer(el, 2500));

    container.appendChild(el);
    [...container.children].filter((t) => !t.classList.contains('out')).slice(0, -MAX_VISIBLE).forEach(dismiss);
    armTimer(el, duration);
    return el;
  }

  function armTimer(el, ms) {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => dismiss(el), ms);
  }

  // "Chave inválida: mínimo 16 bytes..." vira título "Chave inválida" + detalhe
  function split(message, type) {
    const m = /^([^:.]{3,40}):\s+(.+)$/s.exec(message);
    if (m) return { title: m[1], message: m[2].charAt(0).toUpperCase() + m[2].slice(1) };
    return { title: DEFAULT_TITLE[type], message };
  }

  function make(type) {
    return (message, title) => {
      const parts = title ? { title, message } : split(String(message), type);
      return show({ type, ...parts });
    };
  }

  window.Toast = { show, error: make('error'), warning: make('warning') };
})();
