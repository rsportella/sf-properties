(() => {
  'use strict';

  // Cole aqui o ID de métricas do Google Analytics 4 (ex.: 'G-ABC123XYZ9').
  // Enquanto estiver vazio, nenhum banner é exibido e nada é coletado.
  const GA_ID = 'G-NB7LJ4N54C';

  const CONSENT_KEY = 'analytics-consent';
  const isWeb = location.protocol === 'http:' || location.protocol === 'https:';
  if (!GA_ID || !isWeb) return;

  const store = {
    get() { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(CONSENT_KEY, v); } catch { /* ignora */ } },
  };

  let loaded = false;
  function loadAnalytics() {
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    document.head.appendChild(s);
  }

  function track(name, params) {
    if (loaded && window.gtag) gtag('event', name, params);
  }

  // Eventos de uso: registram apenas as opções escolhidas. Chave, valores e arquivos nunca são lidos.
  const TOOLS = {
    string: { op: 'op', algo: 'algo', mode: 'mode', iv: 'randomIv' },
    yaml: { op: 'yamlOp', algo: 'yamlAlgo', mode: 'yamlMode', iv: 'yamlRandomIv' },
    file: { op: 'fileOp', algo: 'fileAlgo', mode: 'fileMode', iv: 'fileRandomIv' },
  };
  const $ = (id) => document.getElementById(id);

  document.addEventListener('tool:result', (e) => {
    const cfg = TOOLS[e.detail.tool];
    if (!cfg) return;
    track('tool_run', {
      tool: e.detail.tool,
      operation: $(cfg.op).value,
      algorithm: $(cfg.algo).value,
      mode: $(cfg.mode).value,
      random_iv: $(cfg.iv).checked,
      success: e.detail.ok,
    });
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'copyResult') {
      track('copy_result');
    } else if (btn.classList.contains('tab')) {
      track('tab_view', { tab: btn.dataset.panel.replace('Panel', '') });
    }
  });

  // Banner de consentimento (LGPD)
  function removeBanner() {
    const b = $('consentBanner');
    if (b) b.remove();
  }
  function decide(value) {
    store.set(value);
    removeBanner();
    if (value === 'granted') loadAnalytics();
  }
  function showBanner() {
    removeBanner();
    const b = document.createElement('div');
    b.id = 'consentBanner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Preferências de privacidade');
    b.innerHTML =
      '<p><strong>Privacidade</strong><br>Usamos o Google Analytics apenas para medir o uso da ferramenta ' +
      '(páginas e opções escolhidas). Sua chave, seus valores e seus arquivos <strong>nunca</strong> são coletados ' +
      'e continuam sendo processados só no seu navegador.</p>' +
      '<div class="consent-actions"><button type="button" class="btn secondary" data-c="denied">Recusar</button>' +
      '<button type="button" class="btn primary" data-c="granted">Aceitar</button></div>';
    b.addEventListener('click', (e) => {
      const c = e.target.dataset && e.target.dataset.c;
      if (c) decide(c);
    });
    document.body.appendChild(b);
  }

  // Link no rodapé para rever a escolha
  const legal = document.querySelector('.legal');
  if (legal) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Preferências de cookies';
    a.addEventListener('click', (e) => { e.preventDefault(); showBanner(); });
    legal.appendChild(a);
  }

  const saved = store.get();
  if (saved === 'granted') loadAnalytics();
  else if (saved !== 'denied') showBanner();
})();
