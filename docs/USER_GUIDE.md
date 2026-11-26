# Hướng dẫn sử dụng

## Mở ứng dụng

Khởi động backend và frontend theo hướng dẫn tại [README.md](../README.md), sau đó mở
<http://localhost:3000>. Nếu backend chưa chạy, bộ tối ưu tự chuyển sang thuật toán đang chọn
trên Web Worker của trình duyệt khi API lỗi hoặc quá thời gian chờ 15 giây.

## Khu vực giao diện

- **Thanh đầu trang:** chọn 1 trong 18 mặt bằng mẫu (hiển thị hộp thoại xác nhận trong ứng dụng trước khi thay đổi), chuyển bước **Mặt bằng** / **Kết quả**, hoàn tác/làm lại và xuất JSON/BOM.
- **Thanh công cụ bên trái:** chọn/kéo, thêm camera/kệ/POS/cửa, đặt người đánh giá, đo và tô mức ưu tiên W.
- **Canvas:** mặt bằng theo mét, lưới, vật cản, camera, vùng FOV và heatmap. Chọn lớp DORI/rủi ro/tắt
  và bật lưới/điểm neo ngay phía trên canvas.
- **Inspector bên phải:** KPI trực tiếp, so sánh phương án, chỉnh tường bao và thông số của vật thể/camera đang chọn.
- **Xuất và dự án / Công cụ nâng cao:** nhập layout JSON, lưu PNG, Greedy không trọng số, ảnh nền và các thao tác ít dùng.
- **Hoàn tác/Làm lại:** các thay đổi sơ đồ và hình người được gom theo thao tác; dùng nút hoặc
  `Ctrl+Z` / `Ctrl+Y` (Mac: `⌘Z` / `⌘Y`). Thay layout, xóa vật thể và xóa cọ sẽ hỏi xác nhận.

## Các thao tác chính

1. Chọn một trong 18 layout mẫu ở thanh đầu trang (3 mẫu quốc tế và 15 mẫu cửa hàng Việt Nam `VN 01`–`VN 15` có người tĩnh); nhập layout JSON trong menu **Xuất dự án**.
2. Thêm kệ, POS, cửa hoặc camera bằng thanh công cụ bên trái.
   Chọn **Người đánh giá**, rồi bấm vào mặt bằng để đặt hình người; chọn/kéo hình người để
   mở thông tin và xem DORI/PPM tại mặt, ngực, bụng và chân. Dùng `Delete` để xóa người.
3. Kéo camera tường dọc tường hoặc camera trần bên trong mặt bằng để đổi vị trí; chọn camera rồi kéo tay cầm màu cam để đổi hướng theo nấc 15°.
   Chọn camera rồi chỉnh chất lượng, model, pan, FOV, tầm xa và chiều cao trong Inspector.
   Ô số cho phép xóa giá trị cũ để nhập lại; nhấn `Enter` hoặc rời ô để áp dụng, `Esc` để
   hủy nội dung đang nhập. Giá trị ngoài phạm vi được báo ngay dưới ô.
4. Chọn vật cản để đổi tên/kích thước/chiều cao; xoay bằng nút xoay hoặc phím `R`.
   Cửa được khóa vào cạnh tường. Có thể xoay vật thể qua vật thể khác để sắp xếp lại;
   di chuyển chặn chồng lấn mới và cho phép tách những vật thể đang chồng nhau.
5. Chọn **DORI**, **Rủi ro**, hoặc **Tắt lớp phủ** phía trên canvas để đổi lớp phủ.
   Chọn cọ `W 5`, `W 3`, `W 1` ở thanh công cụ bên trái, rồi kéo trên sơ đồ để ghi đè trọng số. Nét cọ được
   lưu theo vị trí/bán kính thực nên giữ nguyên khi đổi kích thước lưới. Heatmap rủi ro dùng
   thang đơn sắc theo độ ưu tiên; lưới nhỏ hơn 0.5 m ẩn số, ở 0.5 m hiện mọi W, lưới lớn hơn chỉ hiện W ≥ 2.
   Chú giải bên dưới sơ đồ lọc Thấp/Vừa/Cao.
