'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {splitArtistCredit}=require('./identity');
const norm=s=>String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const key=t=>crypto.createHash('sha256').update(JSON.stringify([norm(t.title),norm(t.artist),Math.round(t.duration||0)])).digest('hex');
function select(track,rows){
  const artists=splitArtistCredit(track.artist).map(norm).filter(Boolean);
  const matches=rows.filter(r=>norm(r.title)===norm(track.title)&&(!artists.length||r.artists.some(a=>artists.includes(norm(a))))&&(!track.duration||!r.duration||Math.abs(track.duration-r.duration)<=Math.max(8,track.duration*.04)));
  if(!artists.length){if(!track.duration||matches.some(r=>!r.duration))return null;const identities=new Set(matches.map(r=>r.artists.map(norm).sort().join('|')));if(identities.size!==1)return null;}
  return matches.sort((a,b)=>Math.abs((a.duration||track.duration)-track.duration)-Math.abs((b.duration||track.duration)-track.duration))[0]||null;
}
class GenreLookup {
  constructor({dir,fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,intervals={apple:3100,mb:1100}}){
    Object.assign(this,{fetch,wait,now,intervals});this.file=path.join(dir,'genres.json');this.cache={};this.last={};this.cooldown=0;this.controller=null;this.cancelled=false;
    try{this.cache=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!this.cache||Array.isArray(this.cache)||typeof this.cache!=='object')this.cache={};}catch{}
  }
  cancel(){this.cancelled=true;this.controller?.abort();}
  async json(url,host){
    if(this.cancelled)throw new Error('Поиск отключён.');
    if(this.now()<this.cooldown)throw new Error('Подождите перед повторным поиском жанров.');
    const delay=Math.max(0,(this.last[host]??-Infinity)+this.intervals[host]-this.now());if(delay)await this.wait(delay);
    if(this.cancelled)throw new Error('Поиск отключён.');
    this.controller=new AbortController();const timer=setTimeout(()=>this.controller?.abort(),12000);
    try{
      this.last[host]=this.now();const r=await this.fetch(url,{signal:this.controller.signal,redirect:'error',headers:{Accept:'application/json','User-Agent':'PixelPlayer/2.1.0 (https://github.com/N0pulsse/pixelplayer)'}});
      if(!r.ok){if([429,503].includes(r.status))this.cooldown=this.now()+Math.min(3600,Math.max(30,Number(r.headers?.get('retry-after'))||60))*1000;throw new Error('Источник жанров временно недоступен.');}
      return await r.json();
    }finally{clearTimeout(timer);this.controller=null;}
  }
  async get(track){
    if(track.genre)return null;
    if(!norm(track.title)||norm(track.title).length<2)return null;
    this.cancelled=false;
    const id=key(track),cached=this.cache[id];if(cached&&this.now()-cached.at<(cached.result?30:3)*86400000)return cached.result;
    let healthy=0;
    try{
      const url=new URL('https://itunes.apple.com/search');url.search=new URLSearchParams({term:[track.title,track.artist].filter(Boolean).join(' ').slice(0,300),media:'music',entity:'song',limit:'25',country:'US'}).toString();
      const data=await this.json(url.href,'apple');healthy++;
      const hit=select(track,(data.results||[]).filter(r=>r.kind==='song').map(r=>({title:r.trackName,artists:splitArtistCredit(r.artistName),duration:r.trackTimeMillis/1000,genre:r.primaryGenreName,url:r.trackViewUrl})));
      if(hit?.genre&&!['music','unknown'].includes(norm(hit.genre)))return this.save(id,{genre:String(hit.genre).slice(0,100),source:'Apple Music / iTunes',url:this.link(hit.url,['music.apple.com','itunes.apple.com'])});
    }catch{healthy=-100;}
    try{
      const escape=s=>String(s||'').replace(/["\\]/g,' ').slice(0,180);
      const query=`recording:"${escape(track.title)}"${track.artist?` AND artist:"${escape(track.artist)}"`:''}`;
      const data=await this.json('https://musicbrainz.org/ws/2/recording/?'+new URLSearchParams({query,fmt:'json',limit:'10'}),'mb');healthy++;
      const hit=select(track,(data.recordings||[]).filter(r=>Number(r.score)>=95&&/^[a-f0-9-]{36}$/.test(r.id)).map(r=>({id:r.id,title:r.title,artists:(r['artist-credit']||[]).map(a=>a.artist?.name||a.name).filter(Boolean),duration:r.length/1000})));
      if(hit){const record=await this.json(`https://musicbrainz.org/ws/2/recording/${hit.id}?inc=genres&fmt=json`,'mb');const genre=(record.genres||[]).filter(g=>Number(g.count)>0&&typeof g.name==='string').sort((a,b)=>b.count-a.count)[0]?.name;if(genre)return this.save(id,{genre:genre.slice(0,100),source:'MusicBrainz',url:`https://musicbrainz.org/recording/${hit.id}`});}
    }catch{healthy=-100;}
    if(healthy>=2)this.save(id,null);return null;
  }
  link(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&hosts.includes(u.hostname)?u.href:'';}catch{return '';}}
  save(id,result){this.cache[id]={at:this.now(),result};const entries=Object.entries(this.cache).sort((a,b)=>b[1].at-a[1].at).slice(0,10000);this.cache=Object.fromEntries(entries);fs.mkdirSync(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.cache));fs.renameSync(tmp,this.file);return result;}
}
class GenreEnricher extends EventEmitter {
  constructor({library,lookup,enabled}){super();Object.assign(this,{library,lookup,enabled});this.queue=new Map();this.running=false;this.updated=0;this.closed=false;}
  status(){return{running:this.running,queued:this.queue.size,updated:this.updated};}
  enqueue(tracks){if(this.closed||!this.enabled())return;for(const t of tracks)if(!t.genre)this.queue.set(t.id,t);this.pump();}
  prioritize(t){if(this.closed||!this.enabled()||!t||t.genre)return;this.queue.delete(t.id);this.queue=new Map([[t.id,t],...this.queue]);this.pump();}
  async pump(){if(this.running||this.closed)return;this.running=true;this.emit('status',this.status());try{while(this.queue.size&&!this.closed&&this.enabled()){
    const [id,t]=this.queue.entries().next().value;this.queue.delete(id);
    try{const result=await this.lookup.get(t);if(result&&!this.closed&&this.enabled()&&this.library.applyGenre(id,key(t),result,key)){this.updated++;this.emit('result',{id,...result});}}catch{}
    this.emit('status',this.status());
    if(this.lookup.cooldown>Date.now()){this.queue.clear();break;}
  }}finally{this.running=false;this.emit('status',this.status());}}
  stop(){this.queue.clear();this.lookup.cancel();this.emit('status',this.status());}
  close(){this.closed=true;this.stop();}
}
module.exports={GenreLookup,GenreEnricher,select,key};
