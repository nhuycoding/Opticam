import { useEffect, useRef, useState } from 'react';
import { Camera, Layers, Map, ScanLine, X } from 'lucide-react';

const TUTORIAL_STEPS = [
  {
    id: 0,
    tag: 'Bước 1',
    title: 'Dựng cửa hàng & Đánh dấu vùng ưu tiên',
    icon: Map,
    points: [
      'Chọn nhanh 1 trong 18 mẫu cửa hàng (15 mẫu Việt Nam VN 01–VN 15 có sẵn người tĩnh) hoặc vẽ thêm Kệ, Thu ngân, Cửa, Tủ mát, Người bằng thanh công cụ trái.',
      'Khu vực Quầy thu ngân & Cửa vào được tự động gán mức Đỏ (W = 5 · ưu tiên nhận diện khuôn mặt). Kệ hàng dùng mức Vàng (W = 3, hoặc chọn CRAVED cao 4.5 cho mỹ phẩm/đồ nhỏ).',
      'Có thể chuyển sang lớp Vùng ưu tiên và dùng cọ W 5 / 3 / 1 để tô thêm vị trí trọng yếu của riêng cửa hàng bạn.',
    ],
    swatches: [
      { cls: 'risk-high', label: 'Vùng Đỏ (W = 5): Thu ngân & Cửa' },
      { cls: 'risk-med', label: 'Vùng Vàng (W = 3): Kệ trưng bày' },
      { cls: 'risk-low', label: 'Nền xanh (W = 1): Lối đi chung' },
    ],
  },
  {
    id: 1,
    tag: 'Bước 2',
    title: 'Chạy tối ưu & Chống khuất tầm tay (1.0 m)',
    icon: Camera,
    points: [
      'Mở mục Camera và tối ưu → chọn phạm vi lắp (khuyên dùng Tường + trần) và số camera dự kiến (1–20).',
      'Bật "Chống khuất tầm tay (1.0 m)" nếu muốn ép camera nhìn thấy cả thao tác tay & hàng hóa dưới 1.0 m (không bị kệ 1.45 m hay quầy 1.1 m che khuất).',
      'Nhấn Tối ưu phương án (phím O) hoặc mở Tùy chọn tối ưu → Giảm số camera theo KPI để máy tự tìm số camera ít nhất đạt Đỏ ≥ 95% & Vàng ≥ 80%.',
    ],
    swatches: [
      { cls: 'mode-kpi', label: 'Mặc định kpi_hybrid: Khóa nét vùng Đỏ trước, sau đó phủ đều kệ hàng' },
    ],
  },
  {
    id: 2,
    tag: 'Bước 3',
    title: 'Đọc bản đồ DORI, Gạch chéo & Kiểm tra 3D',
    icon: Layers,
    points: [
      'Trên lớp Chất lượng DORI: Xanh đậm (≥ 250 PPM) đọc rõ mặt/tiền tại thu ngân; Xanh nhạt (≥ 125 PPM) thấy rõ tay lấy đồ tại kệ.',
      'Ô có gạch chéo vàng cam báo hiệu camera chỉ thấy "đầu" (1.6 m) nhưng bị kệ/quầy che ở tầm tay 1.0 m — hãy thêm camera trần hoặc bật Chống khuất tầm tay.',
      'Đổi sang chế độ 3D và bấm vào camera để xem góc nhìn POV thực tế, so sánh Trước / Sau tối ưu, rồi xuất BOM hoặc JSON.',
    ],
    swatches: [
      { cls: 'dori-id', label: '≥ 250 PPM: Nhận dạng mặt' },
      { cls: 'dori-rec', label: '≥ 125 PPM: Nhận biết thao tác' },
      { cls: 'dori-hatch', label: 'Gạch chéo cam: Khuất tầm tay < 1.0 m' },
    ],
  },
] as const;

export function TutorialModal({ onClose }: { onClose: (dontShowAgain: boolean) => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    startButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose(dontShowAgain);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [dontShowAgain, onClose]);

  const current = TUTORIAL_STEPS[stepIndex];
  const StepIcon = current.icon;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tutorial-modal-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(dontShowAgain); }}>
      <div className="modal-box tutorial-modal">
        <div className="tutorial-header">
          <div className="tutorial-brand">
            <span className="brand-mark"><ScanLine size={18} strokeWidth={1.6} /></span>
            <div>
              <span className="eyebrow">HƯỚNG DẪN NHANH · OPTICAM STUDIO</span>
              <h2 id="tutorial-modal-title">Thiết kế bố trí camera cửa hàng trong 3 bước</h2>
            </div>
          </div>
          <button type="button" className="tutorial-close" aria-label="Đóng hướng dẫn" onClick={() => onClose(dontShowAgain)}>
            <X size={16} />
          </button>
        </div>

        <div className="tutorial-tabs" role="tablist" aria-label="Các bước hướng dẫn">
          {TUTORIAL_STEPS.map((item, idx) => (
            <button key={item.id} type="button" role="tab" aria-selected={idx === stepIndex}
              className={`tutorial-tab${idx === stepIndex ? ' active' : ''}`} onClick={() => setStepIndex(idx)}>
              <strong>{item.tag}</strong>
              <span>{idx === 0 ? 'Mặt bằng' : idx === 1 ? 'Tối ưu' : 'Kết quả & 3D'}</span>
            </button>
          ))}
        </div>

        <div className="tutorial-card" role="tabpanel">
          <div className="tutorial-card-title">
            <StepIcon size={18} aria-hidden="true" />
            <h3>{current.tag}: {current.title}</h3>
          </div>
          <ul className="tutorial-list">
            {current.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <div className="tutorial-swatches">
            {current.swatches.map((swatch) => (
              <span className="tutorial-swatch" key={swatch.label}>
                <i className={`swatch-box ${swatch.cls}`} aria-hidden="true" />
                {swatch.label}
              </span>
            ))}
          </div>
        </div>

        <div className="tutorial-shortcuts">
          <span>Phím nhanh:</span>
          <span><kbd>O</kbd> Tối ưu</span>
          <span><kbd>G</kbd> Lưới</span>
          <span><kbd>R</kbd> Xoay 15°</span>
          <span><kbd>Ctrl+Z</kbd> Hoàn tác</span>
          <span><kbd>Esc</kbd> Bỏ chọn</span>
        </div>

        <div className="tutorial-footer">
          <label className="field-check">
            <input type="checkbox" checked={dontShowAgain} onChange={(event) => setDontShowAgain(event.target.checked)} />
            <span>Đừng hiện lại khi mở ứng dụng</span>
          </label>
          <div className="confirm-actions">
            {stepIndex > 0 && (
              <button type="button" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>Quay lại</button>
            )}
            {stepIndex < TUTORIAL_STEPS.length - 1 ? (
              <>
                <button type="button" onClick={() => onClose(dontShowAgain)}>Bỏ qua</button>
                <button ref={startButtonRef} type="button" className="primary" onClick={() => setStepIndex((i) => Math.min(TUTORIAL_STEPS.length - 1, i + 1))}>Tiếp theo</button>
              </>
            ) : (
              <button ref={startButtonRef} type="button" className="primary" onClick={() => onClose(dontShowAgain)}>Bắt đầu thiết kế</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
