import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Box,
  BrickWall,
  Camera,
  FilePlus2,
  Layers,
  Map,
  Ruler,
  ScanLine,
  Sparkles,
  X,
} from 'lucide-react';
import { SpotlightOverlay } from './SpotlightOverlay';

export interface TutorialStep {
  id: number;
  num: string;
  tag: string;
  title: string;
  targetSelector: string;
  preferredSide: 'left' | 'right' | 'top' | 'bottom' | 'center';
  groupNeeded?: 'room' | 'priority' | 'camera';
  ensureCatalogOpen?: boolean;
  icon: typeof Map;
  description: string;
  bullets: readonly ReactNode[];
  swatches?: readonly { cls: string; label: string }[];
  actionKey?: 'open-builder' | 'wall-tool';
  actionLabel?: string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 0,
    num: '01',
    tag: 'Bước 1/6',
    title: 'Chọn 18 mẫu sẵn hoặc Tự tạo layout mới',
    targetSelector: '[data-tour="project-bar"]',
    preferredSide: 'bottom',
    icon: FilePlus2,
    description: 'Bắt đầu nhanh từ danh sách mẫu hoặc mở trình dựng cửa hàng riêng của bạn.',
    bullets: [
      <>Danh sách dự án gồm <strong>18 mặt bằng bán lẻ</strong> (3 mẫu chuẩn + <strong>VN 01–VN 15</strong> có sẵn người tĩnh).</>,
      <>Bấm nút <strong>Tạo layout</strong> để tự thiết kế cửa hàng <strong>Chữ nhật, Chữ L, Vát góc, Hình thang</strong> hoặc <strong>chấm đỉnh vẽ tường bao</strong>.</>,
    ],
    actionKey: 'open-builder',
    actionLabel: 'Mở Tự tạo layout & xem hướng dẫn',
  },
  {
    id: 1,
    num: '02',
    tag: 'Bước 2/6',
    title: 'Chỉnh kích thước, Xoay 90° & Lưới',
    targetSelector: '[data-tour="planning-settings"]',
    preferredSide: 'left',
    groupNeeded: 'room',
    icon: Ruler,
    description: 'Thiết lập kích thước thật (mét), cao độ trần và độ mịn ô phân tích.',
    bullets: [
      <>Chọn nhanh cỡ <strong>5×12, 8×8, 10×6, 12×8 m</strong> hoặc chỉnh từng ô Rộng / Dài bằng nút <strong>− / +</strong>.</>,
      <>Nút <strong>Xoay 90° (R↔D)</strong> tự động xoay toàn bộ phòng, kệ, cửa, camera & người sang hướng mới mà không báo lỗi tràn tường.</>,
      <>Thanh trượt <strong>Chiều cao trần (2.4–6.0 m)</strong> cập nhật tầm camera; mục <strong>Lưới & tỷ lệ</strong> chỉnh <strong>0.25–1.0 m</strong>.</>,
    ],
  },
  {
    id: 2,
    num: '03',
    tag: 'Bước 3/6',
    title: 'Thanh công cụ & Tự dựng tường vách (W)',
    targetSelector: '[data-tour="tool-rail"]',
    preferredSide: 'right',
    icon: BrickWall,
    description: 'Dùng thanh công cụ nổi bên trái để vẽ tường ngăn, đặt đồ, đo đạc và đặt người.',
    bullets: [
      <>Bấm <strong>Dựng vách</strong> (<kbd>W</kbd>) rồi chấm <strong>2 điểm bất kỳ</strong> trên sàn để dựng vách ngăn kho, quầy lửng hoặc phòng kín (khóa góc 45°/90° & nối tiếp).</>,
      <>Dùng nút <strong>Tường / Trần</strong> để thêm camera thủ công, hoặc <strong>Kiểm tra</strong> để đặt người đo DORI tại mặt/ngực/bụng/chân.</>,
    ],
    actionKey: 'wall-tool',
    actionLabel: 'Thử bật công cụ Dựng vách',
  },
  {
    id: 3,
    num: '04',
    tag: 'Bước 4/6',
    title: 'Thư viện 15 nội thất & Tầng kệ CRAVED',
    targetSelector: '[data-tour="fixture-catalog"]',
    preferredSide: 'left',
    groupNeeded: 'room',
    ensureCatalogOpen: true,
    icon: Box,
    description: 'Đặt nội thất theo vị trí chuột và gắn rủi ro trộm cắp CRAVED theo từng tầng kệ.',
    bullets: [
      <>Chọn 1 trong <strong>15 loại</strong> (Kệ sát tường, Tủ kính khóa, Đảo khuyến mãi, Tủ mát/đông…) → di chuột lên sàn & bấm đặt (<kbd>R</kbd> xoay 15°).</>,
      <>Khi chọn kệ, dùng tab <strong>Kích cỡ & Kiểu</strong> (S/M/L, thanh trượt, kéo góc 2.5D) và <strong>Tầng hàng & CRAVED</strong> để chọn 16 nhóm hàng & cảnh báo <strong>≤ 1.0 m</strong>.</>,
    ],
    swatches: [
      { cls: 'risk-high', label: 'Đỏ (W ≥ 4): POS, Cửa, Tủ giá trị' },
      { cls: 'risk-med', label: 'Vàng (W 2–3.9): Kệ hàng' },
      { cls: 'risk-low', label: 'Nền (W < 2): Lối đi' },
    ],
  },
  {
    id: 4,
    num: '05',
    tag: 'Bước 5/6',
    title: 'Chạy tối ưu & Chống khuất tầm tay (1.0 m)',
    targetSelector: '[data-tour="camera-optimizer"]',
    preferredSide: 'left',
    groupNeeded: 'camera',
    icon: Camera,
    description: 'Cân bằng tự động giữa độ nét nhận diện khuôn mặt (1.6 m) và vùng thao tác tay (1.0 m).',
    bullets: [
      <>Chọn phạm vi lắp (<strong>Tường + trần / Chỉ tường / Chỉ trần</strong>) và số lượng camera (<strong>1–20</strong>).</>,
      <>Bật <strong>Chống khuất tầm tay (1.0 m)</strong> để ưu tiên điểm phân bậc (<strong>≥ 62,5 PPM</strong>) tại vùng <strong>W ≥ 3.0</strong> mà không rớt nét mặt ở thu ngân.</>,
      <>Bấm <strong>Tối ưu phương án</strong> (<kbd>O</kbd>) bên dưới hoặc mở <strong>Tùy chọn tối ưu → Giảm số camera theo KPI</strong>.</>,
    ],
    swatches: [
      { cls: 'mode-kpi', label: 'kpi_hybrid: Khóa Đỏ ≥ 95%, cân bằng Vàng & Tay 1.0 m' },
    ],
  },
  {
    id: 5,
    num: '06',
    tag: 'Bước 6/6',
    title: 'Đọc bản đồ DORI, Gạch chéo & Chế độ 3D',
    targetSelector: '[data-tour="workspace-layers"]',
    preferredSide: 'bottom',
    icon: Layers,
    description: 'Kiểm tra chất lượng từng mét sàn, phát hiện điểm mù dưới kệ và xem phối cảnh 3D.',
    bullets: [
      <>Chuyển sang <strong>Chất lượng DORI</strong> để xem vùng <strong>≥ 250 PPM</strong> (mặt) và <strong>≥ 125 PPM</strong> (tay), kèm <strong>Độ phủ tầm tay 1.0 m</strong> ở Kết quả.</>,
      <>Ô <strong>gạch chéo cam</strong> báo vị trí "chỉ thấy đầu (1.6 m)" nhưng khuất tầm tay 1.0 m — thêm cam trần hoặc đổi góc chiếu để khắc phục.</>,
      <>Bấm <strong>3D</strong> để xem góc nhìn <strong>POV từng camera</strong>, so sánh <strong>Trước / Sau</strong> và xuất BOM / JSON / PNG.</>,
    ],
    swatches: [
      { cls: 'dori-id', label: '≥ 250 PPM: Mặt' },
      { cls: 'dori-rec', label: '≥ 125 PPM: Tay' },
      { cls: 'dori-hatch', label: 'Gạch chéo: Khuất 1.0 m' },
    ],
  },
];

