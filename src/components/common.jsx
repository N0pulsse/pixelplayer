import { useStore } from '../lib/store';
import { libStore } from '../state/library';
import { player, playTracks, useCurrent, usePlayer, playIndex } from '../state/player';
import { go } from '../state/nav';
import { SongRow, VirtualList } from './Lists';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { Button, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { api } from '../api';
import { count, songsWord } from '../lib/util';

export const ROW_H = 68;

/** Заголовок экрана: крупный, в цвет акцента (как «Library» на скриншоте) + кнопка настроек. */
export function PageHeader({ title, sub, children, settings = true }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub && <p className="t-body-l page-sub">{sub}</p>}
      </div>
      <div className="page-actions">
        {children}
        {settings && <IconButton icon="settings" variant="tonal" label="Настройки" onClick={() => go({ name: 'settings' })} />}
      </div>
    </header>
  );
}

/** Плашка «идёт сканирование» */
export function ScanStatus() {
  const scanning = useStore(libStore, (s) => s.scanning);
  const progress = useStore(libStore, (s) => s.progress);
  const total = useStore(libStore, (s) => s.tracks.length);
  if (!scanning) return null;
  let text = 'Ищу музыку на компьютере…';
  let frac = null;
  if (progress) {
    if (progress.phase === 'walk') text = `Просматриваю папки… найдено файлов: ${progress.found}`;
    else { text = `Читаю теги: ${progress.done} из ${progress.total}`; frac = progress.total ? progress.done / progress.total : null; }
  }
  return (
    <div className="scan rise">
      <LoadingIndicator size={52} progress={frac} label="Сканирование музыки" />
      <div className="scan-text">
        <div className="t-title-m">{text}</div>
        <div className="t-body-s scan-sub">В библиотеке уже {count(total, songsWord)} — можно слушать, пока идёт поиск</div>
        {frac !== null && <div className="scan-bar"><i style={{ width: `${Math.round(frac * 100)}%` }} /></div>}
      </div>
    </div>
  );
}

/** Экран-приветствие, когда музыки не найдено */
export function Welcome() {
  const scanning = useStore(libStore, (s) => s.scanning);
  const addFolder = async () => { const p = await api.library.pick(); if (p && p.length) api.library.addFolders(p); };
  return (
    <div className="welcome">
      <div className="welcome-art">
        <span className="w-shape s1" /><span className="w-shape s2" /><span className="w-shape s3" />
        <Icon name="library_music" size={64} />
      </div>
      <h2 className="t-headline-l">{scanning ? 'Ищу вашу музыку…' : 'Здесь пока тихо'}</h2>
      <p className="t-body-l welcome-text">
        {scanning
          ? 'Просматриваю «Музыку», «Загрузки» и другие диски. Это займёт немного времени.'
          : 'Pixel Player сам ищет музыку в «Музыке», «Загрузках» и на других дисках, но тут ничего не нашлось. Укажите папку с песнями — или просто перетащите её в это окно.'}
      </p>
      <ScanStatus />
      <div className="welcome-actions">
        <Button size="m" icon="create_new_folder" onClick={addFolder}>Добавить папку</Button>
        <Button size="m" variant="tonal" icon="refresh" onClick={() => api.library.rescan(false)}>Найти снова</Button>
      </div>
    </div>
  );
}

/** Список треков с виртуализацией; нажатие запускает воспроизведение всего списка с нужного места. */
export function TrackList({ tracks, source, numbered, ctxFor, showAlbum = true, dragFor }) {
  const cur = useCurrent();
  const playing = usePlayer((s) => s.playing);
  const curId = cur ? cur.id : null;
  const onPlay = (i) => playTracks(tracks, i, source);
  return (
    <VirtualList className="tracklist" items={tracks} rowH={ROW_H}
      renderRow={(t, i) => (
        <SongRow key={t.id + ':' + i} track={t} index={i} onPlay={onPlay}
          active={curId === t.id} paused={!playing} showAlbum={showAlbum}
          number={numbered ? (t.track || i + 1) : undefined}
          ctx={ctxFor ? ctxFor(t, i) : undefined} drag={dragFor ? dragFor(t, i) : undefined}
          first={i === 0} last={i === tracks.length - 1} />
      )} />
  );
}
