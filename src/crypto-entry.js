import forge from 'node-forge/lib/forge.js';
import 'node-forge/lib/util.js';
import 'node-forge/lib/cipher.js';
import 'node-forge/lib/cipherModes.js';
import 'node-forge/lib/aes.js';
import 'node-forge/lib/des.js';
import 'node-forge/lib/rc2.js';
import { Blowfish } from 'egoroof-blowfish';

const te = new TextEncoder();

function toForgeBuffer(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return forge.util.createBuffer(s, 'raw');
}
function fromForgeBuffer(buf) {
  const s = buf.getBytes();
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function rc2RawEncryptBlock(keyBytes, block8) {
  const cipher = forge.rc2.createEncryptionCipher(toForgeBuffer(keyBytes), 128);
  cipher.start(null, null);
  cipher.update(toForgeBuffer(block8));
  cipher.finish(() => true);
  return fromForgeBuffer(cipher.output);
}

function bfRawEncryptBlock(bfInstance, block8) {
  const l = ((block8[0] << 24) | (block8[1] << 16) | (block8[2] << 8) | block8[3]) >>> 0;
  const r = ((block8[4] << 24) | (block8[5] << 16) | (block8[6] << 8) | block8[7]) >>> 0;
  const [el, er] = bfInstance._encryptBlock(l, r);
  return new Uint8Array([
    (el >>> 24) & 255, (el >>> 16) & 255, (el >>> 8) & 255, el & 255,
    (er >>> 24) & 255, (er >>> 16) & 255, (er >>> 8) & 255, er & 255,
  ]);
}

/** Generic CFB/OFB construction from a raw block-encrypt primitive (used for RC2 and Blowfish, which lack native CFB/OFB support). */
function streamModeTransform(mode, data, iv, blockSize, encrypt, encryptBlock) {
  const out = new Uint8Array(data.length);
  let feedback = iv.slice(0, blockSize);
  for (let off = 0; off < data.length; off += blockSize) {
    const chunkLen = Math.min(blockSize, data.length - off);
    const keystream = encryptBlock(feedback);
    for (let i = 0; i < chunkLen; i++) out[off + i] = data[off + i] ^ keystream[i];
    if (mode === 'OFB') {
      feedback = keystream;
    } else {
      const cipherBlock = encrypt ? out.subarray(off, off + chunkLen) : data.subarray(off, off + chunkLen);
      if (chunkLen === blockSize) {
        feedback = cipherBlock;
      }
      // a partial final block never has a following iteration, so the feedback value is unused after this
    }
  }
  return out;
}

function forgeStandardCipher(algoName, keyBytes, ivBytes, data, encrypt) {
  const key = toForgeBuffer(keyBytes);
  const c = encrypt ? forge.cipher.createCipher(algoName, key) : forge.cipher.createDecipher(algoName, key);
  c.start(ivBytes ? { iv: toForgeBuffer(ivBytes) } : {});
  c.update(toForgeBuffer(data));
  if (!c.finish()) throw new Error(`Falha ao processar ${algoName} (dado corrompido ou chave/IV incorretos).`);
  return fromForgeBuffer(c.output);
}

function rc2CipherBlockMode(mode, keyBytes, ivBytes, data, encrypt) {
  const cipher = encrypt
    ? forge.rc2.createEncryptionCipher(toForgeBuffer(keyBytes), 128)
    : forge.rc2.createDecryptionCipher(toForgeBuffer(keyBytes), 128);
  cipher.start(mode === 'ECB' ? null : toForgeBuffer(ivBytes), null);
  cipher.update(toForgeBuffer(data));
  if (!cipher.finish()) throw new Error('Falha ao processar RC2 (dado corrompido ou chave/IV incorretos).');
  return fromForgeBuffer(cipher.output);
}

function blowfishBlockMode(mode, keyBytes, ivBytes, data, encrypt) {
  const bfMode = mode === 'ECB' ? Blowfish.MODE.ECB : Blowfish.MODE.CBC;
  const bf = new Blowfish(keyBytes, bfMode, Blowfish.PADDING.PKCS5);
  if (mode === 'CBC') bf.setIv(ivBytes);
  const result = encrypt
    ? bf.encode(data)
    : bf.decode(data, Blowfish.TYPE.UINT8_ARRAY);
  return new Uint8Array(result);
}

/**
 * Runs the raw block cipher transform for one algorithm/mode/direction combination.
 * `data` already excludes any prepended random IV; `ivBytes` is null for ECB.
 */
function transform(algorithm, mode, keyBytes, ivBytes, data, encrypt) {
  if (algorithm === 'AES' || algorithm === 'DES' || algorithm === 'DESede') {
    const prefix = algorithm === 'AES' ? 'AES' : algorithm === 'DES' ? 'DES' : '3DES';
    return forgeStandardCipher(`${prefix}-${mode}`, keyBytes, mode === 'ECB' ? null : ivBytes, data, encrypt);
  }
  if (algorithm === 'RC2') {
    if (mode === 'ECB' || mode === 'CBC') return rc2CipherBlockMode(mode, keyBytes, ivBytes, data, encrypt);
    return streamModeTransform(mode, data, ivBytes, 8, encrypt, (block) => rc2RawEncryptBlock(keyBytes, block));
  }
  if (algorithm === 'Blowfish') {
    if (mode === 'ECB' || mode === 'CBC') return blowfishBlockMode(mode, keyBytes, ivBytes, data, encrypt);
    const bf = new Blowfish(keyBytes, Blowfish.MODE.ECB, Blowfish.PADDING.PKCS5);
    return streamModeTransform(mode, data, ivBytes, 8, encrypt, (block) => bfRawEncryptBlock(bf, block));
  }
  throw new Error(`Algoritmo não suportado: ${algorithm}`);
}

const BLOCK_SIZE = { AES: 16, DES: 8, DESede: 8, RC2: 8, Blowfish: 8 };
const MIN_KEY_LENGTH = 16;

/** Mirrors the MuleSoft Secure Properties Tool's key-sizing rules for each algorithm. */
function resolveKeyBytes(algorithm, rawKeyBytes) {
  const len = rawKeyBytes.length;
  switch (algorithm) {
    case 'AES': {
      const bits = len >= 32 ? 256 : len >= 24 ? 192 : 128;
      return rawKeyBytes.slice(0, bits / 8);
    }
    case 'Blowfish':
      return rawKeyBytes.slice(0, Math.min(len, 56));
    case 'DES':
      if (len < 8) throw new Error('DES requer uma chave de ao menos 8 bytes.');
      return rawKeyBytes.slice(0, 8);
    case 'DESede':
      if (len < 24) throw new Error('DESede (Triple DES) requer uma chave de ao menos 24 bytes.');
      return rawKeyBytes.slice(0, 24);
    case 'RC2':
      if (len < 16) throw new Error('RC2 requer uma chave de ao menos 16 bytes.');
      return rawKeyBytes.slice(0, 16);
    default:
      throw new Error(`Algoritmo não suportado: ${algorithm}`);
  }
}

function usesIv(algorithm, mode) {
  return mode !== 'ECB';
}

function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function base64ToBytes(str) {
  const bin = atob(str.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encrypts raw bytes. Returns raw output bytes: [iv?][ciphertext] when useRandomIv,
 * otherwise just [ciphertext] (IV is then derivable from the key on decrypt).
 */
function encryptBytes(algorithm, mode, keyText, dataBytes, useRandomIv) {
  const rawKeyBytes = te.encode(keyText);
  if (rawKeyBytes.length < MIN_KEY_LENGTH) {
    throw new Error(`Chave inválida: mínimo ${MIN_KEY_LENGTH} bytes UTF-8 (informados ${rawKeyBytes.length}).`);
  }
  const keyBytes = resolveKeyBytes(algorithm, rawKeyBytes);
  const blockSize = BLOCK_SIZE[algorithm];
  let ivBytes = null;
  if (usesIv(algorithm, mode)) {
    ivBytes = useRandomIv ? crypto.getRandomValues(new Uint8Array(blockSize)) : rawKeyBytes.slice(0, blockSize);
  }
  const cipherBytes = transform(algorithm, mode, keyBytes, ivBytes, dataBytes, true);
  if (useRandomIv && ivBytes) {
    const out = new Uint8Array(ivBytes.length + cipherBytes.length);
    out.set(ivBytes);
    out.set(cipherBytes, ivBytes.length);
    return out;
  }
  return cipherBytes;
}

function decryptBytes(algorithm, mode, keyText, dataBytes, useRandomIv) {
  const rawKeyBytes = te.encode(keyText);
  if (rawKeyBytes.length < MIN_KEY_LENGTH) {
    throw new Error(`Chave inválida: mínimo ${MIN_KEY_LENGTH} bytes UTF-8 (informados ${rawKeyBytes.length}).`);
  }
  const keyBytes = resolveKeyBytes(algorithm, rawKeyBytes);
  const blockSize = BLOCK_SIZE[algorithm];
  let ivBytes = null;
  let cipherBytes = dataBytes;
  if (usesIv(algorithm, mode)) {
    if (useRandomIv) {
      if (dataBytes.length <= blockSize) throw new Error(`Conteúdo curto demais para conter um IV de ${blockSize} bytes.`);
      ivBytes = dataBytes.slice(0, blockSize);
      cipherBytes = dataBytes.slice(blockSize);
    } else {
      ivBytes = rawKeyBytes.slice(0, blockSize);
    }
  }
  return transform(algorithm, mode, keyBytes, ivBytes, cipherBytes, false);
}

async function encryptText(algorithm, mode, keyText, plaintext, useRandomIv) {
  const out = encryptBytes(algorithm, mode, keyText, te.encode(plaintext), useRandomIv);
  return `![${bytesToBase64(out)}]`;
}

async function decryptText(algorithm, mode, keyText, wrapped, useRandomIv) {
  const b64 = wrapped.trim().replace(/^!\[/, '').replace(/\]$/, '');
  const out = decryptBytes(algorithm, mode, keyText, base64ToBytes(b64), useRandomIv);
  return new TextDecoder().decode(out);
}

window.MuleCrypto = {
  ALGORITHMS: ['AES', 'Blowfish', 'DES', 'DESede', 'RC2'],
  MODES: ['CBC', 'CFB', 'ECB', 'OFB'],
  usesIv,
  encryptBytes,
  decryptBytes,
  encryptText,
  decryptText,
  bytesToBase64,
  base64ToBytes,
};
