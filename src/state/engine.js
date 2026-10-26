import { clamp } from '../lib/util';

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const abortError = () => Object.assign(new Error('Playback command superseded'), { name: 'AbortError' });

/** Two audio elements provide preloading and equal-power crossfades. */
export class Engine {
  constructor() {
    this.els = [new Audio(), new Audio()];
    this.cur = 0;
    this.master = 0.8;
    this.muted = false;
    this.rate = 1;
    this.fade = null;
    this.preloaded = null;
    this.handlers = new Map();
    this.timer = null;
    this.command = 0;
    this.seekGeneration = 0;
    this.playIntent = false;
    this.audioContext = null;
    this.effects = null;
    this.eqEnabled = false;
    this.eqBands = Array(10).fill(0);
    this.els.forEach((el) => {
      el.preload = 'auto';
      el.preservesPitch = true;
      for (const ev of ['playing', 'pause', 'waiting', 'canplay', 'ended', 'error', 'durationchange', 'loadedmetadata', 'seeked']) {
        el.addEventListener(ev, (e) => { if (el === this.el) this.emit(ev, e); });
      }
    });
  }

  get el() { return this.els[this.cur]; }
  get other() { return this.els[1 - this.cur]; }
  get effectsSupported() { return typeof globalThis.AudioContext === 'function' || typeof globalThis.webkitAudioContext === 'function'; }

  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev).add(fn);
    return () => this.handlers.get(ev)?.delete(fn);
  }
  emit(ev, data) { const s = this.handlers.get(ev); if (s) for (const f of s) f(data); }

  // A squared volume curve gives more useful control at low volumes.
  gain() { return this.muted ? 0 : this.master * this.master; }
  setVolume(v) { this.master = clamp(finite(v, this.master), 0, 1); this.applyVolume(); return this.master; }
  setMuted(m) { this.muted = !!m; this.applyVolume(); }
  fadeProgress() {
    const f = this.fade;
    if (!f || f.t0 === null) return 0;
    return clamp(((f.pausedAt ?? performance.now()) - f.t0) / f.dur, 0, 1);
  }
  applyVolume() {
    const g = this.gain();
    if (!this.fade) { this.el.volume = g; return; }
    const p = this.fadeProgress();
    this.fade.from.volume = clamp(g * Math.cos(p * Math.PI / 2), 0, 1);
    this.fade.to.volume = clamp(g * Math.sin(p * Math.PI / 2), 0, 1);
  }
  setPlaybackRate(value) {
    this.rate = clamp(finite(value, 1), 0.5, 2);
    this.els.forEach((el) => { el.playbackRate = this.rate; el.preservesPitch = true; });
    return this.rate;
  }

  initEffects() {
    if (this.effects) return true;
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return false;
    try {
      const ctx = new Context({ latencyHint: 'playback' });
      const input = ctx.createGain();
      const filters = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequency) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = Math.min(frequency, ctx.sampleRate / 2 - 1);
        filter.Q.value = 1.1;
        return filter;
      });
      let tail = input;
      for (const filter of filters) { tail.connect(filter); tail = filter; }
      tail.connect(ctx.destination);
      const sources = this.els.map((el) => ctx.createMediaElementSource(el));
      sources.forEach((source) => source.connect(input));
      this.audioContext = ctx;
      this.effects = { input, filters, sources };
      return true;
    } catch {
      return false;
    }
  }
  setEqualizer(enabled, bands = this.eqBands) {
    this.eqBands = Array.from({ length: 10 }, (_, i) => clamp(finite(bands[i], 0), -12, 12));
    this.eqEnabled = !!enabled;
    if (this.eqEnabled && !this.initEffects()) { this.eqEnabled = false; return false; }
    if (!this.effects) return true;
    const { input, filters } = this.effects;
    const now = this.audioContext.currentTime;
    // Leave headroom when boosting a band instead of clipping loud recordings.
    const headroom = this.eqEnabled ? Math.max(0, ...this.eqBands) : 0;
    input.gain.setTargetAtTime(10 ** (-headroom / 20), now, 0.025);
    filters.forEach((filter, i) => filter.gain.setTargetAtTime(this.eqEnabled ? this.eqBands[i] : 0, now, 0.025));
    if (this.eqEnabled && !this.paused) this.resumeContext();
    return true;
  }
  resumeContext() {
    if (this.audioContext?.state === 'suspended') return this.audioContext.resume().catch(() => {});
    return Promise.resolve();
  }

  position() { return this.el.currentTime || 0; }
  duration() { const d = this.el.duration; return Number.isFinite(d) ? d : 0; }
  get paused() { return this.el.paused; }

  startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 80);
  }
  stopTimer() { clearInterval(this.timer); this.timer = null; }

  tick() {
    if (this.fade) {
      this.applyVolume();
      if (this.fadeProgress() >= 1) this.endFade();
    }
    this.emit('tick');
  }

  endFade() {
    if (!this.fade) return;
    const { from, to } = this.fade;
    this.fade = null;
    this.release(from);
    to.volume = this.gain();
    this.emit('fadeend');
  }

  release(el) {
    try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* An unloaded element is already released. */ }
  }

  cancelFade() {
    if (!this.fade) return;
    const { from } = this.fade;
    this.fade = null;
    this.release(from);
    this.el.volume = this.gain();
    this.emit('fadeend');
  }

  async load(url, { autoplay = false, startAt = 0 } = {}) {
    const command = ++this.command;
    const seekGeneration = ++this.seekGeneration;
    this.playIntent = autoplay;
    this.cancelFade();
    this.stopTimer();
    if (this.preloaded?.url === url) {
      const old = this.el;
      this.cur = 1 - this.cur;
      this.preloaded = null;
      this.release(old);
    } else {
      this.preloaded = null;
      this.release(this.other);
      this.el.pause();
      this.el.src = url;
      this.el.load();
    }
    const el = this.el;
    el.volume = this.gain();
    el.playbackRate = this.rate;
    const seek = () => {
      if (command !== this.command || seekGeneration !== this.seekGeneration || el !== this.el) return;
      const d = Number.isFinite(el.duration) ? el.duration : Infinity;
      try { el.currentTime = clamp(finite(startAt, 0), 0, d); } catch { /* Metadata may still be unavailable. */ }
    };
    if (el.readyState >= 1) seek();
    else el.addEventListener('loadedmetadata', seek, { once: true });
    if (autoplay) {
      await this.resumeContext();
      if (command !== this.command || !this.playIntent) throw abortError();
      this.startTimer();
      try { await el.play(); }
      catch (e) { if (command !== this.command) throw abortError(); this.stopTimer(); throw e; }
      if (command !== this.command) throw abortError();
    }
  }

  async crossfadeTo(url, seconds) {
    const command = ++this.command;
    this.playIntent = true;
    this.cancelFade();
    const from = this.el;
    const to = this.other;
    if (this.preloaded?.url !== url) { to.src = url; to.load(); }
    this.preloaded = null;
    try { to.currentTime = 0; } catch { /* A freshly loaded track starts at zero. */ }
    to.playbackRate = this.rate;
    to.volume = 0;
    this.cur = 1 - this.cur;
    this.fade = { from, to, t0: null, pausedAt: null, dur: Math.max(300, finite(seconds, 0) * 1000) };
    await this.resumeContext();
    if (command !== this.command || !this.playIntent) throw abortError();
    this.startTimer();
    try {
      await to.play();
      if (command !== this.command) throw abortError();
      if (this.fade?.to === to) this.fade.t0 = this.fade.pausedAt ?? performance.now();
      if (!this.playIntent) this.pause();
    } catch (e) {
      if (command !== this.command) throw abortError();
      this.cancelFade();
      this.stopTimer();
      throw e;
    }
  }

  preload(url) {
    if (this.fade || this.preloaded?.url === url) return;
    const o = this.other;
    o.pause();
    o.src = url;
    o.playbackRate = this.rate;
    o.load();
    this.preloaded = { url };
  }
  clearPreload() {
    if (this.fade || !this.preloaded) return;
    this.preloaded = null;
    this.release(this.other);
  }

  async play() {
    this.playIntent = true;
    const command = this.command;
    await this.resumeContext();
    if (command !== this.command || !this.playIntent) throw abortError();
    if (this.fade?.t0 === null) { this.fade.t0 = performance.now(); this.fade.pausedAt = null; }
    if (this.fade?.pausedAt != null) {
      if (this.fade.t0 !== null) this.fade.t0 += performance.now() - this.fade.pausedAt;
      this.fade.pausedAt = null;
    }
    this.startTimer();
    if (this.fade) this.fade.from.play().catch(() => {});
    await this.el.play();
  }
  pause() {
    this.playIntent = false;
    // Freeze both audio and the fade clock so resuming keeps the same mix.
    if (this.fade && this.fade.pausedAt == null) this.fade.pausedAt = performance.now();
    this.el.pause();
    if (this.fade) this.fade.from.pause();
    this.stopTimer();
  }
  seek(t) {
    this.cancelFade();
    const command = this.command;
    const seekGeneration = ++this.seekGeneration;
    const el = this.el;
    const target = clamp(finite(t, 0), 0, this.duration() || Infinity);
    const apply = () => {
      if (command !== this.command || seekGeneration !== this.seekGeneration || el !== this.el) return;
      try { el.currentTime = Math.min(target, this.duration() || Infinity); } catch { /* Not every backend supports seeking. */ }
    };
    apply();
    if (el.readyState < 1) el.addEventListener('loadedmetadata', apply, { once: true });
  }
  stop() {
    this.command += 1;
    this.playIntent = false;
    this.cancelFade();
    this.preloaded = null;
    this.release(this.other);
    this.release(this.el);
    this.stopTimer();
  }
}
