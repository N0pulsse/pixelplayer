import { createStore } from '../lib/store';
import { uid } from '../lib/util';

/** Временное состояние интерфейса: открыт ли плеер, меню, диалоги, уведомления. */
export const ui = createStore({
  npOpen: false,
  npPanel: 'lyrics',        // 'lyrics' | 'queue' — правая панель на широком экране
  npSheet: null,            // 'lyrics' | 'queue' — полноэкранная панель на узком
  menu: null,
  dialog: null,
  snacks: [],
  dropping: false,
  maximized: false,
  vw: window.innerWidth,
  vh: window.innerHeight,
  libTab: 'songs',
  query: '',
  searchFilter: 'all',
  npRect: null,             // откуда «вырастает» плеер (прямоугольник мини-плеера)
});

window.addEventListener('resize', () => ui.set({ vw: window.innerWidth, vh: window.innerHeight }));

export const openNowPlaying = (rect = null) => ui.set({ npOpen: true, npRect: rect });
export const closeNowPlaying = () => ui.set({ npOpen: false, npSheet: null });

/** Уведомление-«снекбар». action: { label, onClick } */
export function toast(text, { action = null, ms = 4500, icon = null } = {}) {
  const id = uid();
  ui.set({ snacks: [...ui.get().snacks.slice(-2), { id, text, action, icon }] });
  setTimeout(() => dismissToast(id), ms);
  return id;
}
export function dismissToast(id) { ui.set({ snacks: ui.get().snacks.filter((s) => s.id !== id) }); }

/** Контекстное меню. anchor — DOMRect или {x, y}; items — [{label, icon, onClick, danger, disabled, divider, checked}] */
export function openMenu(anchor, items, opts = {}) {
  ui.set({ menu: { anchor, items, ...opts, id: uid() } });
}
export const closeMenu = () => ui.set({ menu: null });

export function openDialog(dialog) { ui.set({ dialog: { ...dialog, id: uid() } }); }
export const closeDialog = () => ui.set({ dialog: null });
