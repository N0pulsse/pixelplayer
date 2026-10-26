'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mktmp, makeAudio, makeCover, ffprobeParser } = require('./helpers');
const { Library } = require('../electron/library');
const { CoverStore } = require('../electron/covers');

function setup() {
  const music = mktmp('pp-music-');
  const data = mktmp('pp-data-');
  const cover = path.join(music, 'cover-src.jpg');
  makeCover(cover, 'red');
  makeAudio(path.join(music, 'Queen', 'A Night at the Opera', '01 - Death on Two Legs.mp3'), { tags: { title: 'Death on Two Legs', artist: 'Queen', album: 'A Night at the Opera', track: '1', date: '1975', genre: 'Rock' }, cover });
  makeAudio(path.join(music, 'Queen', 'A Night at the Opera', '02 - Lazing on a Sunday Afternoon.mp3'), { freq: 500, tags: { title: 'Lazing on a Sunday Afternoon', artist: 'Queen', album: 'A Night at the Opera', track: '2' }, cover });
  makeAudio(path.join(music, 'Кино', 'Группа крови', 'Группа крови.flac'), { freq: 600, tags: { title: 'Группа крови', artist: 'Кино', album: 'Группа крови', track: '1', date: '1988' } });
  makeAudio(path.join(music, 'singles', 'Muse - Uprising.ogg'), { freq: 700, tags: {} });
  makeAudio(path.join(music, 'singles', 'no-tags.m4a'), { freq: 800, tags: {} });
  fs.writeFileSync(path.join(music, 'singles', 'notes.txt'), 'не музыка');
  fs.writeFileSync(path.join(music, 'singles', 'tiny.mp3'), 'x'); // слишком маленький
  const covers = new CoverStore(path.join(data, 'covers'), null);
  const lib = new Library({ dir: data, parse: ffprobeParser(), covers, concurrency: 3 });
  return { music, data, covers, lib };
}

const waitDone = (lib) => new Promise((res) => lib.once('done', res));

test('сканирование находит музыку, читает теги и обложки', async () => {
  const { music, lib, covers } = setup();
  lib.setFolders([{ path: music, enabled: true }]);
  const diffs = [];
  lib.on('diff', (d) => diffs.push(d));
  const done = waitDone(lib);
  lib.scan();
  const res = await done;
  assert.equal(res.total, 5);
  const tracks = lib.getTracks();
  assert.equal(tracks.length, 5);
  const byTitle = Object.fromEntries(tracks.map((t) => [t.title, t]));
  assert.equal(byTitle['Death on Two Legs'].artist, 'Queen');
  assert.equal(byTitle['Death on Two Legs'].album, 'A Night at the Opera');
  assert.equal(byTitle['Death on Two Legs'].year, 1975);
  assert.equal(byTitle['Death on Two Legs'].track, 1);
  assert.ok(byTitle['Death on Two Legs'].duration > 19 && byTitle['Death on Two Legs'].duration < 21);
  assert.ok(byTitle['Death on Two Legs'].cover, 'обложка должна быть сохранена');
  assert.ok(covers.resolve(byTitle['Death on Two Legs'].cover, false));
  assert.ok(covers.resolve(byTitle['Death on Two Legs'].cover, true));
  // Одинаковая обложка → один и тот же ключ
  assert.equal(byTitle['Death on Two Legs'].cover, byTitle['Lazing on a Sunday Afternoon'].cover);
  // Кириллица
  assert.equal(byTitle['Группа крови'].artist, 'Кино');
  assert.equal(byTitle['Группа крови'].lossless, true);
  // Без тегов — разбор имени файла
  assert.equal(byTitle['Uprising'].artist, 'Muse');
  assert.ok(byTitle['no-tags']);
  // root не утекает в публичные данные
  assert.equal('root' in tracks[0], false);
  assert.ok(diffs.length >= 1);
});

