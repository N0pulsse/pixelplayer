'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const esbuild = require('esbuild');

const bundles = new Map();
function fixture(entry, saved = {}, extraApi = {}) {
  let now = 0;
  let timerId = 0;
  const intervals = new Map();
  const timeouts = new Map();
  const data = { ...saved };
  const events = new Map();
  const audio = [];
  class FakeAudio {
    constructor() {
      this.listeners = new Map();
      this.currentTime = 0; this.duration = 120; this.readyState = 1;
      this.paused = true; this.volume = 1; this.src = ''; this.playbackRate = 1;
      audio.push(this);
    }
    addEventListener(name, callback, options) {
      const listeners = this.listeners.get(name) || [];
      listeners.push({ callback, once: options?.once });
      this.listeners.set(name, listeners);
    }
    emit(name) {
      for (const item of [...this.listeners.get(name) || []]) {
        if (item.once) this.listeners.set(name, this.listeners.get(name).filter((x) => x !== item));
        item.callback({ type: name });
      }
    }
    load() { this.currentTime = 0; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    play() {
      if (this.playError) return Promise.reject(this.playError);
      this.paused = false; this.emit('playing');
      return Promise.resolve();
    }
    pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.emit('pause'); }
  }
  const params = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  class FakeContext {
    constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'suspended'; this.destination = {}; this.sources = []; }
    createGain() { return { gain: params(), connect() {} }; }
    createBiquadFilter() { return { frequency: params(), gain: params(), Q: params(), connect() {} }; }
    createMediaElementSource(el) { this.sources.push(el); return { connect() {} }; }
    resume() { this.state = 'running'; return Promise.resolve(); }
  }
  const noop = () => {};
  const api = {
    url: { audio: (id) => `pp://app/audio/${id}`, cover: (id) => `pp://app/cover/${id}` },
    store: { getSync: (key) => data[key], get: async (key) => data[key], set: (key, value) => { data[key] = JSON.parse(JSON.stringify(value)); } },
    win: { setTitle: noop },
    library: { parseFiles: async () => [] },
    onCommand: noop, onOpenFiles: noop,
    ...extraApi,
  };
  const sandbox = {
    module: { exports: {} }, console, URL, queueMicrotask,
    Audio: FakeAudio, AudioContext: FakeContext,
    performance: { now: () => now },
    navigator: {}, location: { href: 'pp://app/index.html' },
    window: { pp: api, innerWidth: 1280, innerHeight: 800, addEventListener: (name, fn) => { const list = events.get(name) || []; list.push(fn); events.set(name, list); } },
    setInterval: (fn) => { const id = ++timerId; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn, ms) => { const id = ++timerId; timeouts.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
  };
  if (!bundles.has(entry)) {
    const result = esbuild.buildSync({
      absWorkingDir: path.join(__dirname, '..'), entryPoints: [entry],
      bundle: true, platform: 'browser', format: 'cjs', write: false,
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    });
    bundles.set(entry, result.outputFiles[0].text);
  }
  vm.runInNewContext(bundles.get(entry), sandbox, { filename: entry });
  return {
    ...sandbox.module.exports, audio, data, api, intervals, timeouts,
    advance: (ms) => { now += ms; },
    event: (name) => { for (const fn of events.get(name) || []) fn(); },
  };
}
const track = (id) => ({ id, title: `Song ${id}`, duration: 120, path: `C:\\Music\\${id}.mp3` });
const plain = (value) => JSON.parse(JSON.stringify(value));

