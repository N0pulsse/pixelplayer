import { useState } from 'react';
import { Icon } from './Icon';
import { api } from '../api';
import { cx, hashStr } from '../lib/util';
import { clipPath } from '../lib/shapes';

const TONES = ['secondary', 'tertiary', 'primary'];

/**
 * Обложка. Если картинки нет — тональная заглушка (цвет зависит от seed, чтобы разные альбомы отличались).
 * shape — имя фигуры (cookie9, squircle, …) для обрезки; иначе используем radius.
 */
export function Cover({ cover, src, size, radius, shape, seed = '', icon = 'music_note', thumb = true, className, style, children, rotate = 0 }) {
  const url = src || (cover ? api.url.cover(cover, thumb) : null);
  const [loadedUrl, setLoadedUrl] = useState(null);
  const [failedUrl, setFailedUrl] = useState(null);
  const ok = !!url && failedUrl !== url;
  const loaded = loadedUrl === url;
  const tone = TONES[hashStr(String(seed || cover || '')) % TONES.length];
  const st = {
    ...(size ? { width: size, height: size } : null),
    ...(radius !== undefined ? { borderRadius: radius } : null),
    ...(shape ? { clipPath: clipPath(shape, rotate), borderRadius: 0 } : null),
    '--cv-bg': `var(--md-${tone}-container)`, '--cv-fg': `var(--md-on-${tone}-container)`,
    ...style,
  };
  return (
    <div className={cx('cover', className)} style={st}>
      {(!ok || !loaded) && (
        <div className="cover-ph"><Icon name={icon} size={size ? Math.max(18, Math.round(size * 0.42)) : undefined} /></div>
      )}
      {ok && url && (
        <img src={url} alt="" draggable="false" decoding="async" className={loaded ? 'in' : ''}
          ref={(el) => { if (el && el.complete && el.naturalWidth && loadedUrl !== url) setLoadedUrl(url); }}
          onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrl(url)} />
      )}
      {children}
    </div>
  );
}
