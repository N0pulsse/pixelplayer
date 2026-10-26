/**
 * Фигуры Material 3 Expressive для обрезки обложек (clip-path: polygon).
 * Все фигуры состоят из одинакового числа точек, поэтому CSS-переходы плавно «перетекают» между ними.
 */
const TAU = Math.PI * 2;
const N = 144;

const polar = (fn) => (t) => { const a = t * TAU; const r = fn(a); return [Math.cos(a) * r, Math.sin(a) * r]; };

function softPolygon(sides, roundness = 0.55, rot = -Math.PI / 2) {
  const apothem = Math.cos(Math.PI / sides);
  const raw = (a) => {
    const seg = TAU / sides;
    const d = ((((a - rot) % seg) + seg) % seg) - seg / 2;
    return apothem / Math.cos(d);
  };
  let max = 0;
  for (let i = 0; i < 360; i++) max = Math.max(max, raw((i / 360) * TAU));
  return polar((a) => {
    const p = raw(a) / max;
    return p + (1 - p) * roundness;
  });
}

const SHAPES = {
  circle: polar(() => 1),
  squircle: (t) => {
    const a = t * TAU; const c = Math.cos(a); const s = Math.sin(a); const e = 2 / 5;
    return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
  },
  oval: (t) => { const a = t * TAU; return [Math.cos(a), Math.sin(a) * 0.74]; },
  cookie9: polar((a) => 0.925 + 0.075 * Math.cos(9 * a - Math.PI / 2 * 9)),
  cookie12: polar((a) => 0.94 + 0.06 * Math.cos(12 * a)),
  cookie6: polar((a) => 0.9 + 0.1 * Math.cos(6 * a - Math.PI)),
  sunny: polar((a) => 0.85 + 0.15 * Math.cos(8 * a)),
  clover: polar((a) => 0.8 + 0.2 * Math.cos(4 * a)),
  flower: polar((a) => 0.82 + 0.18 * Math.cos(5 * a - Math.PI / 2 * 5)),
  pentagon: softPolygon(5, 0.5),
  hexagon: softPolygon(6, 0.5, 0),
  gem: softPolygon(4, 0.42, 0),
  triangle: softPolygon(3, 0.55),
  arch: (t) => { // «арка»: круглый верх, чуть скруглённый низ
    const a = t * TAU; const c = Math.cos(a); const s = Math.sin(a);
    const top = s < 0;
    const e = top ? 1 : 2 / 6;
    return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
  },
};

export const SHAPE_NAMES = Object.keys(SHAPES);
const cache = new Map();

export function shapePoints(name, n = N) {
  const key = `${name}:${n}`;
  if (cache.has(key)) return cache.get(key);
  const fn = SHAPES[name] || SHAPES.circle;
  let pts = Array.from({ length: n }, (_, i) => fn(i / n));
  // нормируем: вписываем в [-1, 1]
  let m = 0;
  for (const [x, y] of pts) m = Math.max(m, Math.abs(x), Math.abs(y));
  pts = pts.map(([x, y]) => [x / m, y / m]);
  cache.set(key, pts);
  return pts;
}

export function polygonOf(points, rotate = 0) {
  const c = Math.cos(rotate); const s = Math.sin(rotate);
  const f = (v) => (50 + 50 * v).toFixed(2);
  return `polygon(${points.map(([x, y]) => `${f(x * c - y * s)}% ${f(x * s + y * c)}%`).join(',')})`;
}

export const clipPath = (name, rotate = 0) => polygonOf(shapePoints(name), rotate);

export function morphPoints(a, b, t) {
  return a.map(([x, y], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t]);
}
