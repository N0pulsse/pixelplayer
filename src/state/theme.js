import { settings } from './settings';
import { player, currentTrack } from './player';
import { ui } from './ui';
import { buildTheme, applyTheme, seedFromImage } from '../lib/color';
import { installMotionTokens } from '../lib/motion';
import { api } from '../api';
import { createStore } from '../lib/store';
import { themeOverrides } from './presets';
export const wallpaperState = createStore({ color: null, source: '', checking: false, engine: false });
let checkingWallpaper = false;
export async function refreshWallpaper() {
  if (checkingWallpaper) return;
  checkingWallpaper = true; wallpaperState.set({ checking: true });
  try { wallpaperState.set(await api.wallpaper.get()); } catch { wallpaperState.set({ color: null, source: 'Цвет обоев недоступен' }); }
  finally { checkingWallpaper = false; wallpaperState.set({ checking: false }); if (settings.get().wallpaperSync) updateTheme(); }
}

let token = 0;
let lastKey = '';
let current = null;

export async function updateTheme() {
  const my = ++token;
  const s = settings.get();
  const root = document.documentElement;
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = s.themeMode === 'dark' || (s.themeMode === 'system' && sysDark);
  const cur = currentTrack();

  let seed = s.seed;
  if (s.wallpaperSync && wallpaperState.get().color) seed = wallpaperState.get().color;
  else if (s.dynamicColor && cur && cur.cover) {
    const sd = await seedFromImage(api.url.cover(cur.cover, true));
    if (my !== token) return;
    if (sd) seed = sd;
  }
  const key = `${seed}|${dark}|${s.variant}|${s.themePreset}`;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  root.dataset.preset = s.themePreset || 'material';
  if (key !== lastKey) {
    lastKey = key;
    current = { ...buildTheme(seed, { dark, variant: s.variant }), ...themeOverrides(s.themePreset, dark) };
    applyTheme(current);
  }
  syncOverlay();
}

/** Цвет системных кнопок окна (свернуть/закрыть) подстраиваем под фон. */
export function syncOverlay() {
  if (!current) return;
  const open = ui.get().npOpen;
  const bg = open ? current['primary-container'] : current.surface;
  const fg = open ? current['on-primary-container'] : current['on-surface'];
  api.win.setOverlay({ color: bg, symbolColor: fg });
}

export function initTheme() {
  installMotionTokens();
  let lastCover = null;
  settings.subscribe(() => { updateTheme(); if (settings.get().wallpaperSync && !wallpaperState.get().source) refreshWallpaper(); });
  if (settings.get().wallpaperSync) refreshWallpaper();
  setInterval(() => { if (settings.get().wallpaperSync) refreshWallpaper(); }, 15000);
  player.subscribe(() => {
    const t = currentTrack();
    const c = t ? t.cover || t.id : null;
    if (c !== lastCover) { lastCover = c; updateTheme(); }
  });
  ui.subscribe((() => { let o = false; return () => { const n = ui.get().npOpen; if (n !== o) { o = n; syncOverlay(); } }; })());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => updateTheme());
  return updateTheme();
}
