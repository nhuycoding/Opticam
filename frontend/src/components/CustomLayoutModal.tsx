import { useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Layers, PenTool, RotateCw, Ruler, Sparkles, X } from 'lucide-react';
import { buildCustomLayout, type CustomRoomShape } from '../core/editor';
import { floorArea, floorOutline } from '../core/footprint';
import type { Layout, Person } from '../types';
import { NumberField } from './NumberField';
import { SpotlightOverlay } from './SpotlightOverlay';

export type CustomBuilderMode = CustomRoomShape | 'draw';

const SHAPE_OPTIONS: Array<{ id: CustomBuilderMode; label: string; hint: string }> = [
  { id: 'rect', label: 'Chữ nhật', hint: 'Phổ thông' },
  { id: 'l-shape', label: 'Chữ L', hint: 'Khuyết góc' },
  { id: 'chamfer', label: 'Vát góc', hint: 'Góc phố' },
  { id: 'trapezoid', label: 'Hình thang', hint: 'Mặt tiền xéo' },
  { id: 'draw', label: 'Tự vẽ tường bao', hint: 'Chấm đỉnh trên lưới' },
];

const BUILDER_TOUR_STEPS = [
  {
    id: 0,
    tag: 'Bước 1/3',
    title: 'Chọn dáng tường bao hoặc Tự vẽ đa giác',
    selector: '[data-layout-tour="shapes"]',
    side: 'right' as const,
    icon: PenTool,
    body: (
      <>
        Chọn nhanh <strong>4 khuôn phòng bán lẻ</strong> phổ biến (<strong>Chữ nhật, Chữ L, Vát góc, Hình thang</strong>) hoặc chọn <strong>Tự vẽ tường bao</strong> để chấm từng góc tường trực tiếp trên mặt bằng.
      </>
    ),
  },
  {
    id: 1,
    tag: 'Bước 2/3',
    title: 'Thiết lập Rộng × Dài, Trần & Độ mịn lưới',
    selector: '[data-layout-tour="dims"]',
    side: 'right' as const,
    icon: Ruler,
    body: (
      <>
        Chỉnh <strong>kích thước phủ ngoài (3–40 m)</strong>, <strong>cao độ trần (2.4–6.0 m)</strong> ảnh hưởng trực tiếp tầm camera trần, và <strong>độ mịn lưới tính toán (0.25–1.0 m)</strong>.
      </>
    ),
  },
  {
    id: 2,
    tag: 'Bước 3/3',
    title: 'Xoay khung 90° & Chọn gói khởi tạo',
    selector: '[data-layout-tour="preview"]',
    side: 'left' as const,
    icon: Layers,
    body: (
      <>
        Dùng nút <strong>Xoay 90°</strong> trên bản xem trước để đảo chiều cửa / góc khuyết chữ L, chọn <strong>Tường bao trống</strong> hoặc <strong>Cửa + Quầy POS + 4 Cam</strong>, rồi bấm <strong>Tạo mặt bằng</strong>.
      </>
    ),
  },
];