test('crossfade pause freezes the mix; volume and mute affect both tracks immediately', async () => {
  const f = fixture('src/state/engine.js');
  const engine = new f.Engine();
  engine.setVolume(1);
  await engine.load('a', { autoplay: true });
  await engine.crossfadeTo('b', 4);
  f.advance(1000); engine.tick();
  const before = [engine.fade.from.volume, engine.fade.to.volume];
  engine.pause();
  f.advance(10000); engine.tick();
  assert.deepEqual([engine.fade.from.volume, engine.fade.to.volume], before);
  engine.setMuted(true);
  assert.equal(engine.fade.from.volume, 0);
  assert.equal(engine.fade.to.volume, 0);
  engine.setMuted(false);
  await engine.play();
  f.advance(1000); engine.tick();
  assert.ok(Math.abs(engine.fade.from.volume - Math.SQRT1_2) < 0.001);
  assert.ok(Math.abs(engine.fade.to.volume - Math.SQRT1_2) < 0.001);
  engine.setVolume(0.5);
  assert.ok(engine.fade.from.volume < 0.18);
  engine.stop();
});

test('seeking during a crossfade restores full gain on the active song', async () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  await engine.load('a', { autoplay: true });
  await engine.crossfadeTo('b', 4);
  const old = engine.fade.from;
  engine.seek(40);
  assert.equal(engine.fade, null);
  assert.equal(old.paused, true);
  assert.equal(old.src, '');
  assert.equal(engine.position(), 40);
  assert.equal(engine.el.volume, 0.8 ** 2);
});

test('a rejected crossfade releases outgoing audio and stops its clock', async () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  await engine.load('a', { autoplay: true });
  const old = engine.el;
  engine.other.playError = new Error('Unsupported format');
  await assert.rejects(engine.crossfadeTo('bad', 4), /Unsupported format/);
  assert.equal(engine.fade, null);
  assert.equal(old.paused, true);
  assert.equal(engine.timer, null);
});

test('a newer load wins over an older pending command', async () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  const first = engine.load('a', { autoplay: true }).catch((e) => e);
  await engine.load('b', { autoplay: true });
  assert.equal((await first).name, 'AbortError');
  assert.equal(engine.el.src, 'b');
  assert.equal(engine.paused, false);
});

test('a manual seek before metadata wins over the restored session position', async () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  engine.el.readyState = 0;
  await engine.load('a', { startAt: 48 });
  engine.seek(12);
  engine.el.readyState = 1;
  engine.el.emit('loadedmetadata');
  assert.equal(engine.position(), 12);
});

test('pausing before a crossfade starts can resume without an extra fade delay', async () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  await engine.load('a', { autoplay: true });
  const fade = engine.crossfadeTo('b', 4).catch((e) => e);
  engine.pause();
  assert.equal((await fade).name, 'AbortError');
  f.advance(10000);
  await engine.play();
  f.advance(2000); engine.tick();
  assert.ok(Math.abs(engine.fadeProgress() - 0.5) < 0.001);
});

test('playback speed applies to active and preloaded audio and preserves pitch', async () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  engine.setPlaybackRate(1.5);
  await engine.load('a'); engine.preload('b');
  assert.ok(engine.els.every((el) => el.playbackRate === 1.5 && el.preservesPitch));
  assert.equal(engine.setPlaybackRate(99), 2);
  assert.equal(engine.setPlaybackRate(NaN), 1);
});

test('equalizer connects both tracks, applies real filters, leaves headroom, and bypasses cleanly', () => {
  const f = fixture('src/state/engine.js'); const engine = new f.Engine();
  assert.equal(engine.setEqualizer(true, [6, 3]), true);
  assert.equal(engine.audioContext.sources.length, 2);
  assert.equal(engine.effects.filters.length, 10);
  assert.equal(engine.effects.filters[0].gain.value, 6);
  assert.equal(engine.effects.filters[1].gain.value, 3);
  assert.ok(Math.abs(engine.effects.input.gain.value - 0.501187) < 0.00001);
  engine.setEqualizer(false);
  assert.equal(engine.effects.input.gain.value, 1);
  assert.ok(engine.effects.filters.every((filter) => filter.gain.value === 0));
});

test('sleep after song takes priority over repeat-one', async () => {
  const f = fixture('src/state/player.js');
  await f.playTracks([track('a'), track('b')]);
  f.cycleRepeat(); f.cycleRepeat();
  f.setSleep({ endOfTrack: true });
  await f.next({ auto: true });
  assert.equal(f.player.get().repeat, 'one');
  assert.equal(f.player.get().sleepEnd, false);
  assert.equal(f.engine.paused, true);
  assert.equal(f.player.get().index, 0);
});

