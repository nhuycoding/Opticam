# OptiCam-Retail

Ứng dụng web hỗ trợ dựng mặt bằng cửa hàng, đặt camera và đánh giá vùng quan sát theo
độ phân giải ảnh (PPM/DORI). Dự án gồm frontend React/Konva, backend FastAPI và bộ
thí nghiệm tái lập cho thuật toán bố trí camera. Chế độ 3D sử dụng Three.js và React Three Fiber.

## Bắt đầu nhanh

Yêu cầu: Node.js 22.12+ (Vite 8), npm và Python 3.10+.

### Chạy bằng cách nhấp đúp trên macOS

Mở thư mục dự án trong **Finder**, nhấp đúp **`start-web.command`**. File tự chuẩn bị
thư viện, chạy backend/frontend và mở <http://localhost:3000> khi cả hai đã sẵn sàng.
Lần đầu cần Internet để tải thư viện. Giữ cửa sổ Terminal vừa mở khi sử dụng;
nhấn **Control+C** trong cửa sổ đó để dừng cả hai server. Bạn không cần gõ lệnh khởi động.

### Chạy bằng một cú nhấp trên Windows

Nhấp đúp **`start-web.bat`** tại thư mục gốc dự án. File tự tạo môi trường Python
riêng trong `backend/.venv`, cài thư viện backend, cài thư viện frontend nếu chưa có,
khởi động cả hai server và tự mở <http://localhost:3000> trong trình duyệt.
Lần đầu cần Internet để tải thư viện. Giữ hai cửa sổ **OptiCam - Backend** và
**OptiCam - Frontend** mở khi sử dụng; đóng cả hai để dừng web. Nếu có lỗi,
cửa sổ sẽ giữ lại thông báo để bạn kiểm tra. File `.bat` dành cho Windows.

### Chạy thủ công

Mở hai terminal PowerShell tại thư mục `opticam_tong_hop` (thư mục chứa `backend`,
`frontend` và `data_samples`).

**Terminal 1 — backend**
```powershell
Set-Location .\backend
python -m pip install -r requirements-dev.txt
python -m uvicorn main:app --reload --port 8000
```

**Terminal 2 — frontend**
```powershell
Set-Location .\frontend
npm.cmd ci
npm.cmd run dev
```

Mở giao diện tại <http://localhost:3000>. Tài liệu API tương tác ở
<http://localhost:8000/docs>; kiểm tra backend tại <http://localhost:8000/api/v1/health>.
Hướng dẫn thao tác đầy đủ: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Kiểm thử

Chạy từ thư mục gốc:
```powershell
Set-Location .\frontend
npm.cmd test
npm.cmd run build
Set-Location ..
python -m pytest .\backend\tests -q
```

Chạy bộ thí nghiệm tái lập:
```powershell
Set-Location .\frontend
npm.cmd run experiments
```

## Tài liệu

- [Hướng dẫn người dùng](docs/USER_GUIDE.md) — công cụ trên Canvas, chỉnh camera, xuất dữ liệu.
- [Kiến trúc dự án](docs/ARCHITECTURE.md) — cấu trúc file và luồng frontend/backend.
- [Mô hình và công thức](docs/FORMULAS.md) — PPM, DORI, vùng rủi ro, mục tiêu Greedy và BOM.
- [Hợp đồng API](docs/API_CONTRACT.md) — endpoint, schema, giới hạn và trạng thái tích hợp.
- [Nghiên cứu và kết quả](docs/RESEARCH.md) — thiết kế thí nghiệm, số liệu và giới hạn nghiên cứu.

## Cấu trúc cấp cao

```text
backend/       FastAPI, optimizer, API tests, cấu hình dependencies
data_samples/  Bảy layout JSON mẫu, gồm bốn cửa hàng Việt Nam chi tiết
docs/          Tài liệu người dùng, kiến trúc, công thức, API, nghiên cứu
frontend/      React/Konva, Three.js, thuật toán client, unit tests, experiments
legacy_pygame/ Prototype Pygame cũ, chỉ để tham khảo
results/       CSV và báo cáo do experiments sinh ra
scripts/       Công cụ tạo lại layout mẫu
```

## Trạng thái và giới hạn

