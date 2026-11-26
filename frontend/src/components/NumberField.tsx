import { useEffect, useState } from 'react';

export function NumberField({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => {
    setDraft(String(value));
    setError('');
  }, [value]);

  const restore = () => setDraft(String(value));
  const commit = () => {
    const text = draft.trim();
    const next = text ? Number(text) : Number.NaN;
    if (Number.isFinite(next) && next >= min && next <= max) {
      setError('');
      if (next !== value) onChange(next);
      setDraft(String(value));
    } else {
      setError(`Nhập số từ ${min} đến ${max}.`);
      restore();
    }
  };

  return <label className="field">{label}<span className="number-input"><input
    aria-invalid={Boolean(error)}
    type="number"
    value={draft}
    min={min}
    max={max}
    step={step}
    aria-label={label}
    onChange={(event) => { setDraft(event.target.value); setError(''); }}
    onKeyDown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restore();
        setError('');
      }
    }}
    onBlur={commit}
  />{error && <small className="fail" role="alert">{error}</small>}</span></label>;
}
