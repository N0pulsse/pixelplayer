'use strict';
const fs = require('node:fs');
const path = require('node:path');

/**
 * Простое хранилище «ключ → JSON» на диске.
 * Запись отложенная (debounce) и атомарная (tmp + rename), чтобы не потерять данные при закрытии.
 */
class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(key) {
    return path.join(this.dir, `${String(key).replace(/[^\w.-]/g, '_')}.json`);
  }

  get(key, fallback = null) {
    if (this.cache.has(key)) return this.cache.get(key);
    let value = fallback;
    try {
      value = JSON.parse(fs.readFileSync(this.file(key), 'utf8'));
    } catch { /* нет файла или он повреждён */ }
    this.cache.set(key, value);
    return value;
  }

  set(key, value, delay = 400) {
    this.cache.set(key, value);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.flushKey(key), delay));
  }

  flushKey(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (!this.cache.has(key)) return;
    const file = this.file(key);
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.cache.get(key)));
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[store] не удалось сохранить', key, e.message);
    }
  }

  flush() {
    for (const key of [...this.timers.keys()]) this.flushKey(key);
  }
}

module.exports = { Store };
