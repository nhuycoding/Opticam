# OptiCam-Retail — bản tổng hợp (nhánh `feature/canvas`, Nhật Quang)

```
frontend/       React + TypeScript + react-konva (Vite)  ← sản phẩm chính theo kế hoạch
data_samples/   3 layout JSON mẫu (60 m², 75 m², 50 m²) — cùng schema với frontend/src/data
docs/           RESEARCH.md — giả thuyết, mô hình, thiết kế thí nghiệm, kết quả, mối đe doạ hợp lệ
results/        CSV + summary.md do `npm run experiments` sinh ra (seed cố định, tái lập được)
legacy_pygame/  Prototype Pygame cũ (giữ để tham chiếu; KHÔNG dùng cho bản nộp)
scripts/        gen_samples.py — sinh JSON mẫu từ preset Pygame
```

## Chạy
```bash
cd frontend && npm install
npm run dev        # http://localhost:3000  (proxy /api → :8000 cho backend của Gia Bảo)
npm test           # vitest: PPM, snap 15°, snap-to-wall, Greedy < 2s
npm run experiments  # vét cạn + so sánh phương pháp + 30 layout ngẫu nhiên → ../results (≈1–2 phút)
npm run build      # → frontend/dist (bundle tĩnh, tách chunk konva)
```

## Đối chiếu kế hoạch (phần Nhật Quang)
| Ngày | Hạng mục | File |
|---|---|---|
| T7 | Canvas Konva, lưới 0.5 m; **thêm / xoá / đổi kích thước** Kệ·POS·Cửa; **đổi kích thước tường bao**; **công cụ đo (m)** | `canvas/OptiCamCanvas.tsx`, `core/editor.ts`, `Inspector.tsx` |
| CN | `pixelsPerMeter` chỉnh được, nạp layout JSON, ảnh nền theo mét + **hiệu chuẩn bằng phép đo**, Risk Overlay W∈{5,3,1} + cọ tô | `core/io.ts`, `core/optics.ts`, `Inspector.tsx` |
| T2 | Nhiều camera, snap-to-wall, xoay 15°, FOV, Heatmap DORI — tách `CameraNode`, `FovCone`, `HeatmapLayer`, `BaseGridLayer`, `ObstacleNode` | `components/canvas/*` |
| T3 | Auto-Optimize 3 cam, Manual 4-Corner, `POST /api/v1/optimize` (payload có `riskMatrix`; fallback client), BOM | `core/api.ts`, `core/optimizer.ts`, `core/bom.ts` |
| T4 | 4 Layer, layer tĩnh `listening={false}`, `React.memo` + rAF, tooltip PPM, FPS, **nút Benchmark 20 cam** (FPS TB, p95, thời gian vẽ heatmap) | `canvas/*`, App |
| T5 | Export/Import bundle (đọc cả file Pygame), PNG, CSV BOM, Vite build | `core/io.ts`, `vite.config.ts` |

Schema với Gia Bảo: xem `docs/API_CONTRACT.md` — chỉ sửa `toApiPayload` / `fromApiResponse` trong `core/api.ts` khi chốt.
Tường bao được tạo từ kích thước phòng (không có tường nội thất tự do — ngoài scope "vật cản hình chữ nhật").

Giữ lại từ bản Pygame: SAT chống chồng lấn + auto-revert, cửa tự khoá vào tường, xoay vật cản 15°, 3 layout, BOM, xuất PNG/JSON.

## Giả định cần nhóm thống nhất
- Vùng Đỏ/Vàng: đệm 1.0 m quanh POS+cửa / quanh kệ (`RED_BUFFER`, `YELLOW_BUFFER` trong `optics.ts`; bản Pygame dùng 1.0 m, tài liệu Nhật Quang dùng 1.2/1.1 m).
- Camera mặc định: 4MP (2560 px), FOV 85°, cao 2.4 m, tầm 10 m; PPM tính trên mặt phẳng mặt người Z = 1.6 m.
- Chưa có: backend thật, Visibility Polygon, phân tích độ nhạy W/buffer.

## Trạng thái kiểm tra
- **Đã chạy thật (Node):** toàn bộ `core/` (gồm `editor.ts`, `api.ts`) (hình học, PPM/DORI, Greedy, vét cạn) và `experiments/run.ts`; các bất đẳng thức trong unit test (vét cạn ≥ Greedy ≥ 63.2%·Optimum, tính đơn điệu) đã được kiểm tra trên 3 layout.
- **Đã kiểm tra kiểu:** `tsc --strict` sạch trên toàn bộ `src/`, nhưng với stub thay cho react/konva (không có mạng) — chưa kiểm tra kiểu của chính thư viện đó.
- **Chưa chạy:** `npm install`, vitest, giao diện React/Konva trên trình duyệt và số đo 60 FPS (dùng nút *Benchmark 20 cam* để lấy số). Chạy `npm run build` và `npm test` đầu tiên, báo lỗi nếu có.
- **Kết quả quan trọng:** xem `docs/RESEARCH.md` §4 — giả thuyết "3 cam tốt hơn 4 cam thủ công" chưa được dữ liệu ủng hộ; không nên đưa số liệu "~60% / ~50%" của bản đề xuất vào báo cáo.