6. Trong **Camera và tối ưu → Thiết lập tối ưu**, chọn phạm vi lắp (**Tường + trần**, **Chỉ tường** hoặc **Chỉ trần**), bật/tắt **Chống khuất tầm tay (1.0 m)** nếu cần bắt buộc camera thấy cả mức tay/hàng hóa `1.0 m` (ngoài mặt `1.6 m`), và nhập **Số camera muốn bố trí (1–20)** rồi bấm **Tối ưu phương án**.
   Hệ thống mặc định dùng thuật toán **Two-Stage KPI + Local Search (`kpi_hybrid`)**: ưu tiên phủ ≥95% vùng Đỏ trước rồi cân bằng vùng Vàng và thực hiện tối đa 3 vòng hoán đổi 1-camera. Trên heatmap DORI, ô chỉ thấy mặt `1.6 m` nhưng bị kệ/quầy che ở tầm tay `1.0 m` sẽ hiện gạch chéo vàng cam kèm cảnh báo trong Scorecard.
   Lệnh **Giảm số camera theo KPI** giải độc lập từng ngân sách `K = 1..M` trên cùng pool ứng viên để tìm số camera ít nhất đạt đồng thời Đỏ ≥95% và Vàng ≥80%. Nếu chưa đạt KPI, ứng dụng giữ phương án đủ ngân sách tìm được và báo tỷ lệ thực tế. **Hủy** dừng tác vụ; chỉnh mặt bằng trong lúc tối ưu làm kết quả cũ không còn được áp dụng.
7. Rê chuột lên ô để xem tọa độ, W, nhóm ưu tiên và trạng thái camera phủ. Nút **Vừa khung**,
   **100%**, `+`/`−`, cuộn chuột và kéo nền trống dùng để điều hướng canvas; giữ `Alt` khi cuộn
   để xoay camera/vật thể đang chọn.
8. Chọn **BOM** hoặc **Xuất JSON** ở thanh đầu trang. Các thao tác nhập layout, lưu PNG và
   so sánh Greedy không trọng số nằm trong mục **Xuất và dự án** ở Inspector.

Trên màn hình nhỏ, bấm **Mở công cụ mặt bằng** dưới canvas để hiện thanh công cụ. Inspector nằm
dưới sơ đồ; kéo nền trống để pan khi phóng lớn.

### Thông số camera

- **Chất lượng ảnh:** preset 2 MP (1920 px ngang), 4 MP (2560 px ngang), 8 MP
  (3840 px ngang), hoặc độ phân giải ngang tùy chỉnh. PPM dùng trực tiếp số pixel ngang.
- **Góc xoay / pan:** hướng trục quang học trên mặt bằng; 0° hướng +X, tăng theo chiều kim đồng hồ.
- **Góc quay / FOV:** độ rộng góc nhìn, đơn vị độ.
- **Tầm xa:** giới hạn khoảng cách 3D từ ống kính tới điểm đánh giá.
- **Kiểu lắp:** gắn tường hoặc gắn trần; ảnh hưởng cách kéo camera và tính cao độ.
- **Chiều cao:** cao độ ống kính so với sàn. Camera tường từ 1,8 m tới thấp hơn trần 0,3 m.
  Camera trần được tính từ chiều cao trần trừ **Khoảng hạ từ trần**, không nhập cao độ độc lập.
- **Góc chúc xuống:** 0–90°; mặc định 20° cho camera tường, 45° cho camera trần. Pan,
  góc chúc và FOV ngang/dọc cùng quyết định vùng nhìn khi tính DORI và tối ưu.
- **Điểm đánh giá trên người:** chọn mặt, ngực hoặc thắt lưng trong Inspector để tính heatmap
  và tối ưu camera. Cửa sổ của hình người luôn hiển thị riêng DORI theo bốn vùng cơ thể.
- **Vùng trọng yếu:** mỗi POS/cửa mặc định có `(Wmax=5, r0=1 m, R=2.5 m)`; mỗi kệ có
  `(Wmax=3, r0=1 m, R=2 m)`. Chọn vật thể để chỉnh ba giá trị này trong Inspector. W giữ ở
  Wmax tới r0 rồi giảm tuyến tính về 1 tại R; nếu nhiều vùng chồng nhau, lấy W lớn nhất.
  Màu chỉ gom để hiển thị (Đỏ `W≥4`, Vàng `2≤W<4`, Xanh `W<2`), còn Greedy dùng W số thực.
  W biểu thị mức ưu tiên thiết kế, không phải xác suất xảy ra trộm.
  Cọ thủ công vẫn dùng mức 5/3/1 và ghi đè lên vùng tự động; nét vẽ sau cùng được ưu tiên.
  Có thể chỉnh kích thước ô trong Inspector; nên chọn `gridM ≤ (R-r0)/3` để lấy mẫu vùng
  chuyển tiếp đủ mịn (ví dụ vùng kệ mặc định khuyến nghị lưới không quá khoảng 0,33 m).
  Với kệ, chọn nhóm hàng **CRAVED cao** (Wmax 4.5), **thông thường** (3.0) hoặc
  **cồng kềnh** (1.8); có thể chọn **Tùy chỉnh** hoặc sửa Wmax trực tiếp. Đây là trọng số
  khởi tạo để ưu tiên bố trí, không phải xác suất/mức trộm cắp đã hiệu chuẩn. CRAVED giúp
  phân nhóm theo thuộc tính sản phẩm; dữ liệu tổn thất và kiểm kê tại cửa hàng mới nên được
  dùng để tinh chỉnh các giá trị.

