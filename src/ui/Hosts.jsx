import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { ui, closeMenu, closeDialog, dismissToast } from '../state/ui';
import { Icon } from './Icon';
import { Button } from './primitives';

/** Контекстные меню, диалоги и снекбары — рисуются поверх всего. */
export function Hosts() {
  return (<><MenuHost /><DialogHost /><SnackHost /></>);
}

function MenuHost() {
  const menu = useStore(ui, (s) => s.menu);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!menu) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    const a = menu.anchor;
    const vw = window.innerWidth; const vh = window.innerHeight;
    let x; let y; let ox = 'left'; let oy = 'top';
    if (a.width !== undefined) {
      x = menu.align === 'right' ? a.right - r.width : a.left;
      y = a.bottom + 6;
      if (menu.up || y + r.height > vh - 8) { y = a.top - r.height - 6; oy = 'bottom'; }
      if (menu.align === 'right') ox = 'right';
    } else { x = a.x; y = a.y; }
    if (x + r.width > vw - 8) { x = Math.max(8, vw - r.width - 8); ox = 'right'; }
    if (y + r.height > vh - 8) { y = Math.max(8, vh - r.height - 8); oy = 'bottom'; }
    setPos({ x: Math.max(8, x), y: Math.max(8, y), ox, oy });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
    window.addEventListener('keydown', k, true);
    window.addEventListener('blur', closeMenu);
    return () => { window.removeEventListener('keydown', k, true); window.removeEventListener('blur', closeMenu); };
  }, [menu]);

  if (!menu) return null;
  return (
    <>
      <div className="scrim" onPointerDown={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu(); }} />
      <div ref={ref} key={menu.id} className="menu" role="menu"
        style={pos ? { left: pos.x, top: pos.y, '--ox': pos.ox, '--oy': pos.oy } : { left: -999, top: -999, visibility: 'hidden' }}>
        {menu.items.map((it, i) => {
          if (it.divider) return <div key={i} className="hr" />;
          if (it.header) return <div key={i} className="mh">{it.header}</div>;
          return (
            <button key={i} className="mi" role="menuitem" disabled={it.disabled} data-danger={it.danger ? 1 : undefined}
              {...(it.danger ? { className: 'mi danger' } : {})}
              onClick={() => { closeMenu(); it.onClick && it.onClick(); }}>
              {it.icon && <Icon name={it.icon} fill={it.fill} />}
              <span className="grow ellipsis">{it.label}</span>
              {it.checked && <Icon name="check" className="check" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

function DialogHost() {
  const d = useStore(ui, (s) => s.dialog);
  const [val, setVal] = useState('');
  useEffect(() => { setVal(d && d.initial ? d.initial : ''); }, [d]);
  useEffect(() => {
    if (!d) return undefined;
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [d]);
  if (!d) return null;
  const confirm = () => { const v = val; closeDialog(); d.onConfirm && d.onConfirm(v); };
  return (
    <div className="dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
      <div className="dialog" key={d.id} role="dialog" aria-modal="true">
        <h2>{d.title}</h2>
        <div className="body">
          {d.text && <p className="t-body-l">{d.text}</p>}
          {d.prompt && (
            <input className="field" autoFocus value={val} placeholder={d.placeholder || ''} maxLength={80}
              onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} />
          )}
          {d.render && d.render({ close: closeDialog })}
        </div>
        <div className="actions">
          <Button variant="text" onClick={closeDialog}>{d.cancelLabel || 'Отмена'}</Button>
          {d.onConfirm && (
            <Button variant={d.danger ? 'danger' : 'filled'} onClick={confirm} disabled={d.prompt && !val.trim()}>
              {d.confirmLabel || 'Готово'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SnackHost() {
  const snacks = useStore(ui, (s) => s.snacks);
  return (
    <div className="snacks" aria-live="polite">
      {snacks.map((s) => (
        <div className="snack" key={s.id}>
          {s.icon && <Icon name={s.icon} />}
          <span className="grow" style={{ flex: 1 }}>{s.text}</span>
          {s.action && <Button variant="text" size="s" onClick={() => { dismissToast(s.id); s.action.onClick(); }}>{s.action.label}</Button>}
        </div>
      ))}
    </div>
  );
}
