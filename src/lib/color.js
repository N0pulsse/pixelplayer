import {
  Hct, MaterialDynamicColors, SchemeTonalSpot, SchemeVibrant, SchemeExpressive, SchemeContent,
  SchemeNeutral, SchemeFruitSalad, SchemeRainbow, argbFromHex, hexFromArgb, sourceColorFromImageBytes,
} from '../vendor/mcu/index';

const mdc = new MaterialDynamicColors();

/** CSS-переменная → динамическая роль цвета Material 3 */
const ROLES = {
  'primary': 'primary', 'on-primary': 'onPrimary',
  'primary-container': 'primaryContainer', 'on-primary-container': 'onPrimaryContainer',
  'secondary': 'secondary', 'on-secondary': 'onSecondary',
  'secondary-container': 'secondaryContainer', 'on-secondary-container': 'onSecondaryContainer',
  'tertiary': 'tertiary', 'on-tertiary': 'onTertiary',
  'tertiary-container': 'tertiaryContainer', 'on-tertiary-container': 'onTertiaryContainer',
  'error': 'error', 'on-error': 'onError',
  'error-container': 'errorContainer', 'on-error-container': 'onErrorContainer',
  'surface': 'surface', 'on-surface': 'onSurface',
  'surface-variant': 'surfaceVariant', 'on-surface-variant': 'onSurfaceVariant',
  'surface-dim': 'surfaceDim', 'surface-bright': 'surfaceBright',
  'surface-container-lowest': 'surfaceContainerLowest', 'surface-container-low': 'surfaceContainerLow',
  'surface-container': 'surfaceContainer', 'surface-container-high': 'surfaceContainerHigh',
  'surface-container-highest': 'surfaceContainerHighest',
  'outline': 'outline', 'outline-variant': 'outlineVariant',
  'inverse-surface': 'inverseSurface', 'inverse-on-surface': 'inverseOnSurface', 'inverse-primary': 'inversePrimary',
  'scrim': 'scrim', 'shadow': 'shadow',
};

export const COLOR_VARS = Object.keys(ROLES);

export const VARIANTS = {
  tonal: { label: 'Сбалансированная', cls: SchemeTonalSpot },
  vibrant: { label: 'Яркая', cls: SchemeVibrant },
  expressive: { label: 'Выразительная', cls: SchemeExpressive },
  content: { label: 'Как на обложке', cls: SchemeContent },
  fruit: { label: 'Фруктовый салат', cls: SchemeFruitSalad },
  rainbow: { label: 'Радуга', cls: SchemeRainbow },
  neutral: { label: 'Сдержанная', cls: SchemeNeutral },
};

export const SEEDS = ['#5170ff', '#7c4dff', '#d6409f', '#e5484d', '#f08c3a', '#e2b93b', '#3fb27f', '#14a8a8', '#3aa0e8'];

const cache = new Map();

/** @returns {Record<string,string>} { 'primary': '#aabbcc', ... } */
export function buildTheme(seedHex, { dark = true, variant = 'vibrant', contrast = 0 } = {}) {
  const key = `${seedHex}|${dark}|${variant}|${contrast}`;
  if (cache.has(key)) return cache.get(key);
  const Scheme = (VARIANTS[variant] || VARIANTS.vibrant).cls;
  const scheme = new Scheme(Hct.fromInt(argbFromHex(seedHex)), dark, contrast, '2025');
  const out = {};
  for (const [cssName, method] of Object.entries(ROLES)) {
    out[cssName] = hexFromArgb(mdc[method]().getArgb(scheme));
  }
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

const seedCache = new Map();

/** Достаёт «главный» цвет из картинки (квантование Celebi + оценка Score). Возвращает '#rrggbb' или null. */
export function seedFromImage(url) {
  if (seedCache.has(url)) return seedCache.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const S = 64;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, S, S);
        const data = ctx.getImageData(0, 0, S, S).data;
        resolve(hexFromArgb(sourceColorFromImageBytes(data)));
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
  seedCache.set(url, p);
  if (seedCache.size > 300) seedCache.delete(seedCache.keys().next().value);
  return p;
}

export function applyTheme(theme, root = document.documentElement) {
  for (const [k, v] of Object.entries(theme)) root.style.setProperty(`--md-${k}`, v);
}

/** hex → rgba-строка для полупрозрачных слоёв */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
