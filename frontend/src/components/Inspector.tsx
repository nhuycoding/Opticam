import { useEffect, useRef, useState } from 'react';
import { PERSON_TARGETS, type Camera, type Layout, type Obstacle, type ShelfRiskCategory, type TargetHeight } from '../types';
import type { Selection, Segment } from './canvas/shared';
import { AREA_MAX, AREA_MIN } from '../core/editor';
import { CAMERA_QUALITY_PRESETS, cameraQualityForResolution, type CameraQualityId } from '../core/camera';
import { RISK_DEFAULTS, SHELF_RISK_PROFILES } from '../core/optics';

interface Props {
  mode?: 'room' | 'risk' | 'camera';
  layout: Layout; sel: Selection; measure: Segment;
  onSelect: (selection: Selection) => void;
  onTargetHeight: (height: TargetHeight) => void;
  onGrid: (gridM: number) => void;
  onObs: (id: string, patch: Partial<Pick<Obstacle, 'label' | 'elev' | 'w' | 'h' | 'riskCategory' | 'riskWmax' | 'riskR0' | 'riskR'>>) => void;
  onCam: (id: string, patch: Partial<Pick<Camera, 'fov' | 'res' | 'height' | 'pan' | 'range' | 'model'>>) => void;
  onRoom: (w: number, h: number) => void; onScale: (ppm: number) => void; onCalibrate: (realM: number) => void;
}
function NumberInput({ value, min, max, step, onCommit, style }: {
  value: number; min: number; max?: number; step: number; onCommit: (value: number) => void; style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(String(value));
  const acceptedValue = useRef(value);
  const [error, setError] = useState('');
  useEffect(() => {
    acceptedValue.current = value;
    setDraft(String(value));
    setError('');
  }, [value]);

  const restore = () => setDraft(String(acceptedValue.current));
  const commit = () => {
    const text = draft.trim();
    const next = text ? Number(text) : Number.NaN;
    if (Number.isFinite(next) && next >= min && (max === undefined || next <= max)) {
      setError('');
      if (next !== value) onCommit(next);
      setDraft(String(value));
    } else {
      setError(max === undefined ? `Nhập số từ ${min}.` : `Nhập số từ ${min} đến ${max}.`);
      restore();
    }
  };

  return <span className="number-input"><input
    aria-invalid={Boolean(error)}
    type="number"
    value={draft}
    min={min}
    max={max}
    step={step}
    style={style}
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
  />{error && <small className="fail" role="alert">{error}</small>}</span>;
}

const Num = ({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) => (
  <label className="field">{label}<NumberInput value={value} min={min} max={max} step={step} onCommit={onChange} /></label>
);

/** Thuộc tính vật thể đang chọn · kích thước tường bao · tỷ lệ px/m · hiệu chuẩn ảnh nền bằng công cụ đo. */
export function Inspector({ mode = 'room', layout: L, sel, measure, onSelect, onTargetHeight, onGrid, onObs, onCam, onRoom, onScale, onCalibrate }: Props) {
  const [customResolutionFor, setCustomResolutionFor] = useState<string | null>(null);
  const obs = sel?.kind === 'obs' ? L.obstacles.find((o) => o.id === sel.id) : undefined;
  const cam = sel?.kind === 'cam' ? L.cameras.find((c) => c.id === sel.id) : undefined;
  const area = L.widthM * L.heightM, mLen = measure ? Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) : 0;
  return (
    <div className="panel inspector-panel">
      <h3>{sel ? 'Thuộc tính đối tượng' : mode === 'room' ? 'Kích thước & bố trí' : mode === 'risk' ? 'Ưu tiên theo vật thể' : 'Thông số & đánh giá'}</h3>
      <label className="field object-picker">Đối tượng đang chọn
        <select aria-label="Chọn đối tượng để chỉnh sửa" value={sel && sel.kind !== 'person' ? `${sel.kind}:${sel.id}` : ''} onChange={(event) => {
          const value = event.target.value;
          const separator = value.indexOf(':');
          onSelect(value ? { kind: value.slice(0, separator) as 'cam' | 'obs', id: value.slice(separator + 1) } : null);
        }}>
          <option value="">Chọn đối tượng trên sơ đồ</option>
          <optgroup label="Camera">{L.cameras.map((camera) => <option key={camera.id} value={`cam:${camera.id}`}>{camera.id} · {camera.model ?? 'Camera'}</option>)}</optgroup>
          <optgroup label="Vật cản">{L.obstacles.map((obstacle) => <option key={obstacle.id} value={`obs:${obstacle.id}`}>{obstacle.label}</option>)}</optgroup>
        </select>
      </label>
      <details className="inspector-settings" open={mode === 'room' || (!obs && !cam && mode === 'camera')}>
      <summary>Thiết lập mặt bằng & đánh giá</summary>
      <div className="inspector-settings-content">
      <label className="field">Độ cao mục tiêu tính từ sàn
        <select value={L.targetHeight} onChange={(e) => {
          const target = PERSON_TARGETS.find((option) => option.height === Number(e.target.value));
          if (target) onTargetHeight(target.height);
        }}>
          {PERSON_TARGETS.map((target) => <option key={target.height} value={target.height}>{target.label} ({target.height.toFixed(1)} m)</option>)}
        </select>
      </label>
      <p className="muted small">PPM và vùng khuất được tính tại độ cao đã chọn; chiều cao từng kệ/POS được xét trên đường ngắm 3D.</p>
      <details className="inspector-settings" open={mode === 'room'}>
        <summary>
          <span>Tường bao & tỷ lệ</span>
          <small>{L.widthM} × {L.heightM} m · ô {L.gridM} m</small>
        </summary>
        <div className="inspector-settings-content">
          <div className="row">
            <Num label="Rộng (m)" value={L.widthM} min={3} max={40} step={0.5} onChange={(v) => onRoom(v, L.heightM)} />
            <Num label="Dài (m)" value={L.heightM} min={3} max={40} step={0.5} onChange={(v) => onRoom(L.widthM, v)} />
            <Num label="Kích thước ô (m)" value={L.gridM} min={0.1} max={2} step={0.05} onChange={onGrid} />
            <Num label="px / m" value={L.pixelsPerMeter} min={30} max={120} step={5} onChange={onScale} />
          </div>
          <p className={area < AREA_MIN || area > AREA_MAX ? 'fail small' : 'muted small'}>{area} m² {area < AREA_MIN || area > AREA_MAX ? `— ngoài phạm vi ${AREA_MIN}–${AREA_MAX} m² của đề tài` : `(1 m = ${L.pixelsPerMeter} px, 1 ô = ${L.gridM} m)`}</p>
          <p className="muted small">Để lấy mẫu vùng giảm dần đủ mịn, nên dùng gridM ≤ (R − r₀)/3; cọ rủi ro lưu theo tọa độ thực nên không lệch khi đổi lưới.</p>
        </div>
      </details>
      {L.background && measure && mLen > 0.05 && (
        <CalibrateRow measured={mLen} onApply={onCalibrate} />
      )}
      </div></details>
      {!sel && <div className="object-list">{(mode === 'camera' ? L.cameras.map(c => ({ id: c.id, label: c.id, note: `${c.res}px · FOV ${c.fov}°`, kind: 'cam' as const })) : L.obstacles.map(o => ({ id: o.id, label: o.label, note: mode === 'risk' ? `W ${(o.riskWmax ?? RISK_DEFAULTS[o.type].wmax).toFixed(1)}` : `${o.w} × ${o.h} m`, kind: 'obs' as const }))).map(item => <button key={item.id} onClick={() => onSelect({ kind: item.kind, id: item.id })}><span>{item.label}</span><small>{item.note}</small></button>)}</div>}
      {obs && <>
        {mode === 'risk' && (() => {
          const defaults = RISK_DEFAULTS[obs.type];
          const riskCategory = obs.riskCategory ?? 'standard';
          return <>
        <h3>Ưu tiên vùng quanh vật thể</h3>
        {obs.type === 'shelf' && <>
          <label className="field">Nhóm hàng (CRAVED)
            <select value={riskCategory} onChange={(e) => {
              const category = e.target.value as ShelfRiskCategory;
              onObs(obs.id, {
                riskCategory: category,
                ...(category === 'custom' ? {} : { riskWmax: SHELF_RISK_PROFILES[category].wmax })
              });
            }}>
              {(['high', 'standard', 'bulky', 'custom'] as ShelfRiskCategory[]).map((category) =>
                <option key={category} value={category}>
                  {SHELF_RISK_PROFILES[category].label}{category !== 'custom' ? ` (Wmax ${SHELF_RISK_PROFILES[category].wmax})` : ''}
                </option>
              )}
            </select>
          </label>
          <p className="muted small">Nhóm CRAVED cao: hàng nhỏ/dễ lấy, giá trị hoặc sức hấp dẫn cao; cồng kềnh: khó che giấu/mang đi. Đây là phân nhóm ưu tiên thiết kế, không phải xác suất trộm cắp.</p>
        </>}
        <div className="row">
          <Num label="W đỉnh" value={obs.riskWmax ?? (obs.type === 'shelf' ? SHELF_RISK_PROFILES[riskCategory].wmax : defaults.wmax)} min={1} max={5} step={0.1} onChange={(v) => onObs(obs.id, { riskWmax: v })} />
          <Num label="r₀ giữ nguyên (m)" value={obs.riskR0 ?? defaults.r0} min={0} max={19.9} step={0.1} onChange={(v) => onObs(obs.id, { riskR0: v })} />
          <Num label="R tắt dần (m)" value={obs.riskR ?? defaults.radius} min={(obs.riskR0 ?? defaults.r0) + 0.1} max={20} step={0.1} onChange={(v) => onObs(obs.id, { riskR: v })} />
        </div>
        <p className="muted small">W giữ ở mức đỉnh đến r₀, sau đó giảm tuyến tính về 1 tại R. Wmax nhóm hàng là giá trị khởi tạo có thể chỉnh, chưa hiệu chuẩn bằng dữ liệu tổn thất của cửa hàng.</p>
        </>;
        })()}
        {mode !== 'risk' && <>
        <h3>Vật cản · {obs.label}</h3>
        <label className="field">Tên<input value={obs.label} onChange={(e) => onObs(obs.id, { label: e.target.value })} /></label>
        <div className="row">
          <Num label="Dài (m)" value={obs.w} min={0.2} max={20} step={0.5} onChange={(v) => onObs(obs.id, { w: v })} />
          <Num label="Rộng (m)" value={obs.h} min={0.2} max={20} step={0.1} onChange={(v) => onObs(obs.id, { h: v })} />
          <Num label="Cao (m)" value={obs.elev} min={0.1} max={3} step={0.1} onChange={(v) => onObs(obs.id, { elev: v })} />
        </div>
        <p className="muted small">Chiều cao vật thể được xét trên đường ngắm 3D tới điểm mục tiêu.</p></>}
      </>}
      {cam && <>
        <h3>Camera · {cam.id}</h3>
        <p className="muted small">Chỉnh thông số camera đang chọn. Góc xoay điều khiển hướng nhìn; góc quay là độ rộng vùng phủ (FOV).</p>
        <label className="field">Model / tên camera
          <input value={cam.model ?? ''} placeholder="Ví dụ: OptiCam IP 4MP" onChange={(e) => onCam(cam.id, { model: e.target.value })} />
        </label>
        <div className="row">
          <label className="field">Chất lượng hình ảnh
            <select
              value={customResolutionFor === cam.id ? 'custom' : cameraQualityForResolution(cam.res)}
              onChange={(e) => {
                const quality = e.target.value as CameraQualityId;
                setCustomResolutionFor(quality === 'custom' ? cam.id : null);
                const preset = CAMERA_QUALITY_PRESETS.find((option) => option.id === quality);
                if (preset) onCam(cam.id, { res: preset.resolution, model: preset.model });
              }}
            >
              {CAMERA_QUALITY_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              <option value="custom">Tùy chỉnh</option>
            </select>
          </label>
          {(customResolutionFor === cam.id || cameraQualityForResolution(cam.res) === 'custom') && (
            <Num label="Độ phân giải ngang (px)" value={cam.res} min={640} max={7680} step={160} onChange={(v) => onCam(cam.id, { res: v })} />
          )}
          <Num label="Góc xoay / hướng nhìn (°)" value={cam.pan} min={0} max={345} step={15} onChange={(v) => onCam(cam.id, { pan: v })} />
          <Num label="Góc quay / FOV (°)" value={cam.fov} min={30} max={140} step={5} onChange={(v) => onCam(cam.id, { fov: v })} />
        </div>
        <div className="row">
          <Num label="Tầm xa (m)" value={cam.range} min={1} max={30} step={0.5} onChange={(v) => onCam(cam.id, { range: v })} />
          <Num label="Cao (m)" value={cam.height} min={1.8} max={4} step={0.1} onChange={(v) => onCam(cam.id, { height: v })} />
        </div>
      </>}
      {mode === 'camera' && sel?.kind !== 'cam' && <p className="muted small">Chọn camera trên sơ đồ để chỉnh chất lượng, hướng xoay và góc quan sát.</p>}
    </div>
  );
}

function CalibrateRow({ measured, onApply }: { measured: number; onApply: (real: number) => void }) {
  const [real, setReal] = useState(measured);
  return (
    <div className="row wrap">
      <span className="small">Đã đo trên ảnh nền: {measured.toFixed(2)} m →</span>
      <label className="field">Chiều dài thực (m)<NumberInput value={real} min={0.1} step={0.1} style={{ width: 80 }} onCommit={setReal} /></label>
      <button onClick={() => onApply(real)}>Hiệu chuẩn ảnh nền</button>
    </div>
  );
}
