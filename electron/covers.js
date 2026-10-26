'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { sha1, sniffImageMime } = require('./util');

const FULL_MAX = 1200; // максимальная сторона «большой» обложки
const THUMB = 320;     // сторона миниатюры для списков

/**
 * Хранилище обложек: <key>.img — большая, <key>.t.jpg — миниатюра.
 * key = хэш содержимого картинки, поэтому одинаковые обложки у разных треков хранятся один раз.
 * nativeImage передаётся из Electron (в тестах его нет — тогда сохраняем оригинал как есть).
 */
class CoverStore {
  constructor(dir, nativeImage = null) {
    this.dir = dir;
    this.nativeImage = nativeImage;
    this.inflight = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  fullPath(key) { return path.join(this.dir, `${key}.img`); }
  thumbPath(key) { return path.join(this.dir, `${key}.t.jpg`); }

  async save(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buf.length < 64) return null;
    const key = sha1(buf).slice(0, 16);
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (fs.existsSync(this.fullPath(key)) && fs.existsSync(this.thumbPath(key))) return key;
    const job = this._write(key, buf).then(() => key).catch((e) => {
      console.error('[covers]', e.message);
      return null;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  async _write(key, buf) {
    let full = buf;
    let thumb = buf;
    const ni = this.nativeImage;
    if (ni) {
      const img = ni.createFromBuffer(buf);
      if (!img.isEmpty()) {
        const { width, height } = img.getSize();
        const max = Math.max(width, height);
        if (max > FULL_MAX) {
          const k = FULL_MAX / max;
          full = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'best' }).toJPEG(90);
        }
        const k2 = Math.min(1, THUMB / max);
        thumb = img.resize({ width: Math.max(1, Math.round(width * k2)), height: Math.max(1, Math.round(height * k2)), quality: 'good' }).toJPEG(84);
      }
    }
    await fsp.writeFile(this.fullPath(key), full);
    await fsp.writeFile(this.thumbPath(key), thumb);
  }

  /** Путь к файлу обложки либо null. */
  resolve(key, thumb) {
    if (!/^[0-9a-f]{8,40}$/.test(key)) return null;
    const p = thumb ? this.thumbPath(key) : this.fullPath(key);
    return fs.existsSync(p) ? p : null;
  }

  mimeOf(file) {
    try {
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(12);
      fs.readSync(fd, b, 0, 12, 0);
      fs.closeSync(fd);
      return sniffImageMime(b);
    } catch { return 'image/jpeg'; }
  }
}

module.exports = { CoverStore };
