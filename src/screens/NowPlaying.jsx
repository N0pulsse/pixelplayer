import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { ui, closeNowPlaying, openMenu } from '../state/ui';
import { settings, setSetting } from '../state/settings';
import {
  player, engine, useCurrent, usePlayer, getPosition, seek, seekBy, next, prev, toggleShuffle, cycleRepeat,
  setVolume, toggleMute, setSleep, playIndex, removeFromQueue, moveInQueue, clearQueue,
  setPlaybackRate,
} from '../state/player';
import { user, toggleFavorite } from '../state/userdata';
import { useLyrics, loadLyrics } from '../state/lyrics';
import { go } from '../state/nav';
import { getIndex } from '../state/library';
import { norm } from '../lib/search';
import { Icon } from '../ui/Icon';
import { IconButton, Slider, Button } from '../ui/primitives';
import { addToPlaylistDialog, openSongMenu } from '../components/actions';
import { Cover } from '../ui/Cover';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { WavySlider } from '../ui/WavySlider';
import { PlayButton, usePosition } from '../components/Shell';
import { EqBars } from '../components/Lists';
import { cx, fmtTime, clamp } from '../lib/util';
import { SPRINGS } from '../lib/motion';
import { api } from '../api';

/* ───────────── тексты ───────────── */

