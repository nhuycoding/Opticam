import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, ChevronRight, Layers, Minus, Plus, Ruler } from 'lucide-react';
import { NumberField } from './NumberField';
import { ShelfTierFolders } from './ShelfTierFolders';
import { StudioSelect } from './StudioSelect';
import { type Camera, type Layout, type Obstacle, type ShelfRiskCategory, type Fixture } from '../types';
import type { Selection } from './canvas/shared';
import { CAMERA_QUALITY_PRESETS, cameraQualityForResolution, cameraProjection, cameraMount, ceilingHeightFor, type CameraQualityId } from '../core/camera';
import { applyTiersToObstacle } from '../core/craved';
import { FIXTURE_GROUP_LABELS, FIXTURE_SPECS, FIXTURE_VALUES, isMerchandisable, sizePresetsForObstacle, type FixtureGroup } from '../core/fixtures';
import { RISK_DEFAULTS, SHELF_RISK_PROFILES } from '../core/optics';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function LiveDimensionControl({
  label, value, min, max, sliderMax, step = 0.05, buttonStep = 0.1, onChange,
}: {
  label: string; value: number; min: number; max: number; sliderMax: number;
  step?: number; buttonStep?: number; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(round2(value)));
  const focusedRef = useRef(false);
  useEffect(() => {
    const rounded = round2(value);
    if (!focusedRef.current || Number(draft.trim()) !== rounded) {
      if (!(focusedRef.current && /\.$/.test(draft.trim()))) {
        setDraft(String(rounded));
      }
    }
  }, [value]);

  const effectiveMax = Math.max(min, Math.min(max, Math.max(sliderMax, value + 0.5)));
  const bump = (delta: number) => {
    const next = round2(Math.min(max, Math.max(min, value + delta)));
    if (Math.abs(next - value) > 1e-4) onChange(next);
  };
  return (
    <div className="dim-control">
      <div className="dim-head">
        <span className="dim-label">{label}</span>
        <div className="dim-controls-right">
          <button type="button" className="dim-step-btn" aria-label={`Giảm ${label}`} disabled={value <= min + 1e-4} onClick={() => bump(-buttonStep)}>
            <Minus size={11} />
          </button>
          <input
            type="number"
            className="dim-num-input"
            aria-label={label}
            value={draft}
            min={min}
            max={max}
            step={step}
            onFocus={() => { focusedRef.current = true; }}
            onChange={(e) => {
              const raw = e.target.value;
              setDraft(raw);
              const text = raw.trim();
              if (!text || text.endsWith('.') || text === '-') return;
              const v = Number(text);
              if (Number.isFinite(v) && v >= min && v <= max) onChange(round2(v));
            }}
            onBlur={() => {
              focusedRef.current = false;
              const v = Number(draft.trim());
              if (Number.isFinite(v) && v >= min && v <= max && Math.abs(v - value) > 1e-4) onChange(round2(v));
              setDraft(String(round2(value)));
            }}
          />
          <button type="button" className="dim-step-btn" aria-label={`Tăng ${label}`} disabled={value >= max - 1e-4} onClick={() => bump(buttonStep)}>
            <Plus size={11} />
          </button>
        </div>
      </div>
      <input
        type="range"
        className="dim-slider"
        aria-label={`Thanh trượt ${label}`}
        min={min}
        max={effectiveMax}
        step={step}
        value={Math.min(effectiveMax, Math.max(min, value))}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onChange(round2(v));
        }}
      />
    </div>
  );
}

