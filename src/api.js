/**
 * Мост к main-процессу (см. electron/preload.js). Если приложение открыли просто в браузере без preload,
 * подставляем пустую заглушку, чтобы интерфейс не падал.
 */
const noop = () => {};
const stub = {
  online: { status:async()=>[],list:async()=>[],save:async()=>{throw new Error('Запустите настольную версию');},remove:async()=>[],open:async()=>{throw new Error('Запустите настольную версию');},external:async()=>{},close:async()=>[],disconnect:async()=>[],onStatus:()=>noop },
  platform: 'web',
  info: { version: 'web', userData: '' },
  url: { audio: (id) => `/audio/${id}`, cover: (key) => `/cover/${key}` },
  library: {
    get: async () => ({ tracks: [], folders: [], scanning: false, progress: null, firstRun: false }),
    rescan: async () => true, pick: async () => [], addFolders: async () => [], removeFolder: async () => [],
    toggleFolder: async () => [], detect: async () => [], dismiss: async () => true, parseFiles: async () => [],
    openFiles: async () => [], classifyPaths: async () => ({ files: [], folders: [] }), retainFiles: async () => [],
    onDiff: () => noop, onProgress: () => noop, onDone: () => noop, onFolders: () => noop, onSuggest: () => noop,
  },
  store: {
    get: async (k) => { try { return JSON.parse(localStorage.getItem('pp:' + k)); } catch { return null; } },
    getSync: (k) => { try { return JSON.parse(localStorage.getItem('pp:' + k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem('pp:' + k, JSON.stringify(v)); } catch { /* */ } },
  },
  playlists: { import: async () => null, export: async () => null },
  lyrics: { get: async () => null },
  artistImage: async () => null,
  artistProfile: async () => null,
  ai: { config: async () => ({}), save: async () => ({}), generate: async () => { throw new Error('Запустите настольную версию плеера'); } },
  wallpaper: { get: async () => ({ color: null, source: 'Требуется Windows' }), pick: async () => null },
  spotify: { status: async () => ({}), client: async () => ({}), start: async () => { throw new Error('Запустите настольную версию плеера'); }, cancel: async () => ({}), disconnect: async () => ({}), browse: async () => ({ items: [] }), devices: async () => [], playback: async () => null, streamToken: async () => { throw new Error("Нужна настольная версия"); }, play: async () => { throw new Error("Запустите настольную версию плеера"); }, command: async () => {}, control: async () => null, onStatus: () => noop },
  win: { minimize: noop, toggleMaximize: noop, close: noop, setOverlay: noop, setAlwaysOnTop: noop, setTitle: noop, isMaximized: async () => false, onMaximize: () => noop },
  shell: { showInFolder: noop, openExternal: noop, openUserData: noop },
  quit: noop,
  pathsForFiles: () => [],
  onCommand: () => noop,
  onOpenFiles: () => noop,
};

export const api = (typeof window !== 'undefined' && window.pp) || stub;
export const isElectron = api.platform !== 'web';
