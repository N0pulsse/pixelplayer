'use strict';
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { isAudioFile } = require('./util');

function decodePlaylist(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  let text = buf.toString('utf8');
  if (text.includes('\ufffd')) text = new TextDecoder('windows-1251').decode(buf);
  return text.replace(/^\uFEFF/, '');
}

/** Local files only: a playlist never starts remote streams or opens unrelated file types. */
function parseM3u(text, playlistPath) {
  const paths = [];
  let skipped = 0;
  for (let line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('"') && line.endsWith('"')) line = line.slice(1, -1);
    if (/^file:/i.test(line)) {
      try { line = fileURLToPath(line); } catch { skipped++; continue; }
    } else if (/^[a-z][a-z\d+.-]*:/i.test(line) && !/^[a-z]:[\\/]/i.test(line)) {
      skipped++; continue;
    }
    if (!isAudioFile(line) || line.includes('\0')) { skipped++; continue; }
    const file = path.isAbsolute(line) ? path.normalize(line) : path.resolve(path.dirname(playlistPath), line);
    // Repeated entries are intentional in M3U and preserve the author's order.
    paths.push(file);
  }
  return { paths, skipped };
}

function serializeM3u(tracks, targetPath) {
  const lines = ['#EXTM3U'];
  const clean = (s) => String(s || '').replace(/[\r\n\0]/g, ' ').trim();
  for (const track of tracks) {
    if (!track || typeof track.path !== 'string' || !isAudioFile(track.path)) continue;
    const title = [clean(track.artist), clean(track.title)].filter(Boolean).join(' - ');
    const duration = Number.isFinite(track.duration) && track.duration > 0 ? Math.round(track.duration) : -1;
    lines.push(`#EXTINF:${duration},${title}`);
    const rel = path.relative(path.dirname(targetPath), track.path);
    // Across volumes path.relative returns an absolute Windows path.
    const location = (rel || path.basename(track.path)).replace(/\\/g, '/');
    lines.push(location.startsWith('#') ? './' + location : location);
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = { decodePlaylist, parseM3u, serializeM3u };
