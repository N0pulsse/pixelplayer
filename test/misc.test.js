'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mktmp, makeAudio } = require('./helpers');
const { fixMojibake, parseFilename, splitArtists, idForPath } = require('../electron/util');
const { parseLrc, getLyrics } = require('../electron/lyrics');
const { detectMusicFolders } = require('../electron/detect');
const { createHandler } = require('../electron/protocol');

test('fixMojibake чинит cp1251, прочитанный как latin1, и не трогает нормальный текст', () => {
  // «Кино» в cp1251: CA E8 ED EE
  const broken = Buffer.from([0xca, 0xe8, 0xed, 0xee]).toString('latin1');
  assert.equal(fixMojibake(broken), 'Кино');
  assert.equal(fixMojibake('Beyoncé'), 'Beyoncé');
  assert.equal(fixMojibake('Mötley Crüe'), 'Mötley Crüe');
  assert.equal(fixMojibake('Группа крови'), 'Группа крови');
  assert.equal(fixMojibake('Queen'), 'Queen');
});

test('parseFilename и splitArtists', () => {
  assert.deepEqual(parseFilename('/m/01 - Muse - Uprising.mp3'), { artist: 'Muse', title: 'Uprising', track: 1 });
  assert.deepEqual(parseFilename('/m/Just a Song.flac'), { artist: null, title: 'Just a Song', track: null });
  assert.deepEqual(splitArtists('A; B'), ['A', 'B']);
  assert.deepEqual(splitArtists('Artist feat. Guest'), ['Artist', 'Guest']);
  assert.deepEqual(splitArtists('AC/DC'), ['AC/DC']);
  assert.deepEqual(splitArtists('Simon & Garfunkel'), ['Simon & Garfunkel']);
  assert.deepEqual(splitArtists('Eminem ft. Rihanna'), ['Eminem', 'Rihanna']);
});

test('parseLrc: метки времени, смещение, несколько меток, расширенный LRC', () => {
  const r = parseLrc('[ar:X]\n[offset:+500]\n[00:01.00]Первая\n[00:03.50][00:10.00]Повтор\n[01:02.5]<01:02.50>Слово\nпросто строка');
  assert.equal(r.synced.length, 4);
  assert.equal(r.synced[0].t, 1.5);
  assert.equal(r.synced[0].text, 'Первая');
  assert.equal(r.synced[1].text, 'Повтор');
  assert.equal(r.synced[2].t, 10.5);
  assert.equal(r.synced[3].t, 63);
  assert.equal(r.synced[3].text, 'Слово');
  const p = parseLrc('просто\nтекст');
  assert.equal(p.synced, null);
  assert.equal(p.plain, 'просто\nтекст');
});

test('getLyrics: .lrc рядом с файлом → LRCLIB (мок) → кэш', async () => {
  const dir = mktmp();
  const cache = mktmp();
  const f = path.join(dir, 'a.mp3');
  fs.writeFileSync(f, 'x');
  fs.writeFileSync(path.join(dir, 'a.lrc'), '[00:05.00]Привет\n[00:09.00]Мир');
  const track = { id: 't1', path: f, title: 'a', artist: 'b', duration: 100 };
  const local = await getLyrics(track, { cacheDir: cache, online: false });
  assert.equal(local.source, 'lrc');
  assert.equal(local.synced.length, 2);

  // без .lrc → онлайн
  fs.rmSync(path.join(dir, 'a.lrc'));
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    assert.match(url, /^https:\/\/lrclib\.net\/api\/get\?/);
    return { ok: true, status: 200, json: async () => ({ syncedLyrics: '[00:01.00]Hello\n[00:02.00]World', plainLyrics: 'Hello\nWorld' }) };
  };
  const online = await getLyrics(track, { cacheDir: cache, online: true, fetch: fakeFetch });
  assert.equal(online.source, 'lrclib');
  assert.equal(online.synced[1].text, 'World');
  const again = await getLyrics(track, { cacheDir: cache, online: true, fetch: fakeFetch });
  assert.equal(again.synced.length, 2);
  assert.equal(calls, 1, 'второй раз берём из кэша');

  // 404 → пустой результат кэшируется
  const miss = { id: 't2', path: f, title: 'zzz', artist: 'q', duration: 10 };
  let c2 = 0;
  const f404 = async (url) => { c2++; return { ok: false, status: 404, json: async () => ([]) }; };
  assert.equal(await getLyrics(miss, { cacheDir: cache, online: true, fetch: f404 }), null);
  const c2a = c2;
  assert.equal(await getLyrics(miss, { cacheDir: cache, online: true, fetch: f404 }), null);
  assert.equal(c2, c2a);

  // сеть упала → не кэшируем
  const track3 = { id: 't3', path: f, title: 'n', artist: 'n', duration: 10 };
  assert.equal(await getLyrics(track3, { cacheDir: cache, online: true, fetch: async () => { throw new Error('offline'); } }), null);
  assert.equal(fs.existsSync(path.join(cache, 't3.json')), false);
});

