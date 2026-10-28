import { createStore, useStore } from '../lib/store';
import { shuffled, debounce, clamp, uid } from '../lib/util';
import { Engine } from './engine';
import { settings, setSetting, EQ_PRESETS, normalizeBands } from './settings';
import { recordPlay } from './userdata';
import { getIndex, adhoc, libStore } from './library';
import { toast } from './ui';
import { api } from '../api';

export const engine = new Engine();
const audioSettings = settings.get();
export const player = createStore({
  queue: [], index: -1, playing: false, buffering: false,
  shuffle: false, repeat: 'off',
  volume: audioSettings.volume, muted: audioSettings.muted,
  playbackRate: audioSettings.playbackRate,
  eqEnabled: audioSettings.eqEnabled, eqPreset: audioSettings.eqPreset, eqBands: audioSettings.eqBands,
  eqAvailable: engine.effectsSupported,
  duration: 0, source: null, origQueue: null,
  sleepAt: null, sleepEnd: false, fading: false,
});

function applyAudioSettings() {
  const s = settings.get();
  engine.setVolume(s.volume);
  engine.setMuted(s.muted);
  engine.setPlaybackRate(s.playbackRate);
  const effectsOk = engine.setEqualizer(s.eqEnabled, s.eqBands);
  player.set({ volume: engine.master, muted: s.muted, playbackRate: engine.rate, eqEnabled: effectsOk && s.eqEnabled, eqPreset: s.eqPreset, eqBands: s.eqBands });
}
applyAudioSettings();
settings.subscribe(applyAudioSettings);

export const currentTrack = () => { const s = player.get(); return s.queue[s.index] || null; };
export const useCurrent = () => useStore(player, (s) => s.queue[s.index] || null);
export const usePlayer = (sel) => useStore(player, sel);
const audioUrl = (t) => api.url.audio(t.id);
// Each queue occurrence has its own identity, including repeated copies of a song.
const queueTracks = (tracks) => (Array.isArray(tracks) ? tracks : []).filter((t) => t && t.id).map((t) => ({ ...t, _queueKey: uid() }));

let listened = 0;
let counted = false;
let lastTick = performance.now();
let errorStreak = 0;
let prefetchedFor = null;
let playVersion = 0;
let errorVersion = -1;
let errorTimer = null;
let sleepTimer = null;
let pendingStart = 0;

function resetListening() { listened = 0; counted = false; lastTick = performance.now(); prefetchedFor = null; }
function invalidatePreload() { prefetchedFor = null; engine.clearPreload(); }
function cancelPendingError() { clearTimeout(errorTimer); errorTimer = null; }

async function startCurrent({ autoplay = true, startAt = 0 } = {}) {
  const t = currentTrack();
  if (!t) return;
  const version = ++playVersion;
  cancelPendingError();
  pendingStart = Math.max(0, Number(startAt) || 0);
  resetListening();
  player.set({ duration: t.duration || 0, playing: false, buffering: true, fading: false });
  onTrackChanged(t);
  try {
    await engine.load(audioUrl(t), { autoplay, startAt: pendingStart });
    if (version !== playVersion) return;
    if (engine.el.readyState >= 1) pendingStart = 0;
    if (!autoplay) player.set({ buffering: false });
  } catch (e) {
    if (version !== playVersion || e?.name === 'AbortError') return;
    handleError(t, version);
  }
}

function handleError(t, version = playVersion) {
  if (version !== playVersion || errorVersion === version || !t) return;
  errorVersion = version;
  errorStreak += 1;
  engine.pause();
  const { queue, repeat } = player.get();
  player.set({ playing: false, buffering: false, fading: false });
  toast(`Не удалось воспроизвести «${t.title || 'трек'}»`, { icon: 'error' });
  if (errorStreak >= Math.min(queue.length, 5) || repeat === 'one') return;
  cancelPendingError();
  errorTimer = setTimeout(() => { if (version === playVersion) next({ auto: true }); }, 400);
}

function onTrackChanged(t) {
  if (settings.get().onlineLyrics !== false) import('./lyrics').then((m) => m.loadLyrics(t)).catch(() => {});
  updateMediaSession(t);
  api.win.setTitle(`${t.artist ? `${t.artist} — ` : ''}${t.title} · Pixel Player`);
  saveSession();
}

