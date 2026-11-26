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

- [Tổng quan toàn dự án (Project Overview)](PROJECT_OVERVIEW.md) — kiến trúc, thuật toán `kpi_hybrid` + 2 cao độ `1.6 m / 1.0 m`, 18 mặt bằng và bằng chứng thực nghiệm.
- [Tài liệu trích dẫn (References)](REFERENCES.md) — chuẩn IEC 62676-4 và danh mục bài báo khoa học đối chứng.
- [Hướng dẫn người dùng](docs/USER_GUIDE.md) — quy trình 2 bước (`Mặt bằng` → `Kết quả`), 18 mẫu cửa hàng, cảnh báo khuất 1.0 m và xuất dữ liệu.
- [Kiến trúc dự án](docs/ARCHITECTURE.md) — cấu trúc file và luồng frontend/backend.
- [Mô hình và công thức](docs/FORMULAS.md) — PPM, DORI, kiểm tra 2 cao độ (`1.6 m + 1.0 m`), vùng rủi ro, `kpi_hybrid` và BOM.
- [Hợp đồng API](docs/API_CONTRACT.md) — endpoint, schema (`algorithm`, `dualHeight`), giới hạn và trạng thái tích hợp.
- [Nghiên cứu & Đánh giá khoa học (2026-11-26)](paper_evaluation_2026-11-26/COMPREHENSIVE_EVALUATION_OVERVIEW.md) — thí nghiệm Phase 1–4, MILP bounds và đối chứng `N = 50` cửa hàng.
- [Tóm tắt trình bày (Khách hàng / Giảng viên)](paper_evaluation_2026-11-26/PRESENTATION_ABSTRACT.md) — bản giải thích [cho khách hàng](paper_evaluation_2026-11-26/ABSTRACT_CUSTOMER.md) và [cho giảng viên hướng dẫn](paper_evaluation_2026-11-26/ABSTRACT_PROFESSOR.md).

## Cấu trúc cấp cao

```text
backend/                    FastAPI, Two-Stage kpi_hybrid optimizer, 62 API/retail tests
data_samples/               18 layout JSON mẫu (3 quốc tế + VN 01..VN 15 có người tĩnh)
docs/                       Tài liệu người dùng, kiến trúc, công thức, API, nghiên cứu
frontend/                   React/Konva 2.5D, Three.js 3D/POV, 255 unit/UI tests, experiments
legacy_pygame/              Prototype Pygame cũ, chỉ để tham khảo
paper_evaluation_2026-11-26/ Bộ thí nghiệm đánh giá khoa học Phase 1–4, MILP và báo cáo
results/                    CSV và báo cáo do experiments sinh ra
scripts/                    Công cụ tạo lại layout mẫu
```

## Trạng thái và giới hạn

- **Quy trình 2 bước (`Mặt bằng` → `Kết quả`):** hỗ trợ 18 mặt bằng cửa hàng Việt Nam & quốc tế có người tĩnh, Canvas 2.5D, 3D/POV, camera tường/trần, hộp thoại xác nhận trong ứng dụng khi đổi layout, lớp phủ DORI/rủi ro, và **cảnh báo khuất tầm thấp (`1.0 m`)** dạng gạch chéo vàng cam trên ô chỉ thấy mặt `1.6 m`.
- **Thuật toán mặc định `kpi_hybrid` (Two-Stage KPI + Local Search) & Tìm số camera tối thiểu theo từng `K`:** chạy đồng nhất trên cả Web Worker TypeScript (`Float32Array`) và FastAPI Python (`dualHeight` tùy chọn chia sẻ cùng phép cắt XY 2D), xuất BOM CSV và bundle JSON.
- **Giới hạn quang học:** chưa mô phỏng méo ống kính, ánh sáng yếu/ngược sáng, nén video, hướng mặt hay người di chuyển; người tĩnh che khuất trong atlas 3D nhưng chưa làm vật cản trong hàm mục tiêu 2D.
- Kết quả nghiên cứu và giới hạn được ghi trong [docs/RESEARCH.md](docs/RESEARCH.md) và [paper_evaluation_2026-11-26/COMPREHENSIVE_EVALUATION_OVERVIEW.md](paper_evaluation_2026-11-26/COMPREHENSIVE_EVALUATION_OVERVIEW.md).

## Chế độ 2.5D và 3D

Nút **2.5D / 3D** nằm phía trên sơ đồ. Hai chế độ dùng chung dữ liệu và lịch sử hoàn tác.
Trong 3D, chọn **Di chuyển vật thể** để kéo nội thất hoặc người trên sàn. Danh sách
nội thất cho phép thêm kệ, tủ mát, tủ đông, quầy thu ngân, quầy đồ ăn và bàn. Chọn vật
thể rồi dùng **Xoay 15°** hoặc **Xóa** trong bảng thông tin. Ở 2.5D, nút ↻ nằm cạnh vật
thể đang chọn cho phép xoay qua các vật thể khác để sắp xếp lại, giữ trong tường bao.

Kéo chuột trái ở chế độ **Xoay góc nhìn**, chuột phải để di chuyển và cuộn để thu phóng.
**Tường tự ẩn** mở góc nhìn vào cửa hàng, **Đặt lại
góc nhìn 3D** đưa mô hình về khung tổng thể.

