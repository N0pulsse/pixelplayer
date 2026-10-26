import { createStore } from '../lib/store';
import { debounce, clamp } from '../lib/util';
import { api } from '../api';

export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: { label: 'Нейтральный', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { label: 'Больше баса', bands: [6, 5, 4, 2, 0, -1, -1, 0, 1, 1] },
  vocal: { label: 'Вокал', bands: [-3, -2, -1, 0, 2, 4, 4, 2, 0, -1] },
  rock: { label: 'Рок', bands: [4, 3, 1, -1, -2, 0, 2, 4, 4, 3] },
  electronic: { label: 'Электроника', bands: [5, 4, 1, 0, -2, 0, 2, 3, 4, 4] },
  acoustic: { label: 'Акустика', bands: [2, 2, 1, 1, 2, 2, 3, 3, 2, 2] },
};

export const DEFAULTS = {
  themeMode: 'dark',
  dynamicColor: true,
  seed: '#5170ff',
  variant: 'tonal',
  reduceMotion: false,
  blurBackground: true,
  railExpanded: false,

  crossfade: 0,
  resume: true,
  volume: 0.8,
  muted: false,
  playbackRate: 1,
  eqEnabled: false,
  eqPreset: 'flat',
  eqBands: EQ_PRESETS.flat.bands.slice(),

  minDuration: 15,
  closeToTray: false,
  onlineLyrics: true,
  artistImages: true,
};

const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? clamp(Number(value), min, max) : fallback;
export const normalizeBands = (bands) => EQ_FREQUENCIES.map((_, i) => number(Array.isArray(bands) ? bands[i] : 0, 0, -12, 12));
function normalize(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const result = { ...patch };
  for (const [key, min, max] of [['volume', 0, 1], ['playbackRate', 0.5, 2], ['crossfade', 0, 12], ['minDuration', 0, 90]]) {
    if (key in result) result[key] = number(result[key], DEFAULTS[key], min, max);
  }
  for (const key of Object.keys(DEFAULTS)) if (typeof DEFAULTS[key] === 'boolean' && key in result) result[key] = typeof result[key] === 'boolean' ? result[key] : DEFAULTS[key];
  if ('themeMode' in result && !['dark', 'light', 'system'].includes(result.themeMode)) result.themeMode = DEFAULTS.themeMode;
  if ('variant' in result && !['tonal', 'vibrant', 'expressive', 'content', 'fruit', 'rainbow', 'neutral'].includes(result.variant)) result.variant = DEFAULTS.variant;
  if ('seed' in result && !/^#[0-9a-f]{6}$/i.test(result.seed)) result.seed = DEFAULTS.seed;
  if ('eqPreset' in result && result.eqPreset !== 'custom' && !Object.hasOwn(EQ_PRESETS, result.eqPreset)) result.eqPreset = 'flat';
  if ('eqBands' in result) result.eqBands = normalizeBands(result.eqBands);
  return result;
}

let saved = {};
try { saved = normalize(api.store.getSync('settings')); } catch { /* Use defaults if the saved data cannot be read. */ }

export const settings = createStore({ ...DEFAULTS, ...saved });
const persist = debounce(() => api.store.set('settings', settings.get()), 250);
settings.subscribe(persist);
window.addEventListener('beforeunload', () => persist.flush());

export const setSetting = (patch) => settings.set(normalize(patch));

