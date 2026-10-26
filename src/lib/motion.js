/**
 * Пружины Material 3 Expressive → CSS linear() + длительность.
 * Значения из спецификации: spatial (с «перелётом») и effects (без него) × fast/default/slow.
 */
const SPECS = {
  'spatial-fast': { damping: 0.9, stiffness: 1400 },
  'spatial': { damping: 0.9, stiffness: 700 },
  'spatial-slow': { damping: 0.9, stiffness: 300 },
  'effects-fast': { damping: 1, stiffness: 3800 },
  'effects': { damping: 1, stiffness: 1600 },
  'effects-slow': { damping: 1, stiffness: 800 },
};
const STRETCH = 1.45; // на десктопе пружины чуть «растягиваем», так выглядит мягче

function stepResponse(zeta, w0) {
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return (t) => 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  return (t) => 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

export function spring({ damping, stiffness }, stretch = STRETCH) {
  const x = stepResponse(damping, Math.sqrt(stiffness));
  let T = 0;
  for (let t = 0; t < 4; t += 0.004) if (Math.abs(1 - x(t)) > 0.003) T = t;
  T += 0.012;
  const N = 56;
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push(Math.round(x((T * i) / N) * 10000) / 10000);
  pts[N] = 1;
  return { easing: `linear(${pts.join(', ')})`, duration: Math.round(T * 1000 * stretch) };
}

export const SPRINGS = Object.fromEntries(Object.entries(SPECS).map(([k, v]) => [k, spring(v)]));

/** Записывает --spatial-ease / --spatial-dur и т.д. в :root. */
export function installMotionTokens(root = document.documentElement) {
  for (const [k, v] of Object.entries(SPRINGS)) {
    root.style.setProperty(`--${k}-ease`, v.easing);
    root.style.setProperty(`--${k}-dur`, `${v.duration}ms`);
  }
}

/** Для Web Animations API */
export const anim = (name = 'spatial') => ({ easing: SPRINGS[name].easing, duration: SPRINGS[name].duration, fill: 'both' });
