'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
function accentHex(value) {
  const n = Number(value) >>> 0;
  return '#' + [n & 255, (n >>> 8) & 255, (n >>> 16) & 255].map((v) => v.toString(16).padStart(2, '0')).join('');
}
function dominantColor(image) {
  const bitmap = image.resize({ width: 48, height: 48 }).toBitmap();
  const bins = new Map();
  for (let i = 0; i < bitmap.length; i += 4) {
    const [b, g, r, a] = bitmap.subarray(i, i + 4);
    if (a < 120 || Math.max(r, g, b) < 32 || Math.min(r, g, b) > 236) continue;
    const key = [r >> 4, g >> 4, b >> 4].join(',');
    const item = bins.get(key) || { n: 0, r: 0, g: 0, b: 0, score: 0 };
    item.n++; item.r += r; item.g += g; item.b += b;
    item.score += 1 + (Math.max(r, g, b) - Math.min(r, g, b)) / 90;
    bins.set(key, item);
  }
  const best = [...bins.values()].sort((a, b) => b.score - a.score)[0];
  return best ? '#' + [best.r, best.g, best.b].map((v) => Math.round(v / best.n).toString(16).padStart(2, '0')).join('') : null;
}
function wallpaperPaths(config) {
  const out = [];
  function walk(value, depth = 0) {
    if (!value || depth > 16) return;
    if (typeof value === 'string' && /(?:project\.json|scene\.pkg|\.(?:mp4|webm|png|jpe?g|bmp))$/i.test(value) && path.isAbsolute(value)) out.push(value);
    else if (typeof value === 'object') {
      const keys = Object.keys(value).sort((a, b) => Number(/selected|current/i.test(b)) - Number(/selected|current/i.test(a)));
      for (const key of keys) if (!/history|recent|playlist|favorites/i.test(key)) walk(value[key], depth + 1);
    }
  }
  walk(config?.user?.general?.wallpaperconfig || config?.wallpaperconfig || config);
  return [...new Set(out)].slice(0, 12);
}
class WallpaperPalette {
  constructor({ nativeImage, platform = process.platform, windowsProbe }) { this.nativeImage = nativeImage; this.platform = platform; this.probe = windowsProbe; this.memo = null; this.at = 0; this.imageMemo = new Map(); }
  async windows() {
    if (this.probe) return this.probe();
    if (Date.now() - this.at < 30000 && this.memo) return this.memo;
    const script = "$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$a=Get-ItemPropertyValue 'HKCU:\\Software\\Microsoft\\Windows\\DWM' AccentColor;$w=Get-ItemPropertyValue 'HKCU:\\Control Panel\\Desktop' Wallpaper;$p=Get-Process wallpaper32,wallpaper64|Select-Object -First 1 -ExpandProperty Path;@{accent=$a;wallpaper=$w;engine=$p}|ConvertTo-Json -Compress";
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 });
    this.memo = JSON.parse(result.stdout.replace(/^\uFEFF/, '')); this.at = Date.now();
    return this.memo;
  }
  async image(file) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > 24 * 1024 * 1024) return null;
      const key = file + stat.mtimeMs;
      if (this.imageMemo.has(key)) return this.imageMemo.get(key);
      let img = this.nativeImage.createFromPath(file);
      if (img.isEmpty() && typeof this.nativeImage.createThumbnailFromPath === 'function') img = await this.nativeImage.createThumbnailFromPath(file, { width: 128, height: 128 });
      const color = img.isEmpty() ? null : dominantColor(img);
      this.imageMemo.clear(); this.imageMemo.set(key, color);
      return color;
    } catch { return null; }
  }
  async get(enginePath) {
    if (this.platform !== 'win32') return { color: null, source: 'Недоступно: требуется Windows', engine: false };
    let system;
    try { system = await this.windows(); } catch { return { color: null, source: 'Не удалось прочитать цвета Windows', engine: false }; }
    const folder = enginePath || (system.engine ? path.dirname(system.engine) : null);
    if (folder) {
      try {
        const configFile = path.extname(folder).toLowerCase() === '.json' ? folder : path.join(folder, 'config.json');
        const stat = await fs.stat(configFile);
        if (stat.size < 8 * 1024 * 1024) {
          const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
          for (const file of wallpaperPaths(config)) {
            const base = path.dirname(file);
            let preview;
            try { const project = JSON.parse(await fs.readFile(path.join(base, 'project.json'), 'utf8')); preview = project.preview; } catch {}
            const candidates = [preview && path.resolve(base, preview), /\.(png|jpe?g|bmp|webp)$/i.test(file) && file, path.join(base, 'preview.jpg'), path.join(base, 'preview.png')].filter(Boolean);
            for (const image of candidates) {
              const color = await this.image(image);
              if (color) return { color, source: 'Wallpaper Engine · палитра превью обоев', engine: !!system.engine, sampledAt: Date.now() };
            }
          }
        }
      } catch {}
    }
    if (system.engine && system.accent !== undefined && system.accent !== null) return { color: accentHex(system.accent), source: 'Wallpaper Engine · системный акцент Windows', engine: true, hint: 'Для динамических обоев включите настройку Wallpaper Engine, меняющую цвет Windows.' };
    const wallpaper = system.wallpaper && await this.image(system.wallpaper);
    if (wallpaper) return { color: wallpaper, source: 'Обои Windows', engine: false };
    return { color: system.accent === undefined || system.accent === null ? null : accentHex(system.accent), source: 'Акцент Windows', engine: false };
  }
}
module.exports = { WallpaperPalette, dominantColor, accentHex, wallpaperPaths };
