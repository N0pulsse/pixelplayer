'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');
const { AUDIO_EXTS, withTimeout } = require('./util');

const norm = (p) => (process.platform === 'win32' ? path.normalize(p).toLowerCase() : path.normalize(p));

/** Быстрая проверка «есть ли в папке музыка» — смотрим до 2 уровней вглубь и не более ~1500 записей. */
async function hasAudio(dir, depth = 2, budget = { left: 1500 }) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return false; }
  const subdirs = [];
  for (const e of entries) {
    if (budget.left-- <= 0) return false;
    if (e.isDirectory()) subdirs.push(e.name);
    else if (AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) return true;
  }
  if (depth <= 0) return false;
  for (const d of subdirs) {
    if (d.startsWith('.') || d.startsWith('$')) continue;
    if (await hasAudio(path.join(dir, d), depth - 1, budget)) return true;
  }
  return false;
}

async function isDir(p) {
  const st = await withTimeout(fsp.stat(p).catch(() => null), 1500, null);
  return !!(st && st.isDirectory());
}

/**
 * Ищем, где на компьютере может лежать музыка.
 * @param {object} env  { musicDir, downloadsDir, homeDir, platform, env }
 * @returns {Promise<Array<{path:string, kind:string, label:string, hasMusic:boolean}>>}
 */
async function detectMusicFolders(env) {
  const platform = env.platform || process.platform;
  const penv = env.env || process.env;
  const cands = []; // {path, kind, label, always}
  const add = (p, kind, label, always = false) => {
    if (p && !cands.some((c) => norm(c.path) === norm(p))) cands.push({ path: p, kind, label, always });
  };

  add(env.musicDir, 'music', 'Музыка', true);
  if (env.homeDir) {
    add(path.join(env.homeDir, 'OneDrive', 'Music'), 'onedrive', 'OneDrive · Music');
    add(path.join(env.homeDir, 'OneDrive', 'Музыка'), 'onedrive', 'OneDrive · Музыка');
  }
  for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    if (penv[k]) {
      add(path.join(penv[k], 'Music'), 'onedrive', 'OneDrive · Music');
      add(path.join(penv[k], 'Музыка'), 'onedrive', 'OneDrive · Музыка');
    }
  }
  if (platform === 'win32') {
    if (penv.PUBLIC) add(path.join(penv.PUBLIC, 'Music'), 'public', 'Общая музыка');
    // Музыка на других дисках: D:\Music, E:\Музыка, флешки и т.п.
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const names = ['Music', 'Музыка', 'MUSIC', 'Media\\Music', 'Моя музыка', 'My Music'];
    for (const L of letters) {
      for (const n of names) add(`${L}:\\${n}`, 'drive', `${L}:\\${n.split('\\').pop()}`);
    }
  }
  add(env.downloadsDir, 'downloads', 'Загрузки');

  // Проверяем существование параллельно, с таймаутом (отключённые сетевые диски на Windows могут «висеть»)
  const checked = await Promise.all(cands.map(async (c) => {
    if (!(await isDir(c.path))) return null;
    const music = await withTimeout(hasAudio(c.path), 4000, false);
    if (!music && !c.always) return null; // «Загрузки» и прочее — только если там есть аудио
    return { path: c.path, kind: c.kind, label: c.label, hasMusic: music };
  }));
  const res = checked.filter(Boolean);
  // На разных регистрах одна и та же папка на Windows может найтись дважды
  const seen = new Set();
  return res.filter((r) => { const k = norm(r.path); if (seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { detectMusicFolders, hasAudio };
