import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

function roundClean(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function NumberField({
  label,
  value,
  min,
  max,
  step,
  buttonStep,
  stepName,
  unit,
  stepButtons = false,
  live = true,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  buttonStep?: number;
  stepName?: string;
  unit?: string;
  stepButtons?: boolean;
  live?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const focusedRef = useRef(false);

  useEffect(() => {
    // Keep external changes (e.g. preset clicks, canvas resize) synced,
    // without clobbering an active trailing decimal like "1." while typing.
    if (!focusedRef.current || Number(draft.trim()) !== value) {
      if (!(focusedRef.current && /\.$/.test(draft.trim()))) {
        setDraft(String(value));
        setError('');
      }
    }
  }, [value]);

  const restore = () => setDraft(String(value));
  const parseValid = (raw: string): number | null => {
    const text = raw.trim();
    if (!text || text.endsWith('.') || text === '-') return null;
    const next = Number(text);
    return Number.isFinite(next) && next >= min && next <= max ? next : null;
  };

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

  const deltaStep = buttonStep ?? step;
  const nudge = (dir: -1 | 1) => {
    const next = roundClean(Math.min(max, Math.max(min, value + dir * deltaStep)));
    if (Math.abs(next - value) > 1e-6) {
      setError('');
      onChange(next);
    }
  };

  const inputEl = (
    <input
      aria-invalid={Boolean(error)}
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        setError('');
        if (live) {
          const next = parseValid(raw);
          if (next !== null && next !== value) onChange(next);
        }
      }}
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
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
    />
  );

  const targetName = stepName ?? label;

  return (
    <label className="field">
      <span className="field-label-text">{label}</span>
      <span className="number-input">
        {stepButtons || unit ? (
          <span className="number-input-box">
            {stepButtons && (
              <button
                type="button"
                className="number-step-btn"
                aria-label={`Giảm ${targetName}`}
                disabled={value <= min + 1e-6}
                onClick={() => nudge(-1)}
              >
                <Minus size={11} />
              </button>
            )}
            {inputEl}
            {unit && <span className="number-unit" aria-hidden="true">{unit}</span>}
            {stepButtons && (
              <button
                type="button"
                className="number-step-btn"
                aria-label={`Tăng ${targetName}`}
                disabled={value >= max - 1e-6}
                onClick={() => nudge(1)}
              >
                <Plus size={11} />
              </button>
            )}
          </span>
        ) : (
          inputEl
        )}
        {error && <small className="fail" role="alert">{error}</small>}
      </span>
    </label>
  );
}
