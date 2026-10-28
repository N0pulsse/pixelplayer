import { useEffect, useState } from 'react';
import { createStore, useStore } from '../lib/store';
import { api } from '../api';
import { useCurrent } from './player';

/** Тексты: кэш последних запросов + хук для текущего трека. */
const cache = new Map();
const pending = new Map();
const lyrics = createStore({ id: null, status: 'idle', data: null });

export async function loadLyrics(track, { force = false } = {}) {
  if (!track) { lyrics.set({ id: null, status: 'idle', data: null }); return; }
  if (!force && cache.has(track.id)) { lyrics.set({ id: track.id, status: cache.get(track.id) ? 'ready' : 'none', data: cache.get(track.id) }); return; }
  lyrics.set({ id: track.id, status: 'loading', data: null });
  let data = null;
  try {
    if (!pending.has(track.id) || force) pending.set(track.id, api.lyrics.get(track, force));
    const job = pending.get(track.id);
    try { data = await job; } finally { if (pending.get(track.id) === job) pending.delete(track.id); }
  } catch { data = null; }
  if (data && !data.synced && !data.plain && !data.instrumental) data = null;
  cache.set(track.id, data);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  if (lyrics.get().id === track.id) lyrics.set({ status: data ? 'ready' : 'none', data });
}

/** Хук: подгружает тексты для текущего трека, когда они нужны (active). */
export function useLyrics(active = true) {
  const track = useCurrent();
  const id = track ? track.id : null;
  useEffect(() => { if (active) loadLyrics(track); }, [id, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useStore(lyrics);
  if (!track || s.id !== id) return { status: active ? 'loading' : 'idle', data: null };
  return s;
}
