import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useStore } from '../lib/store';
import { spotify, spotifyCommand, spotifyError, refreshSpotify, refreshDevices, spotifyPosition } from '../state/spotify';
import { go } from '../state/nav';
import { PageHeader } from '../components/common';
import { Button, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { fmtTime } from '../lib/util';

function Art({ item, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item?.image]);
  return <div className={`sp-art ${className}`}>{item?.image && !failed ? <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon name="music_note" size={36} />}</div>;
}
const link = (item) => `https://open.spotify.com/${item.type || 'track'}/${item.id}`;

export function SpotifyControls({ compact = false }) {
  const s = useStore(spotify); const p = s.playback;
  const [position, setPosition] = useState(spotifyPosition(p));
  const [dragging, setDragging] = useState(false);
  const [volume, setVolume] = useState(p?.device?.volume ?? 50);
  useEffect(() => { if (!dragging) setPosition(spotifyPosition(p)); }, [p, dragging]);
  useEffect(() => { if (!dragging) { const t = setInterval(() => setPosition(spotifyPosition()), 500); return () => clearInterval(t); } }, [dragging]);
  useEffect(() => setVolume(p?.device?.volume ?? 50), [p?.device?.volume]);
  if (!s.status.connected) return null;
  return <section className={`sp-player ${compact ? 'sp-mini' : ''}`} aria-label="Воспроизведение Spotify">
    <div className="sp-player-top">
      <button className="sp-now" onClick={() => compact ? go({ name: 'spotify' }) : p?.track && api.shell.openExternal(link(p.track))} title={compact ? 'Открыть Spotify в плеере' : 'Открыть трек в Spotify'}>
        <Art item={p?.track} /><span><span className="sp-label">Spotify Connect</span><strong className="ellipsis">{p?.track?.title || 'Выберите музыку'}</strong><span className="t-body-m ellipsis">{p?.track?.artist || 'Откройте Spotify на ПК или телефоне'}</span></span>
      </button>
      <div className="sp-transport">
        {!compact && <IconButton icon="shuffle" label="Перемешивание Spotify" on={!!p?.shuffle} disabled={s.busy || !p || !!p?.disallows?.toggling_shuffle} onClick={() => spotifyCommand('shuffle', { value: !p?.shuffle })} />}
        <IconButton icon="skip_previous" label="Предыдущий трек Spotify" disabled={s.busy || !p || !!p?.disallows?.skipping_prev} onClick={() => spotifyCommand('previous')} />
        <IconButton icon={p?.playing ? 'pause' : 'play_arrow'} variant="filled" size="l" label={p?.playing ? 'Пауза Spotify' : 'Продолжить Spotify'} disabled={s.busy || !p || !!p?.disallows?.[p?.playing ? 'pausing' : 'resuming']} onClick={() => spotifyCommand(p?.playing ? 'pause' : 'play')} />
        <IconButton icon="skip_next" label="Следующий трек Spotify" disabled={s.busy || !p || !!p?.disallows?.skipping_next} onClick={() => spotifyCommand('next')} />
        {!compact && <IconButton icon="repeat" label={`Повтор Spotify: ${p?.repeat || 'off'}`} on={!!p && p.repeat !== 'off'} disabled={s.busy || !p || !!p?.disallows?.toggling_repeat_context} onClick={() => spotifyCommand('repeat', { value: p?.repeat === 'off' ? 'context' : p?.repeat === 'context' ? 'track' : 'off' })} />}
      </div>
      {!compact && <div className="sp-volume"><Icon name="volume_up" /><input type="range" min="0" max="100" value={volume} aria-label="Громкость Spotify" disabled={s.busy || !p || !p.device.supportsVolume || p.device.restricted} onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={() => spotifyCommand('volume', { value: volume })} onKeyUp={(e) => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) spotifyCommand('volume', { value: volume }); }} /></div>}
    </div>
    {!compact && p?.track && <div className="sp-seek"><span>{fmtTime(position / 1000)}</span><input type="range" min="0" max={p.track.duration || 1} step="1000" value={Math.min(position, p.track.duration)} aria-label="Позиция Spotify" disabled={s.busy || !!p.disallows.seeking} onPointerDown={() => setDragging(true)} onChange={(e) => setPosition(Number(e.target.value))} onPointerUp={(e) => { setDragging(false); spotifyCommand('seek', { value: Number(e.currentTarget.value) }); }} onPointerCancel={() => setDragging(false)} onKeyUp={(e) => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) spotifyCommand('seek', { value: Number(e.currentTarget.value) }); }} /><span>{fmtTime(p.track.duration / 1000)}</span></div>}
    {!compact && <div className="sp-devices"><label>Слушать на<select className="field" value={s.deviceId} onChange={(e) => { spotify.set({ deviceId: e.target.value }); spotifyCommand('transfer', { deviceId: e.target.value }); }} disabled={s.busy}><option value="">Выберите устройство</option>{s.devices.map((d) => <option key={d.id} value={d.id} disabled={d.restricted}>{d.name}{d.active ? ' · активно' : ''}{d.restricted ? ' · управление недоступно' : ''}</option>)}</select></label><IconButton icon="refresh" label="Обновить устройства Spotify" disabled={s.busy} onClick={() => { refreshDevices(); refreshSpotify(); }} /><Button variant="text" onClick={() => api.shell.openExternal('https://open.spotify.com')}>Открыть Spotify</Button></div>}
  </section>;
}

