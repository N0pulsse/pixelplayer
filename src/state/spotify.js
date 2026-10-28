import { api } from '../api';
import { createStore } from '../lib/store';
import { player, pause } from './player';
import { toast } from './ui';
import { settings, setSetting } from './settings';
import { createSpotifySDK, sdkPlayback } from './spotify-sdk';
import { remoteTransport } from './transport';
export const spotify = createStore({ status: {}, playback: null, devices: [], deviceId: '', active: false, busy: false, error: '', mode: 'embedded', sdk: { state:'idle', deviceId:'' } });
export const spotifyError = (e) => String(e?.message || 'Spotify недоступен').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
const sdk=createSpotifySDK(event=>{
  if(event.kind==='ready')spotify.set({sdk:{state:'ready',deviceId:event.deviceId},deviceId:event.deviceId,error:''});
  if(event.kind==='offline')spotify.set({sdk:{state:'offline',deviceId:''},error:'Встроенный Spotify отключился. Подключите его снова.'});
  if(event.kind==='error'){
    statusGeneration++;sdk.stop();const p=spotify.get().playback;
    const error=event.code==='playback_error'?'Spotify не смог воспроизвести трек. Встроенный сеанс остановлен, чтобы не пропускать следующие песни. Повторите запуск или выберите Spotify Connect.':spotifyError(new Error(event.error));
    spotify.set({sdk:{state:'error',deviceId:''},playback:p?{...p,playing:false,position:spotifyPosition(p),at:Date.now()}:null,error});
  }
  if(event.kind==='state'&&spotify.get().mode==='embedded'){const p=sdkPlayback(event.state,spotify.get().sdk.deviceId,spotify.get().playback?.device?.volume);if(p){spotify.set({playback:p,active:spotify.get().active||p.playing});if(p.playing)pause();}}
});
export function setSpotifyMode(mode){if(!['embedded','connect'].includes(mode))return;statusGeneration++;sdk.stop();spotify.set({mode,active:false,playback:null,deviceId:'',sdk:{state:'idle',deviceId:''},error:''});setSetting({spotifyPlaybackMode:mode});if(mode==='connect'){refreshDevices();refreshSpotify();}}
export function stopEmbedded(){statusGeneration++;sdk.stop();const p=spotify.get().playback;spotify.set({sdk:{state:'idle',deviceId:''},playback:p?{...p,playing:false,position:spotifyPosition(p),at:Date.now()}:null});}
export function connectEmbedded(){sdk.stop();spotify.set({sdk:{state:'connecting',deviceId:''},error:''});sdk.start();}
let refreshTask = null;
let statusGeneration = 0;
export async function refreshSpotify() {
  if (!spotify.get().status.connected || (spotify.get().mode==='embedded'&&spotify.get().sdk.state!=='ready')) return;
  if (refreshTask) return refreshTask;
  const generation = statusGeneration;
  refreshTask = (async () => {
    try { const s=spotify.get(); const playback=s.mode==='embedded'?sdkPlayback(await sdk.command('getCurrentState'),s.sdk.deviceId,s.playback?.device?.volume):await api.spotify.playback(); if (generation === statusGeneration) spotify.set({ playback, error: '' }); }
    catch (e) { if (generation === statusGeneration) spotify.set({ error: spotifyError(e) }); }
    finally { refreshTask = null; }
  })();
  return refreshTask;
}
export async function refreshDevices() {
  if(spotify.get().mode==='embedded')return;
  const generation = statusGeneration;
  try { const devices = await api.spotify.devices(); if (generation !== statusGeneration) return; const s = spotify.get(); const chosen = devices.find((d) => d.id === s.deviceId && !d.restricted) || devices.find((d) => d.active && !d.restricted) || devices.find((d) => !d.restricted); spotify.set({ devices, deviceId: chosen?.id || '', error: '' }); }
  catch (e) { if (generation === statusGeneration) spotify.set({ error: spotifyError(e) }); }
}
export async function spotifyCommand(action, extra = {}) {
  if(action==='pause'&&spotify.get().mode==='embedded'&&spotify.get().sdk.state!=='ready'){stopEmbedded();return true;}
  if (spotify.get().busy) return false;
  const generation = statusGeneration;
  spotify.set({ busy: true, error: '' });
  try {
    const state=spotify.get();
    if(state.mode==='embedded'){
      if(state.sdk.state!=='ready'){
        if(action!=='play')throw new Error('Встроенный Spotify отключён. Выберите трек для повторного запуска.');
        connectEmbedded();
        for(let i=0;i<90&&spotify.get().sdk.state==='connecting';i++)await new Promise(resolve=>setTimeout(resolve,500));
        if(spotify.get().sdk.state!=='ready')throw new Error(spotify.get().error||'Не удалось подключить встроенный Spotify.');
        if(generation!==statusGeneration)return false;
        state.sdk=spotify.get().sdk;
      }
      if(action==='play'&&(extra.uris||extra.context)){
        await sdk.command('activateElement');
        await api.spotify.command({action:'transfer',deviceId:state.sdk.deviceId});
        await api.spotify.command({action:'play',deviceId:state.sdk.deviceId,...extra});
      }else if(['play','pause','seek','volume','next','previous'].includes(action)){
        const methods={play:'resume',pause:'pause',seek:'seek',volume:'setVolume',next:'nextTrack',previous:'previousTrack'};
        await sdk.command(methods[action],action==='volume'?extra.value/100:extra.value);
      }else await api.spotify.command({action,deviceId:state.sdk.deviceId,...extra});
      let playback;
      const target=extra.fallbackUri||extra.uris?.[extra.position||0];
      for(let attempt=0;attempt<6;attempt++){
        playback=sdkPlayback(await sdk.command('getCurrentState'),state.sdk.deviceId,action==='volume'?extra.value:state.playback?.device?.volume);
        if(generation!==statusGeneration)return false;
        if(action==='play'&&(!playback?.playing||(target&&playback.track.uri!==target)) || action==='pause'&&playback?.playing){await new Promise(resolve=>setTimeout(resolve,500));continue;}
        break;
      }
      if(action==='play'&&(!playback?.playing||(target&&playback.track.uri!==target)))throw new Error('Встроенный Spotify не подтвердил запуск выбранного трека. Проверьте подключение и Premium.');
      if(generation!==statusGeneration)return false;
      if(playback){spotify.set({playback,active:spotify.get().active||playback.playing});if(playback.playing)pause();}
      if(action==='pause'&&playback?.playing)throw new Error('Spotify ещё не подтвердил паузу. Повторите команду.');
      setTimeout(refreshSpotify,500);return true;
    }
    if (action === 'play') {
      const result=await api.spotify.play({deviceId:spotify.get().deviceId,...extra});
      if(generation!==statusGeneration)throw new Error('Подключение Spotify изменено.');
      if(result.playback){pause();spotify.set({active:true,playback:result.playback,deviceId:result.deviceId});if(result.recovered)toast('Воспроизведение восстановлено через Spotify на ПК',{icon:'check'});}
      else if(result.opened){pause();spotify.set({active:false,error:'Трек открыт в Spotify на ПК. Spotify Connect пока не подтвердил состояние — управляйте музыкой в окне Spotify.'});}
      else throw new Error('Spotify не подтвердил воспроизведение.');
    } else { const result=await api.spotify.control({ action, deviceId: spotify.get().playback?.device?.id || spotify.get().deviceId, ...extra }); if(result)spotify.set({playback:result}); }
    
    // Spotify updates playback state asynchronously; one delayed refresh follows each command.
    setTimeout(refreshSpotify, 700); return true;
  } catch (e) { if(generation!==statusGeneration)return false; const error = spotifyError(e); spotify.set({ error }); toast(error, { icon: 'error' }); return false; }
  finally { spotify.set({ busy: false }); }
}
export function spotifyPosition(p = spotify.get().playback) { return p ? Math.min(p.track?.duration || Infinity, p.position + (p.playing ? Math.max(0, Date.now() - p.at) : 0)) : 0; }
export function initSpotify() {
  spotify.set({mode:settings.get().spotifyPlaybackMode==='connect'?'connect':'embedded'});
  const apply = (status) => { const before = spotify.get().status; if (before.connected !== status.connected || before.clientId !== status.clientId){statusGeneration++;if(!status.connected)sdk.stop();} spotify.set({ status, ...(!status.connected ? { playback: null, devices: [], active: false, deviceId: '' } : {}) }); if (status.connected && !before.connected) { refreshSpotify(); refreshDevices(); } };
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
