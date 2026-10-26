'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { configureStorage } = require('../electron/storage');
const { decodePlaylist, parseM3u, serializeM3u } = require('../electron/playlists');
const { Library } = require('../electron/library');
const { createHandler } = require('../electron/protocol');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, '.pixel-backend-'));
  t._libraries = [];
  t.after(async () => {
    for (const lib of t._libraries) { lib.close(); await lib.save(); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeLibrary(t, dir, parse = async () => ({ title: 'Тест', duration: 1 })) {
  const lib = new Library({ dir, parse, covers: { save: async () => null }, concurrency: 1 });
  t._libraries.push(lib);
  return lib;
}

test('portable redirects all persistent storage beside the launcher; installed mode keeps defaults', (t) => {
  const dir = tmp(t);
  const calls = new Map();
  const app = {
    getPath: () => 'default-profile', setPath: (key, value) => calls.set(key, value),
    setAppLogsPath: (value) => calls.set('logs', value),
  };
  assert.equal(configureStorage(app, {}).userData, 'default-profile');
  assert.equal(calls.size, 0);
  const result = configureStorage(app, { PORTABLE_EXECUTABLE_DIR: dir });
  assert.equal(result.portable, true);
  assert.equal(calls.get('userData'), path.join(dir, 'PixelPlayer-data'));
  for (const key of ['sessionData', 'logs', 'crashDumps']) {
    assert.ok(calls.get(key).startsWith(result.userData + path.sep));
    assert.ok(fs.statSync(calls.get(key)).isDirectory());
  }
});

test('portable gives a useful error instead of silently saving in AppData', (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'PixelPlayer-data'), 'blocked');
  assert.throws(() => configureStorage({}, { PORTABLE_EXECUTABLE_DIR: dir }), /Переместите EXE/);
});

test('M3U preserves order, Unicode and local file URLs while rejecting streams and unrelated files', (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'Плейлист.m3u8');
  const audio = path.join(dir, 'Музыка', 'A #1.flac');
  const result = parseM3u(`\uFEFF#EXTM3U\nМузыка/A #1.flac\n${pathToFileURL(audio)}\nhttps://example.com/x.mp3\nnotes.txt\nМузыка/A #1.flac`, file);
  assert.deepEqual(result.paths, [audio, audio, audio]);
  assert.equal(result.skipped, 2);
  const serialized = serializeM3u([{ path: audio, artist: 'Кино', title: 'Трек\nдва', duration: 45.2 }], file);
  assert.match(serialized, /#EXTINF:45,Кино - Трек два/);
  assert.deepEqual(parseM3u(serialized, file).paths, [audio]);
  assert.equal(decodePlaylist(Buffer.from([0xca, 0xe8, 0xed, 0xee])), 'Кино');
  assert.equal(decodePlaylist(Buffer.from('\uFEFFКино', 'utf16le')).replace(/^\uFEFF/, ''), 'Кино');
});

test('imported external tracks survive saves, scans and restarts without watching their folder', async (t) => {
  const dir = tmp(t);
  const data = path.join(dir, 'data');
  const song = path.join(dir, 'короткий.wav');
  fs.writeFileSync(song, Buffer.alloc(1024));
  const lib = makeLibrary(t, data);
  const diffs = [];
  lib.on('diff', (diff) => diffs.push(diff));
  const [track] = await lib.parseFiles([song], { persist: true });
  assert.equal(lib.getTracks().length, 1);
  assert.equal(diffs[0].added[0].id, track.id);
  lib.setFolders([]);
  await lib.scan();
  assert.equal(lib.getTracks().length, 1);
  await Promise.all([lib.save(), lib.save(), lib.save()]);
  const restored = makeLibrary(t, data);
  await restored.load();
  restored.setFolders([]);
  assert.equal(restored.getTracks()[0].path, song);
  assert.equal(restored.pathFor(track.id), song);
  assert.equal(restored.getFolders().length, 0);
});

test('a disabled folder cannot be re-added by an in-flight metadata scan', async (t) => {
  const dir = tmp(t);
  const music = path.join(dir, 'music');
  fs.mkdirSync(music);
  fs.writeFileSync(path.join(music, 'short.wav'), Buffer.alloc(512));
  let begin; let release;
  const begun = new Promise((resolve) => { begin = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const lib = makeLibrary(t, path.join(dir, 'data'), async () => { begin(); await gate; return { title: 'Short', duration: 0.5 }; });
  lib.setFolders([{ path: music }]);
  const scanning = lib.scan();
  await begun;
  lib.setFolders([{ path: music, enabled: false }]);
  release();
  await scanning;
  await lib.scanPromise;
  assert.deepEqual(lib.getTracks(), []);
  assert.equal(lib.cache.size, 0);
});

test('retaining an opened track makes it available after restart without adding a watched folder', async (t) => {
  const dir = tmp(t);
  const data = path.join(dir, 'data');
  const file = path.join(dir, 'opened.flac');
  fs.writeFileSync(file, Buffer.alloc(256));
  const lib = makeLibrary(t, data);
  const [track] = await lib.parseFiles([file]);
  assert.equal(lib.getTracks().length, 0);
  const retained = await lib.retainFiles([track.id, track.id, 'unknown', null]);
  assert.equal(retained.length, 1);
  assert.equal(lib.getTracks()[0].id, track.id);
  const restored = makeLibrary(t, data);
  await restored.load();
  restored.setFolders([]);
  assert.equal(restored.getTracks()[0].id, track.id);
  assert.equal(restored.pathFor(track.id), file);
});

test('scanner includes valid short clips and parseFiles ignores folders, empty files and non-audio paths', async (t) => {
  const dir = tmp(t);
  const music = path.join(dir, 'music.v2');
  fs.mkdirSync(music);
  const audio = path.join(music, 'clip.wav');
  fs.writeFileSync(audio, Buffer.alloc(200));
  fs.writeFileSync(path.join(music, 'notes.txt'), 'not music');
  fs.writeFileSync(path.join(music, 'empty.mp3'), '');
  const lib = makeLibrary(t, path.join(dir, 'data'));
  lib.setFolders([{ path: music }]);
  await lib.scan();
  assert.equal(lib.getTracks().length, 1, 'sub-16KB clips are supported');
  assert.equal((await lib.parseFiles([music, path.join(music, 'notes.txt'), path.join(music, 'empty.mp3'), audio])).length, 1);
});

test('protocol safely handles malformed paths, directories, HEAD and invalid byte ranges', async (t) => {
  const dir = tmp(t);
  const appDir = path.join(dir, 'app');
  fs.mkdirSync(appDir);
  fs.writeFileSync(path.join(appDir, 'index.html'), 'hello');
  const audio = path.join(dir, 'a.wav');
  fs.writeFileSync(audio, Buffer.alloc(100));
  const handler = createHandler({ appDir, library: { pathFor: () => audio }, covers: { resolve: () => null } });
  const req = (pathname, range, method = 'GET') => ({ url: `pp://app/${pathname}`, headers: new Headers(range ? { range } : {}), method });
  assert.equal((await handler(req('%E0%A4%A'))).status, 400);
  assert.equal((await handler(req('%00'))).status, 400);
  fs.mkdirSync(path.join(appDir, 'folder'));
  assert.equal((await handler(req('folder'))).status, 404);
  const head = await handler(req('audio/id', null, 'HEAD'));
  assert.equal(head.headers.get('content-length'), '100');
  assert.equal(await head.text(), '');
  for (const range of ['bytes=-0', 'bytes=999-', 'bytes=8-4', 'bytes=0-1,3-4', 'bytes=90071992547409920-', 'bytes=-90071992547409920']) {
    assert.equal((await handler(req('audio/id', range))).status, 416, range);
  }
  const suffix = await handler(req('audio/id', 'bytes=-10'));
  assert.equal(suffix.status, 206);
  assert.equal((await suffix.arrayBuffer()).byteLength, 10);
});