export function SpotifyMini() {
  const s = useStore(spotify);
  return s.active && s.playback?.track ? <div className="mini-wrap"><SpotifyControls compact /></div> : null;
}

export function SpotifyScreen() {
  const s = useStore(spotify);
  const [client, setClient] = useState(s.status.clientId || '');
  const [configure, setConfigure] = useState(!s.status.connected);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('playlists');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState({ items: [], nextOffset: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const requestVersion = useRef(0);
  useEffect(() => setClient(s.status.clientId || ''), [s.status.clientId]);
  useEffect(() => { if (s.status.connected) setConfigure(false); }, [s.status.connected]);
  const task = async (fn) => { setBusy(true); setError(''); try { const status = await fn(); if (status) spotify.set({ status }); } catch (e) { setError(spotifyError(e)); } finally { setBusy(false); } };
  useEffect(() => {
    let alive = true; requestVersion.current++; setPage({ items: [], nextOffset: null }); setError('');
    if (!s.status.connected) return;
    setLoading(true);
    api.spotify.browse({ kind: selected?.type || kind, id: selected?.id, query: search }).then((data) => { if (alive) setPage(data); }).catch((e) => { if (alive) setError(spotifyError(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; requestVersion.current++; };
  }, [s.status.connected, kind, selected, search, reload]);
  const more = async () => { const version = requestVersion.current; setLoading(true); setError(''); try { const data = await api.spotify.browse({ kind: selected?.type || kind, id: selected?.id, query: search, offset: page.nextOffset }); if (version === requestVersion.current) setPage((p) => ({ ...data, items: [...p.items, ...data.items] })); } catch (e) { if (version === requestVersion.current) setError(spotifyError(e)); } finally { if (version === requestVersion.current) setLoading(false); } };
  const play = (index = 0) => {
    if (!s.deviceId) { setError('Откройте Spotify, включите любую песню и обновите устройства.'); return; }
    if (selected) spotifyCommand('play', { context: selected.uri, position: page.items[index]?.position ?? 0 });
    else { const playable = page.items.filter((t) => t.playable); const t = page.items[index]; const position = playable.indexOf(t); if (position >= 0) spotifyCommand('play', { uris: playable.map((x) => x.uri).slice(0,100), position }); }
  };
  const tracks = !!selected || ['liked','search'].includes(kind);
  return <div className="screen-pad spotify-screen">
    <PageHeader title="Spotify" sub="Твоя музыка. Твои устройства."><IconButton icon="tune" variant="tonal" label="Настройки Spotify" onClick={() => setConfigure(!configure)} /></PageHeader>
    <section className="sp-hero"><div className="sp-hero-mark"><Icon name="graphic_eq" size={52} /></div><div><span className="sp-label">Pixel Player × Spotify</span><h2 className="t-headline-m">Вся коллекция — рядом</h2><p className="t-body-l">Плейлисты, любимые песни и альбомы твоего Spotify Premium.</p><p className="t-body-m">Управляй здесь, слушай через Spotify на ПК, телефоне или колонке.</p></div><span className="sp-status">{s.status.connected ? 'Подключено' : s.status.pending ? 'Ожидаем вход' : 'Нужен вход'}</span></section>
    {(configure || !s.status.connected) && <section className="sp-setup"><h2 className="t-headline-s">Подключение Spotify</h2><p>Вход проходит на сайте Spotify. Пароль плееру не нужен.</p>
      <ol><li>Создайте приложение в <button className="sp-link" onClick={() => api.shell.openExternal('https://developer.spotify.com/dashboard')}>Spotify Developers</button>, выберите Web API.</li><li>В Redirect URI добавьте <code>{s.status.redirectUri || 'http://127.0.0.1:43827/callback'}</code>. Скопируйте Client ID.</li><li>Вставьте Client ID ниже и разрешите доступ к библиотеке и управлению воспроизведением.</li></ol>
      <label>Client ID<input className="field" value={client} maxLength={32} autoComplete="off" spellCheck={false} placeholder="32 символа из настроек приложения" onChange={(e) => setClient(e.target.value)} disabled={busy || s.status.pending} /></label>
      <div className="toolbar"><Button icon="open_in_new" disabled={busy || s.status.pending || !/^[a-f0-9]{32}$/i.test(client.trim())} onClick={() => task(async () => { await api.spotify.client(client); return api.spotify.start(); })}>{s.status.connected ? 'Войти заново' : 'Подключить Spotify'}</Button>{s.status.pending && <Button variant="tonal" onClick={() => task(api.spotify.cancel)}>Отменить вход</Button>}{s.status.connected && <Button variant="text" disabled={busy} onClick={() => task(api.spotify.disconnect)}>Отключить аккаунт</Button>}</div>
      <p className="t-body-s">Токены хранятся в зашифрованном виде на этом ПК. На другом компьютере войдите заново. Доступ запрашивается только для чтения коллекции и управления Spotify. Данные Spotify не отправляются ИИ-агенту. <button className="sp-link" onClick={() => api.shell.openExternal('https://github.com/N0pulsse/pixelplayer/blob/main/docs/SPOTIFY-PRIVACY.md')}>О подключении и данных</button></p>
    </section>}
    {(error || s.error || s.status.error) && <div className="agent-error" role="alert">{error || s.error || s.status.error}<Button variant="text" disabled={loading} onClick={() => { setReload((n) => n + 1); refreshSpotify(); }}>Повторить</Button></div>}
    {s.status.connected && <><SpotifyControls /><div className="sp-tabs" role="tablist" aria-label="Библиотека Spotify">{[['playlists','Плейлисты'],['liked','Любимые треки'],['albums','Альбомы'],['search','Поиск']].map(([value,label]) => <button key={value} role="tab" aria-selected={kind === value} className={`chip state ${kind === value ? 'on' : ''}`} onClick={() => { setKind(value); setSelected(null); }}>{label}</button>)}<IconButton icon="refresh" label="Обновить коллекцию Spotify" disabled={loading} onClick={() => setReload((n) => n + 1)} /></div>
    {kind === 'search' && <form className="sp-search" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setSelected(null); }}><input className="field" aria-label="Поиск в Spotify" value={query} maxLength={200} onChange={(e) => setQuery(e.target.value)} placeholder="Песня или исполнитель" /><Button type="submit" icon="search" disabled={loading || !query.trim()}>Найти</Button></form>}
    {selected && <div className="sp-collection-head"><Button variant="tonal" icon="arrow_back" onClick={() => setSelected(null)}>Назад</Button><h2 className="t-headline-s">{selected.name}</h2><Button icon="play_arrow" disabled={s.busy} onClick={() => spotifyCommand('play', { context: selected.uri })}>Слушать</Button><Button variant="text" onClick={() => api.shell.openExternal(link(selected))}>В Spotify ↗</Button></div>}
    {!selected && kind === 'liked' && !!page.items.length && <div className="toolbar"><Button icon="play_arrow" disabled={s.busy} onClick={() => play()}>Слушать загруженные треки</Button><span className="t-body-m">{page.total} в избранном</span></div>}
    {tracks ? <div className="sp-tracks">{page.items.map((t, i) => <div className={`sp-track ${s.playback?.track?.id === t.id ? 'on' : ''}`} key={`${t.id}-${i}`}><button className="sp-track-play state" disabled={!t.playable || s.busy} onClick={() => play(i)} aria-label={`Слушать ${t.title}`}><Art item={{ ...t, image: t.image || selected?.image }} /><Icon name="play_arrow" /></button><button className="sp-track-name" disabled={!t.playable || s.busy} onClick={() => play(i)}><strong className="ellipsis">{t.title}{t.explicit && <span className="sp-explicit">E</span>}</strong><span className="t-body-m ellipsis">{t.artist}{t.album ? ` · ${t.album}` : ''}{!t.playable ? ' · недоступно' : ''}</span></button><span className="t-body-m">{fmtTime(t.duration / 1000)}</span><IconButton icon="open_in_new" size="s" label={`Открыть ${t.title} в Spotify`} onClick={() => api.shell.openExternal(link(t))} /></div>)}</div> : <div className="sp-grid">{page.items.map((item) => <button key={item.id} className="sp-card state" onClick={() => setSelected(item)}><Art item={item} /><strong className="t-title-m">{item.name}</strong><span className="t-body-m">{item.subtitle}</span></button>)}</div>}
    {loading && <div className="agent-progress" role="status"><LoadingIndicator size={44} /><span>Загружаем из Spotify…</span></div>}{!loading && !page.items.length && !error && <p className="sp-empty">{kind === 'search' && !search ? 'Найдите музыку в каталоге Spotify.' : 'Здесь пока нет доступных элементов.'}</p>}{page.nextOffset !== null && <Button variant="tonal" disabled={loading} onClick={more}>Показать ещё</Button>}
    <p className="sp-footnote t-body-s">Аудио воспроизводит выбранное устройство Spotify. Эквалайзер, скорость, кроссфейд и синхронизированные тексты Pixel Player относятся к локальным файлам.</p></>}
  </div>;
}
