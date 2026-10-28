/** Music waveform remains recognizable before animation starts and with reduced motion. */
export function LoadingIndicator({ size = 48, contained = true, className, progress, label = 'Загрузка' }) {
  const value = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : null;
  const inner = contained ? size * 0.82 : size;
  return (
    <div className={`loader ${contained ? 'contained' : ''} ${className || ''}`} style={{ width: size, height: size }} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
      <svg className="loader-visual" width={inner} height={inner} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
        <circle className="loader-ring-track" cx="24" cy="24" r="21" />
        <circle className={`loader-ring ${value === null ? 'orbit' : ''}`} cx="24" cy="24" r="21" pathLength="100"
          strokeDasharray={value === null ? '22 78' : '100'} strokeDashoffset={value === null ? undefined : 100 * (1 - value)} />
        {[12, 21, 28, 18, 10].map((height, i) => <rect key={i} className="loader-bar" x={11 + i * 5.7} y={(48 - height) / 2} width="3.4" height={height} rx="1.7" style={{ animationDelay: `${i * -0.17}s` }} />)}
      </svg>
    </div>
  );
}
