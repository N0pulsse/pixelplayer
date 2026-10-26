import { api } from '../api';
import { adhoc } from '../state/library';
import { playTracks } from '../state/player';
import { createPlaylist } from '../state/userdata';
import { go } from '../state/nav';
import { toast } from '../state/ui';

export async function openAudioFiles() {
  try {
    const tracks = await api.library.openFiles();
    if (!tracks?.length) return;
    tracks.forEach((t) => adhoc.set(t.id, t));
    playTracks(tracks, 0, { label: 'Открытые файлы' });
  } catch {
    toast('Не удалось открыть файлы. Проверьте, доступны ли они на диске.', { icon: 'error' });
  }
}

export async function importPlaylist() {
  try {
    const result = await api.playlists.import();
    if (!result) return;
    const { name, tracks, missing = 0, skipped = 0 } = result;
    if (!tracks.length) { toast('В плейлисте нет доступных аудиофайлов', { icon: 'info' }); return; }
    tracks.forEach((t) => adhoc.set(t.id, t));
    const pl = createPlaylist(name, tracks.map((t) => t.id));
    go({ name: 'playlist', id: pl.id });
    toast(`Импортировано: ${tracks.length}${missing ? ` · не найдены: ${missing}` : ''}${skipped ? ` · пропущено: ${skipped}` : ''}`, { icon: 'playlist_add_check', ms: 7000 });
  } catch {
    toast('Не удалось прочитать плейлист. Используйте файл M3U или M3U8.', { icon: 'error' });
  }
}

export async function exportPlaylist(name, tracks) {
  try {
    const result = await api.playlists.export({ name, tracks });
    if (result) toast(`Плейлист сохранён · ${result.count} треков`, { icon: 'check', action: { label: 'Показать', onClick: () => api.shell.showInFolder(result.path) } });
  } catch {
    toast('Не удалось сохранить плейлист. Выберите доступную для записи папку.', { icon: 'error' });
  }
}
