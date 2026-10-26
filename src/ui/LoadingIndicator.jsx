import { useEffect, useRef } from 'react';
import { shapePoints, morphPoints, polygonOf } from '../lib/shapes';

const SEQ = ['sunny', 'cookie9', 'pentagon', 'clover', 'gem', 'flower'];
const HOLD = 520;   // мс на каждую фигуру
const MORPH = 420;  // мс на превращение

/** Expressive loading indicator: фигура вращается и превращается в другую. */
export function LoadingIndicator({ size = 48, contained = true, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const pts = SEQ.map((n) => shapePoints(n, 72));
    let raf; const t0 = performance.now();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const spring = (x) => { // пружина с лёгким «перелётом»
      const c1 = 1.7; const c3 = c1 + 1;
      return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
    };
    const frame = (now) => {
      if (document.documentElement.dataset.motion === 'reduced' || reducedMotion.matches) {
        el.style.clipPath = polygonOf(pts[0], 0);
        raf = null;
        return;
      }
      const t = now - t0;
      const cycle = HOLD + MORPH;
      const i = Math.floor(t / cycle) % SEQ.length;
      const local = t % cycle;
      const k = local < HOLD ? 0 : Math.min(1, (local - HOLD) / MORPH);
      const a = pts[i]; const b = pts[(i + 1) % SEQ.length];
      const p = k === 0 ? a : morphPoints(a, b, spring(k));
      el.style.clipPath = polygonOf(p, (t / 2600) * Math.PI * 2);
      raf = requestAnimationFrame(frame);
    };
    const syncMotion = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const observer = new MutationObserver(syncMotion);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    reducedMotion.addEventListener('change', syncMotion);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); reducedMotion.removeEventListener('change', syncMotion); };
  }, []);
  const inner = contained ? size * 0.62 : size;
  return (
    <div className={`loader ${contained ? 'contained' : ''} ${className || ''}`} style={{ width: size, height: size }} role="progressbar" aria-label="Загрузка">
      <div ref={ref} className="loader-shape" style={{ width: inner, height: inner }} />
    </div>
  );
}
