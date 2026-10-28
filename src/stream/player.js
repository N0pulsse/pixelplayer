// This origin has no Electron bridge and cannot access the app's parent origin.
let player; let tokenSerial=0; const tokens=new Map();
const send=(kind,data={})=>parent.postMessage({pixelSpotify:true,kind,...data},'pp://app');
function token(){return new Promise((resolve,reject)=>{const id=++tokenSerial;const timer=setTimeout(()=>{tokens.delete(id);reject(new Error('Истекло время получения доступа Spotify.'));},20000);tokens.set(id,{resolve,reject,timer});send('token',{id});});}
window.addEventListener('message',async event=>{
  if(event.source!==parent||event.origin!=='pp://app'||!event.data?.pixelSpotify)return;
  const {kind,id,value,error,method}=event.data;
  if(kind==='token') {const pending=tokens.get(id);if(!pending)return;clearTimeout(pending.timer);tokens.delete(id);error?pending.reject(new Error(error)):pending.resolve(value);return;}
  if(kind!=='command'||!['pause','resume','seek','setVolume','nextTrack','previousTrack','getCurrentState','activateElement','disconnect'].includes(method))return;
  try{if(!player)throw new Error('Встроенный Spotify ещё не готов.');const result=await player[method](value);send('result',{id,value:result});}catch(e){send('result',{id,error:e.message});}
});
window.onSpotifyWebPlaybackSDKReady=()=>{
  player=new Spotify.Player({name:'Pixel Player 2.0',getOAuthToken:cb=>token().then(cb).catch(e=>send('error',{error:e.message})),volume:0.5});
  player.addListener('ready',({device_id})=>send('ready',{deviceId:device_id}));
  player.addListener('not_ready',()=>send('offline'));
  player.addListener('player_state_changed',state=>send('state',{state}));
  for(const kind of ['initialization_error','authentication_error','account_error','playback_error'])player.addListener(kind,({message})=>send('error',{code:kind,error:message}));
  player.addListener('autoplay_failed',()=>send('error',{error:'Нажмите «Слушать», чтобы разрешить звук Spotify.'}));
  player.connect().then(ok=>{if(!ok)send('error',{error:'Не удалось подключить встроенный Spotify.'});}).catch(e=>send('error',{error:e.message}));
};
const script=document.createElement('script');script.src='https://sdk.scdn.co/spotify-player.js';script.onerror=()=>send('error',{error:'Не удалось загрузить Spotify SDK. Проверьте интернет.'});document.head.append(script);
