'use strict';
const path = require('node:path');
const { ArtistProfiles } = require('./artists');
const { PlaylistAgent } = require('./ai');
const { WallpaperPalette } = require('./wallpaper');
const { Spotify } = require('./spotify');
const { OnlinePlayers } = require('./online');
const { artistKey, splitArtistCredit } = require('./identity');
function registerFeatures({ app, ipcMain, dialog, getWindow, store, library, net, nativeImage, safeStorage, shell, BrowserWindow, session }) {
  const fetch = (url, opts = {}) => net.fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(10000) });
  const profiles = new ArtistProfiles({ dir: path.join(app.getPath('userData'), 'artists'), fetch, nativeImage });
  const agent = new PlaylistAgent({ store, dir: app.getPath('userData'), fetch, safeStorage });
  const wallpaper = new WallpaperPalette({ nativeImage });
  const spotify = new Spotify({ store, dir: app.getPath('userData'), safeStorage, fetch, openExternal: (url) => shell.openExternal(url) });
  const online = new OnlinePlayers({ BrowserWindow, session, shell, store, icon:path.join(__dirname,'../build/icon.png'), emit:(status)=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('online:status',status);} });
  app.on('browser-window-created',(_e,w)=>{if(w.webContents.getLastWebPreferences().preload===path.join(__dirname,'preload.js'))w.on('closed',()=>online.closeAll());});
  app.on('before-quit',()=>online.closeAll());
  ipcMain.handle('online:status',()=>online.status());
  ipcMain.handle('online:list',()=>online.list());
  ipcMain.handle('online:save',(_e,input)=>online.save(input));
  ipcMain.handle('online:remove',(_e,id)=>online.remove(id));
  ipcMain.handle('online:open',(_e,key,url)=>online.open(key,url));
  ipcMain.handle('online:external',(_e,key,url)=>online.external(key,url));
  ipcMain.handle('online:close',(_e,key)=>online.close(key));
  ipcMain.handle('online:disconnect',(_e,key)=>online.disconnect(key));
  spotify.on('status', (status) => { const win = getWindow(); if (win && !win.isDestroyed()) win.webContents.send('spotify:status', status); });
  app.on('before-quit', () => spotify.cancel());
  ipcMain.handle('spotify:status', () => spotify.status());
  ipcMain.handle('spotify:client', (_e, value) => spotify.saveClient(value));
  ipcMain.handle('spotify:start', () => spotify.start());
  ipcMain.handle('spotify:cancel', () => spotify.cancel());
  ipcMain.handle('spotify:disconnect', () => spotify.disconnect());
  ipcMain.handle('spotify:browse', (_e, input) => spotify.browse(input));
  ipcMain.handle('spotify:devices', () => spotify.devices());
  ipcMain.handle('spotify:playback', () => spotify.playback());
  ipcMain.handle('spotify:control', (_e,input)=>spotify.control(input));
  ipcMain.handle('spotify:command', (_e, input) => spotify.command(input));
  ipcMain.handle('spotify:stream-token', (event) => {
    if(event.senderFrame?.url !== 'pp://app/index.html')throw new Error('Недопустимый источник запроса.');
    return spotify.streamToken();
  });
  ipcMain.handle('spotify:play', (_e, input) => spotify.playWithRecovery(input));
  ipcMain.handle('artist:profile', (_event, name, force) => profiles.get(name, { force: !!force, online: store.get('settings', {})?.artistImages !== false, albums: [...new Set(library.getTracks().filter((t) => splitArtistCredit(t.artists?.length ? t.artists : t.artist).some((n) => artistKey(n) === artistKey(name))).map((t) => t.album).filter(Boolean))].slice(0, 8) }));
  ipcMain.handle('ai:config', () => agent.config());
  ipcMain.handle('ai:save', (_event, input) => agent.save(input || {}));
  ipcMain.handle('ai:generate', (_event, input = {}) => {
    const ids = new Set(Array.isArray(input.ids) ? input.ids.slice(0, 10000) : []);
    const tracks = library.getTracks().filter((t) => !ids.size || ids.has(t.id));
    return agent.generate({ prompt: input.prompt, limit: input.limit, tracks });
  });
  ipcMain.handle('wallpaper:get', () => wallpaper.get(store.get('settings', {})?.wallpaperEnginePath));
  ipcMain.handle('wallpaper:pick', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { title: 'Папка установки Wallpaper Engine', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
}
module.exports = { registerFeatures };
