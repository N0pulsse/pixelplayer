import { useMemo } from 'react';
import { createStore, useStore } from '../lib/store';
import { cmp, hashStr, folderName } from '../lib/util';
import { norm, queryVariants, scoreText } from '../lib/search';
import { settings } from './settings';
import { api } from '../api';
import { toast } from './ui';
import { albumIdentity, splitArtistCredit } from '../../electron/identity';

export const libStore = createStore({
  ready: false, tracks: [], folders: [], scanning: false, progress: null, firstRun: false, lastDone: null,
});

const map = new Map();
let flushTimer = null;
let pendingFlush = false;

function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  pendingFlush = false;
  libStore.set({ tracks: [...map.values()] });
}
function scheduleFlush(delay = 250) {
  if (pendingFlush) return;
  pendingFlush = true;
  flushTimer = setTimeout(flush, delay);
}

function applyDiff(d) {
  for (const t of d.added || []) map.set(t.id, t);
  for (const t of d.updated || []) map.set(t.id, t);
  for (const id of d.removed || []) map.delete(id);
  scheduleFlush(libStore.get().scanning ? 400 : 60);
}

export async function initLibrary() {
  const buffer = []; let live = false;
  api.library.onDiff((d) => (live ? applyDiff(d) : buffer.push(d)));
  api.library.onProgress((p) => libStore.set({ scanning: true, progress: p }));
  api.library.onDone((d) => { libStore.set({ scanning: false, progress: null, lastDone: d }); flush(); });
  api.library.onFolders((f) => libStore.set({ folders: f }));
  api.library.onSuggest((list) => {
    const f = list[0];
    if (!f) return;
    toast(`Найдена новая папка с музыкой: ${f.path}`, {
      icon: 'library_music', ms: 12000,
      action: { label: 'Добавить', onClick: () => api.library.addFolders([f.path]) },
    });
    api.library.dismiss(f.path); // не предлагать повторно
  });

  const snap = await api.library.get();
  for (const t of snap.tracks) map.set(t.id, t);
  live = true;
  buffer.forEach(applyDiff);
  libStore.set({
    ready: true, tracks: [...map.values()], folders: snap.folders,
    scanning: snap.scanning, progress: snap.progress, firstRun: snap.firstRun,
  });
}

/** Треки, открытые «снаружи» (двойной клик по файлу, drag&drop) — в индекс не входят, но их можно играть. */
export const adhoc = new Map();

/* ───────────── индекс: альбомы, исполнители, жанры, папки ───────────── */

const VARIOUS = 'Разные исполнители';

export function buildIndex(tracks, minDuration) {
  const list = [];
  const byId = new Map();
  for (const t of tracks) {
    if (t.duration && t.duration < minDuration) continue;
    list.push(t);
    byId.set(t.id, t);
  }

  // Альбомы
  const groups = new Map();
  for (const t of list) {
    if (!t.album) continue;
    const key = albumIdentity(t).key;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(t);
  }
  const albums = [];
  const albumOfTrack = new Map();
  const pushAlbum = (title, albumArtist, ts, keySeed) => {
    ts.sort((a, b) => (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0) || cmp(a.title, b.title));
    const artistSet = new Set(ts.map((t) => t.artist || ''));
    const artist = albumArtist || (artistSet.size === 1 ? (ts[0].artist || '') : VARIOUS);
    const id = 'al' + hashStr(keySeed).toString(36);
    const al = {
      id, title, artist, various: artist === VARIOUS || (!albumArtist && artistSet.size > 1),
      year: ts.map((t) => t.year).filter(Boolean).sort()[0] || null,
      cover: (ts.find((t) => t.cover) || {}).cover || null,
      trackIds: ts.map((t) => t.id),
      duration: ts.reduce((s, t) => s + (t.duration || 0), 0),
      added: Math.max(...ts.map((t) => t.added || 0)),
      discs: new Set(ts.map((t) => t.disc || 1)).size,
    };
    albums.push(al);
    for (const t of ts) albumOfTrack.set(t.id, al.id);
  };
  for (const [key, ts] of groups) {
    const title = ts[0].album;
    pushAlbum(title, albumIdentity(ts[0]).primary, ts, key);
  }
  const albumById = new Map(albums.map((a) => [a.id, a]));

  // Исполнители
  const artistsMap = new Map();
  const touchArtist = (name) => {
    const k = norm(name);
    if (!k) return null;
    let a = artistsMap.get(k);
    if (!a) {
      a = { id: 'ar' + hashStr(k).toString(36), name, trackIds: [], albumIds: new Set(), appearanceAlbumIds: new Set(), cover: null, duration: 0 };
      artistsMap.set(k, a);
    }
    return a;
  };
  for (const t of list) {
    const names = splitArtistCredit(t.artists && t.artists.length ? t.artists : t.artist);
    for (const n of names) {
      const a = touchArtist(n);
      if (!a) continue;
      a.trackIds.push(t.id);
      a.duration += t.duration || 0;
      if (!a.cover && t.cover) a.cover = t.cover;
      const alId = albumOfTrack.get(t.id);
      if (alId) {
        if (splitArtistCredit(albumById.get(alId)?.artist).some((name) => norm(name) === norm(a.name))) a.albumIds.add(alId);
        else a.appearanceAlbumIds.add(alId);
      }
    }
  }
  for (const al of albums) {
    if (al.various || !al.artist || al.artist === VARIOUS) continue;
    for (const name of splitArtistCredit(al.artist)) {
      const a = touchArtist(name);
      if (a) {
        a.albumIds.add(al.id); if (!a.cover && al.cover) a.cover = al.cover;
        for (const id of al.trackIds) if (!a.trackIds.includes(id)) { a.trackIds.push(id); a.duration += byId.get(id)?.duration || 0; }
      }
    }
  }
  const artists = [...artistsMap.values()].map((a) => ({ ...a, albumIds: [...a.albumIds], appearanceAlbumIds: [...a.appearanceAlbumIds] }));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  const artistByName = new Map(artists.map((a) => [norm(a.name), a]));

  // Жанры
  const genresMap = new Map();
  for (const t of list) {
    if (!t.genre) continue;
    const k = norm(t.genre);
    if (!k) continue;
    let g = genresMap.get(k);
    if (!g) genresMap.set(k, (g = { id: 'ge' + hashStr(k).toString(36), name: t.genre, trackIds: [], cover: null }));
    g.trackIds.push(t.id);
    if (!g.cover && t.cover) g.cover = t.cover;
  }
  const genres = [...genresMap.values()];
  const genreById = new Map(genres.map((g) => [g.id, g]));

  // Папки
  const foldersMap = new Map();
  for (const t of list) {
    let f = foldersMap.get(t.folder);
    if (!f) foldersMap.set(t.folder, (f = { id: 'fo' + hashStr(t.folder).toString(36), path: t.folder, name: folderName(t.folder), trackIds: [], cover: null }));
    f.trackIds.push(t.id);
    if (!f.cover && t.cover) f.cover = t.cover;
  }
  const folders = [...foldersMap.values()];
  const folderById = new Map(folders.map((f) => [f.id, f]));

  const idx = {
    tracks: list, byId, albums, albumById, albumOfTrack, artists, artistById, artistByName,
    genres, genreById, folders, folderById, search: null,
  };
  return idx;
}

