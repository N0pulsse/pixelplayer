import { useRef, useState, useCallback } from 'react';
import { Icon } from './Icon';
import { cx, clamp } from '../lib/util';

export function Button({ variant = 'filled', size = 's', shape = 'round', icon, iconFill, toggle, on, className, children, ...p }) {
  return (
    <button type="button" className={cx('btn state', variant, size, shape === 'square' && 'square', toggle && 'toggle', on && 'on', className)} aria-pressed={toggle ? !!on : undefined} {...p}>
      {icon && <Icon name={icon} fill={iconFill || on} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, fill, variant, size = 'm', shape, on, label, className, ...p }) {
  return (
    <button type="button" className={cx('ibtn state', variant, size, shape === 'square' && 'square', on && 'on', className)}
      aria-label={label} title={label} aria-pressed={typeof on === 'boolean' ? on : undefined} {...p}>
      <Icon name={icon} fill={fill || on} />
    </button>
  );
}

export function Chip({ on, children, icon, className, ...p }) {
  return (
    <button type="button" className={cx('chip state', on && 'on', className)} role="tab" aria-selected={!!on} {...p}>
      {icon && <Icon name={icon} size={18} fill={on} />}
      {children}
    </button>
  );
}

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" className={cx('switch state', on && 'on')} role="switch" aria-checked={!!on} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <Icon name="check" />
    </button>
  );
}

/**
 * Слайдер M3 Expressive: толстая «таблетка» и вертикальная ручка.
 * value в диапазоне [min, max]; onChange вызывается во время перетаскивания.
 */
export function Slider({ value, min = 0, max = 1, step = 0.01, onChange, onCommit, format, label, size, className, disabled = false }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const frac = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;

  const fromEvent = useCallback((e) => {
    const r = ref.current.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    let v = min + f * (max - min);
    if (step) v = min + Math.round((v - min) / step) * step;
    return clamp(+v.toFixed(4), min, max);
  }, [min, max, step]);

  const down = (e) => {
    if (disabled || e.button !== 0 || max <= min) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(true);
    onChange(fromEvent(e));
  };
  const move = (e) => { if (drag) onChange(fromEvent(e)); };
  const up = (e) => {
    if (!drag) return;
    setDrag(false);
    const v = fromEvent(e);
    onChange(v);
    onCommit && onCommit(v);
  };
  const key = (e) => {
    if (disabled) return;
    const big = (max - min) / 10;
    let v = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value + (step || big / 2);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value - (step || big / 2);
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    else if (e.key === 'PageUp') v = value + big;
    else if (e.key === 'PageDown') v = value - big;
    if (v !== null) { e.preventDefault(); e.stopPropagation(); v = clamp(v, min, max); onChange(v); onCommit && onCommit(v); }
  };

  return (
    <div ref={ref} className={cx('slider', size, drag && 'dragging', className)} role="slider" tabIndex={disabled ? -1 : 0}
      aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={format ? format(value) : undefined} aria-disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(false)} onLostPointerCapture={() => setDrag(false)} onKeyDown={key}>
      <div className="tr"><div className="fill" style={{ width: `${frac * 100}%` }} /></div>
      <div className="th" style={{ left: `${frac * 100}%` }} />
      {format && <div className="tip" style={{ left: `${frac * 100}%` }}>{format(value)}</div>}
    </div>
  );
}

export function Empty({ icon = 'music_off', title, text, children }) {
  return (
    <div className="empty">
      <div className="empty-art"><Icon name={icon} size={48} /></div>
      <h3 className="t-headline-s">{title}</h3>
      {text && <p className="t-body-l">{text}</p>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
