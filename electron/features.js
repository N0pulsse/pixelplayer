'use strict';
const path = require('node:path');
const { ArtistProfiles } = require('./artists');
const { PlaylistAgent } = require('./ai');
const { WallpaperPalette } = require('./wallpaper');
const { GenreLookup, GenreEnricher } = require('./genres');
const { artistKey, splitArtistCredit } = require('./identity');
function registerFeatures({ app, ipcMain, dialog, getWindow, store, library, net, nativeImage, safeStorage }) {
  const fetch = (url, opts = {}) => net.fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(10000) });
  const profiles = new ArtistProfiles({ dir: path.join(app.getPath('userData'), 'artists'), fetch, nativeImage });
  const agent = new PlaylistAgent({ store, dir: app.getPath('userData'), fetch, safeStorage });
  const genres=new GenreEnricher({library,lookup:new GenreLookup({dir:app.getPath('userData'),fetch}),enabled:()=>store.get('settings',{})?.onlineGenres!==false});
  genres.on('status',status=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('genres:status',status);});
  genres.on('result',result=>{const w=getWindow();if(w&&!w.isDestroyed())w.webContents.send('genres:result',result);});
  ipcMain.handle('genres:priority',(_e,id)=>{genres.prioritize(library.cache.get(id)||library.adhoc.get(id));});
  library.on('diff',d=>genres.enqueue([...(d.added||[]),...(d.updated||[])]));
  library.on('done',()=>genres.enqueue(library.getTracks()));
  ipcMain.handle('genres:status',()=>genres.status());
  ipcMain.handle('genres:scan',()=>{genres.enqueue(library.getTracks());return genres.status();});
  app.on('before-quit',()=>genres.close());
  ipcMain.on('store:set',(_e,k)=>{if(k==='settings')queueMicrotask(()=>{if(store.get('settings',{})?.onlineGenres===false)genres.stop();else genres.enqueue(library.getTracks());});});
  const wallpaper = new WallpaperPalette({ nativeImage });
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