export async function playTracks(tracks, start = 0, source = null, { shuffle = false } = {}) {
  let queue = queueTracks(tracks);
  if (!queue.length) return;
  const s = player.get();
  const shuf = shuffle || s.shuffle;
  let orig = null;
  let index = clamp(Math.trunc(Number(start) || 0), 0, queue.length - 1);
  if (shuf) {
    orig = queue.slice();
    const first = shuffle && start === 0 ? null : queue[index];
    const rest = queue.filter((_, i) => !first || i !== index);
    queue = first ? [first, ...shuffled(rest)] : shuffled(rest);
    index = 0;
  }
  player.set({ queue, index, origQueue: orig, shuffle: shuf, source });
  errorStreak = 0;
  await startCurrent();
}
export const playShuffled = (tracks, source) => playTracks(tracks, 0, source, { shuffle: true });

export async function playIndex(i) {
  const { queue } = player.get();
  if (!Number.isInteger(i) || i < 0 || i >= queue.length) return;
  player.set({ index: i });
  errorStreak = 0;
  await startCurrent();
}

export function toggle() {
  const t = currentTrack();
  if (!t) return;
  if (engine.paused && !engine.playIntent) {
    cancelPendingError();
    errorVersion = -1;
    if (pendingStart > 0) { engine.seek(pendingStart); pendingStart = 0; }
    const version = playVersion;
    lastTick = performance.now();
    engine.play().catch((e) => { if (e?.name !== 'AbortError') handleError(t, version); });
  } else pause();
}
export const play = () => { if (engine.paused && !engine.playIntent) toggle(); };
export const pause = () => { engine.pause(); player.set({ playing: false, buffering: false }); };
export function seek(sec) {
  engine.seek(sec);
  pendingStart = 0;
  lastTick = performance.now();
  syncPositionState();
  saveSession();
}
export const seekBy = (d) => seek(engine.position() + d);

function nextIndex(auto) {
  const { queue, index, repeat } = player.get();
  if (!queue.length) return -1;
  if (index + 1 < queue.length) return index + 1;
  if (repeat === 'all') return 0;
  return auto ? -1 : 0;
}

export async function next({ auto = false } = {}) {
  const s = player.get();
  if (!s.queue.length) return;
  // The sleep timer wins over repeat-one and repeat-all.
  if (auto && s.sleepEnd) {
    player.set({ sleepEnd: false, playing: false }); engine.pause(); seek(0); return;
  }
  if (auto && s.repeat === 'one') {
    ++playVersion; cancelPendingError(); resetListening(); seek(0);
    const version = playVersion;
    engine.play().catch((e) => { if (e?.name !== 'AbortError') handleError(currentTrack(), version); });
    return;
  }
  const ni = nextIndex(auto);
  if (ni < 0) {
    engine.pause();
    player.set({ index: 0, playing: false });
    await startCurrent({ autoplay: false });
    return;
  }
  player.set({ index: ni });
  await startCurrent();
}

export async function prev() {
  const s = player.get();
  if (!s.queue.length) return;
  if (engine.position() > 3 || s.index <= 0) {
    if (s.index <= 0 && engine.position() <= 3 && s.repeat === 'all') { player.set({ index: s.queue.length - 1 }); await startCurrent(); return; }
    seek(0); return;
  }
  player.set({ index: s.index - 1 });
  await startCurrent();
}

