import type { Layout } from '../types';
import { useEffect, useState } from 'react';

export const CAMERA_OPTIMIZATION_FORM = 'camera-optimization';

type Mounts = NonNullable<Layout['optimization']>['mounts'];

export function CameraCountOptimizer({ count, mounts, dualHeight, onCountChange, onMounts, onDualHeight, onOptimize, onInvalid, disabled }: {
  count: number; mounts: Mounts; dualHeight: boolean;
  onCountChange: (count: number) => void; onMounts: (mounts: Mounts) => void; onDualHeight: (enabled: boolean) => void;
  onOptimize: (count: number) => void | Promise<void>; onInvalid: () => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(count));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(count)); setError(''); }, [count]);
  const parse = (value: string) => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 20 ? Number(value) : null;
  const optimize = () => {
    const value = parse(draft);
    if (value === null) { setError('Nhập số nguyên từ 1 đến 20.'); onInvalid(); return; }
    setError(''); onCountChange(value); return onOptimize(value);
  };
  return <form id={CAMERA_OPTIMIZATION_FORM} className="panel custom-camera-count" data-tour="camera-optimizer" onSubmit={event => { event.preventDefault(); return optimize(); }}>
    <h3>Thiết lập tối ưu</h3>
    <div className="field">
      <span>Vị trí cho phép tối ưu</span>
      <div className="segmented-pills segmented-3" role="group" aria-label="Vị trí cho phép tối ưu">
        {([['mixed', 'Tường + trần'], ['wall', 'Chỉ tường'], ['ceiling', 'Chỉ trần']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            disabled={disabled}
            className={mounts === value ? 'active' : ''}
            aria-pressed={mounts === value}
            onClick={() => onMounts(value)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
    <label className={`toggle-card${dualHeight ? ' on' : ''}${disabled ? ' disabled' : ''}`}>
      <span className="toggle-card-copy">
        <strong>Chống khuất tầm tay (1.0 m)</strong>
        <small>Ưu tiên tầm tay ≥ 62,5 PPM tại vùng W ≥ 3</small>
      </span>
      <span className="toggle-switch">
        <input type="checkbox" className="toggle-switch-input" aria-label="Chống khuất tầm tay (1.0 m)" checked={dualHeight} disabled={disabled} onChange={event => onDualHeight(event.target.checked)} />
        <span className="toggle-switch-track" aria-hidden="true"><span className="toggle-switch-thumb" /></span>
      </span>
    </label>
    <label className="field">Số camera muốn bố trí (1–20)<input aria-label="Số camera tùy chỉnh" type="text" inputMode="numeric" value={draft} disabled={disabled}
      aria-invalid={Boolean(error)} aria-describedby={error ? 'camera-count-error' : undefined}
      onChange={event => {
        const value = event.target.value;
        setDraft(value);
        setError('');
        const count = parse(value);
        if (count !== null) onCountChange(count);
      }} /></label>
    {error && <p id="camera-count-error" className="fail small" role="alert">{error}</p>}
  </form>;
}
