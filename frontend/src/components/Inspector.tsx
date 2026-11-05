import { useState } from 'react';
import type { Camera, Layout, Obstacle } from '../types';
import type { Selection, Segment } from './canvas/shared';
import { AREA_MAX, AREA_MIN } from '../core/editor';

interface Props {
  layout: Layout; sel: Selection; measure: Segment;
  onObs: (id: string, patch: Partial<Pick<Obstacle, 'label' | 'elev' | 'w' | 'h'>>) => void;
  onCam: (id: string, patch: Partial<Pick<Camera, 'fov' | 'res' | 'height' | 'pan'>>) => void;
  onRoom: (w: number, h: number) => void; onScale: (ppm: number) => void; onCalibrate: (realM: number) => void;
}
const Num = ({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) => (
  <label className="field">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} /></label>
);

/** Thuộc tính vật thể đang chọn · kích thước tường bao · tỷ lệ px/m · hiệu chuẩn ảnh nền bằng công cụ đo. */
export function Inspector({ layout: L, sel, measure, onObs, onCam, onRoom, onScale, onCalibrate }: Props) {
  const obs = sel?.kind === 'obs' ? L.obstacles.find((o) => o.id === sel.id) : undefined;
  const cam = sel?.kind === 'cam' ? L.cameras.find((c) => c.id === sel.id) : undefined;
  const area = L.widthM * L.heightM, mLen = measure ? Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) : 0;
  return (
    <div className="panel">
      <h3>Tường bao & tỷ lệ</h3>
      <div className="row">
        <Num label="Rộng (m)" value={L.widthM} min={3} max={40} step={0.5} onChange={(v) => onRoom(v, L.heightM)} />
        <Num label="Dài (m)" value={L.heightM} min={3} max={40} step={0.5} onChange={(v) => onRoom(L.widthM, v)} />
        <Num label="px / m" value={L.pixelsPerMeter} min={30} max={120} step={5} onChange={onScale} />
      </div>
      <p className={area < AREA_MIN || area > AREA_MAX ? 'fail small' : 'muted small'}>{area} m² {area < AREA_MIN || area > AREA_MAX ? `— ngoài phạm vi ${AREA_MIN}–${AREA_MAX} m² của đề tài` : `(1 m = ${L.pixelsPerMeter} px, 1 ô 0.5 m = ${L.pixelsPerMeter / 2} px)`}</p>
      {L.background && measure && mLen > 0.05 && (
        <CalibrateRow measured={mLen} onApply={onCalibrate} />
      )}
      {obs && <>
        <h3>Vật cản: {obs.label}</h3>
        <label className="field">Tên<input value={obs.label} onChange={(e) => onObs(obs.id, { label: e.target.value })} /></label>
        <div className="row">
          <Num label="Dài (m)" value={obs.w} min={0.2} max={20} step={0.5} onChange={(v) => onObs(obs.id, { w: v })} />
          <Num label="Rộng (m)" value={obs.h} min={0.2} max={20} step={0.1} onChange={(v) => onObs(obs.id, { h: v })} />
          <Num label="Cao (m)" value={obs.elev} min={0.1} max={3} step={0.1} onChange={(v) => onObs(obs.id, { elev: v })} />
        </div>
        <p className="muted small">Kệ ≥ 1.6 m sẽ chắn tầm nhìn khuôn mặt; POS (1.1 m) và cửa thì không.</p>
      </>}
      {cam && <>
        <h3>Camera: {cam.id}</h3>
        <div className="row">
          <Num label="Góc xoay °" value={cam.pan} min={0} max={345} step={15} onChange={(v) => onCam(cam.id, { pan: v })} />
          <Num label="FOV °" value={cam.fov} min={30} max={140} step={5} onChange={(v) => onCam(cam.id, { fov: v })} />
          <Num label="Res ngang (px)" value={cam.res} min={640} max={7680} step={320} onChange={(v) => onCam(cam.id, { res: v })} />
          <Num label="Cao (m)" value={cam.height} min={1.8} max={4} step={0.1} onChange={(v) => onCam(cam.id, { height: v })} />
        </div>
      </>}
    </div>
  );
}

function CalibrateRow({ measured, onApply }: { measured: number; onApply: (real: number) => void }) {
  const [real, setReal] = useState(measured);
  return (
    <div className="row wrap">
      <span className="small">Đã đo trên ảnh nền: {measured.toFixed(2)} m →</span>
      <input type="number" value={real} min={0.1} step={0.1} style={{ width: 80 }} onChange={(e) => setReal(parseFloat(e.target.value) || measured)} /> m thực
      <button onClick={() => onApply(real)}>Hiệu chuẩn ảnh nền</button>
    </div>
  );
}
