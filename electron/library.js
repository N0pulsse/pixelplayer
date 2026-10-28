'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const {
  AUDIO_EXTS, IMAGE_EXTS, FOLDER_COVER_RE,
  idForPath, parseFilename, splitArtists, withTimeout, isAudioFile,
} = require('./util');

const CACHE_VERSION = 3;
const MIN_FILE_SIZE = 64; // не отбрасываем короткие WAV/FLAC и музыкальные фрагменты
const SKIP_DIRS = new Set([
  '$recycle.bin', 'system volume information', 'node_modules', 'appdata',
  'windows', 'program files', 'program files (x86)', 'programdata', '.git', '.cache',
]);

const norm = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));
const isInside = (file, root) => {
  const f = norm(file); const r = norm(root);
  return f === r || f.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
};

/**
 * Библиотека: обходит папки, читает теги (с кэшем по mtime+size), следит за изменениями на диске
 * и сообщает рендереру только разницу (добавлено / обновлено / удалено).
 *
 * События: 'progress' {phase, done, total, found}, 'diff' {added, updated, removed}, 'done' {...}
 */
class Library extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dir      где хранить library.json
   * @param {(file:string)=>Promise<object|null>} o.parse  читает теги
   * @param {import('./covers').CoverStore} o.covers
   */
  constructor({ dir, parse, covers, concurrency }) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.parse = parse;
    this.covers = covers;
    this.concurrency = concurrency || Math.min(6, Math.max(2, os.cpus().length - 1));
    this.cache = new Map();     // id → трек (в т.ч. скрытые: диск отключён)
    this.visible = new Set();   // id треков, которые сейчас показываем
    this.adhoc = new Map();     // id → трек, открытый «снаружи» (двойной клик, drag&drop)
    this.externalIds = new Set(); // файлы импортированных плейлистов сохраняются между запусками
    this._folderRevision = 0;
    this._closed = false;
    this._savePromise = Promise.resolve();
    this.folders = [];          // [{path, enabled, auto}]
    this.scanning = false;
    this.lastScan = 0;
    this.watchers = [];
    this.retried = new Set();
    this.dirCoverMemo = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  /* ───────────── кэш ───────────── */

  async load() {
    try {
      const j = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      if (j && j.v === CACHE_VERSION && Array.isArray(j.tracks)) {
        for (const t of j.tracks) this.cache.set(t.id, t);
        for (const t of j.externalTracks || []) {
          if (t && typeof t.path === 'string' && typeof t.id === 'string' && isAudioFile(t.path)) {
            this.adhoc.set(t.id, t);
            this.externalIds.add(t.id);
          }
        }
      }
    } catch { /* первого запуска ещё не было */ }
  }

  _saveSoon() {
    clearTimeout(this._saveTimer);
    if (this._closed) return;
    this._saveTimer = setTimeout(() => this.save().catch(() => {}), 1500);
  }

  async save() {
    clearTimeout(this._saveTimer);
    // A rescan and application shutdown may save at the same time. Serialize writes
    // so one rename cannot remove another write's temporary file.
    const contents = JSON.stringify({
      v: CACHE_VERSION, tracks: [...this.cache.values()],
      externalTracks: [...this.externalIds].map((id) => this.adhoc.get(id)).filter(Boolean),
    });
    this._savePromise = this._savePromise.catch(() => {}).then(async () => {
      const tmp = `${this.file}.tmp`;
      await fsp.writeFile(tmp, contents);
      await fsp.rename(tmp, this.file);
    });
    return this._savePromise;
  }

  /* ───────────── состояние ───────────── */

  static pub(t) {
    const { root, ...rest } = t; // eslint-disable-line no-unused-vars
    return rest;
  }

  pathFor(id) {
    const t = this.cache.get(id) || this.adhoc.get(id);
    return t ? t.path : null;
  }

  getTracks() {
    const out = [];
    const included = new Set();
    for (const id of this.visible) {
      const t = this.cache.get(id);
      if (t) { out.push(Library.pub(t)); included.add(id); }
    }
    for (const id of this.externalIds) {
      const t = this.adhoc.get(id);
      if (t && !included.has(id)) out.push(Library.pub(t));
    }
    return out;
  }

  getFolders() { return this.folders.map((f) => ({ ...f })); }

  /** Задаём список папок: убираем из кэша треки удалённых папок, показываем треки включённых. */
  setFolders(folders) {
    this._folderRevision++;
    if (this.scanning) this.rescanQueued = this.rescanQueued || { deep: false };
    const seen = new Set();
    this.folders = (Array.isArray(folders) ? folders : []).filter((f) => {
      if (!f || typeof f.path !== 'string' || !path.isAbsolute(f.path)) return false;
      const key = norm(f.path);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((f) => ({ path: path.normalize(f.path), enabled: f.enabled !== false, auto: !!f.auto }));
    const enabledRoots = this.folders.filter((f) => f.enabled).map((f) => f.path);
    const known = this.folders.map((f) => f.path);
    // Удаляем из кэша то, что принадлежит папкам, которых больше нет в списке
    for (const [id, t] of this.cache) {
      if (!known.some((r) => t.root && norm(t.root) === norm(r))) this.cache.delete(id);
    }
    // Пересчитываем, что видно
    const nextVisible = new Set();
    for (const [id, t] of this.cache) {
      if (enabledRoots.some((r) => norm(t.root) === norm(r))) nextVisible.add(id);
    }
    this._applyVisible(nextVisible);
    this._saveSoon();
  }

  _applyVisible(next) {
    const added = []; const removed = [];
    for (const id of next) if (!this.visible.has(id)) added.push(Library.pub(this.cache.get(id)));
    for (const id of this.visible) if (!next.has(id) && !this.externalIds.has(id)) removed.push(id);
    this.visible = next;
    if (added.length || removed.length) this.emit('diff', { added, updated: [], removed });
  }

  /* ───────────── сканирование ───────────── */

  /** @param {{deep?:boolean}} [opts] deep — перечитать теги всех файлов заново */
  scan(opts = {}) {
    if (this._closed) return Promise.resolve();
    if (this.scanning) {
      this.rescanQueued = { deep: !!(opts.deep || (this.rescanQueued && this.rescanQueued.deep)) };
      return this.scanPromise;
    }
    this.scanning = true;
    this.scanPromise = this._scan(!!opts.deep)
      .catch((e) => { console.error('[library] ошибка сканирования', e); this.emit('done', { error: e.message }); })
      .finally(() => {
        this.scanning = false;
        this.lastScan = Date.now();
        const q = this.rescanQueued;
        this.rescanQueued = null;
        if (q && !this._closed) this.scan(q);
      });
    return this.scanPromise;
  }

  async _walk(root, found, progress) {
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
      let dirCover = null;
      const audio = [];
      for (const e of entries) {
        const name = e.name;
        if (e.isDirectory()) {
          const low = name.toLowerCase();
          if (depth < 14 && !low.startsWith('.') && !SKIP_DIRS.has(low)) stack.push({ dir: path.join(dir, name), depth: depth + 1 });
        } else {
          const ext = path.extname(name).toLowerCase();
          if (AUDIO_EXTS.has(ext)) audio.push(name);
          else if (IMAGE_EXTS.has(ext) && FOLDER_COVER_RE.test(name) && !dirCover) dirCover = name;
        }
      }
      for (const name of audio) {
        const full = path.join(dir, name);
        let st;
        try { st = await fsp.stat(full); } catch { continue; }
        if (!st.isFile() || st.size < MIN_FILE_SIZE) continue;
        const id = idForPath(full);
        if (!found.has(id)) {
          found.set(id, { id, file: full, stat: st, root, dirCover: dirCover ? path.join(dir, dirCover) : null });
        }
      }
      progress(found.size);
    }
  }

  async _scan(deep) {
    const revision = this._folderRevision;
    const t0 = Date.now();
    const roots = this.folders.filter((f) => f.enabled);
    const okRoots = []; const missingRoots = [];
    await Promise.all(roots.map(async (r) => {
      const st = await withTimeout(fsp.stat(r.path).catch(() => null), 4000, null);
      (st && st.isDirectory() ? okRoots : missingRoots).push(r.path);
    }));

    this.emit('progress', { phase: 'walk', done: 0, total: 0, found: 0 });
    const found = new Map();
    let lastEmit = 0;
    for (const r of okRoots) {
      await this._walk(r, found, (n) => {
        const now = Date.now();
        if (now - lastEmit > 200) { lastEmit = now; this.emit('progress', { phase: 'walk', done: 0, total: 0, found: n }); }
      });
      if (revision !== this._folderRevision || this._closed) return;
    }
    if (revision !== this._folderRevision || this._closed) return;

    // Что нужно (пере)читать
    const toParse = [];
    const nextVisible = new Set();
    const reusedNew = []; // треки из кэша, которые были скрыты и вернулись
    for (const item of found.values()) {
      const cached = this.cache.get(item.id);
      const fresh = cached && cached.mtime === item.stat.mtimeMs && cached.size === item.stat.size
        && norm(cached.root || '') === norm(item.root);
      const retry = cached && cached.partial && !this.retried.has(item.id);
      if (fresh && !deep && !retry) {
        nextVisible.add(item.id);
        if (!this.visible.has(item.id)) reusedNew.push(Library.pub(cached));
      } else {
        toParse.push(item);
      }
    }

    // Удалённые файлы: убираем из кэша, если папка доступна; если папка недоступна (диск отключён) — только прячем
    const missing = new Set(missingRoots.map(norm));
    for (const [id, t] of this.cache) {
      if (found.has(id)) continue;
      if (t.root && missing.has(norm(t.root))) continue;
      if (this.folders.some((f) => f.enabled && norm(f.path) === norm(t.root || '') && okRoots.includes(f.path))) {
        this.cache.delete(id);
      }
    }

    // Показываем сразу то, что уже в кэше, и убираем исчезнувшее
    const removed = [];
    for (const id of this.visible) {
      if (!nextVisible.has(id) && !found.has(id) && !this.externalIds.has(id)) removed.push(id);
    }
    const parsingIds = new Set(toParse.map((i) => i.id));
    for (const id of parsingIds) if (this.visible.has(id)) nextVisible.add(id);
    for (const id of removed) this.visible.delete(id);
    for (const t of reusedNew) this.visible.add(t.id);
    if (removed.length || reusedNew.length) this.emit('diff', { added: reusedNew, updated: [], removed });

    // Чтение тегов — с ограничением параллелизма и пакетной отправкой в интерфейс
    let done = 0;
    let batchAdded = []; let batchUpdated = [];
    let flushTimer = null;
    const flush = () => {
      flushTimer = null;
      if (revision !== this._folderRevision || this._closed) { batchAdded = []; batchUpdated = []; return; }
      if (!batchAdded.length && !batchUpdated.length) return;
      this.emit('diff', { added: batchAdded, updated: batchUpdated, removed: [] });
      batchAdded = []; batchUpdated = [];
    };
    const queue = toParse.slice();
    const worker = async () => {
      while (queue.length) {
        if (revision !== this._folderRevision || this._closed) return;
        const item = queue.shift();
        try {
          const track = await this._buildTrack(item);
          if (revision !== this._folderRevision || this._closed) return;
          const had = this.visible.has(track.id);
          this.cache.set(track.id, track);
          if (this.externalIds.has(track.id)) this.adhoc.set(track.id, track);
          this.visible.add(track.id);
          (had ? batchUpdated : batchAdded).push(Library.pub(track));
          if (track.partial) this.retried.add(track.id);
        } catch (e) {
          console.error('[library] не удалось обработать', item.file, e.message);
        }
        done += 1;
        if (!flushTimer) flushTimer = setTimeout(flush, 250);
        if (done % 8 === 0 || done === toParse.length) {
          this.emit('progress', { phase: 'parse', done, total: toParse.length, found: found.size });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, toParse.length)) }, worker));
    clearTimeout(flushTimer);
    if (revision !== this._folderRevision || this._closed) { this.dirCoverMemo.clear(); return; }
    flush();

    this.dirCoverMemo.clear();
    this._saveSoon();
    this.emit('done', { total: this.getTracks().length, parsed: toParse.length, ms: Date.now() - t0, missingRoots });
  }

  async _dirCoverKey(file) {
    if (!this.dirCoverMemo.has(file)) {
      this.dirCoverMemo.set(file, (async () => {
        try {
          const st = await fsp.stat(file);
          if (st.size > 12 * 1024 * 1024) return null;
          return await this.covers.save(await fsp.readFile(file));
        } catch { return null; }
      })());
    }
    return this.dirCoverMemo.get(file);
  }

  async _buildTrack({ id, file, stat, root, dirCover }) {
    let tags = null;
    try { tags = await this.parse(file); } catch { tags = null; }
    const fn = parseFilename(file);
    let cover = null;
    if (tags && tags.picture) cover = await this.covers.save(tags.picture.data);
    if (!cover && dirCover) cover = await this._dirCoverKey(dirCover);

    const artist = (tags && tags.artist) || fn.artist || null;
    let artists = [];
    if (tags && tags.artists && tags.artists.length) artists = tags.artists.flatMap((a) => splitArtists(a));
    else artists = splitArtists(artist);
    artists = [...new Set(artists)];

    return {
      id,
      path: file,
      folder: path.dirname(file),
      root,
      title: (tags && tags.title) || fn.title,
      artist,
      artists,
      albumArtist: (tags && tags.albumArtist) || null,
      compilation: !!(tags && tags.compilation),
      musicbrainzAlbumId: (tags && tags.musicbrainzAlbumId) || null,
      album: (tags && tags.album) || null,
      year: (tags && tags.year) || null,
      genre: (tags && tags.genre) || null,
      track: (tags && tags.track) || fn.track || null,
      disc: (tags && tags.disc) || null,
      duration: (tags && tags.duration) || 0,
      bitrate: (tags && tags.bitrate) || null,
      sampleRate: (tags && tags.sampleRate) || null,
      lossless: !!(tags && tags.lossless),
      codec: (tags && tags.codec) || path.extname(file).slice(1).toUpperCase(),
      size: stat.size,
      mtime: stat.mtimeMs,
      added: Math.round(stat.birthtimeMs && stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs),
      cover,
      partial: !tags,
    };
  }

  /** Файлы, открытые «снаружи» (двойной клик, перетаскивание): читаем теги, но в библиотеку не добавляем. */
  async parseFiles(files, { persist = false } = {}) {
    const out = [];
    const added = []; const updated = [];
    for (const input of Array.isArray(files) ? files : []) {
      try {
        if (typeof input !== 'string' || !path.isAbsolute(input) || !isAudioFile(input)) continue;
        const file = path.normalize(input);
        const st = await fsp.stat(file);
        if (!st.isFile() || st.size < MIN_FILE_SIZE) continue;
        const id = idForPath(file);
        const known = this.cache.get(id) || this.adhoc.get(id);
        const fresh = known && known.mtime === st.mtimeMs && known.size === st.size;
        const t = fresh ? known : await this._buildTrack({ id, file, stat: st, root: (known && known.root) || null, dirCover: null });
        if (this.cache.has(id)) this.cache.set(id, t);
        this.adhoc.set(id, t);
        if (persist) {
          const had = this.visible.has(id) || this.externalIds.has(id);
          this.externalIds.add(id);
          (had ? updated : added).push(Library.pub(t));
        }
        out.push(Library.pub(t));
      } catch { /* пропускаем недоступные */ }
    }
    if (persist && out.length) {
      this.emit('diff', { added, updated, removed: [] });
      await this.save();
    }
    return out;
  }

  /** Keep files added to a user's playlist even when their source folder is not watched. */
  async retainFiles(ids) {
    const out = []; const added = []; const updated = [];
    for (const id of new Set(Array.isArray(ids) ? ids : [])) {
      if (typeof id !== 'string') continue;
      const track = this.cache.get(id) || this.adhoc.get(id);
      if (!track) continue;
      const had = this.visible.has(id) || this.externalIds.has(id);
      this.adhoc.set(id, track);
      this.externalIds.add(id);
      const publicTrack = Library.pub(track);
      out.push(publicTrack);
      (had ? updated : added).push(publicTrack);
    }
    if (out.length) {
      this.emit('diff', { added, updated, removed: [] });
      await this.save();
    }
    return out;
  }

  /* ───────────── слежение за диском ───────────── */

  watch() {
    this.unwatch();
    for (const f of this.folders.filter((x) => x.enabled)) {
      try {
        const w = fs.watch(f.path, { recursive: true, persistent: false }, (evt, name) => {
          if (name) {
            const ext = path.extname(String(name)).toLowerCase();
            if (ext && !AUDIO_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) return;
          }
          this.scheduleScan();
        });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch { /* папки нет или нет прав — не страшно */ }
    }
  }

  unwatch() {
    for (const w of this.watchers) { try { w.close(); } catch { /* */ } }
    this.watchers = [];
  }

  scheduleScan(delay = 2500) {
    clearTimeout(this._watchTimer);
    this._watchTimer = setTimeout(() => this.scan(), delay);
  }

  close() {
    this._closed = true;
    this.unwatch();
    clearTimeout(this._watchTimer);
    clearTimeout(this._saveTimer);
  }
}

module.exports = { Library, isInside };
