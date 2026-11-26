# Camera gắn trần và Greedy + Local Search

> **Ghi chú cập nhật (27/11/2026):** Báo cáo dưới đây ghi nhận đợt triển khai gá trần ban đầu ngày 15/11/2026 (`231` Vitest / `51` pytest). Hiện tại thuật toán mặc định đã nâng cấp lên **`kpi_hybrid`** (Two-Stage KPI + Local Search) cùng cơ chế **2 cao độ phân bậc `1.6 m + 1.0 m`** (`DUAL_HEIGHT_SCORING`, `handCoverage >= 62.5 PPM`), bổ sung trình tự tạo layout & dựng vách (`CustomLayoutModal`, `rotateLayout90()`, tour spotlight 6 bước), mở rộng lên **18 mẫu cửa hàng** và vượt qua **24 file / 270 Vitest tests** + **62 pytest tests**. Xem công thức hiện hành tại [FORMULAS.md](FORMULAS.md) và đánh giá đầy đủ tại [COMPREHENSIVE_EVALUATION_OVERVIEW.md](../paper_evaluation_2026-11-26/COMPREHENSIVE_EVALUATION_OVERVIEW.md).

Ngày cập nhật: 15/11/2026.

## Chức năng đã triển khai

- Cấu hình trần 2,4–6 m, mặc định 3,2 m; camera phân biệt gá tường và gá trần. Cao độ camera trần tự tính theo trần và bộ gá, có khoảng cách an toàn với tường và vật thể cao.
- Tổng thể 3D ẩn trần để nhìn nội thất; POV hiện trần. Lưới trần hỗ trợ nhấp đặt camera; chế độ di chuyển cho phép kéo camera trần tại đúng cao độ.
- Inspector cho phép đổi gá, hướng ngang, góc chúc và khoảng hạ. Lịch sử hoàn tác/làm lại và hai chế độ hiển thị dùng cùng dữ liệu.
- Bản vẽ 2.5D biểu diễn giao của trường nhìn 3D với mặt phẳng đánh giá; camera nhìn thẳng xuống 90° giữ đúng hướng và tỷ lệ FOV.
- Phân tích DORI và tối ưu xét FOV ngang/dọc, góc chúc, khoảng cách 3D và chiều cao vật cản. JSON giữ cấu hình trần, kiểu gá và thiết lập tối ưu; BOM/CSV/XLSX bổ sung kiểu gá và góc chúc.

## Thuật toán

Người dùng chọn Chỉ tường, Chỉ trần hoặc Tường + trần; chọn Greedy đối chứng hoặc Greedy + Local Search. Mặc định dùng Tường + trần và Greedy + Local Search.

Hai thuật toán sử dụng cùng tập ứng viên. Greedy tạo phương án ban đầu; Local Search thử thay từng camera bằng một ứng viên khác, tối đa 3 lượt, chỉ nhận thay đổi tăng điểm DORI có trọng số. Hướng quay và góc chúc nằm trong cấu hình ứng viên. Tổng bộ nhớ lấy mẫu được chặn bởi ngân sách 1,5 triệu giá trị camera–ô và 12.000 cấu hình, phân bổ theo các profile quang học khác nhau.

Kết quả hiển thị điểm Greedy và điểm sau cải thiện. Đây là tìm kiếm trên tập hữu hạn; không có chứng minh tối ưu toàn cục. Chức năng giảm số camera theo KPI vẫn đánh giá tiền tố của phương án tìm được, không chứng nhận số camera tối thiểu toàn cục.

Backend và Worker dùng cùng mô hình. Backend cũ hoặc phản hồi thiếu/sai metadata được chuyển sang Worker; tác vụ hỗ trợ hủy và từ chối kết quả khi dữ liệu đầu vào đã thay đổi.

## Kết quả kiểm thử

