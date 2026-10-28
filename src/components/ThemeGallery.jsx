import { useStore } from '../lib/store';
import { settings, setSetting } from '../state/settings';
import { PRESETS, applyPreset } from '../state/presets';
import { wallpaperState, refreshWallpaper } from '../state/theme';
import { api } from '../api';
import { Button, Switch } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { toast } from '../state/ui';
export function ThemeGallery() {
  const s = useStore(settings); const wallpaper = useStore(wallpaperState);
  return <div className="theme-gallery-wrap">
    <div className="theme-gallery" role="radiogroup" aria-label="Темы оформления">
      {PRESETS.map((preset) => <button type="button" key={preset.id} className={`theme-card state ${s.themePreset === preset.id ? 'selected' : ''}`} role="radio" aria-checked={s.themePreset === preset.id} onClick={() => applyPreset(preset)}>
        <span className={`theme-sample ${['blockcraft', 'nether'].includes(preset.id) ? 'blocks' : ''}`} style={{ '--swatch': preset.colors[0], '--swatch-bg': preset.colors[1], '--swatch-extra': preset.colors[2] }}><i /><i /><i />{s.themePreset === preset.id && <Icon name="check" />}</span>
        <strong>{preset.name}</strong><small>{preset.description}</small>
      </button>)}
    </div>
    <div className="wallpaper-card">
      <div className="wallpaper-head"><span className="wallpaper-dot" style={{ background: wallpaper.color || s.seed }} /><div><h3 className="t-title-m">Цвета обоев</h3><p className="t-body-m">{s.wallpaperSync ? wallpaper.checking ? 'Читаем текущую палитру…' : wallpaper.source || 'Определяем источник…' : 'Автоматическая палитра Windows / Wallpaper Engine'}</p></div><Switch on={s.wallpaperSync} label="Синхронизировать с цветами обоев" onChange={(value) => { setSetting({ wallpaperSync: value, dynamicColor: false }); if (value) refreshWallpaper(); }} /></div>
      {s.wallpaperSync && <><p className="t-body-s">Палитра проверяется каждые 15 секунд. Для Wallpaper Engine используется превью выбранных обоев, а при его недоступности — акцент Windows. Для динамических сцен включите в Wallpaper Engine изменение цвета Windows. Это не захват экрана.</p><div className="wallpaper-actions"><Button variant="tonal" icon="refresh" disabled={wallpaper.checking} onClick={refreshWallpaper}>Обновить палитру</Button><Button variant="text" icon="folder" onClick={async () => { try { const folder = await api.wallpaper.pick(); if (folder) { setSetting({ wallpaperEnginePath: folder }); await refreshWallpaper(); } } catch { toast('Не удалось выбрать папку Wallpaper Engine'); } }}>Указать Wallpaper Engine</Button></div>{s.wallpaperEnginePath && <p className="t-body-s wallpaper-path">{s.wallpaperEnginePath}</p>}</>}
    </div>
  </div>;
}