function useActiveLine(lines, offset = 0) {
  const [i, setI] = useState(-1);
  const ref = useRef(-1);
  useEffect(() => {
    if (!lines) return undefined;
    let raf;
    const loop = () => {
      const p = getPosition() + 0.12 + offset;
      let lo = 0; let hi = lines.length - 1; let r = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (lines[m].t <= p) { r = m; lo = m + 1; } else hi = m - 1; }
      if (r !== ref.current) { ref.current = r; setI(r); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lines, offset]);
  return lines ? i : -1;
}

function LyricsView({ active = true }) {
  const track = useCurrent();
  const offsets = useStore(settings, (s) => s.lyricsOffsets);
  const offset = offsets?.[track?.id] || 0;
  const changeOffset = (value) => setSetting({ lyricsOffsets: { ...offsets, [track.id]: Math.max(-30, Math.min(30, value)) } });
  const lyr = useLyrics(active);
  const [mode, setMode] = useState('synced');
  const synced = lyr.data && lyr.data.synced;
  const plain = lyr.data && (lyr.data.plain || (synced ? synced.map((l) => l.text).join('\n') : null));
  const eff = synced && mode === 'synced' ? 'synced' : 'static';
  const lines = eff === 'synced' ? synced : null;
  const act = useActiveLine(lines, offset);
  const box = useRef(null);
  const manual = useRef(0);

  useEffect(() => {
    if (eff !== 'synced' || act < 0) return;
    const el = box.current && box.current.querySelector(`[data-i="${act}"]`);
    if (!el || Date.now() - manual.current < 2500) return;
    const c = box.current;
    c.scrollTo({ top: el.offsetTop - c.clientHeight * 0.38 + el.offsetHeight / 2, behavior: 'smooth' });
  }, [act, eff]);

  if (lyr.status === 'loading') return <div className="ly-state"><LoadingIndicator size={64} /><p className="t-body-l">Ищу текст…</p></div>;
  if (!lyr.data) return (
    <div className="ly-state"><Icon name="lyrics" size={48} /><h3 className="t-headline-s">Текста нет</h3>
      <p className="t-body-l">Положите рядом с песней файл .lrc с тем же именем — или включите онлайн-поиск в настройках.</p><Button variant="tonal" icon="refresh" onClick={() => loadLyrics(track, { force: true })}>Искать заново</Button></div>
  );
  if (lyr.data.instrumental) return <div className="ly-state"><Icon name="piano" size={48} /><h3 className="t-headline-s">Инструментальная композиция</h3><p className="t-body-l">Здесь только музыка.</p></div>;

  return (
    <div className="ly">
      <div className="ly-tabs">
        <div className="seg">
          <button className={cx(eff === 'synced' && 'on')} disabled={!synced} onClick={() => setMode('synced')} style={!synced ? { opacity: .45 } : undefined}>Синхронно</button>
          <button className={cx(eff === 'static' && 'on')} onClick={() => setMode('static')}>Текстом</button>
        </div>
        <IconButton icon="refresh" size="s" label="Искать текст заново" onClick={() => loadLyrics(track, { force: true })} />
      </div>
      <div className="lyrics-tools">
        <span className="t-body-s">{lyr.data.source === 'lrclib' ? 'LRCLIB' : lyr.data.source === 'lrc' ? 'Локальный LRC' : 'Встроенный текст'}{synced ? ' · синхронизирован' : ' · обычный текст'}</span>
        {synced && <div className="lyrics-offset"><button className="btn text s" onClick={() => changeOffset(offset - 0.5)} aria-label="Текст на полсекунды позже">−0,5 с</button><button className="btn tonal s" title="Сбросить поправку" onClick={() => changeOffset(0)}>{offset > 0 ? '+' : ''}{offset.toFixed(1)} с</button><button className="btn text s" onClick={() => changeOffset(offset + 0.5)} aria-label="Текст на полсекунды раньше">+0,5 с</button></div>}
      </div>
      <div className="ly-scroll" ref={box} onWheel={() => { manual.current = Date.now(); }} onPointerDown={() => { manual.current = Date.now(); }}>
        {eff === 'synced' ? (
          <div className="ly-lines synced">
            <div className="ly-pad" />
            {lines.map((l, i) => (
              <button key={i} data-i={i} className={cx('ly-line', i === act && 'cur', i < act && 'past', !l.text && 'gap')}
                onClick={() => { seek(Math.max(0, l.t - offset)); manual.current = 0; }}>
                {l.text || '♪'}
              </button>
            ))}
            <div className="ly-pad" />
          </div>
        ) : (
          <div className="ly-lines static">
            {(plain || '').split('\n').map((t, i) => <p key={i} className={cx('ly-line static', !t.trim() && 'gap')}>{t || ' '}</p>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────── очередь ───────────── */

function QueueView({ active = true }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    if (!active) return;
    const el = box.current && box.current.querySelector('.qrow.cur');
    if (el) box.current.scrollTo({ top: el.offsetTop - 70, behavior: 'auto' });
  }, [active, queue.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = queue.length - index - 1;
  return (
    <div className="q">
      <div className="q-head">
        <div><div className="t-title-m">Очередь</div><div className="t-body-s q-sub">{queue.length} треков · далее {Math.max(0, left)}</div></div>
        <button className="btn text s state" onClick={clearQueue}>Очистить</button>
      </div>
      <div className="q-save"><Button size="s" variant="tonal" icon="playlist_add" disabled={!queue.length} onClick={() => addToPlaylistDialog(queue.map((t) => t.id))}>Сохранить очередь</Button></div>
      <div className="q-list" ref={box}>
        {queue.map((t, i) => (
          <div key={t.id + ':' + i} className={cx('qrow state', i === index && 'cur', over === i && drag !== null && drag !== i && (drag < i ? 'over-b' : 'over-t'), drag === i && 'dragging')}
            draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
            onDragOver={(e) => { e.preventDefault(); setOver(i); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={(e) => { e.preventDefault(); if (drag !== null) moveInQueue(drag, i); setDrag(null); setOver(null); }}
            onClick={() => playIndex(i)}>
            <Icon name="drag_indicator" className="q-grip" />
            <Cover cover={t.cover} size={44} radius={12} seed={t.album || t.title}>{i === index && <div className="row-eq"><EqBars paused={!playing} /></div>}</Cover>
            <div className="row-text"><div className="t-title-s ellipsis">{t.title}</div><div className="t-body-s ellipsis row-sub">{t.artist}</div></div>
            <span className="t-body-s q-dur">{fmtTime(t.duration)}</span>
            <IconButton icon="close" size="xs" label="Убрать" onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── главный экран плеера ───────────── */

function VolumeBlock() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  return (
    <div className="np-vol">
      <IconButton icon={muted || volume === 0 ? 'volume_off' : volume < 0.4 ? 'volume_down' : 'volume_up'} size="s" label="Звук" onClick={toggleMute} />
      <Slider size="sm" value={muted ? 0 : volume} onChange={setVolume} label="Громкость" format={(v) => `${Math.round(v * 100)}%`} />
    </div>
  );
}

export function NowPlaying() {
  const open = useStore(ui, (s) => s.npOpen);
  const [mounted, setMounted] = useState(open);
  const root = useRef(null);
  const closing = useRef(false);
  const reduced = useStore(settings, (s) => s.reduceMotion) || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => { if (open) { closing.current = false; setMounted(true); } }, [open]);

  // «Container transform»: плеер вырастает из мини-плеера и сворачивается обратно
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !mounted || reduced) return undefined;
    const sp = SPRINGS.spatial;
    const mini = document.querySelector('[data-mini]');
    const r = (open ? ui.get().npRect : null) || (mini ? mini.getBoundingClientRect() : null);
    const W = window.innerWidth; const H = window.innerHeight;
    const from = r
      ? `inset(${r.top}px ${W - r.right}px ${H - r.bottom}px ${r.left}px round 28px)`
      : `inset(${H * 0.6}px 0px 0px 0px round 28px)`;
    const full = 'inset(0px 0px 0px 0px round 0px)';
    if (open) {
      el.animate([{ clipPath: from, opacity: 0.4 }, { clipPath: full, opacity: 1 }], { duration: sp.duration + 80, easing: sp.easing, fill: 'both' });
      const kids = el.querySelectorAll('[data-in]');
      kids.forEach((k, i) => k.animate([{ opacity: 0, transform: 'translateY(26px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: sp.duration + 120, easing: sp.easing, delay: 70 + i * 45, fill: 'backwards' }));
    }
    return undefined;
  }, [open, mounted, reduced]);

  useEffect(() => {
    if (open || !mounted || !root.current) return undefined;
    if (reduced) { setMounted(false); return undefined; }
    closing.current = true;
    const el = root.current;
    const mini = document.querySelector('[data-mini]');
    const r = mini ? mini.getBoundingClientRect() : null;
    const W = window.innerWidth; const H = window.innerHeight;
    const to = r ? `inset(${r.top}px ${W - r.right}px ${H - r.bottom}px ${r.left}px round 28px)` : `inset(${H * 0.7}px 0px 0px 0px round 28px)`;
    const a = el.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)', opacity: 1 }, { clipPath: to, opacity: 0 }],
      { duration: 340, easing: 'cubic-bezier(.3,0,.2,1)', fill: 'forwards' });
    a.onfinish = () => { if (closing.current) setMounted(false); };
    return () => { a.cancel(); };
  }, [open, mounted, reduced]);

  if (!mounted) return null;
  return <NowPlayingBody rootRef={root} />;
}

function NowPlayingBody({ rootRef }) {
  const track = useCurrent();
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const source = usePlayer((s) => s.source);
  const sleepAt = usePlayer((s) => s.sleepAt);
  const sleepEnd = usePlayer((s) => s.sleepEnd);
  const rate = usePlayer((s) => s.playbackRate);
  const fav = useStore(user, (s) => (track ? !!s.favorites[track.id] : false));
  const vw = useStore(ui, (s) => s.vw);
  const panel = useStore(ui, (s) => s.npPanel);
  const sheet = useStore(ui, (s) => s.npSheet);
  const blur = useStore(settings, (s) => s.blurBackground);
  const pos = usePosition(250);
  const wide = vw >= 1000;

  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape' && !ui.get().menu && !ui.get().dialog) { if (ui.get().npSheet) ui.set({ npSheet: null }); else closeNowPlaying(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  useEffect(() => { if (!track) closeNowPlaying(); }, [track]);
  if (!track) return null;

  const openPanel = (p) => {
    if (wide) ui.set({ npPanel: p });
    else ui.set({ npSheet: ui.get().npSheet === p ? null : p });
  };
  const goArtist = () => {
    const a = (track.artists && track.artists[0]) || track.artist;
    const art = a && getIndex().artistByName.get(norm(a));
    if (art) { closeNowPlaying(); go({ name: 'artist', id: art.id }); }
  };
  const goAlbum = () => {
    const al = getIndex().albumOfTrack.get(track.id);
    if (al) { closeNowPlaying(); go({ name: 'album', id: al }); }
  };
  const sleepMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(r, [
      { header: 'Таймер сна' },
      ...[15, 30, 45, 60].map((m) => ({ label: `Через ${m} мин`, icon: 'bedtime', onClick: () => setSleep({ minutes: m }) })),
      { label: 'После этого трека', icon: 'music_note', onClick: () => setSleep({ endOfTrack: true }) },
      ...(sleepAt || sleepEnd ? [{ divider: true }, { label: 'Выключить таймер', icon: 'close', onClick: () => setSleep({}) }] : []),
    ], { align: 'right', up: true });
  };
  const rateMenu = (e) => openMenu(e.currentTarget.getBoundingClientRect(), [
    { header: 'Скорость воспроизведения' },
    ...[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((value) => ({ label: `${value}×${value === 1 ? ' · обычная' : ''}`, checked: value === rate, onClick: () => setPlaybackRate(value) })),
  ], { align: 'right', up: true });

  const art = (
    <div className={cx('np-art', playing && 'playing')} data-in>
      <Cover cover={track.cover} thumb={false} seed={track.album || track.title} icon="music_note" className="np-art-img"
        shape={playing ? 'cookie9' : 'squircle'} />
    </div>
  );

  return (
    <div className="np" ref={rootRef} data-wide={wide}>
      <div className="np-bg" aria-hidden="true">
        {blur && track.cover && <img key={track.cover} src={api.url.cover(track.cover, true)} alt="" />}
        <div className="np-bg-shade" />
      </div>

      <header className="np-top drag">
        <IconButton icon="keyboard_arrow_down" variant="surface" label="Свернуть" className="nodrag np-btn" onClick={closeNowPlaying} />
        <div className="np-where">
          <div className="t-label-m np-kicker">Сейчас играет</div>
          {source && source.label && <div className="t-title-s ellipsis">{source.label}</div>}
        </div>
        <div className="np-top-actions nodrag">
          <IconButton icon="more_vert" variant="surface" label="Действия с треком" onClick={(e) => openSongMenu(e, track)} className="np-btn" />
          <IconButton icon="lyrics" variant="surface" label="Тексты" on={wide ? panel === 'lyrics' : sheet === 'lyrics'} onClick={() => openPanel('lyrics')} className="np-btn" />
          <IconButton icon="queue_music" variant="surface" label="Очередь" on={wide ? panel === 'queue' : sheet === 'queue'} onClick={() => openPanel('queue')} className="np-btn" />
        </div>
      </header>

      <div className="np-body">
        <section className="np-main">
          {art}
          <div className="np-info" data-in>
            <div className="np-titles">
              <h1 className="np-title t-headline-m ellipsis" onClick={goAlbum} title={track.title}>{track.title}</h1>
              <p className="np-artist t-title-m ellipsis" onClick={goArtist}>{track.artist || 'Неизвестный исполнитель'}</p>
            </div>
          </div>
          <div className="np-seek" data-in>
            <WavySlider getPosition={getPosition} duration={duration} playing={playing} onSeek={seek} height={40} amp={4} wavelength={30} stroke={6} thumbH={32} />
            <div className="np-times t-label-m"><span>{fmtTime(pos)}</span><span>{fmtTime(duration)}</span></div>
          </div>
          <div className="np-ctrl" data-in>
            <button className="np-sk state" onClick={prev} aria-label="Предыдущий"><Icon name="skip_previous" fill size={32} /></button>
            <PlayButton size={84} variant="pbnp" />
            <button className="np-sk state" onClick={next} aria-label="Следующий"><Icon name="skip_next" fill size={32} /></button>
          </div>
          <div className="np-sec" data-in>
            <div className="np-group">
              <button className={cx('np-gb state', shuffle && 'on')} onClick={toggleShuffle} aria-label="Перемешать" aria-pressed={shuffle} title="Перемешать"><Icon name="shuffle" fill={shuffle} /></button>
              <button className={cx('np-gb state', repeat !== 'off' && 'on')} onClick={cycleRepeat} aria-label={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'} aria-pressed={repeat !== 'off'} title={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}>
                <Icon name={repeat === 'one' ? 'repeat_one' : 'repeat'} fill={repeat !== 'off'} /></button>
              <button className={cx('np-gb state fav', fav && 'on')} onClick={() => toggleFavorite(track.id)} aria-label={fav ? 'Убрать из избранного' : 'В избранное'} aria-pressed={fav} title="В избранное"><Icon name="favorite" fill={fav} /></button>
            </div>
            <div className="np-extra">
              <button className="ibtn s state np-speed" aria-label="Скорость воспроизведения" title="Скорость воспроизведения" onClick={rateMenu}>{rate || 1}×</button>
              <IconButton icon="bedtime" size="s" label={sleepEnd ? 'Таймер: после трека' : sleepAt ? `Таймер: ${Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000))} мин` : 'Таймер сна'} on={!!(sleepAt || sleepEnd)} onClick={sleepMenu} />
              {wide && <VolumeBlock />}
            </div>
          </div>
        </section>

        {wide && (
          <aside className="np-side" data-in>
            <div className="np-side-tabs">
              <button className={cx('np-tab state', panel === 'lyrics' && 'on')} onClick={() => ui.set({ npPanel: 'lyrics' })}><Icon name="lyrics" size={20} />Тексты</button>
              <button className={cx('np-tab state', panel === 'queue' && 'on')} onClick={() => ui.set({ npPanel: 'queue' })}><Icon name="queue_music" size={20} />Очередь</button>
            </div>
            <div className="np-side-body">
              {panel === 'lyrics' ? <LyricsView /> : <QueueView />}
            </div>
          </aside>
        )}
      </div>

      {!wide && sheet && (
        <div className="np-sheet" key={sheet}>
          <div className="np-sheet-top">
            <IconButton icon="arrow_back" variant="surface" label="Назад" onClick={() => ui.set({ npSheet: null })} />
            <h2 className="t-title-l">{sheet === 'lyrics' ? 'Тексты' : 'Очередь'}</h2>
          </div>
          <div className="np-sheet-body">{sheet === 'lyrics' ? <LyricsView /> : <QueueView />}</div>
          <div className="np-sheet-mini">
            <PlayButton size={64} variant="pbnp" />
          </div>
        </div>
      )}
    </div>
  );
}
