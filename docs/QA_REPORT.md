# Kiểm thử và cải tiến OptiCam

Ngày thực hiện 12/11/2026, giờ Việt Nam.

## Cập nhật giao diện Studio

Đã triển khai quy trình Mặt bằng → Ưu tiên → Camera → Kết quả vào ứng dụng React.
Giao diện dùng nền giấy sáng, màu nhấn nâu, font Be Vietnam Pro/Lora có bộ ký tự tiếng Việt
và icon Lucide được đóng gói cục bộ.

Sơ đồ có tường hai nét với ký hiệu vật liệu, đường kích thước tổng thể, thước mét,
chỉ dẫn bề rộng các lối đi đủ điều kiện giữa kệ thẳng, kệ chia khoang hàng, thiết bị POS,
cung mở cửa, nhân vật nhìn từ trên xuống và nhãn camera chứa hướng nhìn, FOV, cao độ.
Nhãn camera điều chỉnh kích thước theo zoom và thử tránh chồng nhau. Mặt bằng nhiều camera
ở diện tích nhỏ vẫn cần phóng to để đọc chi tiết.

So sánh trước/sau lưu camera và điểm đánh giá của lần tối ưu thực tế. Bản trước được khóa
kéo thả và các thao tác thêm người, xoay bằng Alt-wheel. KPI theo bản đang xem. Chỉnh sửa
mặt bằng sau tối ưu sẽ xóa so sánh đã cũ. Đã sửa thứ tự cập nhật state để bản so sánh
không bị xóa sớm giữa các lần render.

- Frontend hiện có 73/73 tests đạt, gồm 9 tests bổ sung cho chuyển bước, giữ chỉnh sửa,
  bản trước/sau, loại kết quả tối ưu cũ, khóa preview và giới hạn nhãn camera.
- TypeScript và production build đạt.
- Máy chủ Vite cho giao diện mới trả HTTP 200.
- Chưa xác nhận trực quan đầy đủ bản Studio trên desktop/mobile và ảnh PNG xuất thực tế.
  Browser access host không khả dụng. Native Chrome đang thay đổi bởi người dùng nên
  công cụ không thực hiện được phiên kiểm thử giao diện độc lập.

## Kết quả kiểm chứng đợt nền tảng

Các kết quả trong bảng dưới được ghi nhận trước khi thay giao diện Studio.

| Hạng mục | Kết quả |
| --- | --- |
| Cài sạch frontend bằng `npm ci` | Thành công, dependency audit ghi nhận 0 lỗ hổng |
| Frontend unit và regression tests | 64/64 đạt |
| TypeScript và production build | Thành công, đã tạo bundle Web Worker |
| Backend API và regression tests | 30/30 đạt |
| HTTP qua Vite proxy và FastAPI | Health và Optimize trả HTTP 200 |
| Worker từ production bundle | Chạy tối ưu, giảm camera và hủy thành công, số worker còn hoạt động bằng 0 |
| Thí nghiệm E1/E2/E3 | Hoàn tất 3 mặt bằng mẫu, 30 mặt bằng ngẫu nhiên và chuỗi 1–5 camera |
| Quan sát Chrome desktop, giao diện tối | Đã quan sát sơ đồ vừa khung, kết quả 3 camera và lớp rủi ro |

Worker production bundle được chạy bằng Node worker threads cùng adapter cho API Web Worker.
Phần kiểm tra này xác nhận thuật toán, kết quả và vòng đời worker.

Dependency audit áp dụng cho bộ npm dependency được cài trong phiên này. Backend còn một
cảnh báo deprecation từ Starlette/AnyIO khi chạy test.

## Các vấn đề đã xử lý

