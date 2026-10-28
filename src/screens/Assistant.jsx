import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { createStore, useStore } from '../lib/store';
import { useIndex } from '../state/library';
import { user, createPlaylist } from '../state/userdata';
import { playTracks } from '../state/player';
import { go } from '../state/nav';
import { toast } from '../state/ui';
import { PageHeader, TrackList } from '../components/common';
import { Button, IconButton } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { LoadingIndicator } from '../ui/LoadingIndicator';
const state = createStore({ prompt: '', limit: 25, scope: 'all', busy: false, result: null, error: '' });
const errorMessage = (error) => String(error?.message || 'Не удалось выполнить запрос').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

export function AgentConfig() {
  const [config, setConfig] = useState({ endpoint: '', model: '', hasKey: false });
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { api.ai.config().then(setConfig).catch((e) => setMessage(errorMessage(e))); }, []);
  const save = async (remove = false) => {
    setBusy(true); setMessage('');
    try {
      const input = { endpoint: config.endpoint, model: config.model };
      if (remove || key.trim()) input.apiKey = remove ? '' : key;
      const result = await api.ai.save(input); setConfig(result); setKey(''); setMessage(remove ? 'Ключ удалён' : 'Подключение сохранено');
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return <div className="agent-config">
    <p className="t-body-m">Совместимый с OpenAI Chat Completions API сервер или локальная модель. Укажите базовый адрес с /v1 либо полный путь /chat/completions.</p>
    <label>Адрес API<input className="field" type="url" value={config.endpoint} placeholder="https://ваш-провайдер/v1" onChange={(e) => setConfig({ ...config, endpoint: e.target.value })} autoComplete="off" /></label>
    <label>Модель<input className="field" value={config.model} placeholder="Имя модели у вашего провайдера" onChange={(e) => setConfig({ ...config, model: e.target.value })} autoComplete="off" /></label>
    <label>API-ключ<input className="field" type="password" value={key} placeholder={config.hasKey ? 'Ключ сохранён · оставьте пустым, чтобы не менять' : 'Для локального сервера можно оставить пустым'} onChange={(e) => setKey(e.target.value)} autoComplete="new-password" spellCheck={false} /></label>
    <div className="agent-config-actions"><Button icon="check" disabled={busy} onClick={() => save()}>Сохранить подключение</Button><Button variant="text" onClick={() => setConfig({ ...config, endpoint: 'http://127.0.0.1:11434/v1' })}>Локальный сервер</Button>{config.hasKey && <Button variant="text" disabled={busy} onClick={() => save(true)}>Удалить ключ</Button>}</div>
    {message && <p className="agent-message" role="status">{message}</p>}
    <p className="t-body-s">Ключ шифруется средствами Windows и не передаётся в интерфейс после сохранения. При переносе на другой ПК введите его заново. Запрос к API выполняется только по кнопке создания плейлиста; провайдер может взимать плату.</p>
  </div>;
}

export function Assistant() {
  const s = useStore(state);
  const idx = useIndex();
  const data = useStore(user);
  const [configure, setConfigure] = useState(false);
  const pool = useMemo(() => idx.tracks.filter((t) => s.scope === 'favorites' ? !!data.favorites[t.id] : s.scope === 'unheard' ? !data.plays[t.id] : true), [idx, s.scope, data.favorites, data.plays]);
  const tracks = (s.result?.trackIds || []).map((id) => idx.byId.get(id)).filter(Boolean);
  const generate = async () => {
    state.set({ busy: true, error: '' });
    try { state.set({ result: await api.ai.generate({ prompt: s.prompt, limit: s.limit, ids: pool.map((t) => t.id) }) }); }
    catch (error) { state.set({ error: errorMessage(error) }); }
    finally { state.set({ busy: false }); }
  };
  const localMix = () => {
    const scored = pool.map((t) => ({ t, rank: Math.random() * 2 + (data.favorites[t.id] ? 1 : 0) - Math.log2((data.plays[t.id]?.n || 0) + 1) * 0.2 })).sort((a, b) => b.rank - a.rank);
    const selected = []; const artists = new Map();
    for (const { t } of scored) { const name = t.artists?.[0] || t.artist || ''; const n = artists.get(name) || 0; if (n >= Math.max(2, Math.ceil(s.limit / 5))) continue; artists.set(name, n + 1); selected.push(t.id); if (selected.length >= s.limit) break; }
    state.set({ error: '', result: { name: 'Открытия дня', reason: 'Локальная подборка с разнообразием исполнителей, учётом избранного и истории. Без запроса к ИИ.', trackIds: selected, local: true } });
  };
  return <div className="screen-pad assistant-screen">
    <PageHeader title="Музыкальный агент" sub="Опишите настроение. Соберите свой следующий плейлист."><IconButton icon="tune" variant="tonal" label="Настроить API" onClick={() => setConfigure(!configure)} /></PageHeader>
    <section className="agent-hero">
      <div className="agent-badge"><Icon name="auto_awesome" size={36} /></div>
      <div className="agent-compose"><label className="t-title-l" htmlFor="agent-prompt">Что будем слушать?</label><textarea id="agent-prompt" className="field" rows={3} maxLength={2000} value={s.prompt} onChange={(e) => state.set({ prompt: e.target.value })} placeholder="Например: 25 спокойных треков для вечерней прогулки, без повторов исполнителей" />
        <div className="agent-examples">{['Вечерний chill', 'Рок для дороги', 'Ностальгия по 2000-м', 'Спокойная музыка для работы'].map((prompt) => <button className="chip state" key={prompt} onClick={() => state.set({ prompt })}>{prompt}</button>)}</div>
        <div className="agent-options"><label>Источник<select className="field" value={s.scope} onChange={(e) => state.set({ scope: e.target.value })}><option value="all">Вся библиотека</option><option value="favorites">Избранное</option><option value="unheard">Ещё не слушали</option></select></label><label>Треков<select className="field" value={s.limit} onChange={(e) => state.set({ limit: Number(e.target.value) })}>{[10, 25, 40, 60].map((n) => <option value={n} key={n}>{n}</option>)}</select></label></div>
        <div className="agent-buttons"><Button size="m" icon="auto_awesome" disabled={s.busy || !s.prompt.trim() || !pool.length} onClick={generate}>Создать с ИИ</Button><Button variant="tonal" size="m" icon="shuffle" disabled={s.busy || !pool.length} onClick={localMix}>Микс без API</Button></div>
        <p className="t-body-s">В API отправляются запрос и метаданные максимум 600 треков выбранной коллекции. Аудиофайлы и пути к ним не отправляются. Агент выбирает только существующие песни.</p>
      </div>
    </section>
    {s.busy && <div className="agent-progress" role="status"><LoadingIndicator size={48} /><span>Агент собирает последовательность…</span></div>}
    {s.error && <div className="agent-error" role="alert">{s.error}<Button variant="text" onClick={() => setConfigure(true)}>Настроить API</Button></div>}
    {configure && <section className="agent-settings"><h2 className="t-headline-s">Подключение агента</h2><AgentConfig /></section>}
    {!!s.result && <section className="agent-result"><div className="sec-head"><div><h2 className="t-headline-m">{s.result.name}</h2><p className="t-body-m">{s.result.reason}</p></div></div>
      <div className="toolbar"><Button icon="play_arrow" disabled={!tracks.length} onClick={() => playTracks(tracks, 0, { label: s.result.name })}>Слушать</Button><Button icon="playlist_add" variant="tonal" disabled={!tracks.length} onClick={() => { const playlist = createPlaylist(s.result.name, tracks.map((t) => t.id)); toast('Плейлист сохранён', { icon: 'check' }); go({ name: 'playlist', id: playlist.id }); }}>Сохранить плейлист</Button><span className="t-body-m">{tracks.length} треков</span></div>
      <div className="list-card big"><TrackList tracks={tracks} source={{ label: s.result.name }} ctxFor={(t) => ({ onRemove: () => state.set({ result: { ...s.result, trackIds: s.result.trackIds.filter((id) => id !== t.id) } }), removeLabel: 'Убрать из подборки' })} /></div>
    </section>}
    {!idx.tracks.length && <p className="t-body-l">Добавьте музыку в библиотеку, чтобы агент мог собрать плейлист.</p>}
  </div>;
}
