import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Cover } from '../ui/Cover';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/primitives';
import { cx, fmtTime, count, songsWord } from '../lib/util';
import { openSongMenu } from './actions';
import { user, toggleFavorite } from '../state/userdata';
import { useStore } from '../lib/store';
import { api } from '../api';

/** Мини-эквалайзер: показывает, какой трек играет сейчас. */
export function EqBars({ paused }) {
  return (
    <span className={cx('eq', paused && 'paused')} aria-hidden="true"><i /><i /><i /></span>
  );
}

export const SongRow = memo(function SongRow({
  track, index, onPlay, active, paused, number, showAlbum = true, ctx, first, last, drag, style,
}) {
  const fav = useStore(user, (s) => !!s.favorites[track.id]);
  const sub = [track.artist, showAlbum ? track.album : null].filter(Boolean).join(' · ');
  return (
    <div className={cx('row state', active && 'active', first && 'first', last && 'last')} style={style}
      onClick={() => onPlay(index)} onContextMenu={(e) => openSongMenu(e, track, ctx)} {...drag}
      role="button" tabIndex={0} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPlay(index); } }}>
      {number !== undefined ? (
        <div className="row-num t-label-l">{active ? <EqBars paused={paused} /> : number}</div>
      ) : (
        <Cover cover={track.cover} size={48} radius={14} seed={track.album || track.title} className="row-cover">
          {active && <div className="row-eq"><EqBars paused={paused} /></div>}
        </Cover>
      )}
      <div className="row-text">
        <div className="t-title-m ellipsis row-title">{track.title}</div>
        <div className="t-body-m ellipsis row-sub">{sub || 'Неизвестный исполнитель'}</div>
      </div>
      {track.lossless && <span className="badge t-label-s" title={`${track.codec || ''} ${track.sampleRate ? track.sampleRate / 1000 + ' кГц' : ''}`}>HI-FI</span>}
      <button className={cx('row-fav ibtn s state', fav && 'on-fav')} aria-label="В избранное" title="В избранное"
        onClick={(e) => { e.stopPropagation(); toggleFavorite(track.id); }}>
        <Icon name="favorite" fill={fav} />
      </button>
      <div className="row-dur t-body-m">{track.duration ? fmtTime(track.duration) : ''}</div>
      <IconButton icon="more_vert" size="s" label="Ещё" className="row-more" onClick={(e) => openSongMenu(e, track, ctx)} />
    </div>
  );
});

/** Виртуальный список фиксированной высоты строки: в DOM только то, что видно. */
export function VirtualList({ items, rowH, renderRow, overscan = 10, className }) {
  const host = useRef(null);
  const [range, setRange] = useState({ start: 0, end: 30 });

  useLayoutEffect(() => {
    const sc = host.current.closest('.screen-scroll') || window;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = host.current;
      if (!el) return;
      const scTop = sc === window ? 0 : sc.getBoundingClientRect().top;
      const viewH = sc === window ? window.innerHeight : sc.clientHeight;
      const off = el.getBoundingClientRect().top - scTop;     // отрицательное, когда список прокручен вверх
      const start = Math.max(0, Math.floor(-off / rowH) - overscan);
      const end = Math.min(items.length, Math.ceil((viewH - off) / rowH) + overscan);
      setRange((r) => (r.start === start && r.end === end ? r : { start, end }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(calc); };
    calc();
    sc.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { sc.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf); };
  }, [items.length, rowH, overscan]);

  const slice = items.slice(range.start, range.end);
  return (
    <div ref={host} className={className} style={{ height: items.length * rowH, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: range.start * rowH }}>
        {slice.map((it, i) => renderRow(it, range.start + i))}
      </div>
    </div>
  );
}

export const AlbumCard = memo(function AlbumCard({ album, onClick, onPlay, i = 0, shape }) {
  return (
    <div className="card state rise" style={{ '--i': Math.min(i, 12) }} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}>
      <Cover cover={album.cover} radius={28} seed={album.title} className="card-art" icon="album" shape={shape}>
        <button className="card-play ibtn filled" aria-label="Играть" onClick={(e) => { e.stopPropagation(); onPlay && onPlay(); }}>
          <Icon name="play_arrow" fill />
        </button>
      </Cover>
      <div className="t-title-s ellipsis card-title">{album.title}</div>
      <div className="t-body-s ellipsis card-sub">{album.artist}{album.year ? ` · ${album.year}` : ''}</div>
    </div>
  );
});

const artistImgCache = new Map();
export function useArtistImage(name) {
  const [url, setUrl] = useState(artistImgCache.get(name) || null);
  useEffect(() => {
    let off = false;
    setUrl(artistImgCache.get(name) || null);
    if (artistImgCache.has(name)) { setUrl(artistImgCache.get(name)); return undefined; }
    api.artistImage(name).then((u) => { artistImgCache.set(name, u); if (!off) setUrl(u); }).catch(() => {});
    return () => { off = true; };
  }, [name]);
  return url;
}

export const ArtistCard = memo(function ArtistCard({ artist, onClick, i = 0 }) {
  const img = useArtistImage(artist.name);
  return (
    <div className="card artist state rise" style={{ '--i': Math.min(i, 12) }} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}>
      <Cover src={img || undefined} cover={img ? null : artist.cover} thumb className="card-art round" seed={artist.name} icon="person"
        style={{ borderRadius: '50%' }} />
      <div className="t-title-s ellipsis card-title" style={{ textAlign: 'center' }}>{artist.name}</div>
      <div className="t-body-s ellipsis card-sub" style={{ textAlign: 'center' }}>{count(artist.trackIds.length, songsWord)}</div>
    </div>
  );
});

export function SectionHeader({ title, action, onAction, children }) {
  return (
    <div className="sec-head">
      <h2 className="t-headline-s">{title}</h2>
      {children}
      {action && <button className="btn text s state" onClick={onAction}>{action}<Icon name="chevron_right" /></button>}
    </div>
  );
}

/** Горизонтальная лента карточек */
export function Shelf({ children }) {
  return <div className="shelf">{children}</div>;
}
