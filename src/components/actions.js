import { openMenu, openDialog, closeDialog, toast } from '../state/ui';
import { playNext, enqueue } from '../state/player';
import { user, toggleFavorite, createPlaylist, addToPlaylist } from '../state/userdata';
import { go } from '../state/nav';
import { getIndex } from '../state/library';
import { norm } from '../lib/search';
import { api } from '../api';
import { createElement as h } from 'react';
import { fmtTime } from '../lib/util';

export function showTrackDetails(track) {
  const values = [
    ['Название', track.title], ['Исполнитель', track.artist], ['Альбом', track.album], ['Год', track.year], ['Жанр', track.genre],
    ['Длительность', fmtTime(track.duration)], ['Формат', [track.codec, track.lossless ? 'Lossless' : null].filter(Boolean).join(' · ')],
    ['Битрейт', track.bitrate ? `${track.bitrate} кбит/с` : null], ['Частота', track.sampleRate ? `${(track.sampleRate / 1000).toFixed(1)} кГц` : null], ['Файл', track.path],
  ].filter(([, value]) => value);
  openDialog({ title: 'О треке', cancelLabel: 'Закрыть', render: () => h('dl', { className: 'track-details' }, values.flatMap(([label, value]) => [h('dt', { key: label }, label), h('dd', { key: label + '-v' }, String(value))])) });
}

/** Диалог «Добавить в плейлист» со списком существующих плейлистов и созданием нового. */
export function addToPlaylistDialog(trackIds) {
  const { playlists } = user.get();
  openDialog({
    title: 'Добавить в плейлист',
    cancelLabel: 'Закрыть',
    render: ({ close }) => h('div', { className: 'pl-pick' },
      h('button', {
        className: 'pl-pick-row state', onClick: () => {
          close();
          setTimeout(() => openDialog({
            title: 'Новый плейлист', prompt: true, placeholder: 'Название', confirmLabel: 'Создать',
            onConfirm: (name) => { const pl = createPlaylist(name, trackIds); toast(`Создан плейлист «${pl.name}»`, { icon: 'playlist_add_check' }); },
          }), 30);
        },
      }, h('span', { className: 'pl-ico' }, '+'), h('span', null, 'Новый плейлист')),
      playlists.map((p) => h('button', {
        key: p.id, className: 'pl-pick-row state',
        onClick: () => { addToPlaylist(p.id, trackIds); close(); toast(`Добавлено в «${p.name}»`, { icon: 'playlist_add_check' }); },
      }, h('span', { className: 'pl-ico' }, '♪'), h('span', { className: 'ellipsis' }, p.name), h('span', { className: 't-body-s pl-n' }, String(p.trackIds.length))))),
  });
}

export function songMenuItems(track, ctx = {}) {
  const idx = getIndex();
  const fav = !!user.get().favorites[track.id];
  const albumId = idx.albumOfTrack.get(track.id);
  const artistName = (track.artists && track.artists[0]) || track.artist;
  const artist = artistName ? idx.artistByName.get(norm(artistName)) : null;
  const items = [
    { label: 'Играть следующим', icon: 'queue_play_next', onClick: () => playNext([track]) },
    { label: 'Добавить в очередь', icon: 'playlist_add', onClick: () => enqueue([track]) },
    { label: fav ? 'Убрать из избранного' : 'В избранное', icon: 'favorite', fill: fav, onClick: () => { const on = toggleFavorite(track.id); if (on) toast('Добавлено в избранное', { icon: 'favorite' }); } },
    { label: 'Добавить в плейлист…', icon: 'playlist_add_check', onClick: () => addToPlaylistDialog([track.id]) },
    { divider: true },
  ];
  if (albumId && ctx.skipAlbum !== true) items.push({ label: 'Перейти к альбому', icon: 'album', onClick: () => go({ name: 'album', id: albumId }) });
  if (artist && ctx.skipArtist !== true) items.push({ label: 'Перейти к исполнителю', icon: 'person', onClick: () => go({ name: 'artist', id: artist.id }) });
  if (track.path) items.push({ label: 'Показать в папке', icon: 'folder_open', onClick: () => api.shell.showInFolder(track.path) });
  items.push({ label: 'О треке', icon: 'info', onClick: () => showTrackDetails(track) });
  if (ctx.onRemove) items.push({ divider: true }, { label: ctx.removeLabel || 'Удалить из списка', icon: 'remove', danger: true, onClick: ctx.onRemove });
  return items;
}

export function openSongMenu(e, track, ctx) {
  e.preventDefault();
  e.stopPropagation();
  const isBtn = e.type === 'click';
  const anchor = isBtn ? e.currentTarget.getBoundingClientRect() : { x: e.clientX, y: e.clientY };
  openMenu(anchor, songMenuItems(track, ctx), { align: 'right' });
}

export { closeDialog };
