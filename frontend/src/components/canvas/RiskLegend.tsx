import type { Cell } from '../../types';
import { priorityBand, priorityColor, type PriorityBand } from './shared';

const bands: { id: PriorityBand; label: string; range: string; weight: number }[] = [
  { id: 'low', label: 'Thấp', range: 'W < 2', weight: 1 },
  { id: 'medium', label: 'Vừa', range: '2 ≤ W < 4', weight: 3 },
  { id: 'high', label: 'Cao', range: 'W ≥ 4', weight: 5 }
];

export function RiskLegend({ cells, filter, onFilter }: {
  cells: Cell[]; filter: PriorityBand | null; onFilter: (band: PriorityBand | null) => void;
}) {
  const validCells = cells.filter((cell) => !cell.solid);
  const counts = { low: 0, medium: 0, high: 0 };
  for (const cell of validCells) counts[priorityBand(cell.w)]++;

  return (
    <div className="risk-canvas-controls" aria-label="Chú giải và bộ lọc mức ưu tiên">
      <div className="risk-info"><span aria-hidden="true">i</span> W là mức ưu tiên thiết kế, không phải xác suất xảy ra trộm.</div>
      <div className="risk-band-buttons" role="group" aria-label="Lọc theo mức ưu tiên">
        {bands.map((band) => {
          const count = counts[band.id], percent = validCells.length ? Math.round((count / validCells.length) * 100) : 0;
          const active = filter === band.id;
          return (
            <button key={band.id} className={`risk-band${active ? ' active' : ''}`} aria-pressed={active}
              title={`${band.label}: ${band.range}. Nhấn để lọc vùng này.`}
              onClick={() => onFilter(active ? null : band.id)}>
              <i style={{ background: priorityColor(band.weight) }} />
              <span><b>{band.label}</b><small>{band.range} · {count} ô ({percent}%)</small></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