test('detectMusicFolders: находит Music и Downloads только с аудио', async () => {
  const home = mktmp('home-');
  const music = path.join(home, 'Music'); fs.mkdirSync(music);
  const dl = path.join(home, 'Downloads'); fs.mkdirSync(path.join(dl, 'x'), { recursive: true });
  const dl2 = path.join(home, 'Downloads2'); fs.mkdirSync(dl2);
  makeAudio(path.join(dl, 'x', 'song.mp3'), { seconds: 2 });
  fs.writeFileSync(path.join(dl2, 'doc.pdf'), 'x');
  let r = await detectMusicFolders({ musicDir: music, downloadsDir: dl, homeDir: home, platform: 'linux', env: {} });
  assert.deepEqual(r.map((x) => x.kind).sort(), ['downloads', 'music']);
  assert.equal(r.find((x) => x.kind === 'downloads').hasMusic, true);
  r = await detectMusicFolders({ musicDir: music, downloadsDir: dl2, homeDir: home, platform: 'linux', env: {} });
  assert.deepEqual(r.map((x) => x.kind), ['music'], 'папка загрузок без музыки не предлагается');
});

test('protocol: отдаёт аудио с Range и защищён от выхода из каталога', async () => {
  const dir = mktmp();
  const app = path.join(dir, 'app'); fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'index.html'), '<html></html>');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  const audio = path.join(dir, 'a.mp3');
  fs.writeFileSync(audio, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  const handler = createHandler({
    appDir: app,
    library: { pathFor: (id) => (id === 'abc' ? audio : null) },
    covers: { resolve: () => null, mimeOf: () => 'image/jpeg' },
  });
  const req = (url, headers = {}) => ({ url, headers: new Headers(headers) });

  let r = await handler(req('pp://app/audio/abc'));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await r.arrayBuffer()).byteLength, 1000);

  r = await handler(req('pp://app/audio/abc', { Range: 'bytes=100-199' }));
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 100-199/1000');
  const b = Buffer.from(await r.arrayBuffer());
  assert.equal(b.length, 100);
  assert.equal(b[0], 100);

  r = await handler(req('pp://app/audio/abc', { Range: 'bytes=900-' }));
  assert.equal(r.status, 206);
  assert.equal((await r.arrayBuffer()).byteLength, 100);

  r = await handler(req('pp://app/audio/abc', { Range: 'bytes=-50' }));
  assert.equal(r.headers.get('content-range'), 'bytes 950-999/1000');
  await r.arrayBuffer();

  r = await handler(req('pp://app/audio/abc', { Range: 'bytes=5000-6000' }));
  assert.equal(r.status, 416);

  assert.equal((await handler(req('pp://app/audio/nope'))).status, 404);
  assert.equal((await handler(req('pp://app/index.html'))).status, 200);
  // URL-парсер сам схлопывает «..», поэтому выйти из каталога нельзя: в ответ приходит 403/404, но не содержимое файла
  for (const u of ['pp://app/../secret.txt', 'pp://app/%2e%2e/secret.txt', 'pp://app/..%2fsecret.txt', 'pp://app/%2e%2e%2fsecret.txt']) {
    const rr = await handler(req(u));
    assert.ok([403, 404].includes(rr.status), u + ' → ' + rr.status);
    assert.notEqual(await rr.text(), 'secret');
  }
});

test('idForPath стабилен', () => {
  assert.equal(idForPath('/a/b.mp3'), idForPath('/a/b.mp3'));
  assert.notEqual(idForPath('/a/b.mp3'), idForPath('/a/c.mp3'));
});
