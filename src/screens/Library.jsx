import { useMemo } from 'react';
import { useIndex, libStore, SONG_SORTS, ALBUM_SORTS, ARTIST_SORTS } from '../state/library';
import { useStore } from '../lib/store';
import { ui, openMenu, openDialog, toast } from '../state/ui';
import { user, createPlaylist, deletePlaylist, renamePlaylist } from '../state/userdata';
import { playTracks, playShuffled } from '../state/player';
import { go } from '../state/nav';
import { Chip, Button, IconButton, Empty } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { Cover } from '../ui/Cover';
import { AlbumCard, ArtistCard } from '../components/Lists';
import { PageHeader, ScanStatus, TrackList, Welcome } from '../components/common';
import { openAudioFiles, importPlaylist } from '../components/libraryActions';
import { count, songsWord, albumsWord, artistsWord, plural, fmtLong } from '../lib/util';

const TABS = [
  ['songs', 'Песни'], ['albums', 'Альбомы'], ['artists', 'Исполнители'],
  ['playlists', 'Плейлисты'], ['genres', 'Жанры'], ['folders', 'Папки'],
];

function SortButton({ sorts, value, onChange }) {
  return (
    <IconButton icon="sort" variant="surface" label="Сортировка" onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(),
      Object.entries(sorts).map(([k, s]) => ({ label: s.label, checked: value === k, onClick: () => onChange(k) })), { align: 'right' })} />
  );
}