| Mức độ | Vấn đề và cách xử lý | Kiểm chứng |
| --- | --- | --- |
| Cao | Import lưới bằng 0 hoặc quá dày có thể gây vòng lặp hoặc cấp phát lớn. Kiểm tra phạm vi, số ô và kích thước file trước khi dựng lưới. | Regression tests |
| Cao | Vòng giảm số ứng viên backend có thể lặp vô hạn khi bốn góc phòng vẫn vượt ngưỡng một triệu phép tính. Dừng giảm khi đã đến bốn góc. | Test lưới 11.750 ô |
| Cao | Greedy dự phòng chạy trên luồng giao diện và có thể làm đứng thao tác. Chuyển tính toán sang Web Worker, thêm hủy tác vụ và thu hồi worker. | Worker production bundle, API fallback tests |
| Cao | Kết quả tối ưu cũ có thể áp lên mặt bằng vừa chỉnh sửa. Kiểm tra phiên bản đối tượng layout trước khi áp dụng kết quả. | Rà soát luồng bất đồng bộ và test hủy |
| Cao | Camera trong request BOM/export có thể chứa thông số sai hoặc giá trị vô hạn, dẫn tới lỗi server. Bổ sung schema camera và kiểm tra số hữu hạn, cả trong metadata. | API tests trả 422 |
| Cao | Lưu trực tiếp vào file có thể để lại JSON ghi dở khi nhiều request cùng lưu. Ghi file tạm rồi thay thế nguyên tử. | Test 20 lần lưu đồng thời |
| Vừa | API chuyển đổi Pydantic obstacle sang dict lặp trong hàng trăm nghìn phép tính đường ngắm. Chuyển đổi một lần khi khởi tạo optimizer. | Profiling, HTTP và test đếm số lần chuyển đổi |
| Vừa | Tọa độ kéo camera, tay cầm xoay và người chưa xét zoom/pan. Đổi tọa độ qua transform của node cha. | 9 test callback thực ở zoom 35%, 100%, 200% |
| Vừa | Thu nhỏ phòng hoặc đổi kích thước vật cản xoay có thể tạo vật cản vượt tường/chồng lấn. Từ chối thay đổi gây xung đột và báo lỗi khi đổi phòng. | Geometry/editor tests |
| Vừa | Camera thêm sau khi xóa có thể trùng mã đang tồn tại. Tìm mã còn trống và vô hiệu hóa nút thêm khi đủ 20 camera. | Rà soát mã |
| Vừa | Profile camera đầy đủ có thể ghi đè vị trí và pan của ứng viên. Chỉ lấy các thuộc tính quang học từ profile. | Regression test và worker production bundle |
| Vừa | Khi profile đầu không quan sát được ô trống, thuật toán có thể bỏ qua các profile tốt hơn phía sau. Tiếp tục xét các profile còn lại. | Frontend và backend tests |
| Vừa | Greedy client có thể lặp lại đúng một ứng viên sau khi điểm đã bão hòa. Loại ứng viên đã chọn khỏi tập của profile đó. | Test ngân sách 20 camera |
| Vừa | Python và JavaScript làm tròn khác nhau ở số dương có phần lẻ 0,5, gây lệch schema lưới. Dùng quy tắc half-up đồng nhất. | API test mặt bằng 4,5 × 3 m, ô 1 m |
| Vừa | BOM frontend dùng chiều cao cáp cố định, khác backend. Dùng chiều cao từng camera và đồng nhất dự toán khi không có camera. | BOM tests |
| Vừa | CSV chưa escape dấu nháy, chuỗi do người dùng nhập có thể thành công thức bảng tính. Escape CSV và xuất chuỗi literal trong CSV/XLSX. | Đọc lại CSV và XLSX trong tests |
| Vừa | Heatmap bundle backend tính cả ô sàn bị vật cản chiếm. Đánh dấu `solid` và loại các ô đó khỏi vùng phủ. | API export test |
| Vừa | Ô số bị mất thay đổi khi rời ô, chế độ độ phân giải tùy chỉnh khó mở. Áp dụng giá trị khi Enter/rời ô, Esc khôi phục và hiển thị lỗi phạm vi. | TypeScript/build và rà soát mã, cần xác nhận thao tác UI thêm |
| Vừa | Sơ đồ bị cắt ở màn hình hẹp và popup người lệch sau zoom/pan. Đo viewport bằng ResizeObserver, tự vừa khung và định vị popup theo tọa độ màn hình. | Quan sát Chrome và rà soát mã |
| Thấp | Undo chưa sẵn sàng trong 500 ms đầu và redo có thể dùng nhánh lịch sử cũ ngay sau khi chỉnh sửa. Cập nhật trạng thái lịch sử ngay khi có thay đổi. | Rà soát mã |
| Thấp | JSON UTF-8 có BOM bị từ chối. Hỗ trợ BOM, file Pygame mẫu và báo lỗi JSON dễ hiểu. | Import regression tests |
| Thấp | Bộ sinh mặt bằng thực nghiệm thiếu `riskStrokes` và `targetHeight`. Bổ sung để E2 chạy đến hết. | Toàn bộ E1/E2/E3 |
| Thấp | Plugin React 4 khai báo peer dependency lệch Vite 8. Nâng plugin tương thích Vite 8 và cập nhật lockfile. | Cài sạch, test và build |

## Giao diện và tương tác

- Mặt bằng là vùng làm việc chính, tự căn vừa khung khi thay đổi kích thước viewport.
- Cho chọn ngân sách 1–20 camera ngay cạnh nút tối ưu, có nút hủy khi đang tính.
- KPI chính hiển thị trước, bảng so sánh và số liệu hiệu năng mở theo nhu cầu.
- Chọn camera hoặc vật cản qua danh sách trong Inspector, hỗ trợ thao tác bằng bàn phím.
- Thiết lập mặt bằng và các công cụ dự án được thu gọn theo nhóm.
- Giao diện Studio hiện dùng nền giấy sáng và hỗ trợ reduced motion.
- Dùng Pointer Events cho công cụ trên sơ đồ, tăng vùng chạm và cỡ chữ nhập liệu trên màn hình nhỏ.
- KPI vùng đỏ/vàng hiển thị trạng thái chưa có vùng khi nhóm tương ứng không có ô.
- Xuất PNG dựng toàn mặt bằng độc lập với zoom/pan hiện tại, giới hạn cạnh ảnh khoảng 2.048 px để kiểm soát bộ nhớ.

