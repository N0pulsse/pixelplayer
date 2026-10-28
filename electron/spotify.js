'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const API = 'https://api.spotify.com/v1';
const REDIRECT = 'http://127.0.0.1:43827/callback';
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read', 'user-read-playback-state', 'user-read-currently-playing', 'user-modify-playback-state'];
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9]{22}$/.test(value);
const clean = (value, max = 300) => String(value || '').slice(0, max);
function image(images) {
  const value = images?.find((x) => x.width >= 160 && x.width <= 640)?.url || images?.[0]?.url;
  try { const u = new URL(value); return u.protocol === 'https:' && ['i.scdn.co', 'mosaic.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com'].includes(u.hostname) ? u.href : ''; } catch { return ''; }
}
function track(t) {
  if (!t || t.type !== 'track' || !id(t.id) || t.is_local) return null;
  return { id: t.id, uri: `spotify:track:${t.id}`, title: clean(t.name), artist: (t.artists || []).map((a) => clean(a.name)).join(', '), album: clean(t.album?.name), image: image(t.album?.images), duration: Math.max(0, Number(t.duration_ms) || 0), playable: t.is_playable !== false && !t.restrictions?.reason, explicit: !!t.explicit };
}
function collection(t, type) {
  if (!t || !id(t.id)) return null;
  return { id: t.id, type, uri: `spotify:${type}:${t.id}`, name: clean(t.name), image: image(t.images), subtitle: type === 'album' ? (t.artists || []).map((a) => clean(a.name)).join(', ') : clean(t.owner?.display_name || 'Плейлист'), total: Number(t.items?.total ?? t.tracks?.total ?? t.total_tracks) || 0 };
}
function page(data, items) { const offset = Number(data.offset) || 0; const limit = Number(data.limit) || 50; return { items: items.filter(Boolean), offset, nextOffset: data.next ? offset + limit : null, total: Number(data.total) || 0 }; }

