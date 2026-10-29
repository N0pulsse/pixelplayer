'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {GenreLookup,GenreEnricher,key,select}=require('../electron/genres');const {Library}=require('../electron/library');
const song={id:'track',title:'Example Song',artist:'Example Artist',duration:180};
const dir=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'pp-genres-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;};
const ok=data=>({ok:true,json:async()=>data});
test('genre matching rejects different artists, covers and ambiguous title-only matches',()=>{
 const row={title:song.title,artists:[song.artist],duration:180};assert.equal(select(song,[{...row,artists:['Wrong Artist']}]),null);assert.equal(select(song,[{...row,duration:240}]),null);assert(select(song,[row]));assert.equal(select({...song,artist:null},[row,{...row,artists:['Another']}]),null);assert.equal(select({...song,artist:null,duration:0},[row]),null);
});
test('genre lookup sends metadata only, preserves tags and persists an offline cache',async t=>{
 let calls=0;const p=dir(t);const lookup=new GenreLookup({dir:p,intervals:{apple:0,mb:0},fetch:async(url)=>{calls++;assert(!url.includes('private-directory'));return ok({results:[{kind:'song',trackName:song.title,artistName:song.artist,trackTimeMillis:180000,primaryGenreName:'Hip-Hop/Rap',trackViewUrl:'https://music.apple.com/us/album/test/123?i=4'}]});}});
 assert.equal(await lookup.get({...song,genre:'Jazz'}),null);assert.equal(calls,0);const result=await lookup.get({...song,path:'C:/private-directory/audio.mp3'});assert.equal(result.genre,'Hip-Hop/Rap');assert.equal(calls,1);
 const offline=new GenreLookup({dir:p,fetch:async()=>{throw new Error('offline');}});assert.deepEqual(await offline.get(song),result);
});
test('genre lookup falls back to exact MusicBrainz recording genres and skips free-form tags',async t=>{
 const id='12345678-1234-1234-1234-123456789abc';let n=0;
 const lookup=new GenreLookup({dir:dir(t),intervals:{apple:0,mb:0},fetch:async()=>{n++;return ok(n===1?{results:[]}:n===2?{recordings:[{id,title:song.title,score:100,length:180000,'artist-credit':[{artist:{name:song.artist}}]}]}:{genres:[{name:'alternative rock',count:4}],tags:[{name:'favorites',count:50}]});}});
 assert.equal((await lookup.get(song)).genre,'alternative rock');assert.equal(n,3);
});
test('rate limits back off and network failures are not cached as permanent misses',async t=>{
 const p=dir(t);let calls=0;const lookup=new GenreLookup({dir:p,fetch:async()=>{calls++;return{ok:false,status:429,headers:{get:()=>60}};}});assert.equal(await lookup.get(song),null);assert.equal(calls,1);assert(lookup.cooldown>Date.now());assert.equal(fs.existsSync(path.join(p,'genres.json')),false);
});
test('genre updates preserve file tags, reject stale metadata and survive library restart',async t=>{
 const p=dir(t),lib=new Library({dir:p,parse:async()=>null,covers:{}});lib.cache.set(song.id,{...song,path:'C:/test.mp3'});lib.visible.add(song.id);let updates=0;lib.on('diff',()=>updates++);
 assert.equal(lib.applyGenre(song.id,'stale',{genre:'Rock'},key),false);assert.equal(lib.applyGenre(song.id,key(song),{genre:'Rock',source:'MusicBrainz',url:''},key),true);assert.equal(updates,1);assert.equal(lib.applyGenre(song.id,key(song),{genre:'Pop'},key),false);await lib.save();lib.close();
 const restored=new Library({dir:p,parse:async()=>null,covers:{}});await restored.load();assert.equal(restored.cache.get(song.id).genre,'Rock');restored.close();
});
test('disabling automatic lookup aborts the request and prevents late genre changes',async t=>{
 let enabled=true,resolve,applied=0,cancelled=false;const enricher=new GenreEnricher({library:{applyGenre(){applied++;return true;}},lookup:{get:()=>new Promise(r=>resolve=r),cancel(){cancelled=true;}},enabled:()=>enabled});enricher.enqueue([song]);enabled=false;enricher.stop();resolve({genre:'Rock'});await new Promise(r=>setImmediate(r));assert(cancelled);assert.equal(applied,0);assert.equal(enricher.queue.size,0);enricher.close();
});
