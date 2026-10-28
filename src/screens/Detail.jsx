import { useMemo, useEffect, useState } from 'react';
import { api } from '../api';
import { settings } from '../state/settings';
import { norm } from '../lib/search';
import { useIndex, trackById } from '../state/library';
import { useStore } from '../lib/store';
import { user, deletePlaylist, renamePlaylist, removeFromPlaylist, setFavorites } from '../state/userdata';
import { playTracks, playShuffled, enqueue } from '../state/player';
import { go, back } from '../state/nav';
import { openDialog, openMenu, toast } from '../state/ui';
import { Button, IconButton, Empty } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Cover } from '../ui/Cover';
import { AlbumCard, SectionHeader, Shelf, useArtistImage } from '../components/Lists';
import { TrackList } from '../components/common';
import { addToPlaylistDialog } from '../components/actions';
import { exportPlaylist } from '../components/libraryActions';
import { count, songsWord, albumsWord, fmtLong, cmp } from '../lib/util';
import { SONG_SORTS } from '../state/library';

function Hero({ cover, shape, icon, title, sub, meta, tracks, label, round, children, imgSrc }) {
  const play = () => playTracks(tracks, 0, { label });
  return (
    <section className="dhero">
      <Cover cover={cover} src={imgSrc || undefined} thumb={false} size={round ? 220 : 240} radius={round ? '50%' : 44} seed={title} icon={icon}
        className="dhero-art rise" shape={shape} />
      <div className="dhero-info">
        <p className="t-label-l dhero-kind">{meta}</p>
        <h1 className="t-display-m dhero-title">{title}</h1>
        {sub && <p className="t-title-m dhero-sub">{sub}</p>}
        <div className="dhero-actions">
          <Button size="m" icon="play_arrow" iconFill onClick={play} disabled={!tracks.length}>Играть</Button>
          <Button size="m" variant="tonal" icon="shuffle" onClick={() => playShuffled(tracks, { label })} disabled={!tracks.length}>Вперемешку</Button>
          <IconButton icon="playlist_add" variant="surface" size="l" label="В очередь" onClick={() => { enqueue(tracks); }} />
          <IconButton icon="playlist_add_check" variant="surface" size="l" label="В плейлист" onClick={() => addToPlaylistDialog(tracks.map((t) => t.id))} />
          {children}
        </div>
      </div>
    </section>
  );
}

function DetailBar() {
  return (
    <div className="detail-bar">
      <IconButton icon="arrow_back" variant="surface" label="Назад" onClick={back} />
    </div>
  );
}

export function AlbumScreen({ id }) {
  const idx = useIndex();
  const album = idx.albumById.get(id);
  const tracks = useMemo(() => (album ? album.trackIds.map((t) => idx.byId.get(t)) : []), [album, idx]);
  if (!album) return <div className="screen-pad"><DetailBar /><Empty title="Альбом не найден" text="Возможно, файлы были удалены." /></div>;
  const artist = idx.artistByName.get(norm(album.artist));
  return (
    <div className="screen-pad">
      <DetailBar />
      <Hero cover={album.cover} icon="album" title={album.title} meta={`Альбом${album.year ? ` · ${album.year}` : ''}`}
        sub={album.artist} tracks={tracks} label={album.title} shape="squircle">
      </Hero>
      <p className="t-body-m dhero-stat">{count(tracks.length, songsWord)} · {fmtLong(album.duration)}
        {artist && !album.various && <> · <button className="link" onClick={() => go({ name: 'artist', id: artist.id })}>Все песни исполнителя</button></>}</p>
      <div className="list-card big"><TrackList tracks={tracks} source={{ label: album.title }} numbered showAlbum={false} ctxFor={() => ({ skipAlbum: true })} /></div>
    </div>
  );
}

