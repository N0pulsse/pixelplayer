'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** Подписка на событие из main-процесса; возвращает функцию отписки. */
function on(channel, cb) {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const info = ipcRenderer.sendSync('app:getInfo');

contextBridge.exposeInMainWorld('pp', {
  platform: process.platform,
  info,

  url: {
    audio: (id) => `pp://app/audio/${id}`,
    cover: (key, thumb) => `pp://app/cover/${key}${thumb ? '?t=1' : ''}`,
  },

  library: {
    get: () => ipcRenderer.invoke('lib:get'),
    rescan: (deep) => ipcRenderer.invoke('lib:rescan', !!deep),
    pick: () => ipcRenderer.invoke('lib:pick'),
    addFolders: (paths) => ipcRenderer.invoke('lib:addFolders', paths),
    removeFolder: (p) => ipcRenderer.invoke('lib:removeFolder', p),
    toggleFolder: (p, enabled) => ipcRenderer.invoke('lib:toggleFolder', p, enabled),
    detect: () => ipcRenderer.invoke('lib:detect'),
    dismiss: (p) => ipcRenderer.invoke('lib:dismiss', p),
    parseFiles: (files) => ipcRenderer.invoke('lib:parseFiles', files),
    retainFiles: (ids) => ipcRenderer.invoke('lib:retainFiles', ids),
    openFiles: () => ipcRenderer.invoke('lib:openFiles'),
    classifyPaths: (paths) => ipcRenderer.invoke('lib:classifyPaths', paths),
    onDiff: (cb) => on('lib:diff', cb),
    onProgress: (cb) => on('lib:progress', cb),
    onDone: (cb) => on('lib:done', cb),
    onFolders: (cb) => on('lib:folders', cb),
    onSuggest: (cb) => on('lib:suggest', cb),
  },

  playlists: {
    import: () => ipcRenderer.invoke('playlists:import'),
    export: (playlist) => ipcRenderer.invoke('playlists:export', playlist),
  },

  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    getSync: (key) => ipcRenderer.sendSync('store:getSync', key),
    set: (key, value) => ipcRenderer.send('store:set', key, value),
  },

  lyrics: { get: (track, force) => ipcRenderer.invoke('lyrics:get', track, force) },
  artistProfile: (name, force) => ipcRenderer.invoke('artist:profile', name, force),
  ai: { config: () => ipcRenderer.invoke('ai:config'), save: (input) => ipcRenderer.invoke('ai:save', input), generate: (input) => ipcRenderer.invoke('ai:generate', input) },
  wallpaper: { get: () => ipcRenderer.invoke('wallpaper:get'), pick: () => ipcRenderer.invoke('wallpaper:pick') },
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    client: (value) => ipcRenderer.invoke('spotify:client', value),
    start: () => ipcRenderer.invoke('spotify:start'), cancel: () => ipcRenderer.invoke('spotify:cancel'),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    browse: (input) => ipcRenderer.invoke('spotify:browse', input),
    devices: () => ipcRenderer.invoke('spotify:devices'), playback: () => ipcRenderer.invoke('spotify:playback'),
    command: (input) => ipcRenderer.invoke('spotify:command', input),
    onStatus: (cb) => on('spotify:status', cb),
  },
  online: {
    status:()=>ipcRenderer.invoke('online:status'), list:()=>ipcRenderer.invoke('online:list'),
    save:(input)=>ipcRenderer.invoke('online:save',input), remove:(id)=>ipcRenderer.invoke('online:remove',id),
    open:(key,url)=>ipcRenderer.invoke('online:open',key,url), external:(key,url)=>ipcRenderer.invoke('online:external',key,url),
    close:(key)=>ipcRenderer.invoke('online:close',key), disconnect:(key)=>ipcRenderer.invoke('online:disconnect',key),
    onStatus:(cb)=>on('online:status',cb),
  },
  artistImage: (name) => ipcRenderer.invoke('artist:image', name),

  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggleMaximize'),
    close: () => ipcRenderer.send('win:close'),
    setOverlay: (o) => ipcRenderer.send('win:overlay', o),
    setAlwaysOnTop: (v) => ipcRenderer.send('win:alwaysOnTop', v),
    setTitle: (t) => ipcRenderer.send('win:title', t),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onMaximize: (cb) => on('win:maximized', cb),
  },

  shell: {
    showInFolder: (p) => ipcRenderer.send('shell:showInFolder', p),
    openExternal: (u) => ipcRenderer.send('shell:openExternal', u),
    openUserData: () => ipcRenderer.send('app:openUserData'),
  },
  quit: () => ipcRenderer.send('app:quit'),

  /** Пути перетащенных файлов (в новых Electron File.path убран). */
  pathsForFiles: (files) => Array.from(files || []).map((f) => webUtils.getPathForFile(f)).filter(Boolean),

  onCommand: (cb) => on('cmd', cb),
  onOpenFiles: (cb) => on('open-files', cb),
});
