import { createStore } from '../lib/store';
import { debounce, uid } from '../lib/util';
import { api } from '../api';

/** Всё, что создаёт пользователь: избранное, плейлисты, статистика прослушиваний. */
export const user = createStore({
  loaded: false,
  favorites: {},     // id → время добавления
  playlists: [],     // {id, name, trackIds[], created}
  plays: {},         // id → {n, last}
  history: [],       // [{id, ts}] — последние прослушанные (новые в начале)
  recentSearches: [],
});

const persistNow = () => {
  const { favorites, playlists, plays, history, recentSearches } = user.get();
  api.store.set('user', { favorites, playlists, plays, history, recentSearches });
};
const persist = debounce(persistNow, 600);
window.addEventListener('beforeunload', persistNow);

export async function loadUser() {
  try {
    const d = await api.store.get('user');
    if (d) user.set({ ...d });
  } catch { /* */ }
  user.set({ loaded: true });
  user.subscribe(persist);
}

export const isFavorite = (id) => !!user.get().favorites[id];

function retainTracks(ids) {
  api.library.retainFiles(ids).catch((e) => console.error('Не удалось сохранить внешние треки', e));
}

export function toggleFavorite(id) {
  const f = { ...user.get().favorites };
  if (f[id]) delete f[id]; else { f[id] = Date.now(); retainTracks([id]); }
  user.set({ favorites: f });
  return !!f[id];
}

export function setFavorites(ids, on) {
  if (on) retainTracks(ids);
  const f = { ...user.get().favorites };
  for (const id of ids) { if (on) f[id] = f[id] || Date.now(); else delete f[id]; }
  user.set({ favorites: f });
}

export function recordPlay(track) {
  const { plays, history } = user.get();
  const p = plays[track.id] || { n: 0, last: 0 };
  user.set({
    plays: { ...plays, [track.id]: { n: p.n + 1, last: Date.now() } },
    history: [{ id: track.id, ts: Date.now() }, ...history].slice(0, 300),
  });
}

export function createPlaylist(name, trackIds = []) {
  retainTracks(trackIds);
  const pl = { id: uid(), name: name.trim() || 'Новый плейлист', trackIds: [...new Set(trackIds)], created: Date.now() };
  user.set({ playlists: [...user.get().playlists, pl] });
  return pl;
}
export function renamePlaylist(id, name) {
  user.set({ playlists: user.get().playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)) });
}
export function deletePlaylist(id) {
  user.set({ playlists: user.get().playlists.filter((p) => p.id !== id) });
}
export function addToPlaylist(id, trackIds) {
  retainTracks(trackIds);
  user.set({
    playlists: user.get().playlists.map((p) => (p.id === id
      ? { ...p, trackIds: [...p.trackIds, ...trackIds.filter((t) => !p.trackIds.includes(t))] }
      : p)),
  });
}
export function removeFromPlaylist(id, trackId) {
  user.set({ playlists: user.get().playlists.map((p) => (p.id === id ? { ...p, trackIds: p.trackIds.filter((t) => t !== trackId) } : p)) });
}
export function movePlaylistTrack(id, from, to) {
  user.set({
    playlists: user.get().playlists.map((p) => {
      if (p.id !== id) return p;
      const a = p.trackIds.slice();
      const [x] = a.splice(from, 1);
      a.splice(to, 0, x);
      return { ...p, trackIds: a };
    }),
  });
}

export function addRecentSearch(q) {
  q = q.trim();
  if (!q) return;
  user.set({ recentSearches: [q, ...user.get().recentSearches.filter((x) => x !== q)].slice(0, 8) });
}
export function clearRecentSearches() { user.set({ recentSearches: [] }); }
