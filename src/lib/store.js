import { useSyncExternalStore } from 'react';

/** Крошечное реактивное хранилище. Ограничение: селектор должен возвращать устойчивые значения (примитивы или те же ссылки). */
export function createStore(initial) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p) if (!Object.is(state[k], p[k])) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}

export function useStore(store, selector = (s) => s) {
  const get = () => selector(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}
