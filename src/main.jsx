import { api } from './api';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/features.css';
import './styles/expansion.css';
import { App } from './App';
import { initTheme } from './state/theme';
import { loadUser } from './state/userdata';
import { initLibrary, libStore, adhoc } from './state/library';
import { restoreSession, engine, player } from './state/player';

async function boot() {
  await Promise.all([loadUser(), initLibrary()]);
  await initTheme();
  api.genres.onResult(result=>{
    const patch={genre:result.genre,genreSource:result.source,genreUrl:result.url};
    if(adhoc.has(result.id))adhoc.set(result.id,{...adhoc.get(result.id),...patch});
    const s=player.get();player.set({queue:s.queue.map(t=>t.id===result.id?{...t,...patch}:t),origQueue:s.origQueue?.map(t=>t.id===result.id?{...t,...patch}:t)||null});
  });
  createRoot(document.getElementById('root')).render(<App />);
  restoreSession().catch(() => {});
  window.__pp = { libStore, engine }; // удобно для отладки в консоли (F12)
}

boot();
