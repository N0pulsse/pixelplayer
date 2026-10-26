'use strict';
const { fixMojibake, splitArtists } = require('./util');

/**
 * Адаптер к библиотеке music-metadata (ESM-пакет, поэтому подгружаем через import()).
 * Если пакет не установился или файл битый — возвращаем null, а библиотека подставит данные из имени файла.
 */
let mmPromise = null;
function loadMM() {
  if (!mmPromise) {
    mmPromise = import('music-metadata').catch((e) => {
      console.error('[meta] music-metadata недоступен:', e.message);
      return null;
    });
  }
  return mmPromise;
}

function lyricsToText(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  if (Array.isArray(entry.syncText) && entry.syncText.length) {
    // Синхронизированные тексты (SYLT) → формат LRC
    const fmt = (ms) => {
      const t = Math.max(0, ms) / 1000;
      const m = Math.floor(t / 60);
      const s = (t - m * 60).toFixed(2).padStart(5, '0');
      return `[${String(m).padStart(2, '0')}:${s}]`;
    };
    // music-metadata отдаёт метки времени в миллисекундах
    return entry.syncText.map((l) => `${fmt(l.timestamp ?? 0)}${l.text ?? ''}`).join('\n');
  }
  return entry.text || null;
}

/**
 * @returns {Promise<null | {title, artist, artists, albumArtist, album, year, genre, track, disc,
 *   duration, bitrate, sampleRate, lossless, codec, picture, lyrics}>}
 */
async function readTags(file, { covers = true } = {}) {
  const mm = await loadMM();
  if (!mm) return null;
  try {
    const meta = await mm.parseFile(file, { duration: true, skipCovers: !covers });
    const c = meta.common || {};
    const f = meta.format || {};
    let picture = null;
    if (covers && Array.isArray(c.picture) && c.picture.length) {
      const sel = typeof mm.selectCover === 'function' ? mm.selectCover(c.picture) : c.picture[0];
      if (sel && sel.data && sel.data.length) picture = { data: sel.data, format: sel.format };
    }
    const lyricsRaw = Array.isArray(c.lyrics) ? c.lyrics.map(lyricsToText).filter(Boolean).join('\n') : null;
    const artistStr = fixMojibake(c.artist || (c.artists && c.artists.join('; ')) || '') || null;
    return {
      title: fixMojibake(c.title) || null,
      artist: artistStr,
      artists: c.artists && c.artists.length ? c.artists.map(fixMojibake) : splitArtists(artistStr),
      albumArtist: fixMojibake(c.albumartist) || null,
      album: fixMojibake(c.album) || null,
      year: c.year || (c.date ? parseInt(String(c.date).slice(0, 4), 10) || null : null),
      genre: c.genre && c.genre.length ? fixMojibake(c.genre[0]) : null,
      track: c.track && c.track.no ? c.track.no : null,
      disc: c.disk && c.disk.no ? c.disk.no : null,
      duration: Number.isFinite(f.duration) ? f.duration : 0,
      bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
      sampleRate: f.sampleRate || null,
      lossless: !!f.lossless,
      codec: f.codec || f.container || null,
      picture,
      lyrics: lyricsRaw,
    };
  } catch (e) {
    return null;
  }
}

module.exports = { readTags, loadMM };
