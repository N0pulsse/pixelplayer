'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, protocol, shell, nativeImage, net, Tray, Menu, safeStorage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { Store } = require('./store');
const { CoverStore } = require('./covers');
const { Library } = require('./library');
const { readTags } = require('./meta');
const { detectMusicFolders } = require('./detect');
const { getLyrics } = require('./lyrics');
const { createHandler } = require('./protocol');
const { isAudioFile, sha1, withTimeout, AUDIO_EXTS } = require('./util');
const { configureStorage } = require('./storage');
const { decodePlaylist, parseM3u, serializeM3u } = require('./playlists');
const { registerFeatures } = require('./features');

const APP_ID = 'com.pixelplayer.desktop';
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

protocol.registerSchemesAsPrivileged([
  { scheme: 'pp', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Музыка должна играть без «жеста пользователя» (восстановление сессии, медиа-клавиши)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Медиа-клавиши и плашка «Сейчас играет» в Windows
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,MediaSessionService');

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

let win = null;
let tray = null;
let quitting = false;
let store; let covers; let library;
let lastFocusCheck = 0;
let lastRescan = 0;
let storage = null;
let quitComplete = false;
let quitSaving = false;
const pendingFiles = [];

try { storage = configureStorage(app); } catch (error) {
  dialog.showErrorBox('Pixel Player · portable', error.message);
  app.quit();
}

const gotLock = storage && app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    showWindow();
    const files = argvFiles(argv);
    if (files.length) {
      if (library && win && !win.webContents.isLoading()) openFiles(files).catch(console.error);
      else pendingFiles.push(...files);
    }
  });
  app.whenReady().then(boot).catch((e) => {
    console.error(e);
    dialog.showErrorBox('Pixel Player', String(e && e.stack || e));
    app.quit();
  });
}

function argvFiles(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && isAudioFile(a) && fs.existsSync(a));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function openFiles(files) {
  const tracks = await library.parseFiles(files);
  if (tracks.length) send('open-files', tracks);
}

/* ───────────────────────── запуск ───────────────────────── */

