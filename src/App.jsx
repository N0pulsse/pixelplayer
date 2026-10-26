import { useEffect, useRef } from 'react';
import { useStore } from './lib/store';
import { ui, toast, openNowPlaying, closeNowPlaying } from './state/ui';
import { nav, useNav, go } from './state/nav';
import { player, toggle, next, prev, seekBy, setVolume, toggleMute, engine, useCurrent } from './state/player';
import { TitleBar, Rail, BottomNav, MiniPlayer } from './components/Shell';
import { Hosts } from './ui/Hosts';
import { Icon } from './ui/Icon';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { Search } from './screens/Search';
import { Settings } from './screens/Settings';
import { NowPlaying } from './screens/NowPlaying';
import { AlbumScreen, ArtistScreen, GenreScreen, FolderScreen, FavoritesScreen, HistoryScreen, PlaylistScreen } from './screens/Detail';
import { api } from './api';
import { playTracks } from './state/player';
import { adhoc } from './state/library';
import { openAudioFiles } from './components/libraryActions';

function renderRoute(r) {
  switch (r.name) {
    case 'home': return <Home />;
    case 'library': return <Library />;
    case 'search': return <Search />;
    case 'settings': return <Settings />;
    case 'album': return <AlbumScreen id={r.id} />;
    case 'artist': return <ArtistScreen id={r.id} />;
    case 'genre': return <GenreScreen id={r.id} />;
    case 'folder': return <FolderScreen id={r.id} />;
    case 'favorites': return <FavoritesScreen />;
    case 'history': return <HistoryScreen />;
    case 'playlist': return <PlaylistScreen id={r.id} />;
    default: return <Home />;
  }
}

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
      const k = e.key;
      if (e.ctrlKey && e.code === 'KeyO') { e.preventDefault(); openAudioFiles(); return; }
      if (e.ctrlKey && e.code === 'KeyF') { e.preventDefault(); closeNowPlaying(); go({ name: 'search' }); return; }
      if (typing) return;
      if (ui.get().dialog || ui.get().menu) return;
      if (k === 'Backspace' || (e.altKey && k === 'ArrowLeft')) { import('./state/nav').then((n) => n.back()); return; }
      if (k === ' ' && !e.target.closest('button, [role="button"], .slider, .wavy')) { e.preventDefault(); toggle(); return; }
      if (e.ctrlKey && k === 'ArrowRight') { e.preventDefault(); next(); return; }
      if (e.ctrlKey && k === 'ArrowLeft') { e.preventDefault(); prev(); return; }
      if (!e.ctrlKey && !e.altKey && !e.target.closest('.slider, .wavy')) {
        if (k === 'ArrowRight') { seekBy(5); e.preventDefault(); }
        else if (k === 'ArrowLeft') { seekBy(-5); e.preventDefault(); }
        else if (k === 'ArrowUp' && !e.target.closest('.screen-scroll')) { setVolume(Math.min(1, player.get().volume + 0.05)); e.preventDefault(); }
        else if (k === 'ArrowDown' && !e.target.closest('.screen-scroll')) { setVolume(Math.max(0, player.get().volume - 0.05)); e.preventDefault(); }
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.code === 'KeyM') toggleMute();
      if (e.code === 'KeyL') { if (player.get().queue.length) { openNowPlaying(); ui.set({ npPanel: 'lyrics', npSheet: ui.get().vw < 1000 ? 'lyrics' : null }); } }
      if (e.code === 'KeyQ') { if (player.get().queue.length) { openNowPlaying(); ui.set({ npPanel: 'queue', npSheet: ui.get().vw < 1000 ? 'queue' : null }); } }
    };
    window.addEventListener('keydown', onKey);
    // боковые кнопки мыши «назад»
    const onMouse = (e) => { if (e.button === 3) { e.preventDefault(); import('./state/nav').then((n) => n.back()); } };
    window.addEventListener('mouseup', onMouse);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onMouse); };
  }, []);
}

/** Перетаскивание файлов и папок в окно */
function useDrop() {
  useEffect(() => {
    let depth = 0;
    const has = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const enter = (e) => { if (!has(e)) return; e.preventDefault(); depth += 1; ui.set({ dropping: true }); };
    const over = (e) => { if (has(e)) e.preventDefault(); };
    const leave = (e) => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) ui.set({ dropping: false }); };
    const drop = async (e) => {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; ui.set({ dropping: false });
      const paths = api.pathsForFiles(e.dataTransfer.files);
      if (!paths.length) return;
      try {
      const { files, folders: dirs } = await api.library.classifyPaths(paths);
      if (dirs.length) { await api.library.addFolders(dirs); toast(`Папок добавлено в библиотеку: ${dirs.length}`, { icon: 'create_new_folder' }); }
      if (files.length) {
        const tracks = await api.library.parseFiles(files);
        for (const t of tracks) adhoc.set(t.id, t);
        if (tracks.length) playTracks(tracks, 0, { label: 'Перетащенные файлы' });
      }
      } catch { toast('Не удалось добавить файлы. Проверьте доступ к папке.', { icon: 'error' }); }
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  }, []);
}

export function App() {
  const { stack, dir, tick } = useNav();
  const route = stack[stack.length - 1];
  const vw = useStore(ui, (s) => s.vw);
  const dropping = useStore(ui, (s) => s.dropping);
  const rail = useStore(ui, (s) => s.vw >= 840);
  const cur = useCurrent();
  const sc = useRef(null);
  useGlobalKeys();
  useDrop();
  useEffect(() => { if (sc.current) sc.current.scrollTop = 0; }, [tick]);

  return (
    <div className="app" data-compact={!rail} data-playing={!!cur}>
      <TitleBar />
      {rail && <Rail />}
      <main className="stage">
        <div className="screen-scroll" ref={sc}>
          <div className="screen" key={tick} data-dir={dir}>{renderRoute(route)}</div>
        </div>
      </main>
      <MiniPlayer />
      {!rail && <BottomNav />}
      <NowPlaying />
      <Hosts />
      {dropping && (
        <div className="drop"><div className="drop-card"><Icon name="library_music" size={56} /><h2 className="t-headline-m">Отпустите, чтобы добавить</h2><p className="t-body-l">Папки попадут в библиотеку, файлы начнут играть сразу</p></div></div>
      )}
    </div>
  );
}