Chế độ **Giảm camera theo KPI (Greedy)** chọn tiền tố ngắn nhất đạt ngưỡng trong chuỗi
Greedy của các profile hiện có. Kết quả phụ thuộc tập ứng viên và thứ tự profile.

Các giới hạn bổ sung gồm file nhập 5 MB, 500 vật cản và 50.000 nét cọ. Giới hạn 20 camera
và 12.000 ô được dùng nhất quán trong kiểm tra dữ liệu. Khi đạt giới hạn cọ, giao diện
thông báo và tắt chế độ tô.

## Hiệu năng đo trong phiên kiểm thử

Các lần gọi API trực tiếp, cùng mặt bằng và profile mặc định, ghi nhận thời gian tính sau.

| Mặt bằng | Trước chuyển đổi obstacle một lần | Sau sửa |
| --- | --- | --- |
| 60 m² | 13.750 ms | 1.439 ms |
| Circle K 75 m² | 22.208 ms | 2.293 ms |
| MiniStop | 9.288 ms | 960 ms |

Lần kiểm tra cuối qua adapter frontend, tính cả thời gian chờ API 1,5 giây và chuyển sang
worker, ghi nhận 1.827 ms, 1.718 ms và 1.642 ms cho ba mặt bằng. Các phép đo phụ thuộc tải
máy tại thời điểm chạy. Circle K vẫn có lần gọi API trực tiếp vượt KPI 2 giây.

E2 với 30 mặt bằng ngẫu nhiên ghi nhận Greedy trung bình 184,4 ms, lớn nhất 572,8 ms.
Có 23/30 mặt bằng đạt đồng thời KPI đỏ và vàng với 3 camera. Tỷ lệ điểm Greedy so với vét
cạn trên cùng tập ứng viên thu gọn trung bình 97,3%. Trong E1 có một lượt Greedy 2.815 ms
khi các tác vụ kiểm thử/build cùng chạy. Các số đo này cho thấy cần đánh giá thời gian
trên cấu hình máy dùng để trình bày đồ án.

Kết quả E1/E2/E3 của lượt kiểm thử được ghi tại thư mục tạm
`/private/tmp/opticam-qa-experiments`. Mã thực nghiệm hỗ trợ `OUT_DIR` để chọn thư mục kết quả.

## Phạm vi còn cần xác nhận trực tiếp

- Chưa kiểm chứng trên điện thoại thật, Safari và Firefox.
- Chưa xác nhận đầy đủ thao tác nhập số, import qua hộp chọn file, focus BOM và xuất PNG trên UI sau sửa. API export và logic nhập dữ liệu đã có test tự động.
- Đã kiểm tra callback kéo thả bằng transform thật của Konva, phần thao tác kéo thả bằng chuột và cảm ứng trên thiết bị thật cần kiểm tra thêm.
- Công cụ điều khiển Chrome gặp lỗi ScreenCaptureKit, mất cửa sổ và accessibility trong phiên kiểm thử, nên phần xác minh UI nêu trên còn giới hạn.

Python Homebrew của môi trường hiện tại gặp lỗi `platform.mac_ver()` và thư viện XML
`pyexpat`. Kiểm thử backend sử dụng Python 3.12.11 độc lập cùng dependency đặt trong thư
mục tạm. Những lỗi môi trường này cần được xử lý khi chạy backend bằng Python hệ thống.

Hai fixture backend cũ đã được chỉnh để khớp kịch bản kiểm thử. Bài kiểm tra vùng phủ thấp
cần cả ba profile có tầm nhìn 30 m. Bài kiểm tra POS che thắt lưng cần điểm mục tiêu ở phía
sau POS. Thuật toán đường ngắm được giữ theo công thức giao tuyến 3D.

## Chạy lại

Từ thư mục `frontend`, chạy các lệnh sau.

```bash
npm ci
npm test
npm run build
npm run dev
```

Từ thư mục gốc, dùng Python 3.10+ cùng dependency backend đã cài.

```bash
python -m pytest backend/tests -q
python -m uvicorn backend.main:app --port 8000
```

Để chạy lại bộ thực nghiệm và lưu kết quả kiểm thử riêng, chạy từ `frontend`.

```bash
OUT_DIR=/tmp/opticam-qa-experiments node --import tsx experiments/run.ts
```
