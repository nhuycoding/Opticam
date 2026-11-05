# Hợp đồng dữ liệu Canvas ↔ Backend (bản nháp — chờ Gia Bảo chốt)

Mọi thay đổi schema chỉ cần sửa 2 hàm trong `frontend/src/core/api.ts`: `toApiPayload` và `fromApiResponse`.
`normalizeLayout` / `normalizeCameras` (io.ts) đã chấp nhận alias: `width|widthM`, `height|heightM`, `grid_size|gridM`,
vật cản `w|width`, `h|height`, `elev|elevation`, `label|name`; camera `pan|pan_angle|angle`.

## `POST /api/v1/optimize`
Request
```json
{ "cameraBudgetK": 3,
  "layout": { "version": "1.0", "name": "...", "widthM": 10, "heightM": 6, "gridM": 0.5,
              "obstacles": [{ "id": "obs_pos", "type": "pos|shelf|entrance", "label": "Quầy POS",
                              "x": 1.0, "y": 0.5, "w": 2.0, "h": 1.0, "elev": 1.1, "angle": 0 }] },
  "grid": { "rows": 12, "cols": 20, "cellSizeM": 0.5 },
  "riskMatrix":    [[1, 3, 5, "..."]],
  "blockedMatrix": [[0, 0, 1, "..."]] }
```
Response (`data.cameras` cũng được chấp nhận)
```json
{ "cameras": [{ "id": "CAM-01", "x": 0, "y": 3.5, "pan": 45, "fov": 85, "res": 2560, "range": 10, "height": 2.4 }] }
```
Quy ước: mét; gốc toạ độ góc trái-trên; `pan` độ, 0° = +X, chiều kim đồng hồ (trục Y hướng xuống); bước 15°.
Timeout 1.5 s hoặc lỗi → frontend tự chạy Greedy cục bộ (`source: 'client'`).