export function playNext(tracks) {
  const added = queueTracks(tracks);
  if (!added.length) return;
  const s = player.get();
  if (!s.queue.length) { playTracks(tracks, 0, { label: 'Очередь' }); return; }
  const queue = s.queue.slice();
  queue.splice(s.index + 1, 0, ...added);
  let orig = s.origQueue;
  if (orig) {
    orig = orig.slice();
    const oi = orig.findIndex((t) => t._queueKey === currentTrack()?._queueKey);
    orig.splice(oi + 1, 0, ...added);
  }
  player.set({ queue, origQueue: orig });
  toast(added.length === 1 ? `«${added[0].title}» сыграет следующим` : `${added.length} треков сыграют следующими`, { icon: 'queue_play_next' });
  invalidatePreload(); saveSession();
}
export function enqueue(tracks) {
  const added = queueTracks(tracks);
  if (!added.length) return;
  const s = player.get();
  if (!s.queue.length) { playTracks(tracks, 0, { label: 'Очередь' }); return; }
  player.set({ queue: [...s.queue, ...added], origQueue: s.origQueue ? [...s.origQueue, ...added] : null });
  toast(added.length === 1 ? `«${added[0].title}» добавлен в очередь` : `Добавлено в очередь: ${added.length}`, { icon: 'playlist_add_check' });
  invalidatePreload(); saveSession();
}
export function removeFromQueue(i) {
  const s = player.get();
  if (!Number.isInteger(i) || i < 0 || i >= s.queue.length) return;
  const removed = s.queue[i];
  const queue = s.queue.filter((_, at) => at !== i);
  const orig = s.origQueue ? s.origQueue.filter((t) => t._queueKey !== removed._queueKey) : null;
  if (!queue.length) { clearAll(); return; }
  const wasPlaying = !engine.paused;
  if (i === s.index) {
    player.set({ queue, origQueue: orig, index: Math.min(i, queue.length - 1) });
    startCurrent({ autoplay: wasPlaying });
  } else {
    player.set({ queue, origQueue: orig, index: i < s.index ? s.index - 1 : s.index });
    invalidatePreload();
  }
  saveSession();
}
export function moveInQueue(from, to) {
  const s = player.get();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return;
  const queue = s.queue.slice();
  const currentKey = currentTrack()?._queueKey;
  const [track] = queue.splice(from, 1);
  queue.splice(to, 0, track);
  player.set({ queue, index: queue.findIndex((t) => t._queueKey === currentKey) });
  invalidatePreload(); saveSession();
}
export function clearQueue() {
  const s = player.get();
  const cur = currentTrack();
  if (!cur) return;
  player.set({ queue: [cur], index: 0, origQueue: s.origQueue ? [cur] : null });
  invalidatePreload(); saveSession();
}
function clearAll() {
  ++playVersion; cancelPendingError(); pendingStart = 0;
  engine.stop();
  resetListening();
  player.set({ queue: [], index: -1, playing: false, buffering: false, fading: false, origQueue: null, duration: 0, source: null });
  if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
  api.win.setTitle('Pixel Player');
  saveSession();
}
export function toggleShuffle() {
  const s = player.get();
  const cur = currentTrack();
  if (!s.shuffle) {
    if (!cur) { player.set({ shuffle: true }); return; }
    const rest = s.queue.filter((_, i) => i !== s.index);
    player.set({ shuffle: true, origQueue: s.queue.slice(), queue: [cur, ...shuffled(rest)], index: 0 });
  } else {
    const orig = s.origQueue || s.queue;
    const index = cur ? Math.max(0, orig.findIndex((t) => t._queueKey === cur._queueKey)) : -1;
    player.set({ shuffle: false, queue: orig, origQueue: null, index });
  }
  invalidatePreload(); saveSession();
}
export function cycleRepeat() {
  const r = player.get().repeat;
  player.set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
  invalidatePreload(); saveSession();
}

export function setVolume(v) { setSetting({ volume: v, muted: false }); }
export function toggleMute() { setSetting({ muted: !player.get().muted }); }
export function setPlaybackRate(value) { setSetting({ playbackRate: value }); syncPositionState(); }
export function setEqualizer(presetOrBands) {
  if (typeof presetOrBands === 'string') {
    const preset = EQ_PRESETS[presetOrBands];
    if (!preset) return;
    setSetting({ eqPreset: presetOrBands, eqBands: preset.bands.slice(), eqEnabled: true });
  } else if (Array.isArray(presetOrBands)) {
    setSetting({ eqPreset: 'custom', eqBands: normalizeBands(presetOrBands), eqEnabled: true });
  }
  if (!engine.eqEnabled) toast('Эквалайзер недоступен на этом устройстве', { icon: 'info' });
}
export function setEqualizerEnabled(enabled) {
  setSetting({ eqEnabled: !!enabled });
  if (enabled && !engine.eqEnabled) toast('Эквалайзер недоступен на этом устройстве', { icon: 'info' });
}

