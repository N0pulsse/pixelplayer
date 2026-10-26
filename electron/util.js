'use strict';
const crypto = require('node:crypto');
const path = require('node:path');

/** Форматы, которые умеет проигрывать встроенный Chromium (Electron). */
const AUDIO_EXTS = new Set([
  '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.weba',
]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** Имена файлов-обложек, которые лежат рядом с музыкой. */
const FOLDER_COVER_RE = /^(cover|folder|front|album|albumart(small|large)?|artwork|thumb|обложка)\.(jpe?g|png|webp)$/i;

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.weba': 'audio/webm',
};

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** Стабильный идентификатор трека по пути (на Windows регистр не важен). */
function idForPath(p) {
  const norm = path.normalize(p);
  const key = process.platform === 'win32' ? norm.toLowerCase() : norm;
  return sha1(key).slice(0, 14);
}

function isAudioFile(file) {
  return AUDIO_EXTS.has(path.extname(file).toLowerCase());
}

/** Определяем тип картинки по первым байтам. */
function sniffImageMime(buf) {
  if (!buf || buf.length < 4) return 'application/octet-stream';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Русские теги в кодировке windows-1251, прочитанные как latin1, превращаются в «Êèíî».
 * Если строка выглядит именно так — переводим обратно.
 */
function fixMojibake(str) {
  if (typeof str !== 'string' || str.length < 2) return str;
  // Подозрительны только слова, где ≥60% символов лежат в диапазоне 0x80–0xFF и нет «нормальной» латиницы.
  const high = (str.match(/[À-ÿ]/g) || []).length;
  if (high < 2) return str;
  if (/[^\u0000-ÿ]/.test(str)) return str; // уже есть юникод вне latin1 — это нормальный текст
  const words = str.split(/[\s\-–—_.,/()\[\]]+/).filter(Boolean);
  const suspicious = words.filter((w) => {
    const h = (w.match(/[\u0080-ÿ]/g) || []).length;
    return w.length >= 2 && h / w.length >= 0.6;
  });
  if (!suspicious.length) return str;
  try {
    const bytes = Buffer.from(str, 'latin1');
    const fixed = new TextDecoder('windows-1251').decode(bytes);
    const letters = (fixed.match(/[Ѐ-ӿ]/g) || []).length;
    if (letters >= Math.max(2, Math.floor(str.replace(/\s/g, '').length * 0.4))) return fixed;
  } catch { /* ignore */ }
  return str;
}

/** «01 - Artist - Title.mp3» → { artist, title, track } */
function parseFilename(file) {
  let base = path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
  let track = null;
  const m = /^(\d{1,3})[\s.\-)]+(.+)$/.exec(base);
  if (m && m[2]) { track = Number(m[1]); base = m[2].trim(); }
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim(), track };
  }
  return { artist: null, title: base, track };
}

/** Делим строку исполнителей: «A; B», «A feat. B», «A / B». «AC/DC» не трогаем. */
function splitArtists(str, extra = []) {
  if (!str) return [];
  const seps = [';', ' / ', ' feat. ', ' feat ', ' ft. ', ' ft ', ' featuring ', ' & ', ...extra];
  // «&» делим только если явно включено пользователем — по умолчанию не делим (Simon & Garfunkel)
  const active = seps.filter((s) => s !== ' & ' || extra.includes(' & '));
  let parts = [str];
  for (const s of active) {
    parts = parts.flatMap((p) => p.split(new RegExp(s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'), 'i')));
  }
  const out = [];
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) if (!out.includes(p)) out.push(p);
  return out;
}

function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((res) => { t = setTimeout(() => res(fallback), ms); }),
  ]);
}

module.exports = {
  AUDIO_EXTS, IMAGE_EXTS, FOLDER_COVER_RE, AUDIO_MIME,
  sha1, idForPath, isAudioFile, sniffImageMime,
  fixMojibake, parseFilename, splitArtists, withTimeout,
};
