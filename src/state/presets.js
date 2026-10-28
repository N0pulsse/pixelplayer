import { settings, setSetting } from './settings';
export const PRESETS = [
  { id: 'material', name: 'Material', seed: '#5170ff', variant: 'expressive', mode: 'dark', colors: ['#bfc5ff', '#1b1b28', '#79e1c5'], description: 'Выразительные формы и динамические цвета' },
  { id: 'blockcraft', name: 'Blockcraft', seed: '#6caa3c', variant: 'tonal', mode: 'dark', colors: ['#83be4b', '#453529', '#6f523b'], description: 'В духе Minecraft: блоки, трава и пиксельная сетка' },
  { id: 'nether', name: 'Nether', seed: '#ef5c39', variant: 'vibrant', mode: 'dark', colors: ['#ff7045', '#261018', '#a42d58'], description: 'Кубический мир лавы и багровых акцентов' },
  { id: 'oled', name: 'Midnight OLED', seed: '#c0b2ff', variant: 'tonal', mode: 'dark', colors: ['#cbb9ff', '#050507', '#25202e'], description: 'Глубокий чёрный и мягкое свечение' },
  { id: 'sakura', name: 'Sakura', seed: '#dc729d', variant: 'content', mode: 'light', colors: ['#fbb3d1', '#fff5fa', '#9f8acf'], description: 'Светлая розовая палитра' },
  { id: 'nord', name: 'Nord', seed: '#81a1c1', variant: 'tonal', mode: 'dark', colors: ['#88c0d0', '#2e3440', '#a3be8c'], description: 'Холодные северные тона' },
  { id: 'cyber', name: 'Neon City', seed: '#bd46f4', variant: 'vibrant', mode: 'dark', colors: ['#e78dff', '#12101f', '#6de7ef'], description: 'Неон, фиолетовый и бирюза' },
  { id: 'forest', name: 'Forest', seed: '#4f9c78', variant: 'content', mode: 'dark', colors: ['#9cd5b4', '#10231d', '#e6c598'], description: 'Лесные оттенки для спокойных вечеров' },
  { id: 'ocean', name: 'Ocean', seed: '#0098b7', variant: 'vibrant', mode: 'dark', colors: ['#79d7ed', '#09242e', '#a4c9ff'], description: 'Глубокий синий и морская прохлада' },
  { id: 'amber', name: 'Amber', seed: '#d78c29', variant: 'content', mode: 'dark', colors: ['#ffcd7d', '#281c12', '#b4b985'], description: 'Тёплый янтарь и уют винила' },
  { id: 'paper', name: 'Paper', seed: '#69747c', variant: 'neutral', mode: 'light', colors: ['#52616e', '#f8f5ee', '#c6c0b3'], description: 'Спокойная светлая тема без лишнего цвета' },
];
export function applyPreset(preset) { setSetting({ themePreset: preset.id, seed: preset.seed, variant: preset.variant, themeMode: preset.mode, dynamicColor: false, wallpaperSync: false }); }
export function themeOverrides(id, dark) {
  if (!dark) return {};
  const bases = { oled: ['#030305', '#0a090f', '#15131d'], nord: ['#242a35', '#2e3440', '#3b4252'], blockcraft: ['#1b2118', '#273021', '#37442c'], nether: ['#210e16', '#341721', '#4b2630'] };
  if (!bases[id]) return {};
  const [surface, low, high] = bases[id];
  return { surface, 'surface-container-lowest': surface, 'surface-container-low': low, 'surface-container': low, 'surface-container-high': high, 'surface-container-highest': high };
}