- Frontend có Canvas tương tác, heatmap DORI/rủi ro, Greedy cục bộ, hiệu chỉnh camera,
  BOM CSV và import/export bundle JSON.
- Backend có Greedy API, lưu/nạp layout, xuất BOM JSON/CSV/XLSX và project bundle.
  Các endpoint lưu/nạp và xuất báo cáo backend hiện chưa có nút gọi trực tiếp trên UI.
- Mô hình PPM/DORI là xấp xỉ 2D; chưa tính méo ống kính, tilt, ánh sáng, người/vật cản động.
- Kết quả nghiên cứu và các giả định định lượng được ghi trong [docs/RESEARCH.md](docs/RESEARCH.md);
  không xem tỷ lệ phủ mô phỏng là bảo đảm nhận diện thực tế.

## Chế độ 2.5D và 3D

Nút **2.5D / 3D** nằm phía trên sơ đồ. Chỉnh sửa mặt bằng và thông số ở 2.5D,
sau đó chuyển sang 3D để xem cùng dữ liệu. Kéo chuột trái để xoay, chuột phải để
di chuyển và cuộn để thu phóng. **Tường tự ẩn** mở góc nhìn vào cửa hàng, **Đặt lại
góc nhìn 3D** đưa mô hình về khung tổng thể.

Chọn **Xem từ camera**, nhấp đúp camera trên mô hình hoặc chọn camera trong bảng
thông tin để xem phối cảnh. Mặc định camera chúc xuống 20°, FOV dọc suy ra từ FOV
ngang theo tỷ lệ 16:9. Sửa hai giá trị này trong **Góc nhìn camera trong 3D** ở bảng
thuộc tính camera của 2.5D. Khung xem giữ đúng FOV và tỷ lệ khi đổi kích thước màn hình.
JSON và phương án tối ưu giữ lại các thông số này. **Tổng thể** quay về góc nhìn xoay tự do.

Góc nhìn 3D là mô phỏng hình học với nội thất giản lược. Heatmap và KPI DORI dùng
mô hình phân tích mặt bằng tại độ cao mục tiêu đã chọn. Góc chúc và FOV dọc phục vụ
xem phối cảnh. Xuất PNG tiếp tục tạo bản vẽ mặt bằng 2.5D.

## Bốn mặt bằng cửa hàng Việt Nam

Chọn VN 01–VN 04 trong danh sách mặt bằng ở đầu giao diện. Các mẫu có camera được bố trí
sẵn theo khu vực phụ trách, kệ một mặt sát tường, kệ đảo thấp, tủ mát, tủ đông, quầy thu
ngân và quầy đồ nóng. Nút **Thêm kệ một mặt sát tường** tạo kệ gắn theo đường bao phòng.

| Mẫu | Dạng mặt bằng | Diện tích | Camera tham khảo |
| --- | --- | --- | --- |
| VN 01 | Nhà ống 4,8 × 15 m | 72 m² | 4 |
| VN 02 | Góc phố hai mặt tiền vát góc, khung 10 × 8 m | 78 m² | 5 |
| VN 03 | Chữ L trong khung 10 × 9 m | 70 m² | 5 |
| VN 04 | Hình thang trong khung 9 × 9 m | 67,5 m² | 4 |

Đường bao đa giác được sử dụng để tính diện tích, loại vùng ngoài cửa hàng khỏi thống kê,
chặn đường ngắm xuyên khoảng khuyết và tạo điểm gắn camera dọc các cạnh thực. JSON nhập
xuất giữ lại đường bao và loại nội thất. Mũi tên đứt nét là lối mua sắm dự kiến của mẫu,
được bỏ khi thay đổi bố cục vật thể để tránh giữ chỉ dẫn đã cũ.

Đây là các mặt bằng mô phỏng. Cách chia khu hàng lạnh, đồ nóng và chỗ ngồi tham khảo
[dịch vụ Circle K Việt Nam](https://www.circlek.com.vn/en/store-locator-2/).
Vai trò camera tại cửa vào, thu ngân và khu hàng tham khảo
[hướng dẫn camera cửa hàng của FPT](https://fpt.vn/tin-tuc/lap-dat-camera-cua-hang-10139.html).
Kích thước, số camera và góc đặt do dự án thiết kế cho từng mẫu.
