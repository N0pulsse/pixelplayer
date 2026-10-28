import { api } from '../api';
import { createStore } from '../lib/store';
import { player, pause } from './player';
import { toast } from './ui';
import { remoteTransport } from './transport';
export const spotify = createStore({ status: {}, playback: null, devices: [], deviceId: '', active: false, busy: false, error: '' });
export const spotifyError = (e) => String(e?.message || 'Spotify недоступен').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
let refreshTask = null;
let statusGeneration = 0;
export async function refreshSpotify() {
  if (!spotify.get().status.connected) return;
  if (refreshTask) return refreshTask;
  const generation = statusGeneration;
  refreshTask = (async () => {
    try { const playback = await api.spotify.playback(); if (generation === statusGeneration) spotify.set({ playback, error: '' }); }
    catch (e) { if (generation === statusGeneration) spotify.set({ error: spotifyError(e) }); }
    finally { refreshTask = null; }
  })();
  return refreshTask;
}
export async function refreshDevices() {
  const generation = statusGeneration;
  try { const devices = await api.spotify.devices(); if (generation !== statusGeneration) return; const s = spotify.get(); const chosen = devices.find((d) => d.id === s.deviceId && !d.restricted) || devices.find((d) => d.active && !d.restricted) || devices.find((d) => !d.restricted); spotify.set({ devices, deviceId: chosen?.id || '', error: '' }); }
  catch (e) { if (generation === statusGeneration) spotify.set({ error: spotifyError(e) }); }
}
export async function spotifyCommand(action, extra = {}) {
  if (spotify.get().busy) return false;
  spotify.set({ busy: true, error: '' });
  try {
    await api.spotify.command({ action, deviceId: spotify.get().deviceId, ...extra });
    if (action === 'play') { pause(); spotify.set({ active: true }); }
    if (action === 'pause') { const p = spotify.get().playback; if (p) spotify.set({ playback: { ...p, playing: false } }); }
    // Spotify updates playback state asynchronously; one delayed refresh follows each command.
    setTimeout(refreshSpotify, 700); return true;
  } catch (e) { const error = spotifyError(e); spotify.set({ error }); toast(error, { icon: 'error' }); return false; }
  finally { spotify.set({ busy: false }); }
}
export function spotifyPosition(p = spotify.get().playback) { return p ? Math.min(p.track?.duration || Infinity, p.position + (p.playing ? Math.max(0, Date.now() - p.at) : 0)) : 0; }
export function initSpotify() {
  const apply = (status) => { const before = spotify.get().status; if (before.connected !== status.connected || before.clientId !== status.clientId) statusGeneration++; spotify.set({ status, ...(!status.connected ? { playback: null, devices: [], active: false, deviceId: '' } : {}) }); if (status.connected && !before.connected) { refreshSpotify(); refreshDevices(); } };
  api.spotify.onStatus(apply); api.spotify.status().then(apply).catch(() => {});
  // Poll only while visible and connected, with backoff after any API error.
  let last = 0;
  const timer = setInterval(() => { const s = spotify.get(); const delay = s.error ? 60000 : 10000; if (!document.hidden && s.status.connected && Date.now() - last >= delay) { last = Date.now(); refreshSpotify(); } }, 1000);
  let wasPlaying = player.get().playing;
  player.subscribe(() => { const playing = player.get().playing; if (playing && !wasPlaying && spotify.get().active) { spotify.set({ active: false }); spotifyCommand('pause'); } wasPlaying = playing; });
  window.addEventListener('beforeunload', () => clearInterval(timer));
  remoteTransport.active = () => spotify.get().active;
  remoteTransport.handle = (action, data = {}) => {
    const s = spotify.get(); if (!s.active) return false;
    if (action === 'playpause') spotifyCommand(s.playback?.playing ? 'pause' : 'play');
    else if (['play','pause','stop'].includes(action)) spotifyCommand(action === 'stop' ? 'pause' : action);
    else if (['next','nexttrack','prev','previoustrack'].includes(action)) spotifyCommand(action.startsWith('next') ? 'next' : 'previous');
    else if (action === 'seekto') spotifyCommand('seek', { value: (data.seekTime || 0) * 1000 });
    else if (['seekforward','seekbackward'].includes(action)) spotifyCommand('seek', { value: spotifyPosition() + (action === 'seekforward' ? 1 : -1) * (data.seekOffset || 10) * 1000 });
    return true;
  };
}