async function boot() {
  const userData = app.getPath('userData');
  store = new Store(path.join(userData, 'data'));
  covers = new CoverStore(path.join(userData, 'covers'), nativeImage);
  library = new Library({ dir: userData, parse: (f) => readTags(f), covers });
  await library.load();

  protocol.handle('pp', createHandler({
    appDir: path.join(__dirname, '..', 'dist', 'renderer'),
    library,
    covers,
    artistDir: path.join(userData, 'artists'),
  }));

  // Первый запуск — ищем музыку сами
  let folders = store.get('folders');
  const firstRun = !Array.isArray(folders);
  if (firstRun) {
    const found = await detectMusicFolders(detectEnv());
    folders = found.map((f) => ({ path: f.path, enabled: true, auto: true }));
    store.set('folders', folders, 0);
  }
  library.setFolders(folders);
  library.on('diff', (d) => send('lib:diff', d));
  library.on('progress', (p) => { library.lastProgress = p; send('lib:progress', p); });
  library.on('done', (d) => { library.lastProgress = null; send('lib:done', d); });

  registerIpc(firstRun);
  createWindow();
  createTray();

  library.watch();
  library.scan();
  lastRescan = Date.now();

  win.webContents.once('did-finish-load', () => {
    const files = [...argvFiles(process.argv), ...pendingFiles.splice(0)];
    if (files.length) openFiles(files).catch(console.error);
  });

  app.on('activate', () => showWindow());
  app.on('before-quit', (event) => {
    quitting = true;
    if (quitComplete) return;
    event.preventDefault();
    if (quitSaving) return;
    quitSaving = true;
    library.close();
    store.flush();
    library.save().catch(console.error).finally(() => { quitComplete = true; app.quit(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => store.flush());
}

function detectEnv() {
  return {
    musicDir: app.getPath('music'),
    downloadsDir: app.getPath('downloads'),
    homeDir: app.getPath('home'),
  };
}

/* ───────────────────────── окно ───────────────────────── */

function createWindow() {
  const saved = store.get('window', {}) || {};
  win = new BrowserWindow({
    width: saved.width || 1280,
    height: saved.height || 820,
    x: saved.x,
    y: saved.y,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#10131a',
    show: false,
    title: 'Pixel Player',
    icon: ICON,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#10131a', symbolColor: '#e1e2ec', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  if (saved.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  win.loadURL('pp://app/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('pp://app/')) e.preventDefault(); });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      win.webContents.toggleDevTools();
    }
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) {
      if (!app.isPackaged) win.webContents.reload();
    }
  });

  win.on('maximize', () => send('win:maximized', true));
  win.on('unmaximize', () => send('win:maximized', false));
  win.on('focus', onFocus);
  win.on('close', (e) => {
    saveBounds();
    const settings = store.get('settings') || {};
    if (!quitting && settings.closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const b = maximized ? (store.get('window') || {}) : win.getBounds();
  store.set('window', { ...b, maximized }, 0);
}

function showWindow() {
  if (!store) return;
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function onFocus() {
  const now = Date.now();
  // Пока окно в фоне, на диске могли появиться файлы — быстро перепроверяем
  if (now - lastRescan > 120000) { lastRescan = now; library.scan(); }
  // Подключили флешку или появилась новая папка с музыкой? Предложим добавить.
  if (now - lastFocusCheck > 60000) {
    lastFocusCheck = now;
    const list = await suggestFolders();
    if (list.length) send('lib:suggest', list);
  }
}

async function suggestFolders() {
  const have = (store.get('folders') || []).map((f) => process.platform === 'win32' ? f.path.toLowerCase() : f.path);
  const dismissed = store.get('dismissed') || [];
  const found = await detectMusicFolders(detectEnv());
  return found.filter((f) => {
    const key = process.platform === 'win32' ? f.path.toLowerCase() : f.path;
    return f.hasMusic && !have.includes(key) && !dismissed.includes(key);
  });
}

/* ───────────────────────── трей ───────────────────────── */

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON);
    if (img.isEmpty()) return;
    tray = new Tray(img.resize({ width: 16, height: 16 }));
    tray.setToolTip('Pixel Player');
    tray.on('click', () => showWindow());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть Pixel Player', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Играть / Пауза', click: () => send('cmd', 'playpause') },
      { label: 'Следующий трек', click: () => send('cmd', 'next') },
      { label: 'Предыдущий трек', click: () => send('cmd', 'prev') },
      { type: 'separator' },
      { label: 'Выход', click: () => { quitting = true; app.quit(); } },
    ]));
  } catch (e) {
    console.error('[tray]', e.message);
  }
}

/* ───────────────────────── IPC ───────────────────────── */

