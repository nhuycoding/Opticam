import { ArrowLeftRight, ChevronRight, FilePlus2, Grid2X2 } from 'lucide-react';
import type { Layout } from '../types';
import { ceilingHeightFor } from '../core/camera';
import { floorArea } from '../core/footprint';
import { NumberField } from './NumberField';

const ROOM_PRESETS = [
  { label: '5×12 m', hint: 'Nhà ống', w: 5, h: 12 },
  { label: '8×8 m', hint: 'Vuông', w: 8, h: 8 },
  { label: '10×6 m', hint: 'Chuẩn', w: 10, h: 6 },
  { label: '12×8 m', hint: 'Mini-Mart', w: 12, h: 8 },
] as const;

const CEILING_PRESETS = [
  { value: 2.8, label: '2.8 m', title: 'Trần thấp (2.8 m)' },
  { value: 3.2, label: '3.2 m', title: 'Trần tiêu chuẩn (3.2 m)' },
  { value: 4.0, label: '4.0 m', title: 'Trần cao (4.0 m)' },
] as const;

const GRID_PRESETS = [
  { value: 0.25, label: 'Chi tiết', sub: '0.25 m' },
  { value: 0.5, label: 'Chuẩn', sub: '0.5 m' },
  { value: 1.0, label: 'Nhanh', sub: '1.0 m' },
] as const;

