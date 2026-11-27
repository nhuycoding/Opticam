# Kiến trúc và cấu trúc dự án

> **Tóm tắt nhanh:** OptiCam chia làm **2 phần song song**: **Frontend** (React + Konva 2.5D + Three.js 3D + Web Worker chạy offline) và **Backend** (FastAPI Python). Cả hai dùng chung một mô hình toán học (`0.00e+00` sai số) — nếu Backend tắt hoặc quá 15 giây, trình duyệt tự động chạy tiếp trên Web Worker mà không gián đoạn người dùng.  
> *(Giải thích thuật ngữ kiến trúc & thuật toán xem tại [GLOSSARY.md](../GLOSSARY.md).)*

## Cây thư mục

```text
opticam/
├── backend/
│   ├── main.py                 # FastAPI, schema request/response, API routes
│   ├── greedy_optimizer.py     # Greedy + Local Search, 3D PPM/FOV/line-of-sight
│   ├── requirements.txt        # Runtime dependencies
│   ├── requirements-dev.txt    # Test dependencies
│   └── tests/test_api.py       # API và optimizer tests
├── data_samples/               # 18 layout mẫu (3 chuẩn + VN 01..VN 15 có polygon và người tĩnh)
├── docs/                       # User guide, architecture, formula, API, research
├── frontend/
│   ├── experiments/run.ts       # E1/E2/E3 thực nghiệm tái lập
│   ├── src/
│   │   ├── App.tsx              # Trạng thái ứng dụng, TutorialModal, CustomLayoutModal, vẽ tường & modal xác nhận
│   │   ├── components/          # Inspector, CameraSchedule, ShelfTierFolders, SpotlightOverlay, TutorialModal, CustomLayoutModal, StudioSelect, Scorecard, BOM, Canvas
│   │   ├── core/                # optics, optimizer, fixtures, craved, geometry, footprint, IO, BOM, API
│   │   ├── data/presets.ts      # Đọc 18 preset JSON từ ../data_samples
│   │   └── types.ts             # Layout, Camera, Obstacle, Fixture, ShelfTier, Score
│   ├── package.json
│   └── vite.config.ts           # Dev server :3000, proxy /api → :8000
├── legacy_pygame/               # Prototype cũ chỉ để tham khảo
├── results/                     # Kết quả CSV/Markdown của experiments
├── scripts/gen_samples.py       # Sinh lại JSON mẫu từ preset Pygame
└── README.md
```

`frontend/node_modules`, `frontend/dist`, Python virtualenv và cache test là file phát sinh;
được bỏ qua bởi `.gitignore`, không phải source để chỉnh tay.

## Trách nhiệm các module

### Frontend