test('a timed sleep expires while paused and clears its pending deadline', async () => {
  const f = fixture('src/state/player.js');
  await f.playTracks([track('a')]);
  f.setSleep({ minutes: 1 }); f.pause();
  const timeout = [...f.timeouts.values()].find((t) => t.ms === 60000);
  assert.ok(timeout);
  timeout.fn();
  assert.equal(f.player.get().sleepAt, null);
  assert.equal(f.engine.paused, true);
});

test('shuffle queue removal only removes one occurrence of a repeated song', async () => {
  const f = fixture('src/state/player.js');
  await f.playTracks([track('a'), track('a'), track('b')]);
  f.toggleShuffle();
  const otherA = f.player.get().queue.findIndex((t, i) => t.id === 'a' && i !== f.player.get().index);
  f.removeFromQueue(otherA); f.toggleShuffle();
  assert.deepEqual(plain(f.player.get().queue.map((t) => t.id)), ['a', 'b']);
  assert.equal(f.currentTrack().id, 'a');
});

test('queue reordering preserves the actual current duplicate occurrence', async () => {
  const f = fixture('src/state/player.js');
  await f.playTracks([track('a'), track('b'), track('a')], 2);
  const key = f.currentTrack()._queueKey;
  f.moveInQueue(2, 0);
  assert.equal(f.player.get().index, 0);
  f.toggleShuffle(); f.toggleShuffle();
  assert.equal(f.currentTrack()._queueKey, key);
});

test('restoring external files retains duplicate index and position, then new playback resets position', async () => {
  let parsed = [];
  const f = fixture('src/state/player.js', { session: {
    ids: ['a', 'b', 'a'], index: 2, pos: 48, repeat: 'one',
    external: [track('a'), track('b')],
  } }, { library: { parseFiles: async (paths) => { parsed = paths; return [track('a'), track('b')]; } } });
  await f.restoreSession();
  assert.equal(parsed.length, 2);
  assert.equal(f.player.get().index, 2);
  assert.equal(f.getPosition(), 48);
  assert.equal(f.engine.paused, true);
  await f.playIndex(1);
  assert.equal(f.getPosition(), 0);
  assert.equal(f.currentTrack().id, 'b');
});

test('settings and queue session are persisted when closing before debounce expires', async () => {
  const f = fixture('src/state/player.js');
  await f.playTracks([track('a'), track('b')]);
  f.setPlaybackRate(1.25); f.setEqualizer('vocal');
  f.seek(19); f.toggleShuffle();
  f.event('beforeunload');
  assert.equal(f.data.settings.playbackRate, 1.25);
  assert.equal(f.data.settings.eqPreset, 'vocal');
  assert.equal(f.data.settings.eqEnabled, true);
  assert.equal(f.data.session.pos, 19);
  assert.equal(f.data.session.shuffle, true);
  assert.equal(f.data.session.external.length, 2);
});

test('corrupt saved audio settings are bounded instead of breaking playback', () => {
  const f = fixture('src/state/player.js', { settings: { volume: 20, playbackRate: 'oops', eqBands: [100, null], themeMode: 'invalid', variant: 'invalid' } });
  assert.equal(f.player.get().volume, 1);
  assert.equal(f.player.get().playbackRate, 1);
  assert.deepEqual(plain(f.player.get().eqBands), [12, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('duplicate audio errors schedule a single automatic skip for the failed command', async () => {
  const f = fixture('src/state/player.js');
  await f.playTracks([track('a'), track('b'), track('c')]);
  f.engine.el.emit('error'); f.engine.el.emit('error');
  const skips = [...f.timeouts.values()].filter((t) => t.ms === 400);
  assert.equal(skips.length, 1);
  await skips[0].fn();
  // The timeout callback starts an asynchronous load; let its play promise settle.
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.currentTrack().id, 'b');
});