export function CustomLayoutModal({
  initialShowTour = false,
  onCancel,
  onCreate,
  onStartPolygonDraw,
}: {
  initialShowTour?: boolean;
  onCancel: () => void;
  onCreate: (built: { layout: Layout; people: Person[] }) => void;
  onStartPolygonDraw: (seed: { name: string; widthM: number; heightM: number; ceilingHeight: number; gridM: number }) => void;
}) {
  const [name, setName] = useState('Mặt bằng tự thiết kế');
  const [shape, setShape] = useState<CustomBuilderMode>('rect');
  const [widthM, setWidthM] = useState(10);
  const [heightM, setHeightM] = useState(6);
  const [ceilingHeight, setCeilingHeight] = useState(3.2);
  const [gridM, setGridM] = useState(0.5);
  const [turns90, setTurns90] = useState(0);
  const [starterKit, setStarterKit] = useState<'empty' | 'basic'>('basic');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!initialShowTour) return;
    if (typeof window === 'undefined') {
      setTourStep(0);
      return;
    }
    const timer = window.setTimeout(() => setTourStep(0), 60);
    return () => window.clearTimeout(timer);
  }, [initialShowTour]);

  useEffect(() => {
    closeBtnRef.current?.focus();
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (tourStep !== null) setTourStep(null);
        else onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, tourStep]);

  const previewBuilt = useMemo(() => {
    if (shape === 'draw') return null;
    return buildCustomLayout({
      name,
      shape,
      widthM,
      heightM,
      gridM,
      ceilingHeight,
      turns90,
      starterKit,
    });
  }, [name, shape, widthM, heightM, gridM, ceilingHeight, turns90, starterKit]);

  const rotatePreview90 = () => {
    setTurns90((t) => (t + 1) % 4);
  };

  const submitBuilder = () => {
    if (shape === 'draw') {
      const rotatedW = turns90 % 2 === 1 ? heightM : widthM;
      const rotatedH = turns90 % 2 === 1 ? widthM : heightM;
      onStartPolygonDraw({ name, widthM: rotatedW, heightM: rotatedH, ceilingHeight, gridM });
      return;
    }
    if (previewBuilt) onCreate(previewBuilt);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    submitBuilder();
  };

  const activeTour = tourStep !== null ? BUILDER_TOUR_STEPS[tourStep] : null;
  const TourIcon = activeTour?.icon ?? HelpCircle;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-layout-title"
      onClick={(event) => { if (event.target === event.currentTarget && tourStep === null) onCancel(); }}
    >
      <form className="modal-box custom-layout-modal" onSubmit={handleSubmit}>
        <div className="tutorial-header">
          <div>
            <span className="eyebrow">TRÌNH TẠO MẶT BẰNG MỚI</span>
            <h2 id="custom-layout-title">Tự tạo layout &amp; khung tường cửa hàng</h2>
          </div>
          <div className="custom-modal-head-actions">
            <button
              type="button"
              className="custom-tour-trigger"
              aria-label="Hướng dẫn tạo layout"
              onClick={() => setTourStep(0)}
            >
              <Sparkles size={13} /> Hướng dẫn 3 bước
            </button>
            <button ref={closeBtnRef} type="button" className="tutorial-close" aria-label="Đóng trình tạo layout" onClick={onCancel}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="custom-layout-grid">
          <div className="custom-layout-form">
            <label className="field">
              <span>Tên cửa hàng</span>
              <input
                type="text"
                value={name}
                maxLength={60}
                placeholder="Ví dụ: Cửa hàng 24h"
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <div className="field" data-layout-tour="shapes">
              <span>Dáng mặt bằng tường bao</span>
              <div className="shape-option-grid" role="radiogroup" aria-label="Dáng mặt bằng tường bao">
                {SHAPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`shape-option-btn${shape === opt.id ? ' active' : ''}`}
                    aria-pressed={shape === opt.id}
                    onClick={() => setShape(opt.id)}
                  >
                    <strong>{opt.label}</strong>
                    <small>{opt.hint}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="custom-dims-block" data-layout-tour="dims">
              <div className="row room-dim-pair">
                <NumberField
                  label={shape === 'draw' ? 'Khung lưới rộng (m)' : 'Rộng gốc (m)'}
                  stepName="Rộng mẫu mới"
                  value={widthM}
                  min={3}
                  max={40}
                  step={0.5}
                  unit="m"
                  stepButtons
                  onChange={setWidthM}
                />
                <NumberField
                  label={shape === 'draw' ? 'Khung lưới dài (m)' : 'Dài gốc (m)'}
                  stepName="Dài mẫu mới"
                  value={heightM}
                  min={3}
                  max={40}
                  step={0.5}
                  unit="m"
                  stepButtons
                  onChange={setHeightM}
                />
              </div>

              <div className="row room-dim-pair">
                <NumberField
                  label="Chiều cao trần (m)"
                  stepName="Trần mẫu mới"
                  value={ceilingHeight}
                  min={2.4}
                  max={6}
                  step={0.1}
                  unit="m"
                  stepButtons
                  onChange={setCeilingHeight}
                />
                <NumberField
                  label="Độ mịn lưới (m)"
                  stepName="Lưới mẫu mới"
                  value={gridM}
                  min={0.1}
                  max={2}
                  step={0.05}
                  buttonStep={0.1}
                  unit="m"
                  stepButtons
                  onChange={setGridM}
                />
              </div>
            </div>

            {shape !== 'draw' && (
              <div className="field">
                <span>Khởi tạo nội thất ban đầu</span>
                <div className="segmented-pills segmented-2" role="group" aria-label="Khởi tạo nội thất ban đầu">
                  <button type="button" className={starterKit === 'basic' ? 'active' : ''} onClick={() => setStarterKit('basic')}>
                    Cửa + Quầy POS + 4 Cam
                  </button>
                  <button type="button" className={starterKit === 'empty' ? 'active' : ''} onClick={() => setStarterKit('empty')}>
                    Tường bao trống
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="custom-layout-preview" data-layout-tour="preview">
            <div className="custom-preview-head">
              <strong>
                {shape === 'draw'
                  ? 'Vẽ đường bao trên sơ đồ'
                  : `${previewBuilt!.layout.widthM} × ${previewBuilt!.layout.heightM} m · ${floorArea(previewBuilt!.layout)} m²`}
              </strong>
              {shape !== 'draw' && (
                <button type="button" className="preview-rotate-btn" onClick={rotatePreview90} title="Xoay toàn bộ khung & nội thất 90°">
                  <RotateCw size={12} /> Xoay 90° ({turns90 * 90}°)
                </button>
              )}
            </div>

            <div className="custom-preview-stage">
              {shape === 'draw' ? (
                <div className="custom-draw-placeholder">
                  <PenTool size={26} />
                  <strong>Chế độ vẽ đường bao tự do</strong>
                  <p>Nhấp các góc tường trực tiếp trên mặt bằng {widthM}×{heightM} m rồi nhấn <b>Hoàn tất khung</b> để dựng tường bao đa giác bất kỳ.</p>
                </div>
              ) : (() => {
                const L = previewBuilt!.layout;
                const outline = floorOutline(L);
                const pad = 1.4;
                const vbW = L.widthM + pad * 2;
                const vbH = L.heightM + pad * 2;
                const polyPoints = outline.map(([x, y]) => `${x + pad},${y + pad}`).join(' ');
                return (
                  <svg viewBox={`0 0 ${vbW} ${vbH}`} className="custom-preview-svg" aria-label="Xem trước mặt bằng">
                    <polygon points={polyPoints} fill="#f3f3e9" stroke="#647156" strokeWidth={Math.max(0.12, Math.max(vbW, vbH) * 0.015)} strokeLinejoin="round" />
                    {L.obstacles.map((obs) => (
                      <rect
                        key={obs.id}
                        x={obs.x + pad}
                        y={obs.y + pad}
                        width={obs.w}
                        height={obs.h}
                        fill={obs.type === 'pos' ? '#d6c4a5' : '#fffefb'}
                        stroke="#765d42"
                        strokeWidth={Math.max(0.06, Math.max(vbW, vbH) * 0.008)}
                        transform={`rotate(${obs.angle} ${obs.x + obs.w / 2 + pad} ${obs.y + obs.h / 2 + pad})`}
                      />
                    ))}
                    {L.cameras.map((cam) => (
                      <circle key={cam.id} cx={cam.x + pad} cy={cam.y + pad} r={Math.max(0.18, Math.max(vbW, vbH) * 0.022)} fill="#765d42" />
                    ))}
                    <text x={vbW / 2} y={pad * 0.55} textAnchor="middle" fontSize={Math.max(0.45, vbH * 0.055)} fill="#59634f">
                      {L.widthM} m
                    </text>
                    <text x={pad * 0.45} y={vbH / 2} textAnchor="middle" fontSize={Math.max(0.45, vbH * 0.055)} fill="#59634f" transform={`rotate(-90 ${pad * 0.45} ${vbH / 2})`}>
                      {L.heightM} m
                    </text>
                  </svg>
                );
              })()}
            </div>
            <p className="custom-preview-note">
              Sau khi tạo, bạn có thể dùng công cụ <b>Dựng vách (W)</b> ở thanh bên trái để ngăn kho hoặc dựng vách bất kỳ.
            </p>
          </div>
        </div>

        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>Hủy</button>
          <button type="button" className="primary" onClick={submitBuilder}>
            {shape === 'draw' ? 'Bắt đầu vẽ tường bao' : 'Tạo mặt bằng'}
          </button>
        </div>
      </form>

      {activeTour && (
        <SpotlightOverlay
          targetSelector={activeTour.selector}
          preferredSide={activeTour.side}
          zIndex={60}
          ariaLabel={`Hướng dẫn tạo layout · ${activeTour.tag}`}
          onBackdropClick={() => setTourStep(null)}
        >
          <div className="tour-card-inner">
            <div className="tour-card-header">
              <span className="tour-step-pill">{activeTour.tag}</span>
              <div className="tour-dots">
                {BUILDER_TOUR_STEPS.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`tour-dot${idx === tourStep ? ' active' : idx < (tourStep ?? 0) ? ' done' : ''}`}
                    onClick={() => setTourStep(idx)}
                  >
                    0{idx + 1}
                  </button>
                ))}
              </div>
              <button type="button" className="tour-close-btn" aria-label="Đóng hướng dẫn tạo layout" onClick={() => setTourStep(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="tour-title-row">
              <span className="tour-title-icon"><TourIcon size={18} /></span>
              <div>
                <h3>{activeTour.title}</h3>
                <p className="tour-desc">{activeTour.body}</p>
              </div>
            </div>
            <p className="tour-live-tip">Vùng sáng đang mở tương tác — bạn có thể bấm chọn trực tiếp ngay lúc xem.</p>
            <div className="tour-footer">
              <span className="tour-sub-label">Hướng dẫn tạo layout</span>
              <div className="tour-nav-actions">
                {tourStep! > 0 && (
                  <button type="button" onClick={() => setTourStep((s) => Math.max(0, (s ?? 0) - 1))}>Quay lại</button>
                )}
                {tourStep! < BUILDER_TOUR_STEPS.length - 1 ? (
                  <button type="button" className="primary" onClick={() => setTourStep((s) => Math.min(BUILDER_TOUR_STEPS.length - 1, (s ?? 0) + 1))}>
                    Tiếp theo
                  </button>
                ) : (
                  <button type="button" className="primary" onClick={() => setTourStep(null)}>Đã hiểu</button>
                )}
              </div>
            </div>
          </div>
        </SpotlightOverlay>
      )}
    </div>
  );
}
