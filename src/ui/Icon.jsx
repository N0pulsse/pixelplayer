import ICONS from './icons-data';
import { cx } from '../lib/util';

/** Иконка Material Symbols Rounded. fill — залитый вариант (для активных состояний). */
export function Icon({ name, fill = false, size, className, style }) {
  const d = ICONS[name] || ICONS.music_note;
  const path = (fill ? d.f : d.o) || d.o || d.f;
  return (
    <svg className={cx('icon', className)} viewBox="0 -960 960 960" width={size || 24} height={size || 24}
      focusable="false" aria-hidden="true" data-icon={name}
      style={size ? { '--icon': `${size}px`, ...style } : style}>
      <path d={path} />
    </svg>
  );
}
