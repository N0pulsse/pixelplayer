import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { settings, setSetting, EQ_PRESETS, EQ_FREQUENCIES } from '../state/settings';
import { setPlaybackRate, setEqualizer, setEqualizerEnabled } from '../state/player';
import { openAudioFiles, importPlaylist } from '../components/libraryActions';
import { libStore, useIndex } from '../state/library';
import { back } from '../state/nav';
import { toast, openDialog } from '../state/ui';
import { Button, IconButton, Switch, Slider } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { api } from '../api';
import { VARIANTS, SEEDS } from '../lib/color';
import { cx, count, songsWord } from '../lib/util';

function Group({ title, children }) {
  return (<section className="sgroup"><h2 className="t-label-l sgroup-title">{title}</h2><div className="sgroup-body">{children}</div></section>);
}
function Row({ icon, title, sub, children, onClick }) {
  return (
    <div className={cx('srow', onClick && 'state')} onClick={onClick} role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } } : undefined}>
      {icon && <span className="srow-ico"><Icon name={icon} /></span>}
      <div className="srow-text"><div className="t-title-m">{title}</div>{sub && <div className="t-body-m srow-sub">{sub}</div>}</div>
      {children}
    </div>
  );
}
function Toggle({ icon, title, sub, k }) {
  const v = useStore(settings, (s) => s[k]);
  return <Row icon={icon} title={title} sub={sub} onClick={() => setSetting({ [k]: !v })}><Switch on={v} onChange={(x) => setSetting({ [k]: x })} label={title} /></Row>;
}

