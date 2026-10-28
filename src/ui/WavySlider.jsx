import { useEffect, useRef, useState } from 'react';
import { clamp, fmtTime } from '../lib/util';

/**
 * Волнистый индикатор прогресса (как в M3 Expressive): активная часть — бегущая волна,
 * на паузе волна плавно «выпрямляется». Рисуем в canvas, перематывается мышью и стрелками.
 */
export function WavySlider({
  getPosition, duration, playing, onSeek, height = 36, amp = 3.4, wavelength = 26, stroke = 5, thumbH = 28, className, disabled = false, label = 'Перемотка',
}) {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const probe = useRef(null);
  const st = useRef({ amp: 0, phase: 0, drag: null, press: 0, w: 0, last: 0 });
  const props = useRef({});
  props.current = { getPosition, duration, playing, onSeek, amp, wavelength, stroke, thumbH, height, disabled };
  const [, force] = useState(0);

  useEffect(() => {
    const cv = canvas.current; const w = wrap.current;
    const ctx = cv.getContext('2d');
    let raf; let timer; let dpr = window.devicePixelRatio || 1;
    let colors; let colorTime = -1000;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = w.getBoundingClientRect();
      st.current.w = r.width;
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.round(props.current.height * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(w);
    resize();

    const frame = (ts) => {
      if(!probe.current || !cv.isConnected)return;
      const s = st.current; const p = props.current;
      const dt = Math.min(0.05, (ts - (s.last || ts)) / 1000);
      s.last = ts;
      const reduced = document.documentElement.dataset.motion === 'reduced' || reducedMotion.matches;
      if (reduced) s.amp = 0;
      const target = !reduced && (p.playing || s.drag !== null) ? p.amp : 0;
      s.amp += (target - s.amp) * (1 - Math.exp(-dt * 7));
      s.phase += dt * (s.amp / Math.max(0.01, p.amp)) * 2.4;
      s.press += ((s.drag !== null ? 1 : 0) - s.press) * (1 - Math.exp(-dt * 16));

      const W = s.w; const H = p.height; const cy = H / 2;
      const dur = p.duration || 0;
      const frac = s.drag !== null ? s.drag : (dur ? clamp(p.getPosition() / dur, 0, 1) : 0);
      if (!colors || ts - colorTime > 180) {
        const cs = getComputedStyle(probe.current);
        colors = { active: cs.color, track: cs.backgroundColor }; colorTime = ts;
      }
      const { active, track } = colors;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = p.stroke;
      const pad = p.stroke / 2 + 2;
      const x = pad + frac * (W - pad * 2);
      const gap = 7 - s.press * 1.5;

      // неактивная часть
      if (x + gap < W - pad) {
        ctx.strokeStyle = track;
        ctx.beginPath(); ctx.moveTo(x + gap, cy); ctx.lineTo(W - pad, cy); ctx.stroke();
      }
      // активная волна
      const end = x - gap;
      if (end > pad) {
        ctx.strokeStyle = active;
        ctx.beginPath();
        const k = (Math.PI * 2) / p.wavelength;
        for (let px = pad; px <= end; px += 1.5) {
          const edge = Math.min(1, (end - px) / 14, (px - pad) / 10 + 0.0);
          const y = cy + Math.sin(px * k - s.phase * 2.2) * s.amp * Math.max(0, edge);
          if (px === pad) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();
      } else if (end > pad - 6) {
        ctx.strokeStyle = active; ctx.beginPath(); ctx.moveTo(pad, cy); ctx.lineTo(Math.max(pad, end), cy); ctx.stroke();
      }
      // ручка
      const tw = 5 - s.press * 2;
      ctx.fillStyle = active;
      ctx.beginPath();
      ctx.roundRect(x - tw / 2, cy - p.thumbH / 2, tw, p.thumbH, tw / 2);
      ctx.fill();
      if (s.drag === null && ((!p.playing && s.amp < .01 && s.press < .01) || reduced)) {
        timer = setTimeout(() => { raf = requestAnimationFrame(frame); }, 120);
      } else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); ro.disconnect(); };
  }, []);

  const fracOf = (e) => {
    const r = wrap.current.getBoundingClientRect();
    const pad = props.current.stroke / 2 + 2;
    return clamp((e.clientX - r.left - pad) / Math.max(1, r.width - pad * 2), 0, 1);
  };
  const down = (e) => {
    if (props.current.disabled || e.button !== 0 || !props.current.duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    st.current.drag = fracOf(e);
    force((n) => n + 1);
  };
  const move = (e) => { if (st.current.drag !== null) st.current.drag = fracOf(e); };
  const up = (e) => {
    if (st.current.drag === null) return;
    const f = fracOf(e);
    st.current.drag = null;
    props.current.onSeek(f * props.current.duration);
    force((n) => n + 1);
  };
  const key = (e) => {
    if (disabled || !duration) return;
    let target;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target = getPosition() + 5;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target = getPosition() - 5;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = duration;
    else if (e.key === 'PageUp') target = getPosition() + duration / 10;
    else if (e.key === 'PageDown') target = getPosition() - duration / 10;
    if (target !== undefined) { e.preventDefault(); e.stopPropagation(); onSeek(clamp(target, 0, duration)); }
  };

  return (
    <div ref={wrap} className={`wavy ${className || ''}`} style={{ height }} role="slider" tabIndex={0} aria-label={label}
      aria-valuemin={0} aria-valuemax={Math.round(duration || 0)} aria-valuenow={Math.round(getPosition())}
      aria-valuetext={`${fmtTime(getPosition())} из ${fmtTime(duration || 0)}`} aria-disabled={disabled || !duration}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { st.current.drag = null; force((n) => n + 1); }} onKeyDown={key}>
      <canvas ref={canvas} style={{ width: '100%', height }} />
      <i ref={probe} className="wavy-probe" />
    </div>
  );
}