export function setSleep({ minutes = 0, endOfTrack = false } = {}) {
  clearTimeout(sleepTimer); sleepTimer = null;
  if (endOfTrack) {
    player.set({ sleepEnd: true, sleepAt: null });
    toast('Остановлю после этого трека', { icon: 'bedtime' });
  } else if (Number.isFinite(Number(minutes)) && Number(minutes) > 0) {
    const duration = clamp(Number(minutes), 0.1, 1440) * 60000;
    player.set({ sleepAt: Date.now() + duration, sleepEnd: false });
    sleepTimer = setTimeout(expireSleep, duration);
    toast(`Таймер сна: ${minutes} мин`, { icon: 'bedtime' });
  } else player.set({ sleepAt: null, sleepEnd: false });
}
function expireSleep() {
  clearTimeout(sleepTimer); sleepTimer = null;
  player.set({ sleepAt: null, sleepEnd: false });
  engine.pause();
  toast('Таймер сна: воспроизведение остановлено', { icon: 'bedtime' });
}

engine.on('playing', () => { lastTick = performance.now(); player.set({ playing: true, buffering: false }); syncPositionState(); });
engine.on('pause', () => {
  engine.stopTimer();
  player.set({ playing: false, buffering: false });
  syncPositionState(); saveSessionNow();
});
engine.on('waiting', () => player.set({ buffering: true }));
engine.on('canplay', () => player.set({ buffering: false }));
engine.on('durationchange', () => { const d = engine.duration(); if (d) player.set({ duration: d }); });
engine.on('loadedmetadata', () => {
  const d = engine.duration(); if (d) player.set({ duration: d });
  // Engine applies its pending seek during this same metadata event.
  queueMicrotask(() => { if (engine.el.readyState >= 1) pendingStart = 0; syncPositionState(); });
});
engine.on('ended', () => next({ auto: true }));
engine.on('error', () => handleError(currentTrack()));
engine.on('fadeend', () => player.set({ fading: false }));
engine.on('seeked', syncPositionState);

let lastSessionSave = 0;
engine.on('tick', () => {
  const s = player.get();
  const now = performance.now();
  const dt = clamp(now - lastTick, 0, 1000);
  lastTick = now;
  if (!engine.paused && !s.buffering) {
    listened += dt;
    if (listened > 3000) errorStreak = 0;
    const t = currentTrack();
    if (t && !counted && listened >= Math.min(30000, ((t.duration || 60) * 1000) / 2)) { counted = true; recordPlay(t); }
  }
  if (s.sleepAt && Date.now() >= s.sleepAt) { expireSleep(); return; }
  const dur = engine.duration();
  if (!dur || engine.paused || s.buffering) return;
  const remaining = (dur - engine.position()) / engine.rate;
  const currentKey = currentTrack()?._queueKey;
  if (remaining < 20 && prefetchedFor !== currentKey && !engine.fade) {
    prefetchedFor = currentKey;
    const ni = s.repeat === 'one' || s.sleepEnd ? -1 : nextIndex(true);
    if (ni >= 0) engine.preload(audioUrl(s.queue[ni]));
  }
  const xf = settings.get().crossfade;
  if (xf > 0 && !engine.fade && s.repeat !== 'one' && !s.sleepEnd && dur / engine.rate > xf * 2.5 && remaining <= xf && remaining > 0.2) {
    const ni = nextIndex(true);
    if (ni >= 0) {
      const version = ++playVersion;
      cancelPendingError(); pendingStart = 0; resetListening();
      const t = s.queue[ni];
      player.set({ index: ni, fading: true, duration: t.duration || 0 });
      onTrackChanged(t);
      engine.crossfadeTo(audioUrl(t), Math.min(xf, remaining)).catch((e) => { if (e?.name !== 'AbortError') handleError(t, version); });
    }
  }
  if (now - lastSessionSave >= 5000) { lastSessionSave = now; saveSession(); syncPositionState(); }
});

function updateMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  try {
    const art = t.cover ? [{ src: new URL(api.url.cover(t.cover), location.href).href, sizes: '512x512' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: art });
  } catch { /* Media metadata is optional. */ }
}
function syncPositionState() {
  if (!('mediaSession' in navigator)) return;
  try {
    const duration = engine.duration();
    if (duration) navigator.mediaSession.setPositionState({ duration, position: clamp(getPosition(), 0, duration), playbackRate: engine.rate });
    navigator.mediaSession.playbackState = engine.paused ? 'paused' : 'playing';
  } catch { /* Some media backends do not implement position state. */ }
}
if ('mediaSession' in navigator) {
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* Optional action. */ } };
  set('play', play); set('pause', pause); set('previoustrack', prev); set('nexttrack', next);
  set('seekbackward', (d) => seekBy(-(d.seekOffset || 10)));
  set('seekforward', (d) => seekBy(d.seekOffset || 10));
  set('seekto', (d) => seek(d.seekTime || 0)); set('stop', pause);
}
api.onCommand((c) => { if (c === 'playpause') toggle(); else if (c === 'next') next(); else if (c === 'prev') prev(); });
api.onOpenFiles((tracks) => {
  if (!tracks?.length) return;
  for (const t of tracks) adhoc.set(t.id, t);
  playTracks(tracks, 0, { label: 'Открытые файлы' });
});

function saveSessionNow() {
  const s = player.get();
  if (!s.queue.length) { api.store.set('session', null); return; }
  const indexed = new Set(libStore.get().tracks.map((t) => t.id));
  const external = [...new Map(s.queue.filter((t) => !indexed.has(t.id) && t.path).map((t) => [t.id, { id: t.id, path: t.path }])).values()];
  api.store.set('session', {
    ids: s.queue.map((t) => t.id), keys: s.queue.map((t) => t._queueKey), index: s.index, pos: getPosition(),
    shuffle: s.shuffle, repeat: s.repeat,
    orig: s.origQueue ? s.origQueue.map((t) => t._queueKey) : null,
    source: s.source, external,
  });
}
const saveSession = debounce(saveSessionNow, 1200);
window.addEventListener('beforeunload', () => saveSession.flush());

export async function restoreSession() {
  if (!settings.get().resume || player.get().queue.length) return;
  let sess;
  try { sess = await api.store.get('session'); } catch { return; }
  if (!sess || !Array.isArray(sess.ids) || !sess.ids.length) return;
  // Re-register externally opened files with the backend; stale paths are omitted.
  if (Array.isArray(sess.external) && sess.external.length) {
    try {
      const tracks = await api.library.parseFiles(sess.external.map((t) => t?.path).filter((p) => typeof p === 'string'));
      for (const t of tracks || []) adhoc.set(t.id, t);
    } catch { /* Missing removable drives must not prevent startup. */ }
  }
  // A file may have been opened while the saved session was being read.
  if (player.get().queue.length) return;
  const allTracks = new Map(libStore.get().tracks.map((t) => [t.id, t]));
  const find = (id) => allTracks.get(id) || getIndex().byId.get(id) || adhoc.get(id);
  const entries = sess.ids.map((id, savedIndex) => ({ track: find(id), savedIndex })).filter((e) => e.track);
  const queue = entries.map(({ track, savedIndex }) => ({ ...track, _queueKey: typeof sess.keys?.[savedIndex] === 'string' ? sess.keys[savedIndex] : uid() }));
  if (!queue.length) return;
  let index = entries.findIndex((e) => e.savedIndex === sess.index);
  if (index < 0) index = 0;
  let origQueue = null;
  if (Array.isArray(sess.orig)) {
    if (Array.isArray(sess.keys)) {
      const byKey = new Map(queue.map((t) => [t._queueKey, t]));
      origQueue = sess.orig.map((key) => byKey.get(key)).filter(Boolean);
    } else {
      // Backward compatibility with sessions that stored track IDs for shuffle.
      const available = queue.slice();
      origQueue = sess.orig.map((id) => { const at = available.findIndex((t) => t.id === id); return at < 0 ? null : available.splice(at, 1)[0]; }).filter(Boolean);
    }
    const included = new Set(origQueue.map((t) => t._queueKey));
    origQueue.push(...queue.filter((t) => !included.has(t._queueKey)));
  }
  player.set({ queue, index, shuffle: !!sess.shuffle, repeat: ['off', 'all', 'one'].includes(sess.repeat) ? sess.repeat : 'off', origQueue, source: sess.source || null });
  await startCurrent({ autoplay: false, startAt: Math.max(0, Number(sess.pos) || 0) });
}
export const getPosition = () => pendingStart > 0 && engine.paused && engine.position() < 0.5 ? pendingStart : engine.position();
