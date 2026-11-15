import { useEffect, useState } from 'react';
import type { Layout } from '../types';
import { ceilingHeightFor } from '../core/camera';

export function PlanningSettings({ layout, disabled, showOptimization, onCeilingHeight, onOptimization }: {
  layout: Layout; disabled: boolean; showOptimization: boolean;
  onCeilingHeight: (height: number) => void;
  onOptimization: (settings: NonNullable<Layout['optimization']>) => void;
}) {
  const height = ceilingHeightFor(layout);
  const [draft, setDraft] = useState(String(height)), [error, setError] = useState('');
  useEffect(() => { setDraft(String(height)); setError(''); }, [height]);
  const settings = layout.optimization ?? { algorithm: 'hybrid', mounts: 'mixed' };
  const commit = () => {
    const value = draft.trim() ? Number(draft) : NaN;
    if (!Number.isFinite(value) || value < 2.4 || value > 6) {
      setDraft(String(height)); setError('Nhập chiều cao từ 2,4 đến 6 m.'); return;
    }
    setError(''); setDraft(String(height)); if (height !== value) onCeilingHeight(value);
  };
  return <section className="panel planning-settings">
    <h3>Trần nhà & vị trí lắp</h3>
    <label className="field">Chiều cao trần (m)<input aria-label="Chiều cao trần (m)" type="number" min={2.4} max={6} step={.1} disabled={disabled} value={draft} aria-invalid={Boolean(error)}
      onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setDraft(String(height)); setError(''); } }} /></label>
    {error && <p role="alert" className="fail small">{error}</p>}
    <p className="muted small">Camera trần nằm dưới trần theo chiều dài bộ gá. Tổng thể 3D ẩn trần; POV hiện trần thật.</p>
    {showOptimization && <>
      <label className="field">Vị trí cho phép tối ưu<select aria-label="Vị trí cho phép tối ưu" disabled={disabled} value={settings.mounts} onChange={event => onOptimization({ ...settings, mounts: event.target.value as typeof settings.mounts })}>
        <option value="mixed">Tường + trần</option><option value="wall">Chỉ tường</option><option value="ceiling">Chỉ trần</option>
      </select></label>
      <label className="field">Thuật toán<select aria-label="Thuật toán tối ưu" disabled={disabled} value={settings.algorithm} onChange={event => onOptimization({ ...settings, algorithm: event.target.value as typeof settings.algorithm })}>
        <option value="hybrid">Greedy + Local Search</option><option value="greedy">Greedy (đối chứng)</option>
      </select></label>
      <p className="muted small">Hai thuật toán dùng cùng tập vị trí và góc nhìn. Local Search thử thay từng camera để tăng điểm DORI có trọng số.</p>
    </>}
  </section>;
}
