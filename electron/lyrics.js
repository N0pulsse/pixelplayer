'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { artistKey, cleanTitle, splitArtistCredit } = require('./identity');

/** Разбор LRC: [mm:ss.xx]текст, несколько меток на строку, [offset:±мс], «улучшенный» LRC с <mm:ss.xx>. */
function parseLrc(text) {
  const synced = [];
  const plainLines = [];
  let offset = 0;
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const tagRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lines) {
    const off = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (off) { offset = parseInt(off[1], 10) || 0; continue; }
    if (/^\s*\[(ar|ti|al|by|au|length|re|ve|la|id|#)\s*:/i.test(raw)) continue;
    const times = [];
    let m;
    tagRe.lastIndex = 0;
    let lastEnd = 0;
    while ((m = tagRe.exec(raw))) {
      const frac = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
      times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
      lastEnd = tagRe.lastIndex;
    }
    const body = raw.slice(lastEnd).replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
    if (times.length) {
      for (const t of times) synced.push({ t, text: body });
    } else if (raw.trim()) {
      plainLines.push(raw.trim());
    }
  }
  synced.forEach((line) => { line.t = Math.max(0, line.t + offset / 1000); });
  synced.sort((a, b) => a.t - b.t);
  const plain = synced.length ? synced.map((l) => l.text).join('\n') : plainLines.join('\n');
  return { synced: synced.length ? synced : null, plain: plain || null };
}

function decodeText(buf) {
  let s = buf.toString('utf8');
  if (s.includes('�')) {
    try { s = new TextDecoder('windows-1251').decode(buf); } catch { /* */ }
  }
  return s;
}

async function readSidecar(trackPath) {
  const base = trackPath.slice(0, trackPath.length - path.extname(trackPath).length);
  for (const ext of ['.lrc', '.LRC', '.txt']) {
    try {
      const buf = await fsp.readFile(base + ext);
      if (buf.length && buf.length < 2 * 1024 * 1024) return decodeText(buf);
    } catch { /* нет такого файла */ }
  }
  return null;
}

/**
 * Тексты песен: .lrc рядом с файлом → встроенные в тег → кэш → LRCLIB (если разрешено).
 * @param {object} track
 * @param {object} deps { cacheDir, online, readEmbedded(path), fetch }
 */
async function getLyrics(track, deps) {
  const { cacheDir, online = true, readEmbedded, fetch: doFetch } = deps;
  let best = null;

  const consider = (text, source) => {
    if (!text) return;
    const p = parseLrc(text);
    if (!p.synced && !p.plain) return;
    const cand = { synced: p.synced, plain: p.plain, source, instrumental: false };
    if (!best || (!best.synced && cand.synced)) best = cand;
  };

  consider(await readSidecar(track.path), 'lrc');
  if (!best || !best.synced) {
    if (readEmbedded) {
      try { consider(await readEmbedded(track.path), 'embedded'); } catch { /* */ }
    }
  }
  if (best && best.synced) return best;

  // Кэш онлайн-запросов
  const cacheFile = cacheDir ? path.join(cacheDir, `${track.id}.json`) : null;
  if (cacheFile && !deps.force) {
    try {
      const c = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
      const fingerprint = `${track.title}|${track.artist}|${Math.round(track.duration || 0)}`;
      const fresh = (!c.fingerprint || c.fingerprint === fingerprint) && Date.now() - (c.fetchedAt || 0) < (c.synced ? 90 : c.plain ? 1 : 0.25) * 86400000;
      if (fresh) {
        if (c.synced) return { synced: c.synced, plain: c.plain, source: 'lrclib', instrumental: !!c.instrumental };
        if (c.instrumental) return { synced: null, plain: null, source: 'lrclib', instrumental: true };
        if (!best && c.plain) return { synced: null, plain: c.plain, source: 'lrclib', instrumental: false };
        if (!c.synced && !online) return best;
        if (c.negative) return best;
      }
    } catch { /* нет кэша */ }
  }

  if (!online || !doFetch || !track.title) return best;

  const online1 = await fetchLrclib(track, doFetch).catch(() => undefined);
  if (online1 === undefined) return best; // сеть недоступна — не кэшируем неудачу
  if (cacheFile) {
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify({
        fetchedAt: Date.now(),
        fingerprint: `${track.title}|${track.artist}|${Math.round(track.duration || 0)}`,
        synced: online1 && online1.synced, plain: online1 && online1.plain,
        instrumental: !!(online1 && online1.instrumental), negative: !online1,
      }));
    } catch { /* */ }
  }
  if (!online1) return best;
  if (online1.instrumental && !best) return { synced: null, plain: null, source: 'lrclib', instrumental: true };
  if (online1.synced) return { synced: online1.synced, plain: online1.plain, source: 'lrclib', instrumental: false };
  if (!best && online1.plain) return { synced: null, plain: online1.plain, source: 'lrclib', instrumental: false };
  return best;
}

/** @returns {Promise<null|{synced,plain,instrumental}>} null — не нашли; бросает ошибку — нет сети */
async function fetchLrclib(track, doFetch) {
  const base = 'https://lrclib.net/api';
  const headers = { 'User-Agent': 'PixelPlayerDesktop/1.2 (https://github.com/N0pulsse/pixelplayer)' };
  const artist = splitArtistCredit(track.artists?.length ? track.artists : track.artist)[0] || '';
  const title = cleanTitle(track.title);
  const q = new URLSearchParams({ track_name: title, artist_name: artist });
  if (track.album) q.set('album_name', track.album);
  if (track.duration) q.set('duration', String(Math.round(track.duration)));

  let best = null;
  const get = await doFetch(`${base}/get?${q}`, { headers });
  if (get.ok) {
    const j = await get.json();
    const r = shape(j);
    if (r?.synced || r?.instrumental) return r;
    best = r;
  } else if (get.status !== 404) {
    throw new Error(`LRCLIB ${get.status}`);
  }

  const s = new URLSearchParams({ track_name: title });
  if (artist) s.set('artist_name', artist);
  let res;
  try { res = await doFetch(`${base}/search?${s}`, { headers }); } catch (error) { if (best) return best; throw error; }
  if (!res.ok) { if (res.status === 404 || best) return best; throw new Error(`LRCLIB ${res.status}`); }
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return best;
  const dur = track.duration || 0;
  const scored = list
    .map((x) => ({ x, d: dur && x.duration ? Math.abs(x.duration - dur) : 5 }))
    .filter((e) => e.d <= 6 && (!e.x.trackName || artistKey(cleanTitle(e.x.trackName)) === artistKey(title)) && (!artist || !e.x.artistName || splitArtistCredit(e.x.artistName).some((a) => artistKey(a) === artistKey(artist))))
    .sort((a, b) => (Number(!!b.x.syncedLyrics) - Number(!!a.x.syncedLyrics)) || a.d - b.d);
  return scored.length ? (shape(scored[0].x) || best) : best;
}

function shape(j) {
  if (!j) return null;
  if (j.instrumental) return { synced: null, plain: null, instrumental: true };
  const synced = j.syncedLyrics ? parseLrc(j.syncedLyrics).synced : null;
  const plain = j.plainLyrics || (synced ? synced.map((l) => l.text).join('\n') : null);
  if (!synced && !plain) return null;
  return { synced, plain, instrumental: false };
}

module.exports = { parseLrc, getLyrics, readSidecar, fetchLrclib };
