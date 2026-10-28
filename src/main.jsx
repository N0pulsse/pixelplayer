import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';
import './styles/features.css';
import './styles/expansion.css';
import './styles/spotify.css';
import './styles/online.css';
import { App } from './App';
import { initTheme } from './state/theme';
import { loadUser } from './state/userdata';
import { initLibrary, libStore } from './state/library';
import { restoreSession, engine } from './state/player';
import { initSpotify } from './state/spotify';

async function boot() {
  await Promise.all([loadUser(), initLibrary()]);
  await initTheme();
  initSpotify();
  createRoot(document.getElementById('root')).render(<App />);
  restoreSession().catch(() => {});
  window.__pp = { libStore, engine }; // удобно для отладки в консоли (F12)
}

boot();