### Ảnh nền và tỷ lệ

Nạp ảnh mặt bằng, chọn công cụ **Đo (m)** và kéo một đoạn có chiều dài thực đã biết.
Nhập chiều dài thực để hiệu chuẩn bề ngang ảnh. Điều khiển `px / m` chỉnh tỷ lệ hiển thị
của sơ đồ, không làm thay đổi kích thước phòng tính bằng mét.

### Phím tắt

| Phím | Tác vụ |
|---|---|
| `O` | Auto-Optimize |
| `B` | Mở/đóng BOM |
| `G` | Bật/tắt lưới |
| `A` | Bật/tắt điểm neo |
| `C` | Thêm camera |
| `R` | Xoay đối tượng đang chọn 15° |
| `Delete` / `Backspace` | Xóa đối tượng đang chọn |
| `1`–`8` | Chọn layout mẫu |
| `Alt` + cuộn chuột | Xoay đối tượng đang chọn 15° |

## Bố trí camera trần trong 3D

1. Đặt **Chiều cao trần (m)** trong bảng **Trần nhà & vị trí lắp**; mặc định 3,2 m,
   phạm vi 2,4–6 m. Nếu có vật thể cao hơn trần mới hoặc camera bị vướng, ứng dụng yêu cầu
   chỉnh vật thể/vị trí trước. Thay chiều cao trần cập nhật các camera theo kiểu lắp của chúng.
2. Chuyển **3D**, chọn **Camera trần**, rồi nhấp vào lưới để lắp. Vị trí cần nằm trong
   đường bao, có khoảng trống với tường và vật thể cao. Không thể đặt trùng camera đã có.
3. Chọn camera để sửa kiểu lắp, pan, góc chúc và khoảng hạ từ trần trong bảng thông tin.
   Khoảng hạ 0,15–1 m, đồng thời giữ ống kính cao ít nhất 1,8 m. Đổi camera tường sang
   camera trần sẽ chọn vị trí hợp lệ trong phòng nếu điểm tường cũ không phù hợp.
4. Chọn **Di chuyển vật thể**, kéo camera trần đến vị trí mới rồi thả để áp dụng. Bật/tắt
   **Lưới trần** khi cần tham chiếu; `Esc` kết thúc đặt hoặc hủy thao tác kéo đang diễn ra.
5. Chọn **Xem từ camera** hoặc nhấp đúp camera để xem POV. Tổng thể ẩn trần, POV hiện trần.
   **Vùng quan sát** chỉ hiện các bề mặt camera nhìn thấy, còn phần khuất là màu đen;
   chế độ này tạm dừng công cụ chỉnh sửa trên mô hình.

Ảnh POV và Vùng quan sát mô phỏng pixel theo PPM, tự điều chỉnh theo độ phân giải,
FOV, khoảng cách và mức phóng đại trên màn hình. Không có thanh chọn độ mờ.
Lớp DORI/KPI lấy mẫu tại độ cao mục tiêu. Người trong mô hình che khuất ở phần hình ảnh 3D;
hiện chưa ảnh hưởng heatmap/KPI hoặc phương án tối ưu, và chưa mô phỏng hướng mặt.

## Lưu ý về dữ liệu

- Import/Export JSON trên UI xử lý layout/bundle trong trình duyệt; dữ liệu không tự gửi
  lên backend để lưu.
- API backend Save/Load, BOM CSV/XLSX và project import/export được mô tả tại
  [API_CONTRACT.md](API_CONTRACT.md), hiện cần gọi qua Swagger UI hoặc HTTP client.
- BOM là ước tính theo giả định tuyến cáp Manhattan; cần khảo sát công trình trước khi đặt mua.
- FOV vẽ trên Canvas được giới hạn bán kính hiển thị 6 m để dễ quan sát; phép tính sử dụng
  tầm xa camera đã cấu hình.
