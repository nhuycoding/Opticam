import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface StudioSelectOption {
  value: string;
  label: string;
  meta?: string;
  group?: string;
  dotColor?: string;
}

interface StudioSelectProps {
  value: string;
  options: readonly StudioSelectOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  variant?: 'default' | 'header' | 'compact';
  onChange: (value: string) => void;
}

export function StudioSelect({
  value,
  options,
  placeholder = 'Chọn...',
  ariaLabel,
  disabled = false,
  variant = 'default',
  onChange,
}: StudioSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const selected = options.find((opt) => opt.value === value);

  const grouped: Array<{ group?: string; items: StudioSelectOption[] }> = [];
  for (const opt of options) {
    const last = grouped[grouped.length - 1];
    if (!last || last.group !== opt.group) {
      grouped.push({ group: opt.group, items: [opt] });
    } else {
      last.items.push(opt);
    }
  }

  return (
    <div ref={rootRef} className={`studio-select studio-select-${variant}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="studio-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((cur) => !cur)}
      >
        <span className="studio-select-value">
          {selected?.dotColor && <i className="studio-select-dot" style={{ background: selected.dotColor }} aria-hidden="true" />}
          <span className={selected ? '' : 'muted'}>{selected?.label ?? placeholder}</span>
        </span>
        {selected?.meta && variant === 'default' && <span className="studio-select-trigger-meta">{selected.meta}</span>}
        <ChevronDown size={variant === 'compact' ? 12 : 14} className="studio-select-arrow" aria-hidden="true" />
      </button>

      {open && (
        <div id={listId} className="studio-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.length === 0 ? (
            <div className="studio-select-empty">Không có mục nào</div>
          ) : (
            grouped.map((bucket, idx) => (
              <div key={bucket.group ?? `g-${idx}`} className="studio-select-group">
                {bucket.group && <div className="studio-select-group-label">{bucket.group}</div>}
                {bucket.items.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`studio-select-option${isSelected ? ' selected' : ''}`}
                      onClick={() => {
                        setOpen(false);
                        if (opt.value !== value) onChange(opt.value);
                      }}
                    >
                      <span className="studio-select-option-main">
                        {opt.dotColor && <i className="studio-select-dot" style={{ background: opt.dotColor }} aria-hidden="true" />}
                        <span className="studio-select-option-label">{opt.label}</span>
                      </span>
                      <span className="studio-select-option-right">
                        {opt.meta && <small className="studio-select-option-meta">{opt.meta}</small>}
                        {isSelected && <Check size={12} className="studio-select-check" aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
