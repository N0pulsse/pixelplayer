import { createStore, useStore } from '../lib/store';

export const ROOTS = ['home', 'search', 'library', 'settings', 'assistant', 'online', 'spotify'];

export const nav = createStore({ stack: [{ name: 'spotify' }], dir: 1, tick: 0 });

export const currentRoute = () => { const s = nav.get().stack; return s[s.length - 1]; };

export function go(route) {
  const { stack, tick } = nav.get();
  const cur = stack[stack.length - 1];
  if (JSON.stringify(cur) === JSON.stringify(route)) return;
  if (ROOTS.includes(route.name)) nav.set({ stack: [route], dir: 1, tick: tick + 1 });
  else nav.set({ stack: [...stack, route], dir: 1, tick: tick + 1 });
}

export function back() {
  const { stack, tick } = nav.get();
  if (stack.length > 1) nav.set({ stack: stack.slice(0, -1), dir: -1, tick: tick + 1 });
}

export const canGoBack = () => nav.get().stack.length > 1;

/** К какому разделу навигации относится экран */
export function rootOf(route) {
  if (route.name === 'spotify') return 'spotify';
  if (route.name === 'online') return 'online';
  if (route.name === 'assistant') return 'assistant';
  if (route.name === 'home') return 'home';
  if (route.name === 'search') return 'search';
  if (route.name === 'settings') return 'settings';
  return 'library';
}

export const useRoute = () => useStore(nav, (s) => s.stack[s.stack.length - 1]);
export const useNav = () => useStore(nav);