export function TutorialModal({
  onClose,
  onFocusStep,
  onOpenCustomBuilder,
  onActivateWallTool,
}: {
  onClose: (dontShowAgain: boolean) => void;
  onFocusStep?: (step: TutorialStep) => void;
  onOpenCustomBuilder?: (dontShowAgain: boolean) => void;
  onActivateWallTool?: (dontShowAgain: boolean) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const current = TUTORIAL_STEPS[stepIndex];
  const StepIcon = current.icon;

  useEffect(() => {
    onFocusStep?.(current);
  }, [current, onFocusStep]);

  useEffect(() => {
    nextBtnRef.current?.focus();
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(dontShowAgain);
      } else if (event.key === 'ArrowRight') {
        setStepIndex((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1));
      } else if (event.key === 'ArrowLeft') {
        setStepIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dontShowAgain, onClose]);

  return (
    <SpotlightOverlay
      targetSelector={current.targetSelector}
      preferredSide={current.preferredSide}
      zIndex={45}
      ariaLabel={`Hướng dẫn tương tác · ${current.tag}`}
      onBackdropClick={() => onClose(dontShowAgain)}
    >
      <div className="tour-card-inner" role="tabpanel">
        <div className="tour-card-header">
          <span className="tour-step-pill">
            <ScanLine size={12} /> {current.tag}
          </span>
          <div className="tour-dots" role="tablist" aria-label="Các bước hướng dẫn">
            {TUTORIAL_STEPS.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={idx === stepIndex}
                aria-label={`${item.tag}: ${item.title}`}
                className={`tour-dot${idx === stepIndex ? ' active' : idx < stepIndex ? ' done' : ''}`}
                onClick={() => setStepIndex(idx)}
              >
                {item.num}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="tour-close-btn"
            aria-label="Đóng hướng dẫn"
            onClick={() => onClose(dontShowAgain)}
          >
            <X size={14} />
          </button>
        </div>

        <div className="tour-title-row">
          <span className="tour-title-icon"><StepIcon size={16} /></span>
          <div>
            <h3>{current.title}</h3>
            <p className="tour-desc">{current.description}</p>
          </div>
        </div>

        <ul className="tour-bullets">
          {current.bullets.map((line, idx) => <li key={idx}>{line}</li>)}
        </ul>

        {current.swatches && (
          <div className="tour-swatches">
            {current.swatches.map((swatch) => (
              <span className="tutorial-swatch" key={swatch.label}>
                <i className={`swatch-box ${swatch.cls}`} aria-hidden="true" />
                {swatch.label}
              </span>
            ))}
          </div>
        )}

        {current.actionKey && (
          <button
            type="button"
            className="tour-try-btn"
            onClick={() => {
              if (current.actionKey === 'open-builder') onOpenCustomBuilder?.(dontShowAgain);
              else if (current.actionKey === 'wall-tool') onActivateWallTool?.(dontShowAgain);
            }}
          >
            <Sparkles size={13} /> {current.actionLabel} <ArrowRight size={13} />
          </button>
        )}

        <p className="tour-live-tip">Vùng sáng đang mở tương tác — bạn có thể bấm thử trực tiếp hoặc xem tiếp.</p>

        <div className="tour-footer">
          <label className="field-check">
            <input type="checkbox" checked={dontShowAgain} onChange={(event) => setDontShowAgain(event.target.checked)} />
            <span>Đừng hiện lại</span>
          </label>
          <div className="tour-nav-actions">
            {stepIndex > 0 && (
              <button type="button" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>Quay lại</button>
            )}
            {stepIndex < TUTORIAL_STEPS.length - 1 ? (
              <>
                <button type="button" onClick={() => onClose(dontShowAgain)}>Bỏ qua</button>
                <button ref={nextBtnRef} type="button" className="primary" onClick={() => setStepIndex((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1))}>
                  Tiếp theo
                </button>
              </>
            ) : (
              <button ref={nextBtnRef} type="button" className="primary" onClick={() => onClose(dontShowAgain)}>
                Bắt đầu thiết kế
              </button>
            )}
          </div>
        </div>
      </div>
    </SpotlightOverlay>
  );
}