interface Props {
  mode: 'room' | 'risk' | 'camera';
  layout: Layout; sel: Selection;
  onSelect: (selection: Selection) => void;
  onObs: (id: string, patch: Partial<Pick<Obstacle, 'label' | 'elev' | 'w' | 'h' | 'riskCategory' | 'riskWmax' | 'riskR0' | 'riskR' | 'fixture' | 'tiers'>>) => void;
  onCam: (id: string, patch: Partial<Camera>) => void;
}
export function Inspector({ mode, layout: L, sel, onSelect, onObs, onCam }: Props) {
  const [customResolutionFor, setCustomResolutionFor] = useState<string | null>(null);
  const [obsTab, setObsTab] = useState<'size' | 'craved'>(mode === 'risk' ? 'craved' : 'size');
  useEffect(() => {
    setObsTab(mode === 'risk' ? 'craved' : 'size');
  }, [mode]);

  const obs = mode !== 'camera' && sel?.kind === 'obs' ? L.obstacles.find((o) => o.id === sel.id) : undefined;
  const cam = mode === 'camera' && sel?.kind === 'cam' ? L.cameras.find((c) => c.id === sel.id) : undefined;
  if (mode === 'camera' && !cam) return null;

  const ceilingH = ceilingHeightFor(L);
  const merchandisable = obs ? isMerchandisable(obs) : false;
  const presets = obs ? sizePresetsForObstacle(obs, ceilingH) : [];
  const fixtureGroups: FixtureGroup[] = ['display', 'cold', 'service', 'structure'];

  return (
    <div className="panel inspector-panel">
      {mode !== 'camera' && (
        <div className="field object-picker">
          <span>{mode === 'risk' ? 'Vật thể cần ưu tiên' : 'Nội thất đang chọn'}</span>
          <StudioSelect
            ariaLabel={mode === 'risk' ? 'Vật thể cần ưu tiên' : 'Nội thất đang chọn'}
            value={obs?.id ?? ''}
            placeholder={`Chọn vật thể (${L.obstacles.length})`}
            options={L.obstacles.map((obstacle) => {
              const w = obstacle.riskWmax ?? RISK_DEFAULTS[obstacle.type].wmax;
              const dotColor = w >= 4 ? '#c66558' : w >= 2 ? '#c59f5c' : '#809388';
              const group = obstacle.type === 'pos' || obstacle.type === 'entrance'
                ? 'Quầy & Lối ra vào'
                : FIXTURE_GROUP_LABELS[FIXTURE_SPECS[obstacle.fixture ?? 'gondola'].group];
              return {
                value: obstacle.id,
                label: obstacle.label,
                meta: `${round2(obstacle.w)}×${round2(obstacle.h)}m · W${w.toFixed(1)}`,
                group,
                dotColor,
              };
            })}
            onChange={(id) => onSelect(id ? { kind: 'obs', id } : null)}
          />
        </div>
      )}
      {mode !== 'camera' && !obs && (
        <p className="inspector-empty-hint">
          Nhấp một kệ, tủ, quầy POS hoặc cửa trên sơ đồ để chỉnh kích thước &amp; hàng hóa CRAVED.
        </p>
      )}
      {obs && <>
        <div className="inspector-obs-tabs" role="tablist" aria-label="Thuộc tính nội thất">
          <button
            type="button"
            role="tab"
            aria-selected={obsTab === 'size'}
            className={obsTab === 'size' ? 'active' : ''}
            onClick={() => setObsTab('size')}
          >
            <Ruler size={12} /> Kích cỡ &amp; Kiểu
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={obsTab === 'craved'}
            className={obsTab === 'craved' ? 'active' : ''}
            onClick={() => setObsTab('craved')}
          >
            <Layers size={12} /> {merchandisable ? 'Tầng hàng & CRAVED' : 'Ưu tiên vùng'}
          </button>
        </div>

        {obsTab === 'size' && (
          <div className="inspector-size-pane">
            {obs.type === 'shelf' && (() => {
              const currentFixture = obs.fixture ?? 'gondola';
              const spec = FIXTURE_SPECS[currentFixture];
              return (
                <details className="accordion-card fixture-type-collapse">
                  <summary className="accordion-summary">
                    <span>Loại nội thất</span>
                    <span className="accordion-pill">{spec.label}</span>
                    <ChevronRight size={14} className="accordion-chevron" aria-hidden="true" />
                  </summary>
                  <div className="accordion-body fixture-type-grid-wrap">
                    {fixtureGroups.map((groupKey) => (
                      <div key={groupKey} className="fixture-type-group">
                        <span className="fixture-type-group-title">{FIXTURE_GROUP_LABELS[groupKey]}</span>
                        <div className="fixture-type-chips">
                          {FIXTURE_VALUES.filter((f) => FIXTURE_SPECS[f].group === groupKey).map((f) => {
                            const fSpec = FIXTURE_SPECS[f];
                            const selected = currentFixture === f;
                            return (
                              <button
                                key={f}
                                type="button"
                                className={`fixture-type-chip${selected ? ' selected' : ''}`}
                                onClick={() => onObs(obs.id, { fixture: f as Fixture })}
                                title={`${fSpec.label} (${fSpec.w}×${fSpec.h} m)`}
                              >
                                <span>{fSpec.label}</span>
                                {selected && <Check size={11} />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}
            <label className="field">Tên hiển thị
              <input value={obs.label} onChange={(e) => onObs(obs.id, { label: e.target.value })} />
            </label>

            <div className="size-presets-block">
              <div className="size-presets-head">
                <span>Cỡ mẫu nhanh</span>
                {obs.type !== 'entrance' && (
                  <button
                    type="button"
                    className="text-button swap-dim-btn"
                    onClick={() => onObs(obs.id, { w: obs.h, h: obs.w })}
                    title="Đổi chiều dài và chiều rộng"
                  >
                    <ArrowLeftRight size={11} /> Đổi Dài ↔ Rộng
                  </button>
                )}
              </div>
              <div className="size-presets-row">
                {presets.map((preset) => {
                  const active = Math.abs(obs.w - preset.w) < 0.03
                    && Math.abs(obs.h - preset.h) < 0.03
                    && Math.abs(obs.elev - preset.elev) < 0.03;
                  return (
                    <button
                      key={preset.tag}
                      type="button"
                      className={`size-preset-btn${active ? ' active' : ''}`}
                      onClick={() => onObs(obs.id, { w: preset.w, h: preset.h, elev: preset.elev })}
                      title={`${preset.label}: ${preset.w} × ${preset.h} × ${preset.elev} m`}
                    >
                      <strong>{preset.tag}</strong>
                      <span>{preset.label}</span>
                      <small>{preset.w}×{preset.h}m</small>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="dim-stack">
              <LiveDimensionControl label="Dài (m)" value={obs.w} min={0.2} max={L.widthM} sliderMax={Math.min(L.widthM, 6)} step={0.05} buttonStep={0.1} onChange={(v) => onObs(obs.id, { w: v })} />
              <LiveDimensionControl label="Rộng (m)" value={obs.h} min={0.2} max={L.heightM} sliderMax={Math.min(L.heightM, 3)} step={0.05} buttonStep={0.1} onChange={(v) => onObs(obs.id, { h: v })} />
              <LiveDimensionControl label="Cao (m)" value={obs.elev} min={0.1} max={ceilingH} sliderMax={ceilingH} step={0.05} buttonStep={0.1} onChange={(v) => onObs(obs.id, { elev: v })} />
            </div>
          </div>
        )}

        {obsTab === 'craved' && (() => {
          const defaults = RISK_DEFAULTS[obs.type];
          const riskCategory = obs.riskCategory ?? 'standard';
          return (
            <div className="inspector-craved-pane">
              {merchandisable && (
                <ShelfTierFolders
                  key={obs.id}
                  obstacle={obs}
                  onChangeTiers={(tiers, preserveCustom) =>
                    onObs(obs.id, applyTiersToObstacle(obs, tiers, preserveCustom))
                  }
                />
              )}
              <details className="accordion-card inspector-settings" open={!merchandisable}>
                <summary className="accordion-summary">
                  <span>{merchandisable ? 'Tùy chỉnh trọng số & bán kính vùng' : 'Ưu tiên vùng quanh vật thể'}</span>
                  <span className="accordion-pill">W {(obs.riskWmax ?? (obs.type === 'shelf' ? SHELF_RISK_PROFILES[riskCategory].wmax : defaults.wmax)).toFixed(1)} · {(obs.riskR ?? defaults.radius).toFixed(1)}m</span>
                  <ChevronRight size={14} className="accordion-chevron" aria-hidden="true" />
                </summary>
                <div className="accordion-body inspector-settings-content">
                  {obs.type === 'shelf' && (
                    <div className="craved-band-pills" role="group" aria-label="Nhóm hàng (CRAVED)">
                      <span className="craved-band-label">Nhóm hàng (CRAVED)</span>
                      <div className="craved-band-row">
                        {(['high', 'standard', 'bulky', 'custom'] as ShelfRiskCategory[]).map((category) => (
                          <button
                            key={category}
                            type="button"
                            className={`craved-band-btn band-${category}${riskCategory === category ? ' active' : ''}`}
                            onClick={() => onObs(obs.id, {
                              riskCategory: category,
                              ...(category === 'custom' ? {} : { riskWmax: SHELF_RISK_PROFILES[category].wmax }),
                            })}
                          >
                            <strong>{SHELF_RISK_PROFILES[category].label}</strong>
                            {category !== 'custom' && <small>W {SHELF_RISK_PROFILES[category].wmax}</small>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="row">
                    <NumberField label="W đỉnh" value={obs.riskWmax ?? (obs.type === 'shelf' ? SHELF_RISK_PROFILES[riskCategory].wmax : defaults.wmax)} min={1} max={5} step={0.1} onChange={(v) => onObs(obs.id, { riskWmax: v })} />
                    <NumberField label="r₀ giữ nguyên (m)" value={obs.riskR0 ?? defaults.r0} min={0} max={19.9} step={0.1} onChange={(v) => onObs(obs.id, { riskR0: v })} />
                    <NumberField label="R tắt dần (m)" value={obs.riskR ?? defaults.radius} min={(obs.riskR0 ?? defaults.r0) + 0.1} max={20} step={0.1} onChange={(v) => onObs(obs.id, { riskR: v })} />
                  </div>
                </div>
              </details>
            </div>
          );
        })()}
      </>}
      {cam && <>
        <h3>Camera · {cam.id}</h3>
        {cam.target && <p className="camera-role">Khu vực phụ trách · {cam.target}</p>}
        <label className="field">Model / tên camera
          <input value={cam.model ?? ''} placeholder="Ví dụ: OptiCam IP 4MP" onChange={(e) => onCam(cam.id, { model: e.target.value })} />
        </label>
        <div className="field">
          <span>Kiểu lắp đặt</span>
          <div className="segmented-pills segmented-2" role="group" aria-label="Kiểu lắp đặt camera">
            {([['wall', 'Gắn tường'], ['ceiling', 'Gắn trần']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cameraMount(cam) === value ? 'active' : ''}
                aria-pressed={cameraMount(cam) === value}
                onClick={() => onCam(cam.id, { mount: value })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Chất lượng hình ảnh</span>
          <div className="segmented-pills segmented-4" role="group" aria-label="Chất lượng hình ảnh">
            {CAMERA_QUALITY_PRESETS.map((preset) => {
              const quality = customResolutionFor === cam.id ? 'custom' : cameraQualityForResolution(cam.res);
              const active = quality === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={active ? 'active' : ''}
                  aria-pressed={active}
                  onClick={() => {
                    setCustomResolutionFor(null);
                    onCam(cam.id, { res: preset.resolution, model: preset.model });
                  }}
                  title={preset.label}
                >
                  <strong>{preset.id.toUpperCase()}</strong>
                  <small>{preset.resolution}p</small>
                </button>
              );
            })}
            <button
              type="button"
              className={(customResolutionFor === cam.id || cameraQualityForResolution(cam.res) === 'custom') ? 'active' : ''}
              aria-pressed={customResolutionFor === cam.id || cameraQualityForResolution(cam.res) === 'custom'}
              onClick={() => setCustomResolutionFor(cam.id)}
            >
              <strong>Khác</strong>
              <small>Tự nhập</small>
            </button>
          </div>
        </div>
        <div className="row">
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
        <details className="accordion-card inspector-settings">
          <summary className="accordion-summary">
            <span>Hướng nhìn &amp; trường nhìn 3D</span>
            <span className="accordion-pill">Chúc {cameraProjection(cam).tilt}° · {Math.round(cameraProjection(cam).vfov)}°</span>
            <ChevronRight size={14} className="accordion-chevron" aria-hidden="true" />
          </summary>
          <div className="accordion-body inspector-settings-content">
            <NumberField label="Góc chúc xuống (°)" value={cameraProjection(cam).tilt} min={0} max={90} step={1} onChange={tilt => onCam(cam.id, { tilt })} />
            <NumberField label="Trường nhìn dọc (°)" value={Math.round(cameraProjection(cam).vfov * 10) / 10} min={10} max={120} step={1} onChange={vfov => onCam(cam.id, { vfov })} />
            <button onClick={() => onCam(cam.id, { vfov: undefined })}>Tự tính FOV dọc theo 16:9</button>
          </div>
        </details>
      </>}
    </div>
  );
}
