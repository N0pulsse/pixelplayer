'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { AUDIO_MIME, sniffImageMime } = require('./util');

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

/**
 * Отдаём файл с поддержкой HTTP Range — без этого перемотка в <audio> не работает.
 */
async function serveFile(file, request, contentType, extraHeaders = {}) {
  let stat;
  try { stat = await fsp.stat(file); } catch { return new Response('Not found', { status: 404 }); }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const size = stat.size;
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
    ...extraHeaders,
  };
  const method = request.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const range = request.headers.get('range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '') || [m[1], m[2]].some((value) => value !== '' && !Number.isSafeInteger(Number(value)))) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    {
      let start; let end;
      if (m[1] === '') { // последние N байт
        const n = Number(m[2]);
        start = Math.max(0, size - n); end = size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
      }
      const stream = method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file, { start, end }));
      return new Response(stream, {
        status: 206,
        headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` },
      });
    }
  }
  return new Response(method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  });
}

/**
 * Обработчик схемы pp://
 *   pp://app/<файл>      — файлы интерфейса (dist/renderer)
 *   pp://audio/<id>      — аудио трека
 *   pp://cover/<ключ>    — обложка (?t=1 — миниатюра)
 *   pp://artist/<ключ>   — фото исполнителя
 */
function createHandler({ appDir, library, covers, artistDir }) {
  const rootApp = path.resolve(appDir);
  return async function handle(request) {
    let url;
    try { url = new URL(request.url); } catch { return new Response('Bad URL', { status: 400 }); }
    let key;
    try { key = decodeURIComponent(url.pathname.replace(/^\/+/, '')); } catch { return new Response('Bad URL', { status: 400 }); }
    if (key.includes('\0')) return new Response('Bad URL', { status: 400 });
    let kind = url.hostname;

    // Все ресурсы живут на одном origin (pp://app), поэтому canvas может читать обложки без CORS:
    //   pp://app/audio/<id>, pp://app/cover/<ключ>, pp://app/artist/<ключ>
    if (kind === 'app') {
      const m = /^(audio|cover|artist)\/(.+)$/.exec(key);
      if (m) { kind = m[1]; key = m[2]; }
    }

    if (kind === 'stream') {
      if(!['player.html','player.js'].includes(key))return new Response('Not found',{status:404});
      return serveFile(path.join(rootApp,'stream',key),request,STATIC_MIME[path.extname(key)]);
    }
    if (kind === 'app') {
      const rel = key || 'index.html';
      const file = path.resolve(rootApp, rel);
      if (file !== rootApp && !file.startsWith(rootApp + path.sep)) return new Response('Forbidden', { status: 403 });
      const type = STATIC_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return serveFile(file, request, type, { 'Cache-Control': 'no-cache' });
    }

    if (kind === 'audio') {
      const file = library.pathFor(key);
      if (!file) return new Response('Not found', { status: 404 });
      const type = AUDIO_MIME[path.extname(file).toLowerCase()] || 'audio/mpeg';
      return serveFile(file, request, type);
    }

    if (kind === 'cover') {
      const file = covers.resolve(key, url.searchParams.get('t') === '1') || covers.resolve(key, false);
      if (!file) return new Response('Not found', { status: 404 });
      return serveFile(file, request, covers.mimeOf(file), { 'Cache-Control': 'max-age=86400' });
    }

    if (kind === 'artist' && artistDir) {
      if (!/^[0-9a-f]{8,40}$/.test(key)) return new Response('Not found', { status: 404 });
      const file = path.join(artistDir, `${key}.jpg`);
      return serveFile(file, request, 'image/jpeg', { 'Cache-Control': 'max-age=86400' });
    }

    return new Response('Not found', { status: 404 });
  };
}

module.exports = { createHandler, serveFile, sniffImageMime };