class Spotify extends EventEmitter {
  constructor({ store, dir, safeStorage, fetch, openExternal, port = 43827 }) {
    super(); Object.assign(this, { store, safeStorage, fetch, openExternal, port });
    this.file = path.join(dir, 'spotify-session.bin'); this.session = null; this.pending = null; this.refreshing = null; this.epoch = 0; this.cooldown = 0; this.error = '';
    if (fs.existsSync(this.file)) {
      try { this.session = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file))); } catch { this.error = 'Войдите в Spotify заново на этом ПК.'; }
    }
  }
  status() { return { clientId: this.store.get('spotify-client', '') || '', connected: !!this.session?.refreshToken, pending: !!this.pending, redirectUri: REDIRECT, error: this.error, encrypted: this.safeStorage.isEncryptionAvailable() }; }
  changed() { this.emit('status', this.status()); }
  saveClient(value) {
    const client = String(value || '').trim();
    if (!/^[a-f0-9]{32}$/i.test(client)) throw new Error('Client ID должен содержать 32 символа из кабинета Spotify. Client Secret не нужен.');
    if (client !== this.status().clientId) { this.disconnect(); this.store.set('spotify-client', client, 0); this.store.flushKey('spotify-client'); }
    this.changed(); return this.status();
  }
  persist(session, epoch) {
    if (epoch !== this.epoch) throw new Error('Подключение отменено.');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно.');
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, this.safeStorage.encryptString(JSON.stringify(session)));
    fs.renameSync(tmp, this.file); this.session = session;
  }
  cancel() { if (this.pending) { clearTimeout(this.pending.timer); this.pending.server.close(); this.pending = null; } this.changed(); return this.status(); }
  disconnect() {
    this.epoch++; this.cancel(); this.session = null; this.refreshing = null; this.error = ''; this.cooldown = 0;
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    this.changed(); return this.status();
  }
  async start() {
    if (!this.status().clientId) throw new Error('Сначала укажите Client ID приложения Spotify.');
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Защищённое хранилище Windows недоступно.');
    this.cancel(); this.error = ''; const epoch = ++this.epoch;
    const state = crypto.randomBytes(32).toString('base64url'); const verifier = crypto.randomBytes(64).toString('base64url');
    const server = http.createServer((req, res) => this.callback(req, res));
    server.headersTimeout = 10000; server.requestTimeout = 10000;
    try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(this.port, '127.0.0.1', resolve); }); }
    catch { throw new Error('Локальный порт входа Spotify занят. Закройте другую копию плеера и повторите.'); }
    server.on('error', () => { this.error = 'Не удалось принять ответ Spotify.'; this.cancel(); });
    const redirect = `http://127.0.0.1:${server.address().port}/callback`;
    const timer = setTimeout(() => { if (this.pending?.epoch === epoch) { this.error = 'Время входа истекло. Нажмите «Подключить» ещё раз.'; this.cancel(); } }, 300000); timer.unref();
    this.pending = { server, timer, state, verifier, redirect, epoch, used: false };
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.status().clientId, redirect_uri: redirect, scope: SCOPES.join(' '), state, code_challenge_method: 'S256', code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }).toString();
    try { await this.openExternal(url.href); } catch { this.cancel(); throw new Error('Не удалось открыть браузер. Попробуйте ещё раз.'); }
    this.changed(); return this.status();
  }
  async callback(req, res) {
    const reply = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }); res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Pixel Player · Spotify</title><body style="background:#121318;color:#e5e2ed;font:18px system-ui;padding:60px;max-width:680px"><h1>Pixel Player × Spotify</h1><p>${message}</p><p>Вернитесь в Pixel Player. Эту вкладку можно закрыть.</p></body></html>`); };
    const pending = this.pending;
    let url; try { url = new URL(req.url, 'http://127.0.0.1'); } catch { reply(400, 'Некорректный ответ.'); return; }
    if (!pending || pending.used || req.method !== 'GET' || url.pathname !== '/callback' || req.headers.host !== new URL(pending.redirect).host) { reply(404, 'Страница не найдена.'); return; }
    if (url.searchParams.get('state') !== pending.state) { reply(400, 'Ответ не соответствует запросу входа.'); return; }
    pending.used = true;
    if (url.searchParams.has('error')) { this.error = 'Вы не разрешили подключение Spotify.'; reply(200, 'Подключение отменено.'); this.cancel(); return; }
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) { this.error = 'Spotify не вернул код входа.'; reply(400, this.error); this.cancel(); return; }
    try {
      const tokens = await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: pending.redirect, code_verifier: pending.verifier });
      this.persist(this.fromTokens(tokens), pending.epoch); this.error = '';
      reply(200, 'Spotify подключён. Ваша библиотека доступна в плеере.');
    } catch { this.error = 'Не удалось завершить вход. Проверьте настройки приложения Spotify и попробуйте снова.'; reply(400, this.error); }
    finally { if (this.pending === pending) this.cancel(); }
  }
  fromTokens(data, previous) {
    if (!data.access_token || !(data.refresh_token || previous?.refreshToken)) throw new Error('Spotify вернул неполный ответ.');
    return { accessToken: data.access_token, refreshToken: data.refresh_token || previous.refreshToken, expires: Date.now() + Math.max(1, Number(data.expires_in) || 3600) * 1000 };
  }
  async tokenRequest(params) {
    let res;
    try { res = await this.fetch('https://accounts.spotify.com/api/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: this.status().clientId }).toString() }); } catch { throw new Error('Не удалось связаться со Spotify. Проверьте интернет.'); }
    if (!res.ok) { const error = new Error('Вход Spotify истёк или отклонён. Подключите аккаунт заново.'); error.auth = res.status === 400 || res.status === 401; throw error; }
    return res.json();
  }
  async access(force = false) {
    if (!this.session?.refreshToken) throw new Error('Подключите аккаунт Spotify.');
    if (!force && this.session.expires > Date.now() + 60000) return this.session.accessToken;
    if (!this.refreshing) {
      const epoch = this.epoch; const previous = this.session;
      const task = (async () => {
        try { const data = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: previous.refreshToken }); this.persist(this.fromTokens(data, previous), epoch); return this.session.accessToken; }
        catch (error) { if (epoch === this.epoch && error.auth) { this.disconnect(); this.error = 'Подключите Spotify заново.'; this.changed(); } throw error; }
      })();
      this.refreshing = task; task.finally(() => { if (this.refreshing === task) this.refreshing = null; }).catch(() => {});
    }
    return this.refreshing;
  }
  async request(endpoint, { method = 'GET', body } = {}, retry = true) {
    // Endpoints are constructed only by the methods below, never supplied by renderer or API pagination links.
    if (Date.now() < this.cooldown) throw new Error(`Лимит Spotify. Повторите через ${Math.ceil((this.cooldown - Date.now()) / 1000)} сек.`);
    const epoch = this.epoch; const token = await this.access();
    let res; try { res = await this.fetch(API + endpoint, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); } catch { throw new Error('Spotify недоступен. Проверьте интернет.'); }
    if (epoch !== this.epoch) throw new Error('Подключение изменено.');
    if (res.status === 401 && retry) { await this.access(true); return this.request(endpoint, { method, body }, false); }
    if (res.status === 429) { const seconds = Math.min(86400, Math.max(1, Number(res.headers?.get('retry-after')) || 30)); this.cooldown = Date.now() + seconds * 1000; throw new Error(`Spotify ограничил запросы. Повторите через ${seconds} сек.`); }
    if (!res.ok) {
      if (res.status === 403) {
        let reason = ''; let message = ''; try { const data = await res.json(); reason = data.error?.reason || ''; message = data.error?.message || ''; } catch {}
        if (reason === 'PREMIUM_REQUIRED' || /premium required|requires premium/i.test(message)) throw new Error('Spotify требует активный Premium именно у подключённого аккаунта. Проверьте подписку в Spotify.');
        if (reason === 'RESTRICTION_VIOLATED' || /restriction violated/i.test(message)) throw new Error('Spotify запретил эту команду для текущего трека или устройства. Откройте трек в Spotify или выберите другое устройство.');
        if (/insufficient.*scope|permissions/i.test(message)) throw new Error('Spotify не выдал разрешение на управление. Войдите в аккаунт заново.');
        throw new Error('Spotify отклонил доступ. Проверьте Premium и список пользователей приложения в кабинете разработчика.');
      }
      throw new Error(res.status === 404 ? 'Откройте Spotify на устройстве, включите любую песню и обновите список устройств.' : res.status === 401 ? 'Подключите Spotify заново.' : `Ошибка Spotify (${res.status}).`);
    }
    // Player commands may return 202 with an opaque acknowledgement instead of JSON.
    return res.status === 204 || method !== 'GET' ? null : res.json();
  }
  async browse(input = {}) {
    const offset = Math.min(100000, Math.max(0, Math.trunc(Number(input.offset)) || 0)); const query = `?limit=50&offset=${offset}`;
    if (input.kind === 'playlists') { const data = await this.request('/me/playlists' + query); return page(data, data.items.map((x) => collection(x, 'playlist'))); }
    if (input.kind === 'albums') { const data = await this.request('/me/albums' + query); return page(data, data.items.map((x) => collection(x.album, 'album'))); }
    if (input.kind === 'liked') { const data = await this.request('/me/tracks' + query); return page(data, data.items.map((x) => track(x.track))); }
    if (['playlist', 'album'].includes(input.kind) && id(input.id)) {
      const endpoint = input.kind === 'playlist' ? `/playlists/${input.id}/items` : `/albums/${input.id}/tracks`;
      const data = await this.request(endpoint + query);
      return page(data, data.items.map((x, index) => { const t = track(input.kind === 'playlist' ? x.item || x.track : { ...x, album: { name: '', images: [] } }); return t && { ...t, position: offset + index }; }));
    }
    if (input.kind === 'search') { const q = clean(input.query, 200).trim(); if (!q) return { items: [], nextOffset: null, total: 0 }; const data = await this.request(`/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(q)}`); return page(data.tracks, data.tracks.items.map(track)); }
    throw new Error('Неизвестный раздел Spotify.');
  }
  async devices() { const data = await this.request('/me/player/devices'); return (data.devices || []).filter((x) => x.id).map((x) => ({ id: clean(x.id, 200), name: clean(x.name), type: clean(x.type), active: !!x.is_active, restricted: !!x.is_restricted, volume: x.volume_percent, supportsVolume: x.supports_volume !== false })); }
  async playback() {
    const data = await this.request('/me/player');
    if (!data) return null;
    return { track: track(data.item), playing: !!data.is_playing, position: Number(data.progress_ms) || 0, device: { id: clean(data.device?.id, 200), name: clean(data.device?.name), volume: data.device?.volume_percent, restricted: !!data.device?.is_restricted, supportsVolume: data.device?.supports_volume !== false }, shuffle: !!data.shuffle_state, repeat: data.repeat_state, disallows: data.actions?.disallows || {}, at: Date.now() };
  }
  async command(input = {}) {
    const device = input.deviceId ? String(input.deviceId) : '';
    if (device && !/^[A-Za-z0-9_-]{1,200}$/.test(device)) throw new Error('Некорректное устройство Spotify.');
    const suffix = device ? `?device_id=${encodeURIComponent(device)}` : '';
    const value = Number(input.value);
    if (input.action === 'play') {
      let body;
      if (input.context) {
        if (!/^spotify:(album|playlist):[A-Za-z0-9]{22}$/.test(input.context)) throw new Error('Некорректная коллекция.');
        body = { context_uri: input.context }; if (Number.isInteger(input.position) && input.position >= 0) body.offset = { position: input.position };
      } else if (input.uris) {
        if (!Array.isArray(input.uris) || !input.uris.length || input.uris.length > 100 || input.uris.some((x) => !/^spotify:track:[A-Za-z0-9]{22}$/.test(x))) throw new Error('Некорректный список треков.');
        const position = Number.isInteger(input.position) && input.position >= 0 && input.position < input.uris.length ? input.position : 0;
        // Spotify supports offset only for album/playlist contexts, not explicit URI lists.
        body = { uris: [...input.uris.slice(position), ...input.uris.slice(0, position)] };
      }
      return this.request('/me/player/play' + suffix, { method: 'PUT', body });
    }
    if (input.action === 'pause') return this.request('/me/player/pause' + suffix, { method: 'PUT' });
    if (['next','previous'].includes(input.action)) return this.request('/me/player/' + input.action + suffix, { method: 'POST' });
    const q = suffix ? suffix + '&' : '?';
    if (input.action === 'seek' && Number.isFinite(value)) return this.request('/me/player/seek' + q + 'position_ms=' + Math.max(0, Math.round(value)), { method: 'PUT' });
    if (input.action === 'volume' && Number.isFinite(value)) return this.request('/me/player/volume' + q + 'volume_percent=' + Math.min(100, Math.max(0, Math.round(value))), { method: 'PUT' });
    if (input.action === 'shuffle' && typeof input.value === 'boolean') return this.request('/me/player/shuffle' + q + 'state=' + input.value, { method: 'PUT' });
    if (input.action === 'repeat' && ['off','track','context'].includes(input.value)) return this.request('/me/player/repeat' + q + 'state=' + input.value, { method: 'PUT' });
    if (input.action === 'transfer' && device) return this.request('/me/player', { method: 'PUT', body: { device_ids: [device], play: false } });
    throw new Error('Неизвестная команда Spotify.');
  }
}
module.exports = { Spotify, SCOPES, REDIRECT, track, collection, image };