- `App.tsx`: điều phối quy trình 2 bước (`Mặt bằng` → `Kết quả`), tour tương tác 6 bước (`TutorialModal` qua `?` / `opticam.tutorial.dismissed`), tạo layout tùy chỉnh (`CustomLayoutModal` + chế độ tự chấm đỉnh tường bao `polygon`), công cụ dựng vách ngăn `W` (`wall`), hộp thoại xác nhận trong ứng dụng (`pendingLayout`, `pendingConfirm`), chế độ đặt nội thất theo con trỏ (`PlacementDraft`), bố cục sidebar thiết lập `396 px` (`432 px` wide / `348 px` narrow) và so sánh trước/sau.
- `components/canvas/`: ghép các Konva layer; render lưới/ảnh nền, heatmap DORI/rủi ro kèm gạch chéo cảnh báo ô khuất tầm tay (`1.0 m`), xem trước đoạn vách ngăn (`wall`) & đa giác tường bao (`polygon`), bóng xem trước ghost, tay kéo góc resize trực tiếp (`anchorTopLeft`), vật cản kèm hàng hóa mini, nhân vật `PersonNode`, camera/FOV, nhãn kệ xoay đứng `180°`, đo khoảng cách và tooltip PPM.
- `components/CameraSchedule.tsx`: danh sách camera gọn bên cạnh sơ đồ, hỗ trợ thu gọn thành thanh mini `46 px` (`190 px` ↔ `46 px`).
- `components/ShelfTierFolders.tsx`: giao diện folder xếp lớp theo từng tầng kệ (`zMin–zMax`), gán nhóm hàng từ `GOODS_CATALOG` và cảnh báo tầng `≤ 1.0 m`.
- `components/SpotlightOverlay.tsx`, `TutorialModal.tsx` & `CustomLayoutModal.tsx`: overlay cắt vùng spotlight (`clip-path: polygon(evenodd, ...)`), bám kích thước qua `ResizeObserver`, thẻ hướng dẫn 6 bước tương tác (`01`–`06`), trình tạo mặt bằng mới (`Chữ nhật`, `Chữ L`, `Vát góc`, `Hình thang`, `Tự vẽ tường bao`, `Xoay 90°`) kèm tour 3 bước riêng.
- `components/StudioSelect.tsx`: dropdown popover & segmented-pills thay thế `<select>` hệ điều hành trong thanh dự án, Inspector, cài đặt tối ưu và 3D.
- `core/fixtures.ts` & `core/craved.ts`: catalog **13 loại nội thất** (15 mục gồm POS/Cửa), preset **S / M / L**, **16 nhóm hàng CRAVED** 6 trục và hàm tự động tổng hợp `riskCategory`/`riskWmax` từ tầng kệ.
- `core/optics.ts`: phân vùng rủi ro, `dualPpmAt()` chia sẻ chung phép cắt 2D cho mặt (`1.6 m`) và tầm tay (`1.0 m`), mô hình phân bậc `DUAL_HEIGHT_SCORING`, tính `handCoverage` (`>= 62.5 PPM`), `headOnlyCells`/`headOnlyPct`, DORI và Scorecard.
- `core/optimizer.ts`: sinh tập ứng viên tường/trần có giới hạn, cache PPM theo profile (`prepareCandidateGroups`), mặc định **`kpi_hybrid`** (Two-Stage KPI-Aware Greedy + Hinge Local Search với `lambdaHand = 0.50`), chế độ `dualHeight`, và `minimumCamerasForTargets()` giải độc lập theo từng `K`; `greedy`/`hybrid`/vét cạn phục vụ đối chứng.
- `core/localSolver.ts` và `core/optimizer.worker.ts`: chạy thuật toán đã chọn, giảm camera và đối chứng trên Web Worker.
- `components/PlanningSettings.tsx`, `NumberField.tsx` & `CameraCountOptimizer.tsx`: chọn nhanh cỡ mặt bằng (`5×12`, `8×8`, `10×6`, `12×8`), nút **`Xoay 90° (R↔D)`**, chỉnh kích thước phòng/lưới (`accordion-card` thu gọn)/chiều cao trần (quick pills + slider), phạm vi lắp (`Tường + trần` / `Chỉ tường` / `Chỉ trần` qua `segmented-pills`), thẻ bật/tắt `toggle-switch` **`Chống khuất tầm tay (1.0 m)`** và ngân sách camera `1–20`; `NumberField` tích hợp nút stepper `−/+` + đơn vị và commit giá trị trực tiếp khi đang nhập.
- `components/three/`: `Store3D.tsx`, `Furniture3D.tsx` (`ItemShape` hàng hóa 3D theo loại hàng CRAVED), `PersonModel3D.tsx` (hình dáng người cải tiến), camera gắn tường/trần, lưới trần để nhấp lắp và kéo camera trên mặt phẳng cao độ.
- `three/CameraImageEffect.tsx`, `ObservationMaterials.ts` và `cameraVisibility.ts`:
  atlas độ sâu theo camera, kiểm tra bề mặt nhìn thấy gắn vào hình học, pixel theo PPM.
  Atlas cập nhật khi camera/nội thất/người/trần thay đổi, tái sử dụng khi xoay tổng thể.
  Trần hiện trong POV, ẩn tổng thể và vẫn hiện trong lượt dựng atlas.
- `core/api.ts`: chuyển layout/ma trận thành payload, gửi `POST /api/v1/optimize`,
  chuẩn hóa response/diagnostics; timeout 15 giây hoặc lỗi sẽ fallback sang optimizer client.
- `core/io.ts`: chuẩn hóa layout cũ/mới, tải file, export/parse bundle JSON.
- `core/bom.ts`: BOM client và CSV.
- `core/editor.ts`: thêm/xóa/resize vật cản, resize phòng, `rotateLayout90()` (tự động xoay 90° cùng chiều kim đồng hồ toàn bộ tường bao, đa giác, nội thất, camera, nét cọ, lối đi và người), `buildWallObstacle()` (dựng vách ngăn giữa 2 điểm) và `buildCustomLayout()` (sinh mặt bằng từ 4 dáng chuẩn + gói khởi tạo).