- Frontend: 230 ca trong 23 file qua lần chạy toàn bộ; sau bổ sung ca bảo toàn vị trí khi chỉ đổi góc camera, chạy lại 17 ca App đều qua. Tổng tập hiện tại 231 ca đã được kiểm tra.
- Backend: 51/51 ca qua lần chạy tích hợp cuối.
- TypeScript và production build thành công. Vite còn cảnh báo kích thước chunk 3D khoảng 871 kB trước gzip; không thêm thư viện đồ họa.
- Kiểm tra thêm 8 phương án tối ưu qua lưu/nạp JSON: giữ kiểu gá, góc chúc, cao độ ống kính và điểm DORI sau tối ưu.
- Golden fixture MiniStop cho kết quả frontend/backend trùng cấu hình và điểm trong sai số số thực.
- Kiểm tra trực quan cuối trên Chrome chưa hoàn tất: công cụ điều khiển báo noWindowsAvailable và browser access host unavailable. Các ca hình học, tương tác React, phép chiếu và cơ chế hiệu ứng 3D đã chạy tự động; chưa xác nhận hình ảnh thực tế trên GPU ở vòng tích hợp này.

## Thí nghiệm so sánh

Cố định K=3, cùng tập ứng viên tường + trần, điểm DORI có trọng số. Thời gian là số đo Node trên máy phát triển, không phải cam kết thời gian trên mọi thiết bị. Điểm tăng không đồng nghĩa với tăng cùng tỷ lệ diện tích phủ.

| Layout | Camera trần | Greedy | Sau Local Search | Tăng điểm |
|---|---:|---:|---:|---:|
| Layout 1: Chuẩn 60 m2 (10m x 6m) | 2 | 552.81 | 552.81 | 0.00% |
| Layout 2: Circle K 75 m2 (12.5m x 6m) | 2 | 634.08 | 634.08 | 0.00% |
| Layout 3: MiniStop 50 m2 (8.5m x 6m) | 1 | 498.04 | 508.17 | 2.03% |
| VN 01 · Nhà ống 72 m² | 2 | 2238.21 | 2249.39 | 0.50% |
| VN 02 · Góc phố vát góc 78 m² | 2 | 2759.49 | 2803.98 | 1.61% |
| VN 03 · Mặt bằng chữ L 70 m² | 3 | 2476.00 | 2481.86 | 0.24% |
| VN 04 · Mặt bằng hình thang 67,5 m² | 2 | 2465.46 | 2465.46 | 0.00% |
| VN 05 · Cửa hàng giờ cao điểm 78 m² | 2 | 2759.49 | 2803.98 | 1.61% |

5/8 layout tăng điểm, 3 giữ nguyên; không có layout giảm trong tập thí nghiệm này. Mức tăng cao nhất khoảng 2,03%; thời gian đo khoảng 0,35–2,05 giây mỗi layout trong Node. Kết quả không bảo đảm mức cải thiện cho mặt bằng khác.

Tái lập:

```sh
cd frontend
node --import tsx experiments/ceiling.ts
```

Dữ liệu: [CSV](../results/ceiling-optimization.csv), [JSON](../results/ceiling-optimization.json).

## Cách sử dụng

1. Khởi động lại frontend/backend đang chạy để nạp mã mới, rồi mở localhost:3000.
2. Chỉnh Chiều cao trần trong bảng Trần nhà & vị trí lắp.
3. Ở 3D, chọn Camera trần và nhấp lưới; chọn Di chuyển vật thể để kéo camera. Chọn camera để chỉnh kiểu lắp, góc chúc hoặc khoảng hạ.
4. Ở bước Camera/Kết quả, chọn phạm vi vị trí và thuật toán, nhập số camera rồi tối ưu.
5. Xem điểm Greedy/Sau tối ưu và kiểm tra POV/Vùng quan sát; lưu dự án JSON hoặc xuất BOM.

## Giới hạn mô hình

- Mặt phẳng đánh giá vẫn là một độ cao mục tiêu được chọn, chưa tối ưu đồng thời tất cả bề mặt hoặc toàn bộ thể tích cửa hàng.
- Mô hình người tham gia che khuất trong hiển thị 3D; vị trí người chưa tham gia hàm mục tiêu của bộ tối ưu và heatmap lưới.
- PPM là mật độ điểm ảnh danh định; chưa mô phỏng hướng mặt, ánh sáng, nén video hoặc méo ống kính. Góc nhìn dốc xuống không tự chứng minh khả năng nhận dạng khuôn mặt.
- Chi phí gá trần và tuyến cáp thực tế chưa được hiệu chỉnh riêng; BOM giữ mô hình dự toán hiện có.

Mã triển khai được quản lý trên nhánh `upload-opticam` của repository OptiCam.
