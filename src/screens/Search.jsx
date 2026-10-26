import { useMemo, useEffect, useRef } from 'react';
import { useIndex, searchLibrary } from '../state/library';
import { useStore } from '../lib/store';
import { ui } from '../state/ui';
import { user, addRecentSearch, clearRecentSearches } from '../state/userdata';
import { playTracks, useCurrent, usePlayer } from '../state/player';
import { go } from '../state/nav';
import { Icon } from '../ui/Icon';
import { Chip, IconButton, Empty } from '../ui/primitives';
import { Cover } from '../ui/Cover';
import { AlbumCard, ArtistCard, SectionHeader, Shelf, SongRow } from '../components/Lists';
import { PageHeader } from '../components/common';
import { count } from '../lib/util';

const FILTERS = [['all', 'Всё'], ['songs', 'Песни'], ['albums', 'Альбомы'], ['artists', 'Исполнители']];

export function Search() {
  const idx = useIndex();
  const q = useStore(ui, (s) => s.query);
  const filter = useStore(ui, (s) => s.searchFilter);
  const recent = useStore(user, (s) => s.recentSearches);
  const cur = useCurrent();
  const playing = usePlayer((s) => s.playing);
  const input = useRef(null);
  useEffect(() => { input.current && input.current.focus(); }, []);

  const res = useMemo(() => (q.trim() ? searchLibrary(idx, q) : null), [idx, q]);
  const setQ = (v) => ui.set({ query: v });
  const submit = () => addRecentSearch(q);

  const empty = res && !res.tracks.length && !res.albums.length && !res.artists.length;
  const show = (k) => filter === 'all' || filter === k;
  const play = (list, i) => { submit(); playTracks(list, i, { label: `Поиск: ${q}` }); };

  return (
    <div className="screen-pad">
      <PageHeader title="Поиск" />
      <div className="searchbar">
        <Icon name="search" />
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Песни, альбомы, исполнители"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setQ(''); }} spellCheck={false} />
        {q && <IconButton icon="close" size="s" label="Очистить" onClick={() => { setQ(''); input.current.focus(); }} />}
      </div>

      {!res && (
        <>
          {recent.length > 0 && (
            <section>
              <SectionHeader title="Недавние запросы"><button className="btn text s state" onClick={clearRecentSearches}>Очистить</button></SectionHeader>
              <div className="chips wrap">{recent.map((r) => <Chip key={r} className="soft" icon="history" onClick={() => setQ(r)}>{r}</Chip>)}</div>
            </section>
          )}
          {idx.genres.length > 0 && (
            <section>
              <SectionHeader title="Жанры" />
              <div className="grid genres">
                {[...idx.genres].sort((a, b) => b.trackIds.length - a.trackIds.length).slice(0, 12).map((g, i) => (
                  <button key={g.id} className="genre state rise" style={{ '--i': i, '--h': (i * 47) % 3 }} onClick={() => go({ name: 'genre', id: g.id })}>
                    <Cover cover={g.cover} className="genre-art" radius={0} icon="piano" seed={g.name} />
                    <span className="genre-shade" /><span className="t-title-m genre-name">{g.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {!recent.length && !idx.genres.length && <Empty icon="search" title="Что послушаем?" text="Начните вводить название песни, альбома или имя исполнителя. Раскладка не важна: «ghbdtn» найдёт «привет»." />}
        </>
      )}

      {res && (
        <>
          <div className="chips" role="tablist">{FILTERS.map(([k, l]) => <Chip key={k} on={filter === k} onClick={() => ui.set({ searchFilter: k })}>{l}</Chip>)}</div>
          {empty && <Empty icon="search_off" title="Ничего не найдено" text={`По запросу «${q}» в вашей библиотеке нет совпадений.`} />}
          {show('artists') && res.artists.length > 0 && (
            <section><SectionHeader title="Исполнители" />
              <Shelf>{res.artists.map((a, i) => <ArtistCard key={a.id} artist={a} i={i} onClick={() => { submit(); go({ name: 'artist', id: a.id }); }} />)}</Shelf></section>
          )}
          {show('albums') && res.albums.length > 0 && (
            <section><SectionHeader title="Альбомы" />
              <Shelf>{res.albums.map((a, i) => <AlbumCard key={a.id} album={a} i={i} onClick={() => { submit(); go({ name: 'album', id: a.id }); }}
                onPlay={() => play(a.trackIds.map((t) => idx.byId.get(t)), 0)} />)}</Shelf></section>
          )}
          {show('songs') && res.tracks.length > 0 && (
            <section><SectionHeader title={`Песни · ${count(res.totalTracks, ['совпадение', 'совпадения', 'совпадений'])}`} />
              <div className="list-card">
                {res.tracks.map((t, i) => (
                  <SongRow key={t.id} track={t} index={i} onPlay={(k) => play(res.tracks, k)} active={cur && cur.id === t.id} paused={!playing}
                    first={i === 0} last={i === res.tracks.length - 1} />
                ))}
              </div></section>
          )}
        </>
      )}
    </div>
  );
}