function registerIpc(firstRun) {
  registerFeatures({ app, ipcMain, dialog, getWindow: () => win, store, library, net, nativeImage, safeStorage, shell });
  // Библиотека
  ipcMain.handle('lib:get', () => ({
    tracks: library.getTracks(),
    folders: library.getFolders(),
    scanning: library.scanning,
    progress: library.lastProgress || null,
    firstRun,
  }));
  ipcMain.handle('lib:rescan', (_e, deep) => { lastRescan = Date.now(); library.scan({ deep: !!deep }); return true; });
  ipcMain.handle('lib:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите папку с музыкой',
      properties: ['openDirectory', 'multiSelections'],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('lib:addFolders', (_e, paths) => {
    const folders = store.get('folders') || [];
    const have = new Set(folders.map((f) => f.path.toLowerCase()));
    for (const p of Array.isArray(paths) ? paths : []) {
      if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
      if (!have.has(p.toLowerCase())) { folders.push({ path: p, enabled: true, auto: false }); have.add(p.toLowerCase()); }
      else folders.forEach((f) => { if (f.path.toLowerCase() === p.toLowerCase()) f.enabled = true; });
    }
    applyFolders(folders);
    return library.getFolders();
  });
  ipcMain.handle('lib:removeFolder', (_e, p) => {
    const folders = (store.get('folders') || []).filter((f) => f.path !== p);
    // запоминаем, что пользователь не хочет эту папку, чтобы автопоиск не предлагал её снова
    const dismissed = store.get('dismissed') || [];
    const key = process.platform === 'win32' ? p.toLowerCase() : p;
    if (!dismissed.includes(key)) store.set('dismissed', [...dismissed, key], 0);
    applyFolders(folders);
    return library.getFolders();
  });
  ipcMain.handle('lib:toggleFolder', (_e, p, enabled) => {
    const folders = (store.get('folders') || []).map((f) => (f.path === p ? { ...f, enabled: !!enabled } : f));
    applyFolders(folders);
    return library.getFolders();
  });
  ipcMain.handle('lib:detect', async () => {
    const found = await detectMusicFolders(detectEnv());
    const have = (store.get('folders') || []).map((f) => f.path.toLowerCase());
    return found.map((f) => ({ ...f, added: have.includes(f.path.toLowerCase()) }));
  });
  ipcMain.handle('lib:dismiss', (_e, p) => {
    const dismissed = store.get('dismissed') || [];
    const key = process.platform === 'win32' ? p.toLowerCase() : p;
    if (!dismissed.includes(key)) store.set('dismissed', [...dismissed, key], 0);
    return true;
  });
  ipcMain.handle('lib:parseFiles', (_e, files) => library.parseFiles(files || []));
  ipcMain.handle('lib:retainFiles', (_e, ids) => library.retainFiles(ids));
  ipcMain.handle('lib:openFiles', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Открыть музыку', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Аудиофайлы', extensions: [...AUDIO_EXTS].map((ext) => ext.slice(1)) }],
    });
    return result.canceled ? [] : library.parseFiles(result.filePaths);
  });
  ipcMain.handle('lib:classifyPaths', async (_e, paths) => {
    const files = []; const folders = [];
    const entries = await Promise.all((Array.isArray(paths) ? paths : []).map(async (p) => {
      if (typeof p !== 'string' || !path.isAbsolute(p)) return null;
      const stat = await fsp.stat(p).catch(() => null);
      return { p, stat };
    }));
    for (const entry of entries) {
      if (!entry || !entry.stat) continue;
      if (entry.stat.isDirectory()) folders.push(entry.p);
      else if (entry.stat.isFile() && isAudioFile(entry.p)) files.push(entry.p);
    }
    return { files, folders };
  });

  ipcMain.handle('playlists:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Импортировать плейлист', properties: ['openFile'],
      filters: [{ name: 'Плейлисты M3U', extensions: ['m3u', 'm3u8'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const file = result.filePaths[0];
    const stat = await fsp.stat(file);
    if (stat.size > 8 * 1024 * 1024) throw new Error('Плейлист слишком большой (максимум 8 МБ).');
    const { paths, skipped } = parseM3u(decodePlaylist(await fsp.readFile(file)), file);
    const tracks = await library.parseFiles(paths, { persist: true });
    return { name: path.basename(file, path.extname(file)), tracks, missing: paths.length - tracks.length, skipped };
  });
  ipcMain.handle('playlists:export', async (_e, playlist) => {
    if (!playlist || !Array.isArray(playlist.tracks)) throw new Error('Выберите плейлист для экспорта.');
    const tracks = playlist.tracks.map((track) => {
      const id = typeof track === 'string' ? track : track && track.id;
      const file = library.pathFor(id);
      const original = library.cache.get(id) || library.adhoc.get(id);
      return file && original ? { ...original, path: file } : null;
    }).filter(Boolean);
    const safeName = String(playlist.name || 'Плейлист').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    const result = await dialog.showSaveDialog(win, {
      title: 'Экспортировать плейлист', defaultPath: `${safeName}.m3u8`,
      filters: [{ name: 'Плейлист UTF-8', extensions: ['m3u8'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, serializeM3u(tracks, result.filePath), 'utf8');
    return { path: result.filePath, count: tracks.length };
  });

  // Настройки и пользовательские данные
  ipcMain.handle('store:get', (_e, key) => store.get(key));
  ipcMain.on('store:getSync', (e, key) => { e.returnValue = store.get(key); });
  ipcMain.on('store:set', (_e, key, value) => {
    store.set(key, value);
    // beforeunload persists the last queue/settings after before-quit has fired.
    // These writes must not wait for a debounce timer while the process exits.
    if (quitting) store.flushKey(key);
  });

  // Тексты и картинки исполнителей
  ipcMain.handle('lyrics:get', async (_e, requested, force) => {
    const track = requested && (library.cache.get(requested.id) || library.adhoc.get(requested.id));
    if (!track) return null;
    const settings = store.get('settings') || {};
    return getLyrics(track, {
      cacheDir: path.join(app.getPath('userData'), 'lyrics'),
      online: settings.onlineLyrics !== false,
        force: !!force,
      readEmbedded: async (p) => { const t = await readTags(p, { covers: false }); return t && t.lyrics; },
      fetch: (url, opts) => net.fetch(url, { ...opts, signal: AbortSignal.timeout(8000) }),
    });
  });
  ipcMain.handle('artist:image', (_e, name) => artistImage(String(name || '')));

  // Окно
  ipcMain.on('win:minimize', () => win && win.minimize());
  ipcMain.on('win:toggleMaximize', () => { if (win) (win.isMaximized() ? win.unmaximize() : win.maximize()); });
  ipcMain.on('win:close', () => win && win.close());
  ipcMain.on('win:overlay', (_e, o) => {
    try {
      if (win && typeof win.setTitleBarOverlay === 'function' && o && o.color) {
        win.setTitleBarOverlay({ color: o.color, symbolColor: o.symbolColor, height: 40 });
        win.setBackgroundColor(o.color);
      }
    } catch { /* не Windows */ }
  });
  ipcMain.on('win:alwaysOnTop', (_e, v) => win && win.setAlwaysOnTop(!!v));
  ipcMain.on('win:title', (_e, title) => { if (win) win.setTitle(title || 'Pixel Player'); if (tray) tray.setToolTip(title || 'Pixel Player'); });
  ipcMain.handle('win:isMaximized', () => !!(win && win.isMaximized()));

  ipcMain.on('shell:showInFolder', (_e, p) => { if (p) shell.showItemInFolder(p); });
  ipcMain.on('shell:openExternal', (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); });
  ipcMain.on('app:openUserData', () => shell.openPath(app.getPath('userData')));
  ipcMain.on('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.on('app:getInfo', (e) => {
    e.returnValue = { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, ...storage };
  });
}

function applyFolders(folders) {
  store.set('folders', folders, 0);
  library.setFolders(folders);
  library.watch();
  send('lib:folders', library.getFolders());
  lastRescan = Date.now();
  library.scan();
}

/* ───────────────────────── фото исполнителей (Deezer) ───────────────────────── */

const artistMemo = new Map();
let artistActive = 0;
const artistWaiters = [];

async function artistImage(name) {
  const settings = store.get('settings') || {};
  if (settings.artistImages === false || !name) return null;
  const key = sha1('v2:' + name.toLowerCase()).slice(0, 16);
  const dir = path.join(app.getPath('userData'), 'artists');
  const file = path.join(dir, `${key}.jpg`);
  if (fs.existsSync(file)) return `pp://app/artist/${key}`;
  const misses = store.get('artistMiss') || {};
  if (misses[key] && Date.now() - misses[key] < 14 * 86400000) return null;
  if (artistMemo.has(key)) return artistMemo.get(key);

  const job = (async () => {
    if (artistActive >= 2) await new Promise((r) => artistWaiters.push(r));
    artistActive += 1;
    try {
      await fsp.mkdir(dir, { recursive: true });
      const res = await net.fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=20`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`deezer ${res.status}`);
      const j = await res.json();
      const nrm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const hit = (j.data || []).filter((a) => nrm(a.name) === nrm(name)).sort((a,b) => (b.nb_fan || 0) - (a.nb_fan || 0))[0];
      const pic = hit && (hit.picture_big || hit.picture_xl);
      if (!pic || /\/images\/artist\/\/|2a96cbd8b46e442fc41c2b86b821562f/.test(pic)) {
        misses[key] = Date.now(); store.set('artistMiss', misses);
        return null;
      }
      const img = await net.fetch(pic, { signal: AbortSignal.timeout(10000) });
      if (!img.ok) throw new Error(`img ${img.status}`);
      await fsp.writeFile(file, Buffer.from(await img.arrayBuffer()));
      return `pp://app/artist/${key}`;
    } catch {
      return null; // нет сети — попробуем в следующий раз
    } finally {
      artistActive -= 1;
      const next = artistWaiters.shift();
      if (next) next();
      artistMemo.delete(key);
    }
  })();
  artistMemo.set(key, job);
  return withTimeout(job, 20000, null);
}