test('повторное сканирование использует кэш и подхватывает новые/удалённые файлы', async () => {
  const { music, data, covers, lib } = setup();
  lib.setFolders([{ path: music, enabled: true }]);
  let done = waitDone(lib);
  lib.scan();
  await done;
  await lib.save();

  // Новый экземпляр: кэш должен подняться без парсинга
  let parseCalls = 0;
  const counting = ffprobeParser();
  const lib2 = new Library({ dir: data, parse: async (f) => { parseCalls++; return counting(f); }, covers, concurrency: 2 });
  await lib2.load();
  lib2.setFolders([{ path: music, enabled: true }]);
  assert.equal(lib2.getTracks().length, 5, 'из кэша сразу видно 5 треков');
  done = waitDone(lib2);
  lib2.scan();
  await done;
  assert.equal(parseCalls, 0, 'ничего не изменилось — парсить не нужно');

  // Добавляем и удаляем файлы
  makeAudio(path.join(music, 'new', 'Daft Punk - Digital Love.mp3'), { freq: 900, tags: { title: 'Digital Love', artist: 'Daft Punk' } });
  fs.rmSync(path.join(music, 'singles', 'no-tags.m4a'));
  const diffs = [];
  lib2.on('diff', (d) => diffs.push(d));
  done = waitDone(lib2);
  lib2.scan();
  await done;
  assert.equal(parseCalls, 1);
  assert.equal(lib2.getTracks().length, 5);
  assert.ok(lib2.getTracks().some((t) => t.title === 'Digital Love'));
  assert.ok(!lib2.getTracks().some((t) => t.title === 'no-tags'));
  assert.ok(diffs.some((d) => d.removed.length === 1));
  assert.ok(diffs.some((d) => d.added.some((t) => t.title === 'Digital Love')));
});

test('отключённая или удалённая папка скрывает треки, а «пропавший диск» не стирает кэш', async () => {
  const { music, lib } = setup();
  lib.setFolders([{ path: music, enabled: true }]);
  let done = waitDone(lib);
  lib.scan();
  await done;
  assert.equal(lib.getTracks().length, 5);

  lib.setFolders([{ path: music, enabled: false }]);
  assert.equal(lib.getTracks().length, 0);
  lib.setFolders([{ path: music, enabled: true }]);
  assert.equal(lib.getTracks().length, 5, 'при включении треки возвращаются из кэша');

  // Диск «отключили» — папки нет
  const moved = music + '-gone';
  fs.renameSync(music, moved);
  done = waitDone(lib);
  lib.scan();
  const res = await done;
  assert.equal(lib.getTracks().length, 0);
  assert.equal(res.missingRoots.length, 1);
  assert.equal(lib.cache.size, 5, 'кэш не стёрт');
  // Диск вернули
  fs.renameSync(moved, music);
  done = waitDone(lib);
  lib.scan();
  await done;
  assert.equal(lib.getTracks().length, 5);

  // Папку удалили из списка — кэш чистится
  lib.setFolders([]);
  assert.equal(lib.cache.size, 0);
});

test('watch: новый файл в папке подхватывается автоматически', async () => {
  const { music, lib } = setup();
  lib.setFolders([{ path: music, enabled: true }]);
  let done = waitDone(lib);
  lib.scan();
  await done;
  lib.watch();
  const added = new Promise((res) => lib.on('diff', (d) => { if (d.added.some((t) => t.title === 'Live Add')) res(); }));
  setTimeout(() => makeAudio(path.join(music, 'live', 'Live Add.mp3'), { tags: { title: 'Live Add', artist: 'X' } }), 200);
  lib.scheduleScan = ((orig) => (d) => orig.call(lib, 300))(lib.scheduleScan);
  await Promise.race([added, new Promise((_, rej) => setTimeout(() => rej(new Error('watch не сработал за 12 с')), 12000))]);
  lib.close();
});

test('parseFiles читает отдельные файлы вне библиотеки', async () => {
  const { music, lib } = setup();
  const f = path.join(music, 'singles', 'Muse - Uprising.ogg');
  const [t] = await lib.parseFiles([f]);
  assert.equal(t.artist, 'Muse');
  assert.equal(lib.pathFor(t.id), f);
});
