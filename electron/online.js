'use strict';
const crypto = require('node:crypto');
const PROVIDERS = {
  yandex: { name: 'Яндекс Музыка', home: 'https://music.yandex.ru/', hosts: ['music.yandex.ru','music.yandex.com','music.yandex.kz','music.yandex.by','music.yandex.uz'], auth: ['passport.yandex.ru','passport.yandex.com','passport.yandex.kz','oauth.yandex.ru','id.yandex.ru','id.yandex.com'] },
  soundcloud: { name: 'SoundCloud', home: 'https://soundcloud.com/', hosts: ['soundcloud.com','www.soundcloud.com','m.soundcloud.com','on.soundcloud.com'], auth: ['secure.soundcloud.com','accounts.google.com','appleid.apple.com','www.facebook.com'] },
};
function provider(key) { if (!Object.hasOwn(PROVIDERS,key)) throw new Error('Неизвестный музыкальный сервис.'); return PROVIDERS[key]; }
function parseLink(key, value) {
  const p = provider(key); let url;
  try { url = new URL(String(value || p.home).trim()); } catch { throw new Error('Вставьте полную ссылку HTTPS из музыкального сервиса.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !p.hosts.includes(url.hostname) || url.href.length > 2048) throw new Error(`Нужна ссылка с официального сайта ${p.name}.`);
  // Keep only public track/album/playlist/profile locations. Never persist login callbacks or private link tokens.
  let kind = 'home'; let pathname = url.pathname.replace(/\/+$/,'') || '/';
  if (key === 'yandex') {
    if (/^\/album\/\d+\/track\/\d+$/.test(pathname) || /^\/track\/\d+$/.test(pathname)) kind = 'track';
    else if (/^\/album\/\d+$/.test(pathname)) kind = 'album';
    else if (/^\/users\/[^/]+\/playlists\/\d+$/.test(pathname) || /^\/playlists\/(?:lk\.)?[A-Za-z0-9_-]+$/.test(pathname)) kind = 'playlist';
    else if (/^\/artist\/\d+$/.test(pathname)) kind = 'artist';
    else if (!['/','/home','/my','/collection','/search'].includes(pathname)) throw new Error('Поддерживаются ссылки на трек, альбом, исполнителя или плейлист Яндекс Музыки.');
  } else {
    if(url.hostname==='on.soundcloud.com'){if(!/^\/[A-Za-z0-9_-]+$/.test(pathname))throw new Error('Некорректная короткая ссылка SoundCloud.');kind='link';}
    else if (pathname === '/' || ['/discover','/stream','/you/library','/you/likes','/search'].includes(pathname)) kind = 'home';
    else if (/^\/[A-Za-z0-9_-]+\/sets\/[A-Za-z0-9_-]+$/.test(pathname)) kind = 'playlist';
    else if (/^\/[A-Za-z0-9_-]+\/(?!s-)[A-Za-z0-9_-]+$/.test(pathname)) kind = 'track';
    else if (/^\/[A-Za-z0-9_-]+$/.test(pathname) && !['connect','logout','sign-out','login','signup','settings'].includes(pathname.slice(1))) kind = 'artist';
    else throw new Error('Поддерживаются публичные ссылки SoundCloud на трек, плейлист или исполнителя. Короткую ссылку сначала откройте в браузере.');
  }
  if (/%(?:2f|5c)|\\/i.test(pathname)) throw new Error('Некорректная ссылка.');
  url.pathname = pathname; url.hash = ''; url.search = '';
  return { url: url.href, kind };
}
function canNavigate(key, value) {
  try { const p=provider(key); const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && !u.port && [...p.hosts,...p.auth].includes(u.hostname); } catch { return false; }
}
function cleanBookmarks(items) {
  const result=[];
  for (const item of Array.isArray(items) ? items.slice(0,200) : []) {
    try { const link=parseLink(item.provider,item.url); result.push({ id:crypto.createHash('sha256').update(item.provider+'|'+link.url).digest('hex').slice(0,24), provider:item.provider, title:String(item.title || provider(item.provider).name).trim().slice(0,120), ...link }); } catch {}
  }
  return [...new Map(result.map(x=>[x.id,x])).values()];
}
class OnlinePlayers {
  constructor({ BrowserWindow, session, shell, store, icon, emit = () => {} }) { Object.assign(this,{BrowserWindow,session,shell,store,icon,emit}); this.windows=new Map(); this.states=new Map(); this.sessions=new Map(); this.popups=new Set(); }
  list() { return cleanBookmarks(this.store.get('online-bookmarks',[])); }
  save(input={}) {
    const value=cleanBookmarks([input])[0]; if(!value)throw new Error('Проверьте название и ссылку закладки.');
    const items=this.list().filter(x=>x.id!==value.id); if(items.length>=200)throw new Error('Можно сохранить до 200 закладок.');
    items.unshift(value); this.store.set('online-bookmarks',items,0);this.store.flushKey('online-bookmarks');return items;
  }
  remove(id) { const items=this.list().filter(x=>x.id!==id);this.store.set('online-bookmarks',items,0);this.store.flushKey('online-bookmarks');return items; }
  status() { return Object.keys(PROVIDERS).map(key=>({provider:key,open:false,playing:false,loading:false,...this.states.get(key)})); }
  update(key,patch) { this.states.set(key,{...this.states.get(key),...patch});this.emit(this.status()); }
  external(key,url) { return this.shell.openExternal(parseLink(key,url).url); }
  getSession(key) {
    if(this.sessions.has(key))return this.sessions.get(key);
    const s=this.session.fromPartition('persist:pixelplayer-online-'+key);
    s.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    s.setPermissionCheckHandler(()=>false);
    s.on('will-download',event=>event.preventDefault());
    this.sessions.set(key,s);return s;
  }
  secure(w,key) {
    const wc=w.webContents;
    wc.on('will-attach-webview',e=>e.preventDefault());
    wc.on('will-navigate',(e,url)=>{if(!canNavigate(key,url))e.preventDefault();});
    wc.on('will-redirect',(e,url)=>{if(!canNavigate(key,url))e.preventDefault();});
    wc.setWindowOpenHandler(({url})=>{
      if(canNavigate(key,url))return{action:'allow',overrideBrowserWindowOptions:{width:620,height:760,autoHideMenuBar:true,webPreferences:{session:this.getSession(key),nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false}}};
      return{action:'deny'};
    });
    wc.on('did-create-window',child=>{this.popups.add(child);this.secure(child,key);child.on('closed',()=>this.popups.delete(child));});
  }
  async navigate(w,key,url) {
    let timer;
    const loaded=w.loadURL(url).catch(()=>{if(!w.isDestroyed())this.update(key,{loading:false,error:'Сервис недоступен. Попробуйте открыть его в браузере.'});});
    try{await Promise.race([loaded,new Promise(resolve=>{timer=setTimeout(resolve,12000);})]);}finally{clearTimeout(timer);}
  }
  async open(key,value) {
    const p=provider(key);const link=parseLink(key,value);
    let w=this.windows.get(key);
    if(w&&!w.isDestroyed()){w.show();w.focus();if(value)await this.navigate(w,key,link.url);return this.status();}
    w=new this.BrowserWindow({width:1180,height:820,minWidth:640,minHeight:560,title:p.name+' · Pixel Player',icon:this.icon,autoHideMenuBar:true,backgroundColor:'#111318',show:false,webPreferences:{session:this.getSession(key),nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false,spellcheck:false,backgroundThrottling:false}});
    this.windows.set(key,w);this.secure(w,key);this.update(key,{open:true,loading:true,error:'',playing:false});
    w.once('ready-to-show',()=>w.show());
    w.webContents.on('did-start-loading',()=>this.update(key,{loading:true,error:''}));
    w.webContents.on('did-stop-loading',()=>this.update(key,{loading:false}));
    w.webContents.on('did-fail-load',(_e,code,_description,_url,main)=>{if(main&&code!==-3)this.update(key,{loading:false,error:'Не удалось загрузить сервис. Проверьте интернет или откройте его в браузере.'});});
    w.webContents.on('audio-state-changed',()=>this.update(key,{playing:w.webContents.isCurrentlyAudible()}));
    w.webContents.on('render-process-gone',()=>this.update(key,{playing:false,error:'Окно сервиса завершило работу. Закройте и откройте его снова.'}));
    w.on('closed',()=>{if(this.windows.get(key)===w)this.windows.delete(key);this.update(key,{open:false,playing:false,loading:false});});
    await this.navigate(w,key,link.url);
    return this.status();
  }
  close(key) { provider(key);const w=this.windows.get(key);if(w&&!w.isDestroyed())w.close();return this.status(); }
  async disconnect(key) {
    provider(key);this.close(key);for(const w of [...this.popups])if(!w.isDestroyed()&&w.webContents.session===this.getSession(key))w.close();
    await this.getSession(key).clearStorageData();await this.getSession(key).clearCache();this.update(key,{error:''});return this.status();
  }
  closeAll() { for(const key of Object.keys(PROVIDERS))this.close(key);for(const w of this.popups)if(!w.isDestroyed())w.close(); }
}
module.exports={OnlinePlayers,PROVIDERS,parseLink,canNavigate,cleanBookmarks};
