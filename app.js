(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  if (!window.MuleCrypto) {
    const b = $('fatalBanner');
    b.style.display = 'block';
    b.innerHTML = '<strong>Falha ao carregar o motor de criptografia.</strong> O arquivo pode estar corrompido — baixe-o novamente.';
    document.querySelectorAll('button.btn').forEach((btn) => (btn.disabled = true));
    return;
  }

  const ALGO_INFO = {
    AES: { hint: 'mínimo 16 bytes; exatamente 32 bytes usa AES-256 (senão AES-128 com os 16 primeiros bytes)' },
    Blowfish: { hint: 'mínimo 16 bytes (chave efetiva de até 56 bytes)' },
    DES: { hint: 'mínimo 16 bytes informados; usa apenas os 8 primeiros (DES = chave de 64 bits)' },
    DESede: { hint: 'mínimo 24 bytes (Triple DES = chave de 192 bits)' },
    RC2: { hint: 'mínimo 16 bytes (RC2 = chave de 128 bits)' },
  };

  /** Erros viram toast. Sucesso não mostra mensagem: o resultado aparece na própria tela. */
  function fail(e) {
    if (e && e.name === 'InvalidCharacterError') {
      Toast.error('O texto não é um Base64 válido. Confira se copiou o valor completo.', 'Valor inválido');
    } else if (e && /^Falha ao processar/.test(e.message)) {
      Toast.error('Confira se a chave, o algoritmo, o mode e o IV aleatório são os mesmos usados na criptografia.', 'Não foi possível descriptografar');
    } else {
      Toast.error((e && e.message) || String(e));
    }
  }
  function report(tool, ok) {
    document.dispatchEvent(new CustomEvent('tool:result', { detail: { tool, ok } }));
  }

  function populateAlgoModeSelects(algoSel, modeSel) {
    MuleCrypto.ALGORITHMS.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a === 'DESede' ? 'DESede (3DES)' : a;
      algoSel.appendChild(opt);
    });
    MuleCrypto.MODES.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modeSel.appendChild(opt);
    });
  }

  /** Atualiza a dica da chave e desabilita "random IV" em ECB (que não usa IV). */
  function wireAlgoGroup({ algoSel, modeSel, randomIvChk, hintEl }) {
    function refresh() {
      if (hintEl) hintEl.textContent = ALGO_INFO[algoSel.value].hint;
      const isEcb = modeSel.value === 'ECB';
      randomIvChk.disabled = isEcb;
      if (isEcb) randomIvChk.checked = false;
    }
    algoSel.addEventListener('change', refresh);
    modeSel.addEventListener('change', refresh);
    refresh();
  }

  document.querySelectorAll('.tab').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      $(btn.dataset.panel).classList.add('active');
    })
  );

  // ---- String ----
  populateAlgoModeSelects($('algo'), $('mode'));
  wireAlgoGroup({ algoSel: $('algo'), modeSel: $('mode'), randomIvChk: $('randomIv'), hintEl: $('keyHint') });

  $('runString').addEventListener('click', async () => {
    try {
      const algo = $('algo').value, mode = $('mode').value, key = $('key').value, useRandom = $('randomIv').checked;
      const out = $('op').value === 'encrypt'
        ? await MuleCrypto.encryptText(algo, mode, key, $('value').value, useRandom)
        : await MuleCrypto.decryptText(algo, mode, key, $('value').value, useRandom);
      $('stringResult').textContent = out;
      report('string', true);
    } catch (e) {
      $('stringResult').textContent = '';
      fail(e);
      report('string', false);
    }
  });

  $('copyResult').addEventListener('click', async () => {
    const text = $('stringResult').textContent;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      document.dispatchEvent(new CustomEvent('result:copied'));
    } catch {
      Toast.error('O navegador bloqueou o acesso à área de transferência. Selecione o texto e copie manualmente.', 'Não foi possível copiar');
    }
  });

  // ---- YAML ----
  populateAlgoModeSelects($('yamlAlgo'), $('yamlMode'));
  wireAlgoGroup({ algoSel: $('yamlAlgo'), modeSel: $('yamlMode'), randomIvChk: $('yamlRandomIv'), hintEl: $('yamlKeyHint') });

  $('yamlFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) $('yamlText').value = await f.text();
  });

  function splitComment(s) {
    let quote = null, esc = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && quote === '"') { esc = true; continue; }
      if ((c === '"' || c === "'") && !quote) quote = c;
      else if (c === quote) quote = null;
      else if (c === '#' && !quote) return [s.slice(0, i), s.slice(i)];
    }
    return [s, ''];
  }
  function findYamlColon(line) {
    let quote = null, esc = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (esc) { esc = false; continue; }
      if (c === '\\' && quote === '"') { esc = true; continue; }
      if ((c === '"' || c === "'") && !quote) quote = c;
      else if (c === quote) quote = null;
      else if (c === ':' && !quote) return i;
    }
    return -1;
  }
  function unquote(v) {
    v = v.trim();
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) return v.slice(1, -1);
    return v;
  }
  async function processYaml(text, operation, algo, mode, key, useRandom) {
    const lines = text.replace(/\r\n/g, '\n').split('\n'), out = [];
    for (const original of lines) {
      if (!original.trim() || original.trimStart().startsWith('#') || original.trimStart().startsWith('- ')) {
        out.push(original);
        continue;
      }
      const idx = findYamlColon(original);
      if (idx < 0) { out.push(original); continue; }
      const left = original.slice(0, idx + 1), rest = original.slice(idx + 1);
      const [valuePart, comment] = splitComment(rest);
      const lead = (valuePart.match(/^\s*/) || [''])[0], trail = (valuePart.match(/\s*$/) || [''])[0], raw = valuePart.trim();
      if (!raw) { out.push(original); continue; }
      try {
        if (operation === 'encrypt') {
          if (/^!\[.*\]$/.test(raw)) { out.push(original); continue; }
          const enc = await MuleCrypto.encryptText(algo, mode, key, unquote(raw), useRandom);
          out.push(left + lead + enc + trail + comment);
        } else {
          const m = raw.match(/^!?\[([^\]]+)\]$/);
          if (!m) { out.push(original); continue; }
          const dec = await MuleCrypto.decryptText(algo, mode, key, m[1], useRandom);
          out.push(left + lead + JSON.stringify(dec) + trail + comment);
        }
      } catch (e) {
        const msg = e && e.name === 'InvalidCharacterError' ? 'o valor não está em Base64 válido' : e.message;
        throw new Error(`Erro na linha ${out.length + 1}: ${msg}`);
      }
    }
    return out.join('\n');
  }
  $('runYaml').addEventListener('click', async () => {
    try {
      const algo = $('yamlAlgo').value, mode = $('yamlMode').value;
      $('yamlText').value = await processYaml($('yamlText').value, $('yamlOp').value, algo, mode, $('yamlKey').value, $('yamlRandomIv').checked);
      report('yaml', true);
    } catch (e) {
      fail(e);
      report('yaml', false);
    }
  });
  $('downloadYaml').addEventListener('click', () =>
    downloadBlob(
      new Blob([$('yamlText').value], { type: 'text/yaml;charset=utf-8' }),
      $('yamlFile').files[0]?.name?.replace(/(\.ya?ml)$/i, '-secure$1') || 'secure-properties.yaml'
    )
  );

  // ---- Arquivo inteiro ----
  populateAlgoModeSelects($('fileAlgo'), $('fileMode'));
  wireAlgoGroup({ algoSel: $('fileAlgo'), modeSel: $('fileMode'), randomIvChk: $('fileRandomIv'), hintEl: $('fileKeyHint') });

  let fileBlob = null, fileName = '';
  $('runFile').addEventListener('click', async () => {
    const f = $('wholeFile').files[0];
    if (!f) {
      Toast.warning('Escolha um arquivo para continuar.', 'Nenhum arquivo selecionado');
      report('file', false);
      return;
    }
    try {
      const algo = $('fileAlgo').value, mode = $('fileMode').value, key = $('fileKey').value, useRandom = $('fileRandomIv').checked;
      if ($('fileOp').value === 'encrypt') {
        const data = new Uint8Array(await f.arrayBuffer());
        const b64 = MuleCrypto.bytesToBase64(MuleCrypto.encryptBytes(algo, mode, key, data, useRandom));
        fileBlob = new Blob([b64], { type: 'text/plain;charset=utf-8' });
        fileName = f.name + '.encrypted';
        $('fileResult').textContent = b64.slice(0, 800) + (b64.length > 800 ? '…' : '');
      } else {
        const txt = (await f.text()).trim();
        const dec = MuleCrypto.decryptBytes(algo, mode, key, MuleCrypto.base64ToBytes(txt), useRandom);
        fileBlob = new Blob([dec], { type: 'application/octet-stream' });
        fileName = f.name.replace(/\.encrypted$/, '') || 'decrypted.bin';
        $('fileResult').textContent = `${dec.length} bytes descriptografados.`;
      }
      $('downloadFile').disabled = false;
      report('file', true);
    } catch (e) {
      fileBlob = null;
      $('downloadFile').disabled = true;
      $('fileResult').textContent = '';
      fail(e);
      report('file', false);
    }
  });
  $('downloadFile').addEventListener('click', () => {
    if (fileBlob) downloadBlob(fileBlob, fileName);
  });

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
})();