export function ArtistScreen({ id }) {
  const idx = useIndex();
  const artist = idx.artistById.get(id);
  const img = useArtistImage(artist ? artist.name : '');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const online = useStore(settings, (s) => s.artistImages);
  useEffect(() => {
    let active = true;
    setProfile(null);
    if (!artist) return undefined;
    setLoading(true);
    api.artistProfile(artist.name, refresh > 0).then((data) => { if (active) setProfile(data); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [artist?.name, refresh, online]);
  const tracks = useMemo(() => (artist ? artist.trackIds.map((t) => idx.byId.get(t)).sort(SONG_SORTS.album.fn) : []), [artist, idx]);
  const albums = useMemo(() => (artist ? artist.albumIds.map((a) => idx.albumById.get(a)).filter(Boolean).sort((a, b) => (b.year || 0) - (a.year || 0)) : []), [artist, idx]);
  if (!artist) return <div className="screen-pad"><DetailBar /><Empty title="Исполнитель не найден" /></div>;
  return (
    <div className="screen-pad">
      <DetailBar />
      <section className="artist-banner" style={profile?.banner || profile?.image || img ? { '--artist-image': `url("${profile?.banner || profile?.image || img}")` } : undefined}>
        <div className="artist-banner-image" aria-hidden="true" />
        <Hero cover={artist.cover} imgSrc={profile?.image || img} icon="person" round title={artist.name} meta={profile?.genre || 'Исполнитель'}
          sub={[profile?.country, profile?.formed && `С ${profile.formed}`, `${count(albums.length, albumsWord)} · ${count(tracks.length, songsWord)} в библиотеке`].filter(Boolean).join(' · ')} tracks={tracks} label={artist.name}>
          <IconButton icon="refresh" variant="surface" size="l" label="Обновить данные артиста" disabled={loading || !online} onClick={() => setRefresh((x) => x + 1)} />
        </Hero>
      </section>
      <div className="artist-about">
        {loading && <p className="t-body-m">Ищем биографию, изображения и дискографию…</p>}
        {profile?.biography && <details><summary className="t-title-m">Об исполнителе</summary><p className="artist-bio t-body-l">{profile.biography}</p></details>}
        {profile?.source && <p className="t-body-s">Данные: <button className="link" onClick={() => api.shell.openExternal(profile.url)}>{profile.source}</button>{profile.cached ? ' · сохранённая копия' : ''}</p>}
        {!loading && !profile?.found && <p className="t-body-m">{!online ? 'Интернет-данные отключены в настройках.' : profile?.offline ? 'Сервис временно недоступен. Музыка на компьютере доступна.' : 'Надёжного совпадения в интернете не найдено.'}</p>}
      </div>
      {profile?.albums?.length > 0 && <section><SectionHeader title="Дискография в интернете" /><div className="online-albums">
        {profile.albums.map((album, i) => {
          const local = albums.find((a) => norm(a.title) === norm(album.title));
          return <button className="online-album state" key={`${album.title}:${i}`} onClick={() => local ? go({ name: 'album', id: local.id }) : api.shell.openExternal(album.url || profile.url)}>
            <Icon name={local ? 'album' : 'language'} /><span><strong>{album.title}</strong><small>{[album.year, album.type, local ? 'В библиотеке' : 'Открыть источник'].filter(Boolean).join(' · ')}</small></span><Icon name="chevron_right" />
          </button>;
        })}
      </div></section>}
      {albums.length > 0 && (
        <section>
          <SectionHeader title="Альбомы в библиотеке" />
          <Shelf>{albums.map((a, i) => <AlbumCard key={a.id} album={a} i={i} onClick={() => go({ name: 'album', id: a.id })}
            onPlay={() => playTracks(a.trackIds.map((t) => idx.byId.get(t)), 0, { label: a.title })} />)}</Shelf>
        </section>
      )}
      <section>
        <SectionHeader title="Все песни" />
        <div className="list-card big"><TrackList tracks={tracks} source={{ label: artist.name }} ctxFor={() => ({ skipArtist: true })} /></div>
      </section>
    </div>
  );
}

/** Универсальный экран «список треков»: жанр, папка, избранное, история. */
function ListScreen({ title, kind, icon, tracks, label, shape = 'cookie9', empty, ctxFor, children }) {
  return (
    <div className="screen-pad">
      <DetailBar />
      <Hero cover={tracks.find((t) => t.cover)?.cover} icon={icon} title={title} meta={kind}
        sub={`${count(tracks.length, songsWord)} · ${fmtLong(tracks.reduce((s, t) => s + (t.duration || 0), 0))}`}
        tracks={tracks} label={label || title} shape={shape}>{children}</Hero>
      {tracks.length
        ? <div className="list-card big"><TrackList tracks={tracks} source={{ label: label || title }} ctxFor={ctxFor} /></div>
        : <Empty icon={icon} title={empty || 'Пока пусто'} />}
    </div>
  );
}

export function GenreScreen({ id }) {
  const idx = useIndex();
  const g = idx.genreById.get(id);
  const tracks = useMemo(() => (g ? g.trackIds.map((t) => idx.byId.get(t)).sort(SONG_SORTS.artist.fn) : []), [g, idx]);
  if (!g) return <div className="screen-pad"><DetailBar /><Empty title="Жанр не найден" /></div>;
  return <ListScreen title={g.name} kind="Жанр" icon="piano" tracks={tracks} shape="flower" />;
}

export function FolderScreen({ id }) {
  const idx = useIndex();
  const f = idx.folderById.get(id);
  const tracks = useMemo(() => (f ? f.trackIds.map((t) => idx.byId.get(t)).sort(SONG_SORTS.album.fn) : []), [f, idx]);
  if (!f) return <div className="screen-pad"><DetailBar /><Empty title="Папка не найдена" /></div>;
  return <ListScreen title={f.name} kind={f.path} icon="folder" tracks={tracks} shape="squircle" />;
}

export function FavoritesScreen() {
  const idx = useIndex();
  const favs = useStore(user, (s) => s.favorites);
  const tracks = useMemo(() => Object.keys(favs).map((i) => idx.byId.get(i)).filter(Boolean).sort((a, b) => favs[b.id] - favs[a.id]), [idx, favs]);
  return <ListScreen title="Избранное" kind="Плейлист" icon="favorite" tracks={tracks} shape="flower" empty="Нажмите ♥ у любимых песен — они появятся здесь"><IconButton icon="download" variant="surface" size="l" label="Экспорт избранного в M3U8" disabled={!tracks.length} onClick={() => exportPlaylist('Избранное', tracks)} /></ListScreen>;
}

export function HistoryScreen() {
  const idx = useIndex();
  const history = useStore(user, (s) => s.history);
  const tracks = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const h of history) { const t = idx.byId.get(h.id); if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); } }
    return out;
  }, [idx, history]);
  return <ListScreen title="История" kind="Недавно прослушанное" icon="history" tracks={tracks} shape="cookie12" empty="Здесь появятся песни, которые вы послушали"><IconButton icon="delete" variant="surface" size="l" label="Очистить историю" disabled={!history.length} onClick={() => openDialog({ title: 'Очистить историю?', text: 'Список прослушанных песен будет очищен.', confirmLabel: 'Очистить', onConfirm: () => { user.set({ history: [] }); toast('История очищена', { icon: 'check' }); } })} /></ListScreen>;
}

