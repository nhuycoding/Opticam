# Kiến trúc và cấu trúc dự án

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
│   │   ├── App.tsx              # Trạng thái ứng dụng và hành động UI
│   │   ├── components/          # Inspector, Scorecard, BOM, Canvas nodes/layers
│   │   ├── core/                # Hình học, optics, optimizer, IO, BOM, API adapter
│   │   ├── data/presets.ts      # Đọc preset JSON từ ../data_samples
│   │   └── types.ts             # Kiểu Layout, Camera, Obstacle, Cell, Score
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

- `App.tsx`: điều phối quy trình 2 bước (`Mặt bằng` → `Kết quả`), hộp thoại xác nhận đổi layout trong ứng dụng (`pendingLayout`), trạng thái selection/công cụ/3D và so sánh trước/sau.
- `components/canvas/`: ghép các Konva layer; render lưới/ảnh nền, heatmap DORI/rủi ro kèm gạch chéo cảnh báo ô khuất tầm tay (`1.0 m`), vật cản, camera/FOV, đo khoảng cách và tooltip PPM.
- `core/optics.ts`: phân vùng rủi ro, `dualPpmAt()` chia sẻ chung phép cắt 2D cho mặt (`1.6 m`) và tầm tay (`1.0 m`), tính `headOnlyCells`/`headOnlyPct`, DORI và Scorecard.
- `core/optimizer.ts`: sinh tập ứng viên tường/trần có giới hạn, cache PPM theo profile (`prepareCandidateGroups`), mặc định **`kpi_hybrid`** (Two-Stage KPI-Aware Greedy + Hinge Local Search), chế độ `dualHeight`, và `minimumCamerasForTargets()` giải độc lập theo từng `K`; `greedy`/`hybrid`/vét cạn phục vụ đối chứng.
- `core/localSolver.ts` và `core/optimizer.worker.ts`: chạy thuật toán đã chọn, giảm camera và đối chứng trên Web Worker.
- `components/PlanningSettings.tsx`, `NumberField.tsx` & `CameraCountOptimizer.tsx`: chỉnh kích thước phòng/lưới/chiều cao trần, phạm vi lắp (`Tường + trần` / `Chỉ tường` / `Chỉ trần`), bật/tắt **`Chống khuất tầm tay (1.0 m)`** và ngân sách camera `1–20`.
- `components/three/`: mô hình/POV, nội thất instancing, camera gắn tường/trần, lưới trần
  để nhấp lắp, kéo camera trên mặt phẳng cao độ và bảng thuộc tính 3D.
- `three/CameraImageEffect.tsx`, `ObservationMaterials.ts` và `cameraVisibility.ts`:
  atlas độ sâu theo camera, kiểm tra bề mặt nhìn thấy gắn vào hình học, pixel theo PPM.
  Atlas cập nhật khi camera/nội thất/người/trần thay đổi, tái sử dụng khi xoay tổng thể.
  Trần hiện trong POV, ẩn tổng thể và vẫn hiện trong lượt dựng atlas.
- `core/api.ts`: chuyển layout/ma trận thành payload, gửi `POST /api/v1/optimize`,
  chuẩn hóa response/diagnostics; timeout 15 giây hoặc lỗi sẽ fallback sang optimizer client.
- `core/io.ts`: chuẩn hóa layout cũ/mới, tải file, export/parse bundle JSON.
- `core/bom.ts`: BOM client và CSV.
- `core/editor.ts`: thêm/xóa/resize vật cản và resize phòng.

### Backend

- `main.py`: FastAPI app, validation Pydantic (`algorithm` mặc định `kpi_hybrid`, `dualHeight: bool = False`), route, lưu file, xuất BOM/bundle.
- `greedy_optimizer.py`: biên dịch trước vật cản/lượng giác, lối tắt đa giác lồi, đánh giá thưa theo ô nhìn thấy, hỗ trợ `greedy`/`hybrid`/`kpi_hybrid` và `dual_height`.
- `tests/test_api.py`, `test_ceiling_optimizer.py`, `test_retail_layouts.py`: 62 tests kiểm tra API, đối chứng parity TS–Python, trần nhà và 15 mẫu bán lẻ Việt Nam.
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
`Layout.optimization` lưu `algorithm: greedy|hybrid` và `mounts: wall|mixed|ceiling`;
project JSON, API và undo/redo giữ các thuộc tính này.

Phân tích heatmap và tối ưu lấy mẫu mục tiêu trên một mặt phẳng độ cao, xét pan/tilt,
FOV ngang/dọc, khoảng cách 3D và vật cản dạng thể tích hộp. Người tĩnh và hàng hóa chi tiết
tham gia hình ảnh/che khuất shader 3D nhưng chưa tham gia hàm mục tiêu lưới. Hướng mặt,
ánh sáng và nén video chưa được mô hình hóa.

Greedy và Hybrid dùng cùng tập ứng viên hữu hạn; Hybrid chỉ nhận thay camera tăng điểm
DORI và giới hạn ba lượt. Giới hạn 1.500.000 giá trị ứng viên–ô trên các profile khác nhau
giữ mức tính toán hữu hạn, có thể làm lấy mẫu vị trí thưa hơn. Kết quả không kèm chứng
nhận tối ưu toàn cục. Bộ đo tám preset với K=3 lưu ở
[results/ceiling-optimization.csv](../results/ceiling-optimization.csv).