const MAX_CELLS = 12000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function PlanningSettings({ layout, disabled, onRoom, onSwapRoom, onOpenCustomBuilder, onGrid, onScale, onCeilingHeight }: {
  layout: Layout; disabled: boolean;
  onRoom: (width: number, height: number) => void;
  onSwapRoom?: () => void;
  onOpenCustomBuilder?: () => void;
  onGrid: (gridM: number) => void;
  onScale: (pixelsPerMeter: number) => void;
  onCeilingHeight: (height: number) => void;
}) {
  const ceiling = ceilingHeightFor(layout);
  const area = floorArea(layout);
  const volume = Math.round(area * ceiling);
  const cols = Math.ceil(layout.widthM / layout.gridM);
  const rows = Math.ceil(layout.heightM / layout.gridM);
  const cellCount = cols * rows;
  const denseWarning = cellCount > MAX_CELLS ? 'over' : cellCount > 9000 ? 'warn' : 'ok';

  const minBounds = layout.obstacles.reduce(
    (acc, obs) => ({
      w: Math.max(acc.w, Math.ceil((obs.x + obs.w) * 10) / 10),
      h: Math.max(acc.h, Math.ceil((obs.y + obs.h) * 10) / 10),
    }),
    { w: 3, h: 3 },
  );

  return (
    <section className="panel planning-settings" data-tour="planning-settings">
      <div className="planning-header">
        <h3>Tùy chỉnh kích thước</h3>
        <div className="planning-badges">
          <span className="planning-metric-pill" title="Diện tích sàn & thể tích không gian">
            {area} m² · {volume} m³
          </span>
          <button
            type="button"
            className="text-button swap-dim-btn"
            disabled={disabled}
            onClick={() => onSwapRoom ? onSwapRoom() : onRoom(layout.heightM, layout.widthM)}
            title="Hoán đổi Rộng ↔ Dài và tự động xoay nội thất, cửa, camera 90°"
          >
            <ArrowLeftRight size={11} /> Xoay 90° (R↔D)
          </button>
          {onOpenCustomBuilder && (
            <button
              type="button"
              className="text-button swap-dim-btn"
              disabled={disabled}
              onClick={onOpenCustomBuilder}
              title="Tự tạo mặt bằng mới hoặc vẽ đường bao tường"
            >
              <FilePlus2 size={11} /> Tạo mới
            </button>
          )}
        </div>
      </div>

      <fieldset className="dimension-fields" disabled={disabled}>
        <div className="room-preset-row" role="group" aria-label="Cỡ mặt bằng phổ biến">
          {ROOM_PRESETS.map((preset) => {
            const active = Math.abs(layout.widthM - preset.w) < 0.05 && Math.abs(layout.heightM - preset.h) < 0.05;
            return (
              <button
                key={preset.label}
                type="button"
                className={`room-preset-chip${active ? ' active' : ''}`}
                onClick={() => onRoom(preset.w, preset.h)}
                title={`Đặt kích thước ${preset.label} (${preset.hint})`}
              >
                <strong>{preset.label}</strong>
                <small>{preset.hint}</small>
              </button>
            );
          })}
        </div>

        <div className="row room-dim-pair">
          <NumberField
            label="Rộng (m)"
            stepName="Rộng mặt bằng"
            value={layout.widthM}
            min={3}
            max={40}
            step={0.5}
            unit="m"
            stepButtons
            onChange={(width) => onRoom(width, layout.heightM)}
          />
          <NumberField
            label="Dài (m)"
            stepName="Dài mặt bằng"
            value={layout.heightM}
            min={3}
            max={40}
            step={0.5}
            unit="m"
            stepButtons
            onChange={(height) => onRoom(layout.widthM, height)}
          />
        </div>

        <div className="ceiling-control-card">
          <div className="ceiling-card-top">
            <NumberField
              label="Chiều cao trần (m)"
              stepName="Chiều cao trần"
              value={ceiling}
              min={2.4}
              max={6}
              step={0.1}
              unit="m"
              stepButtons
              onChange={onCeilingHeight}
            />
            <div className="ceiling-quick-pills" role="group" aria-label="Mức trần phổ biến">
              {CEILING_PRESETS.map((preset) => {
                const active = Math.abs(ceiling - preset.value) < 0.05;
                return (
                  <button
                    key={preset.value}
                    type="button"
                    className={`ceiling-pill-btn${active ? ' active' : ''}`}
                    title={preset.title}
                    onClick={() => onCeilingHeight(preset.value)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
          <input
            type="range"
            className="dim-slider ceiling-slider"
            aria-label="Thanh trượt Chiều cao trần (m)"
            min={2.4}
            max={6}
            step={0.1}
            value={ceiling}
            onChange={(event) => {
              const v = event.target.valueAsNumber;
              if (Number.isFinite(v)) onCeilingHeight(round1(v));
            }}
          />
        </div>

        {(layout.floorPolygon || minBounds.w > 3 || minBounds.h > 3) && (
          <p className="room-bounds-hint">
            {layout.floorPolygon
              ? 'Mặt bằng đa giác: đổi Rộng / Dài sẽ co giãn tỷ lệ theo đường bao.'
              : `Giới hạn theo nội thất đang đặt: tối thiểu ${minBounds.w} × ${minBounds.h} m.`}
          </p>
        )}

        <details className="accordion-card grid-scale-collapse">
          <summary className="accordion-summary">
            <span className="accordion-title-with-icon">
              <Grid2X2 size={13} /> Lưới &amp; tỷ lệ hiển thị
            </span>
            <span className={`accordion-pill${denseWarning === 'over' ? ' pill-fail' : denseWarning === 'warn' ? ' pill-warn' : ''}`}>
              {layout.gridM} m · {cellCount.toLocaleString('vi-VN')} ô
            </span>
            <ChevronRight size={14} className="accordion-chevron" aria-hidden="true" />
          </summary>
          <div className="accordion-body">
            <div className="grid-preset-strip">
              <span className="craved-band-label">Độ mịn lưới phân tích</span>
              <div className="segmented-pills segmented-3" role="group" aria-label="Độ mịn lưới phân tích">
                {GRID_PRESETS.map((preset) => {
                  const active = Math.abs(layout.gridM - preset.value) < 0.01;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      className={active ? 'active' : ''}
                      aria-pressed={active}
                      onClick={() => onGrid(preset.value)}
                    >
                      <strong>{preset.label}</strong>
                      <small>{preset.sub}</small>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="row room-dim-pair">
              <NumberField
                label="Kích thước ô (m)"
                value={layout.gridM}
                min={0.1}
                max={2}
                step={0.05}
                buttonStep={0.1}
                unit="m"
                stepButtons
                onChange={onGrid}
              />
              <NumberField
                label="Tỷ lệ (px/m)"
                value={layout.pixelsPerMeter}
                min={30}
                max={120}
                step={5}
                unit="px/m"
                stepButtons
                onChange={onScale}
              />
            </div>
            <p className={`grid-cell-budget${denseWarning !== 'ok' ? ` ${denseWarning}` : ''}`}>
              Lưới {cols} × {rows} = <b>{cellCount.toLocaleString('vi-VN')}</b> / {MAX_CELLS.toLocaleString('vi-VN')} ô tối đa · Tỷ lệ px/m chỉ đổi độ phóng bản vẽ 2.5D.
            </p>
          </div>
        </details>
      </fieldset>
    </section>
  );
}
