import { useEffect, useState } from 'react';

export function CameraCountOptimizer({ count, onCountChange, onOptimize, disabled }: {
  count: number; onCountChange: (count: number) => void; onOptimize: (count: number) => void; disabled: boolean;
}) {
  const [draft, setDraft] = useState(String(count));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(count)); setError(''); }, [count]);
  const parse = (value: string) => /^\d+$/.test(value.trim()) && Number(value) >= 1 && Number(value) <= 20 ? Number(value) : null;
  const optimize = () => {
    const value = parse(draft);
    if (value === null) { setError('Nhập số nguyên từ 1 đến 20.'); return; }
    setError(''); onCountChange(value); onOptimize(value);
  };
  return <section className="panel custom-camera-count">
    <h3>Tối ưu theo số camera</h3>
    <label className="field">Số camera muốn bố trí<input aria-label="Số camera tùy chỉnh" type="text" inputMode="numeric" value={draft} disabled={disabled}
      aria-invalid={Boolean(error)} aria-describedby={error ? 'camera-count-error' : undefined}
      onChange={event => { const value = event.target.value; setDraft(value); setError(''); const parsed = parse(value); if (parsed !== null) onCountChange(parsed); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); optimize(); } }} /></label>
    {error && <p id="camera-count-error" className="fail small" role="alert">{error}</p>}
    <button className="primary" disabled={disabled} onClick={optimize}>Tối ưu số camera đã nhập</button>
    <p className="muted">Nhập từ 1–20 camera. Phương án mới sử dụng tối đa số lượng này.</p>
  </section>;
}