export function PlaylistScreen({ id }) {
  const idx = useIndex();
  const pl = useStore(user, (s) => s.playlists.find((p) => p.id === id));
  const tracks = useMemo(() => (pl ? pl.trackIds.map(trackById).filter(Boolean) : []), [pl, idx]);
  if (!pl) return <div className="screen-pad"><DetailBar /><Empty title="Плейлист не найден" /></div>;
  return (
    <ListScreen title={pl.name} kind="Плейлист" icon="queue_music" tracks={tracks} shape="cookie9" empty="Добавляйте песни через меню «⋮» → «Добавить в плейлист»"
      ctxFor={(t) => ({ onRemove: () => removeFromPlaylist(pl.id, t.id), removeLabel: 'Убрать из плейлиста' })}>
      <IconButton icon="more_vert" variant="surface" size="l" label="Ещё" onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(), [
        { label: 'Переименовать', icon: 'edit', onClick: () => openDialog({ title: 'Переименовать', prompt: true, initial: pl.name, confirmLabel: 'Сохранить', onConfirm: (n) => renamePlaylist(pl.id, n) }) },
        { label: 'Экспорт в M3U8', icon: 'download', disabled: !tracks.length, onClick: () => exportPlaylist(pl.name, tracks) },
        { label: 'Удалить плейлист', icon: 'delete', danger: true, onClick: () => openDialog({ title: 'Удалить плейлист?', text: `«${pl.name}» будет удалён. Сами песни останутся на компьютере.`, danger: true, confirmLabel: 'Удалить', onConfirm: () => { deletePlaylist(pl.id); back(); toast('Плейлист удалён', { icon: 'delete' }); } }) },
      ], { align: 'right' })} />
    </ListScreen>
  );
}
