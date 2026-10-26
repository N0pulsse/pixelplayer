import { useMemo } from 'react';
import { useIndex, libStore } from '../state/library';
import { useStore } from '../lib/store';
import { user } from '../state/userdata';
import { playTracks, playShuffled, useCurrent, usePlayer } from '../state/player';
import { go } from '../state/nav';
import { Icon } from '../ui/Icon';
import { Cover } from '../ui/Cover';
import { Button } from '../ui/primitives';
import { AlbumCard, ArtistCard, SectionHeader, Shelf, SongRow } from '../components/Lists';
import { PageHeader, ScanStatus } from '../components/common';
import { openAudioFiles } from '../components/libraryActions';
import { api } from '../api';
import { toast } from '../state/ui';
import { greeting, hashStr, mulberry32, count, songsWord } from '../lib/util';
import { clipPath } from '../lib/shapes';

const BLOBS = [
  { a: 'cookie9', b: 'flower', size: 236, x: 56, y: 8, d: 0 },
  { a: 'circle', b: 'cookie6', size: 150, x: 0, y: 150, d: 1.2 },
  { a: 'squircle', b: 'sunny', size: 170, x: 270, y: 196, d: 2.4 },
  { a: 'oval', b: 'clover', size: 118, x: 296, y: 0, d: 3.1 },
];

export function buildMix(idx, u) {
  if (!idx.tracks.length) return [];
  const rnd = mulberry32(hashStr(new Date().toDateString()) ^ idx.tracks.length);
  const scored = idx.tracks.map((t) => {
    const p = u.plays[t.id];
    return [(u.favorites[t.id] ? 3 : 0) + Math.log2((p ? p.n : 0) + 1) * 1.5 + rnd() * 3.2, t];
  }).sort((a, b) => b[0] - a[0]);
  const perArtist = new Map(); const out = [];
  for (const [, t] of scored) {
    const k = t.artist || '';
    const n = perArtist.get(k) || 0;
    if (n >= 3) continue;
    perArtist.set(k, n + 1);
    out.push(t);
    if (out.length >= 30) break;
  }
  // Small libraries should still get a complete mix, even with a single artist.
  if (out.length < Math.min(30, idx.tracks.length)) {
    const selected = new Set(out.map((t) => t.id));
    for (const [, t] of scored) {
      if (!selected.has(t.id)) out.push(t);
      if (out.length >= 30) break;
    }
  }
  return out;
}

async function addMusicFolder() {
  try {
    const paths = await api.library.pick();
    if (paths?.length) await api.library.addFolders(paths);
  } catch {
    toast('Не удалось добавить папку. Попробуйте выбрать её снова.', { icon: 'error' });
  }
}

function FirstListen() {
  return (
    <div className="screen-pad home home-empty">
      <PageHeader title="Ваша музыка" sub="Знакомые песни. Новые впечатления." />
      <section className="first-listen">
        <div className="first-copy">
          <span className="hero-eyebrow"><Icon name="headphones" size={18} /> PIXEL PLAYER</span>
          <h2 className="first-title">Всё звучит.<br /><span>По-вашему.</span></h2>
          <p className="t-body-l">Соберите любимую музыку в одном месте. Добавьте папку или откройте аудиофайлы, чтобы начать слушать.</p>
          <div className="first-actions">
            <Button size="m" icon="create_new_folder" onClick={addMusicFolder}>Добавить музыку</Button>
            <Button variant="tonal" size="m" icon="audio_file" onClick={openAudioFiles}>Открыть файлы</Button>
          </div>
          <span className="first-hint t-body-s"><Icon name="drive_file_move" size={18} /> Можно перетащить файлы и папки прямо сюда</span>
        </div>
        <div className="first-art" aria-hidden="true">
          <span className="first-orbit orbit-one" /><span className="first-orbit orbit-two" />
          <div className="first-record"><span className="record-groove" /><span className="record-label"><Icon name="music_note" size={62} /></span></div>
          <span className="first-spark"><Icon name="auto_awesome" size={36} /></span>
          <span className="first-wave"><i /><i /><i /><i /><i /></span>
        </div>
      </section>
      <ScanStatus />
      <div className="intro-features">
        <div><span className="intro-icon"><Icon name="hard_drive" /></span><h3 className="t-title-m">Ваша коллекция</h3><p className="t-body-m">Локальные файлы, альбомы и плейлисты под рукой.</p></div>
        <div><span className="intro-icon"><Icon name="palette" /></span><h3 className="t-title-m">Цвет вашей музыки</h3><p className="t-body-m">Палитра меняется вместе с обложкой альбома.</p></div>
        <div><span className="intro-icon"><Icon name="graphic_eq" /></span><h3 className="t-title-m">Свой характер звука</h3><p className="t-body-m">Настройте звучание и плавные переходы между песнями.</p></div>
      </div>
      <button type="button" className="first-settings state" onClick={() => go({ name: 'settings' })}><Icon name="tune" size={20} /><span>Настроить внешний вид и звук</span><Icon name="chevron_right" size={20} /></button>
    </div>
  );
}

