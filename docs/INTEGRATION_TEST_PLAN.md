# Checklist nghiệm thu tích hợp OptiCam

## Luồng End-to-End tự động

Chạy tại `frontend/`:

```sh
npm run test:e2e
```

Playwright khởi chạy ứng dụng Vite và FastAPI, mở Chromium và kiểm tra:

1. Import JSON layout hợp lệ, xác nhận tên/phạm vi phòng và lớp phủ DORI hiển thị.
2. Gửi Auto-Optimize qua API thật, xác nhận API phản hồi và kết quả được gắn vào layout.
3. Mở BOM, kiểm tra tổng công suất, dự phòng PoE, số dòng camera và tải CSV.
4. Export project JSON, kiểm tra bundle/BOM, sau đó import lại và xác nhận layout giữ nguyên.
5. Chạy benchmark Canvas với 20 camera qua 120 khung hình; ghi nhận FPS trung bình và p95
   trong thông báo trên giao diện.
6. Mở tab **Kiểm thử**, chạy 6 frontend self-tests và 2 API integration checks, rồi xác nhận
   từng kết quả/thông báo lỗi hiển thị trên trang.
7. Giả lập backend trả HTTP 502, xác nhận tab đưa ra trạng thái lỗi và địa chỉ/hướng dẫn kiểm tra backend.

Trong ứng dụng, tab **Kiểm thử** có các nút **Chạy tất cả**, **Chạy test frontend** và
**Test tích hợp API**. Các self-test này chạy logic kiểm tra trong trình duyệt trên layout
đang mở; chúng không chạy lệnh Vitest/pytest hệ điều hành.

## Checklist nghiệm thu thủ công

| Hạng mục | Thao tác | Điều kiện đạt |
|---|---|---|
| Layout | Import từng JSON mẫu và một layout đã export | Kích thước, vật cản và camera đọc đúng; không hiện lỗi import |
| Tối ưu | Chạy Auto-Optimize với backend đang hoạt động | API trả danh sách camera; nguồn xử lý hiển thị Backend API |
| Fallback | Tắt backend rồi chạy Auto-Optimize | Giao diện hoàn thành bằng Greedy client, không treo |
| Heatmap | Bật Heatmap DORI, chỉnh pan/FOV hoặc kéo camera | Mức PPM cập nhật theo vị trí camera |
| Độ phủ | Thử layout nghiệm thu không có vật cản cao | Greedy đạt trên 85% diện tích yêu cầu theo tiêu chí kế hoạch |
| BOM | Mở BOM sau khi tối ưu, đối chiếu camera và công suất datasheet | Mã/số camera đúng; tổng cáp và PoE budget khớp dòng từng camera |
| Xuất BOM | Tải CSV (và thử endpoint XLSX nếu cần) | File mở được, có cột cáp/công suất và tổng dự phòng PoE |
| Bundle | Export JSON, import lại file vừa export | Tọa độ phòng, camera, vật cản và dữ liệu BOM không sai lệch |
| Hiệu năng | Chạy Benchmark 20 cam | Hoàn tất 120 frame; lưu lại FPS trung bình và p95 để nghiệm thu |

## Giả định và giới hạn

- E2E tự động dùng layout phòng 4 × 3 m, grid 1 m và API local; không chứng nhận hiệu năng
  triển khai ngoài máy kiểm thử.
- Mục tiêu >85% phải được kiểm tra trên layout/vùng yêu cầu đã thống nhất; không suy ra từ
  một mẫu thử nhỏ.
- Công suất BOM mặc định 12 W/camera là ước lượng. Trước khi mua sắm cần thay bằng công suất
  tối đa theo datasheet và xác nhận ngân sách từng cổng/tổng PoE switch.

## Kết quả kiểm thử lần hoàn thiện

- Frontend unit tests: **28 passed**.
- Backend API/optimizer/BOM tests: **11 passed**.
- Playwright Chromium E2E: **4 passed**, gồm kiểm tra diện tích phủ vượt 85%, tab self-test
  và thông báo khắc phục khi backend proxy trả HTTP 502.
- Type-check và production build: **passed**.
- Benchmark 20 camera hoàn thành 120 frame; E2E xác nhận giao diện trả về FPS trung bình và
  p95. Giá trị hiệu năng thay đổi theo máy chạy, nên cần ghi riêng khi nghiệm thu trên máy đích.
