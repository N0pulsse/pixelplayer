import { api } from '../api';
export function createSpotifySDK(onEvent) {
  let frame;let startTimer;let serial=0;const pending=new Map();
  const send=data=>frame?.contentWindow?.postMessage({pixelSpotify:true,...data},'pp://stream');
  const receive=async event=>{
    if(!frame||event.source!==frame.contentWindow||event.origin!=='pp://stream'||!event.data?.pixelSpotify)return;
    const data=event.data;
    if(data.kind==='token'){try{send({kind:'token',id:data.id,value:await api.spotify.streamToken()});}catch(e){send({kind:'token',id:data.id,error:e.message});}return;}
    if(data.kind==='result'){const task=pending.get(data.id);if(!task)return;pending.delete(data.id);clearTimeout(task.timer);data.error?task.reject(new Error(data.error)):task.resolve(data.value);return;}
    if(['ready','offline','error'].includes(data.kind))clearTimeout(startTimer);
    onEvent(data);
  };
  return {
    start(){if(frame)return;window.addEventListener('message',receive);frame=document.createElement('iframe');frame.src='pp://stream/player.html';frame.allow='encrypted-media; autoplay';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.title='Spotify audio engine';frame.hidden=true;document.body.append(frame);startTimer=setTimeout(()=>onEvent({kind:'error',error:'Не удалось подготовить встроенный Spotify. Проверьте интернет и повторите подключение.'}),45000);},
    command(method,value){return new Promise((resolve,reject)=>{if(!frame){reject(new Error('Подключите встроенный Spotify.'));return;}const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Spotify не ответил на команду.'));},12000);pending.set(id,{resolve,reject,timer});send({kind:'command',id,method,value});});},
    stop(){clearTimeout(startTimer);send({kind:'command',method:'disconnect'});frame?.remove();frame=null;window.removeEventListener('message',receive);for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Встроенный Spotify отключён.'));}pending.clear();},
  };
}
export function sdkPlayback(state,deviceId,volume=50){
  if(!state?.track_window?.current_track)return null;
  const t=state.track_window.current_track;const image=t.album?.images?.[0]?.url||'';
  return {track:{id:t.id,uri:t.uri,title:t.name,artist:(t.artists||[]).map(a=>a.name).join(', '),album:t.album?.name||'',image:/^https:\/\/(i\.scdn\.co|image-cdn-(ak|fa)\.spotifycdn\.com)\//.test(image)?image:'',duration:state.duration||t.duration_ms||0},playing:!state.paused,position:state.position||0,at:Date.now(),device:{id:deviceId,name:'Pixel Player 2.0',volume,supportsVolume:true},shuffle:!!state.shuffle,repeat:['off','context','track'][state.repeat_mode]||'off',disallows:Object.fromEntries(Object.entries(state.disallows||{}).map(([k,v])=>[k,v]))};
}
