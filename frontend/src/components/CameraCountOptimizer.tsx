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
  return <form id={CAMERA_OPTIMIZATION_FORM} className="panel custom-camera-count" onSubmit={event => { event.preventDefault(); return optimize(); }}>
    <h3>Thiết lập tối ưu</h3>
    <label className="field">Vị trí cho phép tối ưu<select aria-label="Vị trí cho phép tối ưu" disabled={disabled} value={mounts} onChange={event => onMounts(event.target.value as Mounts)}>
      <option value="mixed">Tường + trần</option><option value="wall">Chỉ tường</option><option value="ceiling">Chỉ trần</option>
    </select></label>
    <label className="field-check">
      <input type="checkbox" aria-label="Chống khuất tầm tay (1.0 m)" checked={dualHeight} disabled={disabled} onChange={event => onDualHeight(event.target.checked)} />
      <span>Chống khuất tầm tay (1.0 m)</span>
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
