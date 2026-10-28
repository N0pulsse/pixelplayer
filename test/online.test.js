'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {OnlinePlayers,parseLink,canNavigate,cleanBookmarks}=require('../electron/online');
function fixture(){
  const windows=[];const sessions=new Map();const stored={};const updates=[];const external=[];
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.loaded=[];this.webContents=new EventEmitter();this.webContents.session=options.webPreferences.session;this.webContents.setWindowOpenHandler=fn=>this.popup=fn;windows.push(this);}
    isDestroyed(){return !!this.destroyed;}show(){this.shown=true;}focus(){this.focused=true;}
    async loadURL(url){this.loaded.push(url);}close(){this.destroyed=true;this.emit('closed');}
  }
  const session={fromPartition(key){if(!sessions.has(key))sessions.set(key,{setPermissionRequestHandler(fn){this.permission=fn;},setPermissionCheckHandler(fn){this.check=fn;},on(){},async clearStorageData(){this.cleared=true;},async clearCache(){this.cacheCleared=true;}});return sessions.get(key);}};
  const manager=new OnlinePlayers({BrowserWindow:Window,session,shell:{openExternal:async u=>external.push(u)},store:{get:(k,d)=>stored[k]||d,set:(k,v)=>stored[k]=v,flushKey(){}},emit:s=>updates.push(s)});
  return{manager,windows,sessions,stored,updates,external};
}
test('online links accept supported public locations and remove tracking and fragments',()=>{
  assert.equal(parseLink('yandex','https://music.yandex.ru/album/123/track/456?utm_source=test#x').url,'https://music.yandex.ru/album/123/track/456');
  assert.equal(parseLink('yandex','https://music.yandex.ru/playlists/lk.abc-123').kind,'playlist');
  assert.equal(parseLink('soundcloud','https://soundcloud.com/artist/sets/playlist').kind,'playlist');
  assert.equal(parseLink('soundcloud','https://on.soundcloud.com/example').kind,'link');
  for(const url of ['file:///C:/secret','javascript:alert(1)','http://soundcloud.com/user/song','https://user:secret@soundcloud.com/user/song','https://soundcloud.com.evil.example/u/t','https://soundcloud.com:8443/u/t','https://soundcloud.com/u/t/s-secret','https://soundcloud.com/connect'])assert.throws(()=>parseLink('soundcloud',url));
  assert.throws(()=>parseLink('unknown','https://example.com'));
});
test('bookmarks persist canonical links, deduplicate and ignore invalid restored entries',()=>{
  const f=fixture();f.manager.save({provider:'soundcloud',url:'https://soundcloud.com/user/track?tracking=x',title:'Saved song'});
  f.manager.save({provider:'soundcloud',url:'https://soundcloud.com/user/track#fragment',title:'Renamed'});
  assert.equal(f.manager.list().length,1);assert.equal(f.manager.list()[0].title,'Renamed');
  assert.equal(JSON.stringify(f.stored).includes('tracking'),false);
  assert.equal(cleanBookmarks([{provider:'yandex',url:'https://evil.example'}]).length,0);
  f.manager.remove(f.manager.list()[0].id);assert.equal(f.manager.list().length,0);
});
test('service windows have isolated persistent sessions and no privileged renderer bridge',async()=>{
  const f=fixture();await f.manager.open('yandex');await f.manager.open('soundcloud');
  const [y,s]=f.windows;assert.notEqual(y.options.webPreferences.session,s.options.webPreferences.session);
  for(const w of f.windows){const p=w.options.webPreferences;assert.equal(p.nodeIntegration,false);assert.equal(p.contextIsolation,true);assert.equal(p.sandbox,true);assert.equal(p.webviewTag,false);assert.equal(p.preload,undefined);}
  await f.manager.open('soundcloud');assert.equal(f.windows.length,2);assert.equal(s.loaded.length,1);assert.equal(s.focused,true);
  await f.manager.open('soundcloud','https://soundcloud.com/u/t');assert.equal(s.loaded.length,2);
  let permission; s.options.webPreferences.session.permission(null,'camera',v=>permission=v);assert.equal(permission,false);
});
test('remote navigation and auth popups stay on trusted HTTPS hosts with sandboxing',async()=>{
  const f=fixture();await f.manager.open('yandex');const w=f.windows[0];
  assert.equal(canNavigate('yandex','https://passport.yandex.ru/auth'),true);
  assert.equal(canNavigate('yandex','https://evil.example'),false);
  let prevented=false;w.webContents.emit('will-navigate',{preventDefault(){prevented=true;}},'file:///C:/private');assert.equal(prevented,true);
  assert.equal(w.popup({url:'https://evil.example'}).action,'deny');
  const popup=w.popup({url:'https://passport.yandex.ru/auth'});assert.equal(popup.action,'allow');assert.equal(popup.overrideBrowserWindowOptions.webPreferences.sandbox,true);
});
test('disconnect clears only the selected service session and closes its window',async()=>{
  const f=fixture();await f.manager.open('yandex');await f.manager.open('soundcloud');
  f.manager.save({provider:'yandex',title:'Album',url:'https://music.yandex.ru/album/123'});
  await f.manager.disconnect('yandex');
  assert.equal(f.windows[0].destroyed,true);assert.equal(f.windows[1].destroyed,undefined);
  assert.equal(f.sessions.get('persist:pixelplayer-online-yandex').cleared,true);assert.equal(f.sessions.get('persist:pixelplayer-online-soundcloud').cleared,undefined);
  assert.equal(f.manager.list().length,1);assert.equal(f.manager.status().find(s=>s.provider==='yandex').open,false);
});
test('audible status follows the web contents without assuming an event argument shape',async()=>{
  const f=fixture();await f.manager.open('soundcloud');const wc=f.windows[0].webContents;
  wc.isCurrentlyAudible=()=>true;wc.emit('audio-state-changed',{audible:true});assert.equal(f.manager.status().find(s=>s.provider==='soundcloud').playing,true);
  wc.isCurrentlyAudible=()=>false;wc.emit('audio-state-changed',{});assert.equal(f.manager.status().find(s=>s.provider==='soundcloud').playing,false);
});
