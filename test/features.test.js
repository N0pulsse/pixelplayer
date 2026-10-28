'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { splitArtistCredit, albumIdentity } = require('../electron/identity');
const { fetchLrclib, parseLrc } = require('../electron/lyrics');
const { PlaylistAgent, endpoint, selectResult } = require('../electron/ai');
const { ArtistProfiles } = require('../electron/artists');
const { WallpaperPalette, accentHex, wallpaperPaths } = require('../electron/wallpaper');
const plain = (x) => JSON.parse(JSON.stringify(x));
const temp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-features-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
test('artist credits split collaborators without breaking band names', () => {
  assert.deepEqual(splitArtistCredit('Muse FEAT. Guest; Third'), ['Muse','Guest','Third']);
  for (const name of ['AC/DC','Simon & Garfunkel','Earth, Wind & Fire','Tyler, The Creator']) assert.deepEqual(splitArtistCredit(name), [name]);
  assert.equal(albumIdentity({album:'Hits',artist:'A'}).key === albumIdentity({album:'Hits',artist:'B'}).key, false);
});
test('album index keeps same-titled releases separate and guest albums out of main discography', () => {
  const bundle = esbuild.buildSync({ entryPoints:[path.join(__dirname,'../src/state/library.js')], bundle:true, platform:'browser',format:'cjs',write:false,define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent' }).outputFiles[0].text;
  const sandbox = {module:{exports:{}},window:{pp:{store:{getSync:()=>({})}},innerWidth:1200,innerHeight:800,addEventListener(){}},setTimeout,clearTimeout,console};
  vm.runInNewContext(bundle,sandbox);
  const idx = sandbox.module.exports.buildIndex([
    {id:'a',title:'One',artist:'A feat. Guest',album:'Home',folder:'same'},
    {id:'b',title:'Two',artist:'A',album:'Home',folder:'different'},
    {id:'c',title:'Three',artist:'B',album:'Home',folder:'same'},
    {id:'d',title:'Four',artist:'Vocalist',albumArtist:'Producer',album:'Sessions',folder:'same'},
  ],0);
  assert.equal(idx.albums.length,3); assert.equal(idx.artistByName.get('a').albumIds.length,1);
  assert.equal(idx.artistByName.get('producer').trackIds[0],'d');
  assert.equal(idx.artistByName.get('guest').albumIds.length,0); assert.equal(idx.artistByName.get('guest').appearanceAlbumIds.length,1);
  assert.equal(idx.albums.find(a=>a.artist==='A').trackIds.length,2);
});
test('synced lyrics are preferred over exact plain text and wrong artist matches are rejected', async () => {
  let calls=0;
  const result=await fetchLrclib({title:'Song (Official Video)',artist:'A feat. Guest',duration:100},async(url)=>{
    calls++;
    return {ok:true,json:async()=>url.includes('/get?')?{plainLyrics:'plain'}:[{trackName:'Song',artistName:'B',duration:100,syncedLyrics:'[00:01]Wrong'},{trackName:'Song',artistName:'A',duration:101,syncedLyrics:'[00:01]Correct'}]};
  });
  assert.equal(calls,2); assert.equal(result.synced[0].text,'Correct');
  assert.equal(parseLrc('[00:02]Text\n[offset:-500]').synced[0].t,1.5);
});
test('AI accepts local HTTP only, strips hallucinated IDs and deduplicates selections',()=>{
  assert.equal(endpoint('http://localhost:11434/v1'),'http://localhost:11434/v1/chat/completions');
  assert.throws(()=>endpoint('http://example.com/v1'));
  assert.throws(()=>endpoint('https://user:pass@example.com/v1'));
  assert.deepEqual(selectResult('{"trackIds":["a","invented","a","b"],"name":"Mix"}',new Set(['a','b']),1).trackIds,['a']);
});
test('AI key stays encrypted; requests omit paths and never send keys to a changed server',async(t)=>{
  const values={};const store={get:(k,d)=>values[k]||d,set:(k,v)=>values[k]=v,flushKey(){}};
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:(s)=>Buffer.from(s.split('').reverse().join('')),decryptString:(b)=>b.toString().split('').reverse().join('')};
  let request;
  const agent=new PlaylistAgent({dir:temp(t),store,safeStorage,fetch:async(url,opts)=>{request={url,...opts};return{ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{"name":"Night","trackIds":["x","fake"]}'}}]})};}});
  agent.save({endpoint:'https://provider.example/v1',model:'chosen-model',apiKey:'private-test-key'});
  assert.equal(JSON.stringify(agent.config()).includes('private-test-key'),false);
  assert.equal(JSON.stringify(values).includes('private-test-key'),false);
  assert.throws(()=>agent.save({endpoint:'https://other.example/v1',model:'chosen-model'}));
  const result=await agent.generate({prompt:'Night music',tracks:[{id:'x',title:'Song',artist:'A',path:'C:\\private\\song.mp3'}]});
  assert.deepEqual(result.trackIds,['x']);assert.equal(request.body.includes('private'),false);assert.equal(request.headers.Authorization,'Bearer private-test-key');
  assert.equal(request.redirect,'error');
});
test('artist profiles use exact identity and serve cached biographies while offline',async(t)=>{
  let calls=0;
  const profiles=new ArtistProfiles({dir:temp(t),fetch:async()=>{throw new Error('unused')},nativeImage:{}});
  profiles.json=async(url)=>{calls++;return url.includes('search.php')?{artists:[{idArtist:'1',strArtist:'A',strBiographyRU:'Biography',strCountry:'RU'}]}:{album:[{idAlbum:'2',strAlbum:'Home',intYearReleased:'2020'}]};};
  const result=await profiles.get('A');assert.equal(result.biography,'Biography');assert.equal(result.albums[0].title,'Home');
  assert.equal((await profiles.get('A',{online:false})).cached,true);assert.equal(calls,3);
});
test('Wallpaper Engine selected paths exclude history; color fallback accurately decodes Windows ABGR',async()=>{
  assert.equal(accentHex(0xff332211),'#112233');
  assert.deepEqual(wallpaperPaths({selectedwallpapers:[{file:'C:\\wallpaper\\project.json'}],history:[{file:'C:\\old\\project.json'}]}),['C:\\wallpaper\\project.json']);
  const service=new WallpaperPalette({nativeImage:{},windowsProbe:async()=>({accent:0xff332211,engine:'C:\\engine\\wallpaper64.exe'})});
  const result=await service.get();assert.equal(result.color,'#112233');assert.equal(result.engine,true);
});