Chọn **Xem từ camera**, nhấp đúp camera trên mô hình hoặc chọn camera trong bảng
thông tin để xem phối cảnh. Mặc định camera tường chúc xuống 20°, camera trần 45°; FOV dọc suy ra từ FOV
ngang theo tỷ lệ 16:9. Sửa hai giá trị này trong **Góc nhìn camera trong 3D** ở bảng
thuộc tính camera của 2.5D. Khung xem giữ đúng FOV và tỷ lệ khi đổi kích thước màn hình.
JSON và phương án tối ưu giữ lại các thông số này. **Tổng thể** quay về góc nhìn xoay tự do.
Trong POV và vùng quan sát, mật độ điểm ảnh được tính bằng PPM = độ phân giải ngang /
(2 × khoảng cách 3D × tan(FOV ngang/2)), dùng chung công thức với phân tích DORI.
Mô phỏng quy đổi kích thước một pixel camera (1/PPM mét) sang tỷ lệ hiển thị hiện tại.
Phóng lớn mô hình sẽ làm lộ các khối pixel, còn ảnh thu nhỏ của camera độ phân giải cao
có thể vẫn rõ. Các ngưỡng DORI của IEC 62676-4:2014 là 250 / 125 / 62,5 / 25 PPM.
Hiệu ứng là mô phỏng mật độ điểm ảnh, chưa xét ánh sáng, nén video hoặc méo ống kính.

Ở góc nhìn tổng thể 3D, bật **Vùng quan sát** để chỉ hiện những bề mặt mà ít nhất một
camera nhìn thấy. Các phần ngoài FOV, ngoài tầm nhìn hoặc bị tủ, kệ, tường và người che
khuất được thể hiện bằng màu đen. Mô phỏng xét cả góc chúc và FOV dọc, đồng thời chọn
hình ảnh rõ nhất khi nhiều camera nhìn cùng một vị trí. Có thể tiếp tục xoay và thu phóng
để quan sát. Tắt nút để bố trí nội thất trên mô hình đầy đủ.

Hiệu ứng hình ảnh mang tính minh họa. Bản đồ độ sâu được tái sử dụng khi xoay góc nhìn
và cập nhật khi đổi camera, nội thất hoặc người. Thiết bị cần hỗ trợ WebGL với bộ đệm
HDR để dùng hiệu ứng này. Kệ có hàng hóa dạng hộp, chai và lon dùng hình học đơn giản,
giới hạn số lượng để giảm chi phí dựng hình.

Ở bước **Camera** hoặc **Kết quả**, nhập số nguyên 1–20 vào **Số camera muốn bố trí**
rồi bấm **Tối ưu số camera đã nhập**. Có thể tiếp tục dùng tùy chọn tối ưu số camera hiện
có và giảm số camera theo KPI.

Mẫu **VN 05 · Cửa hàng giờ cao điểm** có bảy người ở quầy, lối kệ và khu hàng lạnh.
Nút **Thêm người** trong 3D đặt người vào vị trí trống. Người được lưu trong dự án JSON.

Góc nhìn 3D là mô phỏng hình học với nội thất giản lược. Heatmap và KPI DORI lấy mẫu
tại độ cao mục tiêu đã chọn; góc chúc và FOV dọc cũng được xét trong phân tích và tối ưu.
Xuất PNG tạo bản vẽ mặt bằng 2.5D.

## Camera trần và thuật toán bố trí

Trong **Trần nhà & vị trí lắp**, đặt chiều cao trần từ 2,4–6 m (mặc định 3,2 m).
Camera trần có khoảng hạ từ trần đến ống kính 0,15–1 m, giữ ống kính cao ít nhất 1,8 m.
Camera tường giữ khoảng trống phía trên 0,3 m. Chọn kiểu lắp trong thuộc tính camera;
đổi chiều cao trần tự cập nhật cao độ camera trần theo khoảng hạ đã lưu.

Ở 3D, bật **Lưới trần** để xem mặt phẳng lắp đặt; chọn **Camera trần** rồi nhấp lưới để
thêm camera. Chọn **Di chuyển vật thể** để kéo camera trần; `Esc` kết thúc chế độ đặt.
Tổng thể ẩn trần để dễ quan sát nội thất, còn POV hiện trần thật. Trần vẫn được tính vào
bản đồ độ sâu khi kiểm tra che khuất trong Vùng quan sát.

Bộ tối ưu cho phép **Tường + trần**, **Chỉ tường** hoặc **Chỉ trần**, và hai thuật toán:
**Greedy (đối chứng)** và **Greedy + Local Search** (mặc định). Cả hai dùng cùng tập ứng viên
vị trí/pan/tilt. Hybrid tạo phương án Greedy rồi thử thay từng camera trong tối đa ba lượt;
chỉ nhận thay đổi tăng điểm DORI có trọng số. Giao diện hiển thị điểm Greedy, điểm sau
cải thiện, số ứng viên và số lần thay camera thành công. Tập ứng viên được lấy mẫu hữu hạn
và giới hạn bộ nhớ; đây là heuristic, chưa chứng minh nghiệm tối ưu toàn cục.

Bộ đo tại [results/ceiling-optimization.csv](results/ceiling-optimization.csv) dùng tám mẫu,
cố định ba camera và chế độ tường + trần: Hybrid tăng điểm trên năm mẫu, bằng Greedy trên
ba mẫu, mức tăng lớn nhất khoảng 2,03%. Đây là kết quả của cấu hình và tập mẫu đã chạy,
không phải cam kết mức tăng cho mọi cửa hàng. Công thức và giới hạn được ghi tại
[docs/FORMULAS.md](docs/FORMULAS.md).

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