export function Library() {
  const idx = useIndex();
  const ready = useStore(libStore, (s) => s.ready);
  const tab = useStore(ui, (s) => s.libTab);
  const sortSongs = useStore(ui, (s) => s.sortSongs || 'title');
  const sortAlbums = useStore(ui, (s) => s.sortAlbums || 'title');
  const sortArtists = useStore(ui, (s) => s.sortArtists || 'name');
  const playlists = useStore(user, (s) => s.playlists);
  const favCount = useStore(user, (s) => Object.keys(s.favorites).length);

  const songs = useMemo(() => [...idx.tracks].sort(SONG_SORTS[sortSongs].fn), [idx, sortSongs]);
  const albums = useMemo(() => [...idx.albums].sort(ALBUM_SORTS[sortAlbums].fn), [idx, sortAlbums]);
  const artists = useMemo(() => [...idx.artists].sort(ARTIST_SORTS[sortArtists].fn), [idx, sortArtists]);
  const genres = useMemo(() => [...idx.genres].sort((a, b) => b.trackIds.length - a.trackIds.length), [idx]);
  const folders = useMemo(() => [...idx.folders].sort((a, b) => a.path.localeCompare(b.path)), [idx]);

  if (ready && !idx.tracks.length && tab !== 'playlists') return <div className="screen-pad"><PageHeader title="Библиотека"><Button variant="tonal" icon="playlist_add" onClick={importPlaylist}>Импорт M3U</Button></PageHeader><Welcome /></div>;

  const setTab = (t) => ui.set({ libTab: t });
  const albumTracks = (a) => a.trackIds.map((id) => idx.byId.get(id));

  return (
    <div className="screen-pad">
      <PageHeader title="Библиотека"><Button variant="tonal" icon="audio_file" onClick={openAudioFiles}>Открыть</Button></PageHeader>
      <ScanStatus />
      <div className="chips" role="tablist">
        {TABS.map(([k, label]) => <Chip key={k} on={tab === k} onClick={() => setTab(k)}>{label}</Chip>)}
      </div>

      {tab === 'songs' && (
        <>
          <div className="toolbar">
            <Button variant="tonal" size="s" icon="shuffle" onClick={() => playShuffled(songs, { label: 'Все песни' })}>Вперемешку</Button>
            <Button variant="text" size="s" icon="play_arrow" onClick={() => playTracks(songs, 0, { label: 'Все песни' })}>Играть всё</Button>
            <span className="grow" />
            <span className="t-body-m toolbar-count">{count(songs.length, songsWord)} · {fmtLong(songs.reduce((s, t) => s + (t.duration || 0), 0))}</span>
            <SortButton sorts={SONG_SORTS} value={sortSongs} onChange={(k) => ui.set({ sortSongs: k })} />
          </div>
          <div className="list-card big"><TrackList tracks={songs} source={{ label: 'Все песни' }} /></div>
        </>
      )}

      {tab === 'albums' && (
        <>
          <div className="toolbar"><span className="t-body-m toolbar-count">{count(albums.length, albumsWord)}</span><span className="grow" />
            <SortButton sorts={ALBUM_SORTS} value={sortAlbums} onChange={(k) => ui.set({ sortAlbums: k })} /></div>
          <div className="grid">
            {albums.map((a, i) => <AlbumCard key={a.id} album={a} i={i} onClick={() => go({ name: 'album', id: a.id })}
              onPlay={() => playTracks(albumTracks(a), 0, { label: a.title })} />)}
          </div>
        </>
      )}

      {tab === 'artists' && (
        <>
          <div className="toolbar"><span className="t-body-m toolbar-count">{count(artists.length, artistsWord)}</span><span className="grow" />
            <SortButton sorts={ARTIST_SORTS} value={sortArtists} onChange={(k) => ui.set({ sortArtists: k })} /></div>
          <div className="grid artists">
            {artists.map((a, i) => <ArtistCard key={a.id} artist={a} i={i} onClick={() => go({ name: 'artist', id: a.id })} />)}
          </div>
        </>
      )}

      {tab === 'playlists' && (
        <div className="list-stack">
          <div className="toolbar"><Button variant="tonal" icon="playlist_add" onClick={importPlaylist}>Импорт M3U / M3U8</Button></div>
          <button className="tile state" onClick={() => go({ name: 'favorites' })}>
            <span className="tile-ico fav"><Icon name="favorite" fill /></span>
            <span className="tile-text"><span className="t-title-m">Избранное</span><span className="t-body-m tile-sub">{count(favCount, songsWord)}</span></span>
            <Icon name="chevron_right" />
          </button>
          <button className="tile state" onClick={() => go({ name: 'history' })}>
            <span className="tile-ico"><Icon name="history" /></span>
            <span className="tile-text"><span className="t-title-m">История</span><span className="t-body-m tile-sub">Недавно прослушанное</span></span>
            <Icon name="chevron_right" />
          </button>
          {playlists.map((p) => {
            const n = p.trackIds.filter((id) => idx.byId.has(id)).length;
            const first = idx.byId.get(p.trackIds[0]);
            return (
              <button key={p.id} className="tile state" onClick={() => go({ name: 'playlist', id: p.id })}>
                <Cover cover={first && first.cover} size={56} radius={16} seed={p.id} icon="queue_music" />
                <span className="tile-text"><span className="t-title-m">{p.name}</span><span className="t-body-m tile-sub">{count(n, songsWord)}</span></span>
                <Icon name="chevron_right" />
              </button>
            );
          })}
          <Button size="m" variant="tonal" icon="add" className="new-pl" onClick={() => openDialog({
            title: 'Новый плейлист', prompt: true, placeholder: 'Название', confirmLabel: 'Создать',
            onConfirm: (name) => { const pl = createPlaylist(name); go({ name: 'playlist', id: pl.id }); },
          })}>Новый плейлист</Button>
        </div>
      )}

      {tab === 'genres' && (
        genres.length ? (
          <div className="grid genres">
            {genres.map((g, i) => (
              <button key={g.id} className="genre state rise" style={{ '--i': Math.min(i, 12), '--h': (i * 47) % 3 }} onClick={() => go({ name: 'genre', id: g.id })}>
                <Cover cover={g.cover} className="genre-art" radius={0} icon="piano" seed={g.name} />
                <span className="genre-shade" />
                <span className="t-title-m genre-name">{g.name}</span>
                <span className="t-body-s genre-n">{count(g.trackIds.length, songsWord)}</span>
              </button>
            ))}
          </div>
        ) : <Empty icon="category" title="Жанры не найдены" text="В тегах ваших файлов не указан жанр." />
      )}

      {tab === 'folders' && (
        <div className="list-stack">
          {folders.map((f) => (
            <button key={f.id} className="tile state" onClick={() => go({ name: 'folder', id: f.id })}>
              <span className="tile-ico"><Icon name="folder" fill /></span>
              <span className="tile-text"><span className="t-title-m ellipsis">{f.name}</span><span className="t-body-s tile-sub ellipsis">{f.path} · {count(f.trackIds.length, songsWord)}</span></span>
              <Icon name="chevron_right" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