### Backend

- `main.py`: FastAPI app, validation Pydantic (`algorithm` mặc định `kpi_hybrid`, `dualHeight: bool = False`), route, lưu file, xuất BOM/bundle (chấp nhận trường `fixture` và `tiers` trên vật cản).
- `greedy_optimizer.py`: biên dịch trước vật cản/lượng giác, lối tắt đa giác lồi, đánh giá thưa theo tuple `nz_dual`, hỗ trợ `greedy`/`hybrid`/`kpi_hybrid` và chấm điểm phân bậc 2 cao độ `DUAL_HEIGHT_SCORING` (`dual_height` + `lambda_hand = 0.50`).
- `tests/test_api.py`, `test_ceiling_optimizer.py`, `test_retail_layouts.py`: 62 tests kiểm tra API, đối chứng parity TS–Python (gồm `kpi_hybrid` và `dual_height`), trần nhà và 15 mẫu bán lẻ Việt Nam.
- `storage/layouts/`: mặc định lưu layout qua API; thư mục được tạo khi có request Save.

## Luồng dữ liệu chính

```text
JSON mẫu ──> presets.ts ──> App/Layout ──> buildZones ──> evaluate ──> Canvas/Scorecard
                                  │
                                  ├── Auto-Optimize ──> toApiPayload ──> FastAPI Greedy/Hybrid
                                  │                           └── timeout/lỗi ──> Web Worker Greedy/Hybrid
                                  ├── Export JSON/PNG ──> tải về trên trình duyệt
                                  └── BOM ──> buildBom ──> bảng / CSV trên trình duyệt
```

Backend cũng cung cấp Save/Load, BOM JSON/CSV/XLSX và project bundle endpoints. Những route
này chưa được gọi từ các nút UI; xem [API_CONTRACT.md](API_CONTRACT.md) để biết request.

## Thành phần phụ thuộc và chạy

- Frontend: React, TypeScript, react-konva/Konva, Three.js/React Three Fiber, Vite, Vitest.
- Backend: FastAPI, Pydantic v1, Uvicorn, openpyxl, python-multipart.
- Vite chạy ở cổng 3000 và proxy `/api` sang `http://localhost:8000`.
- Lệnh chạy, build, test: [README.md](../README.md).


## Mô hình dùng chung và giới hạn

`Layout.ceilingHeight` mặc định 3,2 m, giới hạn 2,4–6 m. `Camera.mount` thiếu được hiểu
là `wall`; camera trần có `ceilingDrop` mặc định 0,15 m, phạm vi 0,15–1 m và cao độ
`ceilingHeight - ceilingDrop` (ít nhất 1,8 m). Camera tường chừa 0,3 m dưới trần.
`Layout.optimization` lưu `algorithm: greedy|hybrid|kpi_hybrid`, `mounts: wall|mixed|ceiling`
và `dualHeight: boolean`; project JSON, API và undo/redo giữ các thuộc tính này (cùng
`fixture` và `tiers` của kệ/nội thất).

Phân tích heatmap và tối ưu lấy mẫu mục tiêu trên một mặt phẳng độ cao, xét pan/tilt,
FOV ngang/dọc, khoảng cách 3D và vật cản dạng thể tích hộp. Người tĩnh và hàng hóa chi tiết
tham gia hình ảnh/che khuất shader 3D nhưng chưa tham gia hàm mục tiêu lưới. Hướng mặt,
ánh sáng và nén video chưa được mô hình hóa.

Greedy và Hybrid dùng cùng tập ứng viên hữu hạn; Hybrid chỉ nhận thay camera tăng điểm
DORI và giới hạn ba lượt. Giới hạn 1.500.000 giá trị ứng viên–ô trên các profile khác nhau
giữ mức tính toán hữu hạn, có thể làm lấy mẫu vị trí thưa hơn. Kết quả không kèm chứng
nhận tối ưu toàn cục. Bộ đo tám preset với K=3 lưu ở
[results/ceiling-optimization.csv](../results/ceiling-optimization.csv).
