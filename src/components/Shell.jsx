import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { ui, openNowPlaying } from '../state/ui';
import { settings, setSetting } from '../state/settings';
import { useRoute, go, back, rootOf, canGoBack } from '../state/nav';
import { player, useCurrent, usePlayer, toggle, next, prev, getPosition, seek, setVolume, toggleMute, engine } from '../state/player';
import { Icon } from '../ui/Icon';
import { IconButton, Slider } from '../ui/primitives';
import { Cover } from '../ui/Cover';
import { WavySlider } from '../ui/WavySlider';
import { toggleFavorite, user } from '../state/userdata';
import { cx, fmtTime } from '../lib/util';
import { api } from '../api';
import { spotify } from '../state/spotify';

export const NAV = [
  { id: 'home', label: 'Главная', icon: 'home', route: { name: 'home' } },
  { id: 'search', label: 'Поиск', icon: 'search', route: { name: 'search' } },
  { id: 'library', label: 'Библиотека', icon: 'library_music', route: { name: 'library' } },
  { id: 'online', label: 'Онлайн', icon: 'graphic_eq', route: { name: 'online' } },
  { id: 'assistant', label: 'Агент', icon: 'auto_awesome', route: { name: 'assistant' } },
];

/** Текущая секунда воспроизведения для подписей (обновляется ~4 раза в секунду). */
export function usePosition(ms = 250) {
  const [p, setP] = useState(getPosition());
  useEffect(() => {
    const t = setInterval(() => setP(getPosition()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return p;
}

/** Кнопка «Играть/Пауза»: при паузе — круг/«таблетка», при игре — скруглённый квадрат (морф формы). */
export function PlayButton({ size = 56, className, variant = 'filled' }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  return (
    <button type="button" className={cx('playbtn state', variant, playing && 'playing', className)} style={{ '--s': `${size}px` }}
      onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'} aria-pressed={playing} title={playing ? 'Пауза' : 'Играть'}>
      <Icon name={playing ? 'pause' : 'play_arrow'} fill size={Math.round(size * 0.5)} />
      {buffering && playing && <span className="playbtn-spin" />}
    </button>
  );
}

export function TitleBar() {
  const maximized = useStore(ui, (s) => s.maximized);
  useEffect(() => { api.win.isMaximized().then((m) => ui.set({ maximized: m })); return api.win.onMaximize((m) => ui.set({ maximized: m })); }, []);
  const route = useRoute();
  const showBack = canGoBack();
  return (
    <div className="titlebar drag" onDoubleClick={(e) => { if (!e.target.closest('button')) api.win.toggleMaximize(); }} data-max={maximized}>
      {showBack && (
        <IconButton icon="arrow_back" size="s" label="Назад" className="nodrag tb-back" onClick={back} />
      )}
      <span className="tb-brand" aria-hidden="true"><Icon name="graphic_eq" size={18} /></span>
      <span className="tb-title t-label-l">Pixel Player</span>
      <span className="tb-context t-body-s">{NAV.find((n) => n.id === rootOf(route))?.label || (rootOf(route) === 'settings' ? 'Настройки' : 'Ваша музыка')}</span>
    </div>
  );
}

export function Rail() {
  const route = useRoute();
  const open = useStore(settings, (s) => s.railExpanded);
  const root = rootOf(route);
  return (
    <nav className={cx('rail', open && 'open')} aria-label="Навигация">
      <div className="rail-top">
        <IconButton icon="menu" size="m" label={open ? 'Свернуть меню' : 'Развернуть меню'} aria-expanded={open} onClick={() => setSetting({ railExpanded: !open })} />
        {open && <span className="rail-brand t-title-m">Ваша музыка</span>}
      </div>
      <div className="rail-items">
        {NAV.map((n) => (
          <button type="button" key={n.id} className={cx('rail-item state', root === n.id && 'on')} onClick={() => go(n.route)} aria-current={root === n.id ? 'page' : undefined}>
            <span className="rail-ind"><Icon name={n.icon} fill={root === n.id} /></span>
            <span className="rail-label t-label-m">{n.label}</span>
          </button>
        ))}
      </div>
      <div className="rail-bottom">
        <button type="button" className={cx('rail-item state', root === 'settings' && 'on')} aria-current={root === 'settings' ? 'page' : undefined} onClick={() => go({ name: 'settings' })}>
          <span className="rail-ind"><Icon name="settings" fill={root === 'settings'} /></span>
          <span className="rail-label t-label-m">Настройки</span>
        </button>
      </div>
    </nav>
  );
}

export function BottomNav() {
  const route = useRoute();
  const root = rootOf(route);
  return (
    <nav className="bnav" aria-label="Навигация">
      {[...NAV, { id: 'settings', label: 'Настройки', icon: 'settings', route: { name: 'settings' } }].map((n) => (
        <button type="button" key={n.id} className={cx('bnav-item state', root === n.id && 'on')} aria-current={root === n.id ? 'page' : undefined} onClick={() => go(n.route)}>
          <span className="bnav-ind"><Icon name={n.icon} fill={root === n.id} /></span>
          <span className="t-label-s">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function MiniPlayer() {
  const remote = useStore(spotify, (s) => s.active && !!s.playback?.track);
  const track = useCurrent();
  const playing = usePlayer((s) => s.playing);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const favorites = useStore(user, (s) => s.favorites);
  const vw = useStore(ui, (s) => s.vw);
  const ref = useRef(null);
  const wide = vw >= 1040;
  const pos = usePosition(500);
  if (!track || remote) return null;
  const open = () => openNowPlaying(ref.current.getBoundingClientRect());

  return (
    <div className="mini-wrap">
      <section ref={ref} className="mini" aria-label="Сейчас играет" onClick={(e) => { if (!e.target.closest('button, .slider, .wavy')) open(); }} data-mini>
        <div className="mini-main">
          <Cover cover={track.cover} size={56} seed={track.album || track.title} className={cx('mini-cover', playing && 'spin')}
            shape={playing ? 'cookie9' : 'squircle'} thumb />
          <button type="button" className="mini-text" title="Открыть экран воспроизведения" onClick={open}>
            <span className="t-title-m ellipsis">{track.title}</span>
            <span className="t-body-m ellipsis mini-sub">{track.artist || 'Неизвестный исполнитель'}</span>
          </button>
          <IconButton icon="favorite" fill={!!favorites[track.id]} size="s" label={favorites[track.id] ? 'Убрать из избранного' : 'В избранное'} aria-pressed={!!favorites[track.id]}
            onClick={() => toggleFavorite(track.id)} className={cx('mini-fav', favorites[track.id] && 'is-favorite')} />
          {wide && <span className="t-body-s mini-time">{fmtTime(pos)} / {fmtTime(duration)}</span>}
          <div className="mini-ctrl">
            <IconButton icon="skip_previous" fill size="m" label="Предыдущий" onClick={prev} className="mini-sk" />
            <PlayButton size={56} variant="pbmini" />
            <IconButton icon="skip_next" fill size="m" label="Следующий" onClick={next} className="mini-sk" />
          </div>
          {wide && (
            <div className="mini-vol">
              <IconButton icon={muted || volume === 0 ? 'volume_off' : volume < 0.4 ? 'volume_down' : 'volume_up'} size="s" label={muted ? 'Включить звук' : 'Выключить звук'} aria-pressed={muted} onClick={toggleMute} />
              <Slider size="sm" value={muted ? 0 : volume} onChange={setVolume} label="Громкость" className="mini-vol-s" />
            </div>
          )}
          <IconButton icon="expand_less" size="s" label="Развернуть" onClick={open} className="mini-exp" />
        </div>
        <WavySlider className="mini-wave" getPosition={getPosition} duration={duration} playing={playing} onSeek={seek}
          height={18} amp={2.2} wavelength={18} stroke={4} thumbH={14} />
      </section>
    </div>
  );
}
