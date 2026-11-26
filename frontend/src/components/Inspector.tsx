import { useState } from 'react';
import { NumberField } from './NumberField';
import { type Camera, type Layout, type Obstacle, type ShelfRiskCategory, type Fixture } from '../types';
import type { Selection } from './canvas/shared';
import { CAMERA_QUALITY_PRESETS, cameraQualityForResolution, cameraProjection, cameraMount, ceilingHeightFor, type CameraQualityId } from '../core/camera';
import { RISK_DEFAULTS, SHELF_RISK_PROFILES } from '../core/optics';

interface Props {
  mode: 'room' | 'risk' | 'camera';
  layout: Layout; sel: Selection;
  onSelect: (selection: Selection) => void;
  onObs: (id: string, patch: Partial<Pick<Obstacle, 'label' | 'elev' | 'w' | 'h' | 'riskCategory' | 'riskWmax' | 'riskR0' | 'riskR' | 'fixture'>>) => void;
  onCam: (id: string, patch: Partial<Camera>) => void;
}
export function Inspector({ mode, layout: L, sel, onSelect, onObs, onCam }: Props) {
  const [customResolutionFor, setCustomResolutionFor] = useState<string | null>(null);
  const obs = mode !== 'camera' && sel?.kind === 'obs' ? L.obstacles.find((o) => o.id === sel.id) : undefined;
  const cam = mode === 'camera' && sel?.kind === 'cam' ? L.cameras.find((c) => c.id === sel.id) : undefined;
  if (mode === 'camera' && !cam) return null;
  return (
    <div className="panel inspector-panel">
      {mode !== 'camera' && <label className="field object-picker">
        {mode === 'risk' ? 'Vật thể cần ưu tiên' : 'Nội thất'}
        <select value={obs?.id ?? ''} onChange={(event) => {
          const id = event.target.value;
          onSelect(id ? { kind: 'obs', id } : null);
        }}>
          <option value="">Chọn vật thể</option>
          {L.obstacles.map((obstacle) => <option key={obstacle.id} value={obstacle.id}>{obstacle.label}</option>)}
        </select>
      </label>}
      {obs && <>
        {mode === 'risk' && (() => {
          const defaults = RISK_DEFAULTS[obs.type];
          const riskCategory = obs.riskCategory ?? 'standard';
          return <>
        <h3>Ưu tiên vùng quanh vật thể</h3>
        {obs.type === 'shelf' && (!obs.fixture || ['wall-shelf', 'gondola'].includes(obs.fixture)) && <>
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
        </>}
        <div className="row">
          <NumberField label="W đỉnh" value={obs.riskWmax ?? (obs.type === 'shelf' ? SHELF_RISK_PROFILES[riskCategory].wmax : defaults.wmax)} min={1} max={5} step={0.1} onChange={(v) => onObs(obs.id, { riskWmax: v })} />
          <NumberField label="r₀ giữ nguyên (m)" value={obs.riskR0 ?? defaults.r0} min={0} max={19.9} step={0.1} onChange={(v) => onObs(obs.id, { riskR0: v })} />
          <NumberField label="R tắt dần (m)" value={obs.riskR ?? defaults.radius} min={(obs.riskR0 ?? defaults.r0) + 0.1} max={20} step={0.1} onChange={(v) => onObs(obs.id, { riskR: v })} />
        </div>
        </>;
        })()}
        {mode === 'room' && <details key={obs.id} className="inspector-settings">
          <summary>Chỉnh sửa nội thất</summary>
          <div className="inspector-settings-content">
            {obs.type === 'shelf' && <label className="field">Loại nội thất<select value={obs.fixture ?? 'gondola'} onChange={event => onObs(obs.id, { fixture: event.target.value as Fixture })}>
              <option value="gondola">Kệ hai mặt</option><option value="wall-shelf">Kệ một mặt sát tường</option><option value="fridge">Tủ mát</option><option value="freezer">Tủ đông</option><option value="food-counter">Quầy đồ ăn / pha chế</option><option value="seating">Bàn ngồi</option><option value="partition">Vách ngăn</option><option value="column">Cột</option>
            </select></label>}
            <label className="field">Tên<input value={obs.label} onChange={(e) => onObs(obs.id, { label: e.target.value })} /></label>
            <div className="row">
              <NumberField label="Dài (m)" value={obs.w} min={0.2} max={20} step={0.5} onChange={(v) => onObs(obs.id, { w: v })} />
              <NumberField label="Rộng (m)" value={obs.h} min={0.2} max={20} step={0.1} onChange={(v) => onObs(obs.id, { h: v })} />
              <NumberField label="Cao (m)" value={obs.elev} min={0.1} max={3} step={0.1} onChange={(v) => onObs(obs.id, { elev: v })} />
            </div>
          </div>
        </details>}
      </>}
      {cam && <>
        <h3>Camera · {cam.id}</h3>
        {cam.target && <p className="camera-role">Khu vực phụ trách · {cam.target}</p>}
        <label className="field">Model / tên camera
          <input value={cam.model ?? ''} placeholder="Ví dụ: OptiCam IP 4MP" onChange={(e) => onCam(cam.id, { model: e.target.value })} />
        </label>
        <label className="field">Kiểu lắp đặt<select aria-label="Kiểu lắp đặt camera" value={cameraMount(cam)} onChange={event => onCam(cam.id, { mount: event.target.value as Camera['mount'] })}><option value="wall">Gắn tường</option><option value="ceiling">Gắn trần</option></select></label>
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
            <NumberField label="Độ phân giải ngang (px)" value={cam.res} min={640} max={7680} step={160} onChange={(v) => onCam(cam.id, { res: v })} />
          )}
          <NumberField label="Góc xoay / hướng nhìn (°)" value={cam.pan} min={0} max={345} step={15} onChange={(v) => onCam(cam.id, { pan: v })} />
          <NumberField label="Góc quay / FOV (°)" value={cam.fov} min={30} max={140} step={5} onChange={(v) => onCam(cam.id, { fov: v })} />
        </div>
        <div className="row">
          <NumberField label="Tầm xa (m)" value={cam.range} min={1} max={30} step={0.5} onChange={(v) => onCam(cam.id, { range: v })} />
          {cameraMount(cam) === 'ceiling' ? <>
            <NumberField label="Bộ gá dưới trần (m)" value={cam.ceilingDrop ?? .15} min={.15} max={Math.min(1, ceilingHeightFor(L) - 1.8)} step={.05} onChange={ceilingDrop => onCam(cam.id, { ceilingDrop })} />
          </> : <NumberField label="Cao (m)" value={cam.height} min={1.8} max={ceilingHeightFor(L) - .3} step={0.1} onChange={(v) => onCam(cam.id, { height: v })} />}
        </div>
        <details className="inspector-settings">
          <summary>Hướng nhìn & trường nhìn 3D</summary>
          <div className="inspector-settings-content">
            <NumberField label="Góc chúc xuống (°)" value={cameraProjection(cam).tilt} min={0} max={90} step={1} onChange={tilt => onCam(cam.id, { tilt })} />
            <NumberField label="Trường nhìn dọc (°)" value={Math.round(cameraProjection(cam).vfov * 10) / 10} min={10} max={120} step={1} onChange={vfov => onCam(cam.id, { vfov })} />
            <button onClick={() => onCam(cam.id, { vfov: undefined })}>Tự tính FOV dọc theo 16:9</button>
          </div>
        </details>
      </>}
    </div>
  );
}
