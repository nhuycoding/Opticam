import type { Layout } from '../types';
import { ceilingHeightFor } from '../core/camera';
import { NumberField } from './NumberField';

export function PlanningSettings({ layout, disabled, onRoom, onGrid, onScale, onCeilingHeight }: {
  layout: Layout; disabled: boolean;
  onRoom: (width: number, height: number) => void;
  onGrid: (gridM: number) => void;
  onScale: (pixelsPerMeter: number) => void;
  onCeilingHeight: (height: number) => void;
}) {
  return <section className="panel planning-settings">
    <h3>Tùy chỉnh kích thước</h3>
    <fieldset className="dimension-fields" disabled={disabled}>
      <div className="row">
        <NumberField label="Rộng (m)" value={layout.widthM} min={3} max={40} step={0.5} onChange={width => onRoom(width, layout.heightM)} />
        <NumberField label="Dài (m)" value={layout.heightM} min={3} max={40} step={0.5} onChange={height => onRoom(layout.widthM, height)} />
      </div>
      <div className="row">
        <NumberField label="Kích thước ô (m)" value={layout.gridM} min={0.1} max={2} step={0.05} onChange={onGrid} />
        <NumberField label="Tỷ lệ (px/m)" value={layout.pixelsPerMeter} min={30} max={120} step={5} onChange={onScale} />
      </div>
      <NumberField label="Chiều cao trần (m)" value={ceilingHeightFor(layout)} min={2.4} max={6} step={0.1} onChange={onCeilingHeight} />
    </fieldset>
  </section>;
}
