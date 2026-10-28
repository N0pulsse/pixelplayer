'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Spotify, track, image, REDIRECT } = require('../electron/spotify');
const clientId = '0123456789abcdef0123456789abcdef';
const trackId = '0123456789ABCDEFGHIJKL';
function service(t, fetch, openExternal = async () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-spotify-'));
  const values = {};
  const store = { get: (k, fallback) => values[k] ?? fallback, set: (k,v) => values[k] = v, flushKey() {} };
  const key = crypto.randomBytes(32);
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (value) => { const iv=crypto.randomBytes(16); const cipher=crypto.createCipheriv('aes-256-cbc',key,iv); return Buffer.concat([iv,cipher.update(value),cipher.final()]); }, decryptString: (buf) => { const cipher=crypto.createDecipheriv('aes-256-cbc',key,buf.subarray(0,16)); return Buffer.concat([cipher.update(buf.subarray(16)),cipher.final()]).toString(); } };
  const s = new Spotify({ dir, store, safeStorage, fetch, openExternal, port: 0 }); s.saveClient(clientId);
  t.after(() => { s.cancel(); fs.rmSync(dir, { recursive:true, force:true }); });
  return { s, dir, values };
}
const ok = (data) => ({ ok:true,status:200,json:async()=>data });
test('Spotify PKCE login validates state, exchanges code once and encrypts tokens', async(t) => {
  let authorize; let request; let calls=0;
  const {s,dir,values}=service(t, async(url,opts)=>{ calls++; request={url,...opts}; return ok({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600}); },async(url)=>authorize=new URL(url));
  await s.start(); assert.equal(s.status().pending,true);
  assert.equal(authorize.origin,'https://accounts.spotify.com'); assert.equal(authorize.searchParams.has('client_secret'),false);
  assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
  assert.equal(authorize.searchParams.get('code_challenge'),crypto.createHash('sha256').update(s.pending.verifier).digest('base64url'));
  const redirect=new URL(authorize.searchParams.get('redirect_uri')); assert.equal(redirect.hostname,'127.0.0.1'); assert.equal(redirect.pathname,'/callback');
  assert.equal(s.status().redirectUri,REDIRECT); redirect.search=new URLSearchParams({code:'test-code',state:'incorrect'}).toString();
  assert.equal((await fetch(redirect)).status,400); assert.equal(calls,0); assert.equal(s.status().pending,true);
  redirect.searchParams.set('state',authorize.searchParams.get('state'));
  assert.equal((await fetch(redirect)).status,200); assert.equal(calls,1); assert.equal(s.status().connected,true);
  assert.equal(request.url,'https://accounts.spotify.com/api/token'); assert.equal(request.redirect,'error');
  assert.equal(new URLSearchParams(request.body).get('grant_type'),'authorization_code');
  assert.equal(fs.readFileSync(path.join(dir,'spotify-session.bin')).includes(Buffer.from('test-refresh')),false);
  assert.equal(JSON.stringify(s.status()).includes('test-access'),false); assert.equal(JSON.stringify(values).includes('test-refresh'),false);
  s.disconnect(); assert.equal(fs.existsSync(path.join(dir,'spotify-session.bin')),false);
});
test('Spotify refresh is deduplicated and cannot restore a disconnected session',async(t)=>{
  let complete;let calls=0;
  const {s}=service(t,async()=>{calls++;return new Promise((r)=>complete=()=>r(ok({access_token:'new',expires_in:3600})));});
  s.persist({accessToken:'old',refreshToken:'refresh',expires:0},s.epoch);
  const a=s.access();const b=s.access(); s.disconnect();complete();
  const results=await Promise.allSettled([a,b]); assert.equal(calls,1); assert.ok(results.every((x)=>x.status==='rejected')); assert.equal(s.status().connected,false);
});
test('Spotify retries an expired access token once and preserves rotated refresh tokens',async(t)=>{
  let calls=0;
  const {s}=service(t,async(url,opts)=>{calls++;if(url.includes('/api/token'))return ok({access_token:'new',refresh_token:'rotated',expires_in:3600});if(opts.headers.Authorization==='Bearer old')return{ok:false,status:401};return ok({devices:[]});});
  s.persist({accessToken:'old',refreshToken:'refresh',expires:Date.now()+3600000},s.epoch);
  assert.deepEqual(await s.devices(),[]);assert.equal(calls,3);assert.equal(s.session.refreshToken,'rotated');
});
test('Spotify uses current playlist items API, filters unavailable items and does not follow remote next URLs',async(t)=>{
  let url;
  const {s}=service(t,async(u)=>{url=u;return ok({items:[{item:{id:trackId,type:'track',name:'Song',duration_ms:123000}},{item:null},{item:{type:'episode'}},{item:{id:trackId,type:'track',is_local:true}}],offset:50,limit:50,next:'https://untrusted.example/steal',total:104});});
  s.persist({accessToken:'access',refreshToken:'refresh',expires:Date.now()+3600000},s.epoch);
  const result=await s.browse({kind:'playlist',id:trackId,offset:50});
  assert.equal(url,`https://api.spotify.com/v1/playlists/${trackId}/items?limit=50&offset=50`);assert.equal(result.items.length,1);assert.equal(result.items[0].position,50);assert.equal(result.nextOffset,100);
  await assert.rejects(s.browse({kind:'playlist',id:'../../anything'}));
});
test('Spotify commands reject arbitrary URIs and respect Retry-After without extra requests',async(t)=>{
  let calls=0;let sent;
  const {s}=service(t,async(url,opts)=>{calls++;sent={url,...opts};return{ok:false,status:429,headers:{get:()=> '25'}};});
  s.persist({accessToken:'access',refreshToken:'refresh',expires:Date.now()+3600000},s.epoch);
  await assert.rejects(s.command({action:'play',uris:['https://bad.example']}));assert.equal(calls,0);
  await assert.rejects(s.command({action:'play',context:`spotify:album:${trackId}`,deviceId:'device',position:3}),/25/);
  assert.equal(JSON.parse(sent.body).offset.position,3);assert.equal(sent.redirect,'error');
  await assert.rejects(s.devices(),/Лимит/);assert.equal(calls,1);
});
test('Spotify metadata sanitizes image origins and omits podcasts and local tracks',()=>{
  assert.equal(image([{url:'https://untrusted.example/cover.jpg'}]),'');
  assert.equal(image([{url:'https://i.scdn.co/image/test'}]),'https://i.scdn.co/image/test');
  assert.equal(track({id:trackId,type:'episode'}),null);
  assert.equal(track({id:trackId,type:'track',is_playable:false}).playable,false);
});
test('Spotify explicit track lists start at the requested song without an unsupported context offset',async(t)=>{
  let sent;
  const {s}=service(t,async(_url,opts)=>{sent=JSON.parse(opts.body);return{ok:true,status:204};});
  s.persist({accessToken:'access',refreshToken:'refresh',expires:Date.now()+3600000},s.epoch);
  const uris=['spotify:track:'+'a'.repeat(22),'spotify:track:'+'b'.repeat(22)];
  await s.command({action:'play',uris,position:1});assert.deepEqual(sent.uris,[uris[1],uris[0]]);assert.equal('offset' in sent,false);
});
test('Spotify accepts asynchronous non-JSON playback acknowledgements',async(t)=>{
  const {s}=service(t,async()=>({ok:true,status:202,json:async()=>{throw new Error('opaque acknowledgement');}}));
  s.persist({accessToken:'access',refreshToken:'refresh',expires:Date.now()+3600000},s.epoch);
  assert.equal(await s.command({action:'pause'}),null);
});