export function Settings() {
  const s = useStore(settings);
  const folders = useStore(libStore, (x) => x.folders);
  const scanning = useStore(libStore, (x) => x.scanning);
  const idx = useIndex();
  const [found, setFound] = useState(null);
  const info = api.info || {};

  useEffect(() => { api.library.detect().then(setFound).catch(() => {}); }, [folders]);

  const addFolder = async () => { const p = await api.library.pick(); if (p && p.length) api.library.addFolders(p); };
  const countFor = (path) => idx.tracks.filter((t) => t.folder === path || t.folder.startsWith(path + '\\') || t.folder.startsWith(path + '/')).length;
  const suggestions = (found || []).filter((f) => !f.added);

  return (
    <div className="screen-pad settings">
      <header className="page-head"><div><h1 className="page-title">Настройки</h1></div></header>

      <Group title="Моя музыка">
        {folders.map((f) => (
          <Row key={f.path} icon="folder" title={f.path} sub={`${count(countFor(f.path), songsWord)}${f.auto ? ' · найдена автоматически' : ''}`}>
            <Switch on={f.enabled} onChange={(v) => api.library.toggleFolder(f.path, v)} label="Включить папку" />
            <IconButton icon="close" size="s" label="Убрать папку" onClick={() => api.library.removeFolder(f.path)} />
          </Row>
        ))}
        {!folders.length && <Row icon="folder_open" title="Папки не выбраны" sub="Добавьте папку с музыкой — или нажмите «Найти музыку»." />}
        {suggestions.map((f) => (
          <Row key={f.path} icon="auto_awesome" title={f.path} sub={`Найдено на компьютере · ${f.label}`}>
            <Button variant="tonal" size="s" onClick={() => api.library.addFolders([f.path])}>Добавить</Button>
          </Row>
        ))}
        <div className="srow actions">
          <Button size="m" variant="tonal" icon="audio_file" onClick={openAudioFiles}>Открыть файлы</Button>
          <Button size="m" icon="create_new_folder" onClick={addFolder}>Добавить папку</Button>
          <Button size="m" variant="text" icon="playlist_add" onClick={importPlaylist}>Импорт M3U</Button>
          <Button size="m" variant="tonal" icon="auto_awesome" disabled={scanning} onClick={async () => { const l = await api.library.detect(); setFound(l); const add = l.filter((x) => !x.added).map((x) => x.path); if (add.length) { api.library.addFolders(add); toast(`Добавлено папок: ${add.length}`, { icon: 'auto_awesome' }); } else toast('Новых папок с музыкой не найдено', { icon: 'info' }); }}>Найти музыку</Button>
          <Button size="m" variant="text" icon="refresh" disabled={scanning} onClick={() => { api.library.rescan(false); toast('Проверяю изменения…', { icon: 'sync' }); }}>Обновить</Button>
          <Button size="m" variant="text" icon="cached" disabled={scanning} onClick={() => { api.library.rescan(true); toast('Перечитываю все теги…', { icon: 'cached' }); }}>Перечитать теги</Button>
        </div>
        <Row icon="timer" title="Скрывать короткие треки" sub={`Короче ${s.minDuration} с — не показывать (звуки уведомлений, голосовые)`}>
          <div className="srow-slider"><Slider size="sm" min={0} max={90} step={5} value={s.minDuration} onChange={(v) => setSetting({ minDuration: v })} format={(v) => `${v} с`} label="Минимальная длительность" /></div>
        </Row>
        <p className="t-body-s sgroup-note">Новые файлы в этих папках подхватываются сами. Поддерживаются MP3, FLAC, M4A/AAC, OGG, Opus, WAV.</p>
      </Group>

      <Group title="Внешний вид">
        <Row icon="contrast" title="Тема">
          <div className="seg">
            {[['dark', 'Тёмная'], ['light', 'Светлая'], ['system', 'Как в Windows']].map(([k, l]) => <button key={k} className={cx(s.themeMode === k && 'on')} onClick={() => setSetting({ themeMode: k })}>{l}</button>)}
          </div>
        </Row>
        <Toggle icon="palette" title="Цвета из обложки" sub="Интерфейс подстраивается под играющий альбом" k="dynamicColor" />
        <Row icon="format_paint" title="Стиль палитры" sub={VARIANTS[s.variant].label}>
          <div className="variants">
            {Object.entries(VARIANTS).map(([k, v]) => <button key={k} className={cx('vchip state', s.variant === k && 'on')} onClick={() => setSetting({ variant: k })}>{v.label}</button>)}
          </div>
        </Row>
        <Row icon="colorize" title="Основной цвет" sub={s.dynamicColor ? 'Используется, когда ничего не играет' : 'Основа всей палитры'}>
          <div className="seeds">
            {SEEDS.map((c) => <button key={c} className={cx('seed', s.seed === c && 'on')} style={{ background: c }} onClick={() => setSetting({ seed: c })} aria-label={c} />)}
          </div>
        </Row>
        <Toggle icon="blur_on" title="Размытая обложка на фоне плеера" k="blurBackground" />
        <Toggle icon="animation" title="Меньше анимаций" sub="Отключает пружинные эффекты и движение" k="reduceMotion" />
      </Group>

      <Group title="Воспроизведение">
        <Row icon="speed" title="Скорость воспроизведения" sub={`${s.playbackRate || 1}× · высота голоса сохраняется`}>
          <div className="srow-slider"><Slider size="sm" min={0.5} max={2} step={0.05} value={s.playbackRate || 1} onChange={setPlaybackRate} format={(v) => `${v.toFixed(2)}×`} label="Скорость воспроизведения" /></div>
          <Button variant="text" onClick={() => setPlaybackRate(1)}>1×</Button>
        </Row>
        <Row icon="graphic_eq" title="Плавный переход между треками" sub={s.crossfade ? `Кроссфейд ${s.crossfade} с` : 'Выключен — треки идут встык'}>
          <div className="srow-slider"><Slider size="sm" min={0} max={12} step={1} value={s.crossfade} onChange={(v) => setSetting({ crossfade: v })} format={(v) => (v ? `${v} с` : 'выкл')} label="Кроссфейд" /></div>
        </Row>
        <Toggle icon="history" title="Продолжать с того же места" sub="При запуске восстановить очередь и позицию" k="resume" />
        <Toggle icon="minimize" title="Сворачивать в трей при закрытии" sub="Музыка продолжит играть в фоне" k="closeToTray" />
      </Group>

      <Group title="Студия звука">
        <Row icon="equalizer" title="10-полосный эквалайзер" sub="Настройте звучание под свои наушники и музыку">
          <Switch on={!!s.eqEnabled} onChange={setEqualizerEnabled} label="Включить эквалайзер" />
        </Row>
        <div className="equalizer" data-enabled={!!s.eqEnabled}>
          <div className="eq-presets" aria-label="Пресеты эквалайзера">
            {Object.entries(EQ_PRESETS).map(([key, preset]) => <Button key={key} variant={s.eqPreset === key ? 'filled' : 'tonal'} size="s" toggle on={s.eqPreset === key} onClick={() => { setEqualizer(key); setEqualizerEnabled(true); }}>{preset.label}</Button>)}
          </div>
          <div className="eq-bands">
            {EQ_FREQUENCIES.map((hz, i) => {
              const value = s.eqBands?.[i] || 0;
              const freq = hz >= 1000 ? `${hz / 1000}k` : String(hz);
              return <label className="eq-band" key={hz}>
                <output>{value > 0 ? '+' : ''}{value} <small>дБ</small></output>
                <input type="range" min="-12" max="12" step="1" value={value} aria-label={`${hz} Гц`} aria-valuetext={`${value} децибел`}
                  onChange={(e) => { const bands = [...s.eqBands]; bands[i] = Number(e.target.value); setEqualizer(bands); }} />
                <span>{freq}</span>
              </label>;
            })}
          </div>
          <p className="t-body-s sgroup-note">Частоты в Гц · усиление от −12 до +12 дБ. Пресеты можно настроить вручную.</p>
        </div>
      </Group>

      <Group title="Интернет">
        <Toggle icon="lyrics" title="Искать тексты песен онлайн" sub="LRCLIB: отправляется название, исполнитель и длительность трека. Тексты из .lrc-файлов и тегов используются в первую очередь" k="onlineLyrics" />
        <Toggle icon="person" title="Фото исполнителей" sub="Deezer: отправляется только имя исполнителя" k="artistImages" />
      </Group>

      <Group title="О приложении">
        <Row icon="info" title="Pixel Player" sub={`Версия ${info.version || ''} · ${info.portable ? 'Портативная версия — без установки' : 'Настольная версия'}`} />
        <Row icon="description" title="Лицензии компонентов" sub="Открытые библиотеки, шрифты и иконки" onClick={async () => {
          try {
            const response = await fetch(new URL('./licenses/THIRD_PARTY_NOTICES.txt', location.href));
            if (!response.ok) throw new Error('Licenses unavailable');
            const text = await response.text();
            openDialog({ title: 'Лицензии компонентов', cancelLabel: 'Закрыть', render: () => <pre className="license-text">{text}</pre> });
          } catch { toast('Не удалось открыть лицензии', { icon: 'error' }); }
        }} />
        <Row icon="folder_open" title="Папка с данными приложения" sub={info.userData} onClick={() => api.shell.openUserData()} />
        <Row icon="keyboard" title="Горячие клавиши" sub="Ctrl+O — открыть файлы · Пробел — пауза · ← → — перемотка · Ctrl+← → — трек · ↑ ↓ — громкость · M — без звука · L — тексты · Q — очередь · Ctrl+F — поиск" />
        <p className="t-body-s sgroup-note">Шрифты Google Sans Flex и Roboto Flex (SIL OFL), иконки Material Symbols (Apache-2.0), цвета — Material Color Utilities (Apache-2.0).</p>
      </Group>
    </div>
  );
}