export function Home() {
  const idx = useIndex();
  const ready = useStore(libStore, (s) => s.ready);
  const u = useStore(user);
  const cur = useCurrent();
  const playing = usePlayer((s) => s.playing);
  const mix = useMemo(() => buildMix(idx, u), [idx, u.loaded, u.favorites, u.plays]);

  const recentAlbums = useMemo(() => [...idx.albums].sort((a, b) => b.added - a.added).slice(0, 18), [idx]);
  const recentTracks = useMemo(() => [...idx.tracks].sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 6), [idx]);
  const heard = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const h of u.history) {
      const t = idx.byId.get(h.id);
      const al = t && idx.albumOfTrack.get(t.id);
      if (al && !seen.has(al)) { seen.add(al); out.push(idx.albumById.get(al)); }
      if (out.length >= 14) break;
    }
    return out;
  }, [idx, u.history]);
  const favs = useMemo(() => Object.keys(u.favorites).map((id) => idx.byId.get(id)).filter(Boolean)
    .sort((a, b) => u.favorites[b.id] - u.favorites[a.id]), [idx, u.favorites]);
  const top = useMemo(() => Object.entries(u.plays).sort((a, b) => b[1].n - a[1].n).map(([id]) => idx.byId.get(id)).filter(Boolean).slice(0, 6), [idx, u.plays]);
  const artists = useMemo(() => [...idx.artists].sort((a, b) => b.trackIds.length - a.trackIds.length).slice(0, 16), [idx]);
  const discover = useMemo(() => {
    const rnd = mulberry32(hashStr(new Date().toDateString() + 'x'));
    const albums = [...idx.albums];
    for (let i = albums.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [albums[i], albums[j]] = [albums[j], albums[i]]; }
    return albums.slice(0, 14);
  }, [idx]);
  const unheard = useMemo(() => idx.tracks.filter((t) => !u.plays[t.id]), [idx, u.plays]);

  if (!ready) return <div className="screen-pad home" aria-busy="true"><PageHeader title="Ваша музыка" sub="Готовим библиотеку…" /><div className="home-skeleton"><span /><span /><span /></div></div>;
  if (!idx.tracks.length) return <FirstListen />;

  const blobTracks = [];
  const seenCover = new Set();
  for (const t of mix) { if (t.cover && !seenCover.has(t.cover)) { seenCover.add(t.cover); blobTracks.push(t); } if (blobTracks.length >= BLOBS.length) break; }
  for (const t of mix) { if (blobTracks.length >= BLOBS.length) break; if (!blobTracks.includes(t)) blobTracks.push(t); }

  const playAlbum = (al) => playTracks(al.trackIds.map((id) => idx.byId.get(id)), 0, { label: al.title });

  return (
    <div className="screen-pad home">
      <PageHeader title={greeting()} sub={`${count(idx.tracks.length, songsWord)} · Ваша музыка всегда рядом`}>
        <Button variant="tonal" icon="audio_file" onClick={openAudioFiles}>Открыть файлы</Button>
      </PageHeader>
      <ScanStatus />

      <section className="hero">
        <div className="hero-text">
          <span className="hero-eyebrow"><Icon name="auto_awesome" size={18} /> СОБРАНО ДЛЯ ВАС</span>
          <h2 className="t-display-l hero-title">Сегодня<br />в вашем ритме</h2>
          <p className="t-body-l hero-sub">Ваш ежедневный микс · {count(mix.length, songsWord)}</p>
          <div className="hero-actions">
            <Button className="hero-start" size="m" icon="play_arrow" iconFill onClick={() => playTracks(mix, 0, { label: 'Ваш микс' })}>Слушать микс</Button>
            <Button className="hero-shuffle" variant="tonal" size="m" icon="shuffle" onClick={() => playShuffled(mix, { label: 'Ваш микс' })}>Перемешать</Button>
          </div>
        </div>
        <div className="hero-blobs" aria-hidden={false}>
          {BLOBS.map((b, i) => {
            const t = blobTracks[i];
            if (!t) return null;
            return (
              <button type="button" key={b.a} className="blob" title={`${t.title} — ${t.artist || ''}`} aria-label={`Слушать ${t.title}${t.artist ? ` — ${t.artist}` : ''}`}
                style={{ width: b.size, height: b.size, left: b.x, top: b.y, '--d': `${b.d}s`, '--a': clipPath(b.a), '--b': clipPath(b.b) }}
                onClick={() => playTracks(mix, mix.indexOf(t), { label: 'Ваш микс' })}>
                <Cover cover={t.cover} thumb={false} seed={t.title} className="blob-cover" icon="music_note"
                  style={{ '--cv-bg': `var(--md-${['tertiary', 'primary', 'secondary', 'tertiary'][i]})`, '--cv-fg': `var(--md-on-${['tertiary', 'primary', 'secondary', 'tertiary'][i]})` }} />
              </button>
            );
          })}
        </div>
      </section>

      <div className="home-shortcuts" aria-label="Быстрый доступ">
        <button type="button" className="shortcut shortcut-favorites state" onClick={() => go({ name: 'favorites' })}><span className="shortcut-icon"><Icon name="favorite" fill /></span><span><strong>Избранное</strong><small>{count(favs.length, songsWord)}</small></span><Icon name="chevron_right" /></button>
        <button type="button" className="shortcut shortcut-history state" onClick={() => go({ name: 'history' })}><span className="shortcut-icon"><Icon name="history" /></span><span><strong>История</strong><small>{u.history.length ? 'Вернуться к знакомому' : 'Начните свою историю'}</small></span><Icon name="chevron_right" /></button>
        <button type="button" className="shortcut shortcut-discover state" disabled={!unheard.length} onClick={() => playShuffled(unheard, { label: 'Ещё не слушали' })}><span className="shortcut-icon"><Icon name="radio" /></span><span><strong>Ещё не слушали</strong><small>{unheard.length ? count(unheard.length, songsWord) : 'Вся коллекция знакома'}</small></span><Icon name="play_arrow" fill /></button>
      </div>

      {top.length > 0 && (
        <section>
          <SectionHeader title="Часто слушаете" />
          <div className="list-card">
            {top.map((t, i) => (
              <SongRow key={t.id} track={t} index={i} onPlay={(k) => playTracks(top, k, { label: 'Часто слушаете' })}
                active={cur && cur.id === t.id} paused={!playing} first={i === 0} last={i === top.length - 1} />
            ))}
          </div>
        </section>
      )}

      {heard.length > 0 && (
        <section>
          <SectionHeader title="Недавно слушали" />
          <Shelf>{heard.map((a, i) => <AlbumCard key={a.id} album={a} i={i} onClick={() => go({ name: 'album', id: a.id })} onPlay={() => playAlbum(a)} />)}</Shelf>
        </section>
      )}

      <section>
        <SectionHeader title="Недавно добавлено" action={recentAlbums.length ? 'Все альбомы' : 'Вся музыка'} onAction={() => { go({ name: 'library' }); }} />
        {recentAlbums.length ? (
          <Shelf>{recentAlbums.map((a, i) => <AlbumCard key={a.id} album={a} i={i} onClick={() => go({ name: 'album', id: a.id })} onPlay={() => playAlbum(a)} />)}</Shelf>
        ) : (
          <div className="list-card">
            {recentTracks.map((t, i) => <SongRow key={t.id} track={t} index={i} onPlay={(k) => playTracks(recentTracks, k, { label: 'Недавно добавлено' })}
              active={cur?.id === t.id} paused={!playing} first={i === 0} last={i === recentTracks.length - 1} />)}
          </div>
        )}
      </section>

      {favs.length > 0 && (
        <section>
          <SectionHeader title="Избранное" action="Открыть" onAction={() => go({ name: 'favorites' })} />
          <div className="list-card">
            {favs.slice(0, 5).map((t, i) => (
              <SongRow key={t.id} track={t} index={i} onPlay={(k) => playTracks(favs, k, { label: 'Избранное' })}
                active={cur && cur.id === t.id} paused={!playing} first={i === 0} last={i === Math.min(5, favs.length) - 1} />
            ))}
          </div>
        </section>
      )}

      {artists.length > 0 && (
        <section>
          <SectionHeader title="Исполнители" action="Все" onAction={() => { go({ name: 'library' }); }} />
          <Shelf>{artists.map((a, i) => <ArtistCard key={a.id} artist={a} i={i} onClick={() => go({ name: 'artist', id: a.id })} />)}</Shelf>
        </section>
      )}

      {discover.length > 0 && (
        <section>
          <SectionHeader title="Откройте заново" />
          <Shelf>{discover.map((a, i) => <AlbumCard key={a.id} album={a} i={i} onClick={() => go({ name: 'album', id: a.id })} onPlay={() => playAlbum(a)} />)}</Shelf>
        </section>
      )}
    </div>
  );
}