let memo = { tracks: null, min: null, idx: null };
export function getIndex() {
  const tracks = libStore.get().tracks;
  const min = settings.get().minDuration;
  if (memo.tracks !== tracks || memo.min !== min) memo = { tracks, min, idx: buildIndex(tracks, min) };
  return memo.idx;
}

export function useIndex() {
  const tracks = useStore(libStore, (s) => s.tracks);
  const min = useStore(settings, (s) => s.minDuration);
  return useMemo(() => {
    if (memo.tracks !== tracks || memo.min !== min) memo = { tracks, min, idx: buildIndex(tracks, min) };
    return memo.idx;
  }, [tracks, min]);
}

export function trackById(id) {
  return getIndex().byId.get(id) || adhoc.get(id) || null;
}

/* ───────────── поиск ───────────── */

export function searchLibrary(idx, query, limit = { tracks: 60, albums: 24, artists: 18 }) {
  const variants = queryVariants(query);
  if (!variants.length) return { tracks: [], albums: [], artists: [], genres: [] };
  if (!idx.search) {
    idx.search = {
      tracks: idx.tracks.map((t) => ({ t, title: norm(t.title), artist: norm(t.artist || ''), album: norm(t.album || '') })),
      albums: idx.albums.map((a) => ({ a, title: norm(a.title), artist: norm(a.artist) })),
      artists: idx.artists.map((a) => ({ a, name: norm(a.name) })),
    };
  }
  const tracks = [];
  for (const r of idx.search.tracks) {
    const s = Math.max(scoreText(r.title, variants) * 1.2, scoreText(r.artist, variants), scoreText(r.album, variants) * 0.7,
      scoreText(`${r.artist} ${r.title}`, variants) * 0.9);
    if (s > 0) tracks.push([s, r.t]);
  }
  tracks.sort((a, b) => b[0] - a[0] || cmp(a[1].title, b[1].title));
  const albums = [];
  for (const r of idx.search.albums) {
    const s = Math.max(scoreText(r.title, variants) * 1.1, scoreText(r.artist, variants) * 0.8);
    if (s > 0) albums.push([s, r.a]);
  }
  albums.sort((a, b) => b[0] - a[0]);
  const artists = [];
  for (const r of idx.search.artists) {
    const s = scoreText(r.name, variants);
    if (s > 0) artists.push([s, r.a]);
  }
  artists.sort((a, b) => b[0] - a[0]);
  return {
    tracks: tracks.slice(0, limit.tracks).map((x) => x[1]),
    totalTracks: tracks.length,
    albums: albums.slice(0, limit.albums).map((x) => x[1]),
    artists: artists.slice(0, limit.artists).map((x) => x[1]),
  };
}

/* ───────────── сортировка ───────────── */

export const SONG_SORTS = {
  title: { label: 'По названию', fn: (a, b) => cmp(a.title, b.title) },
  artist: { label: 'По исполнителю', fn: (a, b) => cmp(a.artist, b.artist) || cmp(a.album, b.album) || (a.track || 0) - (b.track || 0) },
  album: { label: 'По альбому', fn: (a, b) => cmp(a.album, b.album) || (a.disc || 1) - (b.disc || 1) || (a.track || 0) - (b.track || 0) },
  added: { label: 'Сначала новые', fn: (a, b) => (b.added || 0) - (a.added || 0) },
  duration: { label: 'По длительности', fn: (a, b) => (b.duration || 0) - (a.duration || 0) },
  year: { label: 'По году', fn: (a, b) => (b.year || 0) - (a.year || 0) },
};
export const ALBUM_SORTS = {
  title: { label: 'По названию', fn: (a, b) => cmp(a.title, b.title) },
  artist: { label: 'По исполнителю', fn: (a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title) },
  year: { label: 'По году', fn: (a, b) => (b.year || 0) - (a.year || 0) },
  added: { label: 'Сначала новые', fn: (a, b) => (b.added || 0) - (a.added || 0) },
};
export const ARTIST_SORTS = {
  name: { label: 'По имени', fn: (a, b) => cmp(a.name, b.name) },
  count: { label: 'По числу песен', fn: (a, b) => b.trackIds.length - a.trackIds.length },
};
