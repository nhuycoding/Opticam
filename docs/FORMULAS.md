# Mô hình và công thức

Tài liệu này mô tả đúng các phép tính đang dùng trong frontend (`frontend/src/core/optics.ts`)
và backend (`backend/greedy_optimizer.py`). Mô hình lấy mẫu mục tiêu trên một mặt phẳng độ cao, xét góc nhìn và che khuất 3D
để hỗ trợ bố trí sơ bộ; không phải chứng nhận hiệu năng camera thực.

## 1. Lưới, tọa độ và vùng rủi ro

- Tọa độ mặt bằng tính bằng mét; gốc `(0, 0)` ở góc trên-trái, `x` tăng sang phải, `y`
  tăng xuống dưới.
- Với kích thước ô `g = gridM`, số cột `C = round(widthM / g)`, số hàng
  `R = round(heightM / g)`. Tâm ô `(r, c)`:

  ```text
  x_c = (c + 0.5) g
  y_r = (r + 0.5) g
  ```

- Khoảng cách từ tâm ô đến vật cản chữ nhật (kể cả hình chữ nhật xoay) được tính trong
  hệ tọa độ local của hình chữ nhật. Ô nằm trong kệ/POS là ô đặc và không được tính là
  sàn; cửa không tạo ô đặc.
- Mỗi vật thể có hồ sơ `(Wmax, r0, R)`. Mặc định POS/cửa là `(5, 1.0 m, 2.5 m)`.
  Thư viện nội thất gồm **13 phân loại** trong [`fixtures.ts`](../frontend/src/core/fixtures.ts) (`wall-shelf`, `gondola`, `endcap`, `promo-island`, `checkout-rack`, `locked-cabinet`, `fridge`, `freezer`, `food-counter`, `seating`, `locker`, `partition`, `column`), cùng `pos` và `entrance`.
- Mô hình **CRAVED theo tầng kệ** ([`craved.ts`](../frontend/src/core/craved.ts)): kệ hàng hóa hỗ trợ các tầng xếp lớp `tiers?: ShelfTier[]` (`zMin–zMax`, `categoryId` từ **16 nhóm hàng CRAVED** hoặc `wmax` riêng). Khi thay đổi tầng hoặc nhóm hàng, hệ thống tự tổng hợp mức rủi ro cao nhất của kệ: `riskWmax = max_tier(wmax)` và suy ra `riskCategory` (`high` khi `W >= 4.0`, `standard` khi `2.3 <= W < 4.0`, `bulky` khi `W < 2.3`).
- Kệ thông thường dùng `(3, 1.0 m, 2.0 m)`; nhóm CRAVED cao mặc định `Wmax = 4.5` (hoặc theo nhóm hàng như mỹ phẩm `4.8`, rượu ngoại `4.6`), nhóm cồng kềnh `Wmax = 1.8`, cùng `r0 = 1.0 m`, `R = 2.0 m`:

  ```text
  t = clamp((d - r0) / (R - r0), 0, 1)
  W_object(d) = 1 + (Wmax - 1) × (1 - t)
  W_auto = max(1, W_object_1, ..., W_object_n)
  ```

  Trọng số giữ ở `Wmax` trong bán kính lõi `r0`, giảm tuyến tính về 1 tại `R`, và không
  cộng dồn giữa vật thể. Khi người dùng chỉnh trực tiếp `Wmax` trên kệ không đồng bộ tầng,
  nhóm được đánh dấu `custom`.
- Điểm CRAVED 6 trục (`concealable`, `removable`, `available`, `valuable`, `enjoyable`,
  `disposable`) được dùng để phân nhóm hàng khởi tạo (`GOODS_CATALOG`), hiển thị hình khối
  hàng hóa (`ItemShape`) và gắn cảnh báo cho tầng thấp `zMin <= 1.0 m`. Các `Wmax` là
  giả định thiết kế phục vụ ưu tiên quan sát, cần hiệu chỉnh thêm theo dữ liệu kiểm kê thực tế
  của cửa hàng.
- Cọ rủi ro ghi các nét hình tròn `(x, y, radius, W)` theo mét. Mọi nét có tâm nằm trong
  bán kính đều áp dụng; nét sau cùng khớp với ô sẽ ghi đè nét trước và công thức tự động.
  Vì lưu theo tọa độ thực, thay đổi lưới không làm nét cọ lệch vị trí. Layout cũ vẫn đọc
  được map `risk` theo chỉ số ô; dữ liệu mới dùng `riskStrokes`.
- Trọng số là số thực trong `[1, 5]`. Ba màu chỉ là nhóm hiển thị: Đỏ `W ≥ 4`, Vàng
  `2 ≤ W < 4`, Xanh `W < 2`. Tối ưu hóa dùng W liên tục, không làm tròn theo màu.

## 2. Kiểu lắp, góc pan/tilt và FOV 3D

- `mount = wall | ceiling`; file cũ thiếu `mount` được hiểu là camera tường.
- `ceilingHeight` mặc định 3,2 m, phạm vi 2,4–6 m. Camera tường có cao độ ống kính
  từ 1,8 m tới `ceilingHeight - 0.3 m`. Camera trần dùng
  `height = ceilingHeight - ceilingDrop`, với `ceilingDrop` trong 0,15–1 m, đồng thời
  giữ ống kính cao ít nhất 1,8 m.
- Pan 0° hướng +X trên mặt bằng, tăng theo hướng +Y. Tilt là góc chúc xuống từ phương
  ngang, phạm vi 0–90°; mặc định tường 20°, trần 45°. Góc pan khi kéo tay cầm được snap
  15°; tập ứng viên tối ưu mặc định dùng bước pan 30°.
- `fov` và `vfov` là góc mở toàn phần ngang và dọc. Nếu thiếu `vfov`, suy ra từ cảm biến
  tỷ lệ 16:9: `vfov = 2 atan(tan(fov/2) / (16/9))`.

Với sai khác tọa độ tới mục tiêu `(dx, dy, dz)`, trong đó
`dz = Z_target - H_camera`, đổi pan `p`, tilt `t` và FOV sang radian:

```text
along = dx cos(p) + dy sin(p)
depth = along cos(t) - dz sin(t)
right = -dx sin(p) + dy cos(p)
up    = along sin(t) + dz cos(t)
r     = √(dx² + dy² + dz²)
```

Mục tiêu thuộc vùng nhìn khi đồng thời thỏa mãn:

```text
0.03 m ≤ r ≤ range
depth > 0
|right| ≤ depth tan(fov/2)
|up|    ≤ depth tan(vfov/2)
```

Đây là phép chiếu trong hệ trục camera, áp dụng được cả khi camera trần chúc thẳng
xuống 90°. `range` là khoảng cách 3D xuyên tâm, không phải khoảng cách trên sàn.
Frontend, backend và camera phối cảnh 3D sử dụng cùng quy ước pan/tilt/FOV.

## 3. PPM và che khuất

Với độ phân giải ngang `Res`, FOV ngang và khoảng cách 3D `r` ở trên:

```text
PPM = Res / (2 r tan(FOV / 2))
```

PPM bằng 0 nếu không thỏa vùng nhìn, tia đi qua phần ngoài đường bao đa giác cửa hàng,
hoặc tia cắt vật cản. Tia nhìn nội suy độ cao từ camera tới điểm đánh giá; kệ/POS chắn
khi tia đi qua phần có độ cao không lớn hơn `elev`. Cửa không chắn tia. Chọn mặt 1,6 m,
ngực 1,2 m hoặc thắt lưng 0,9 m làm độ cao lấy mẫu heatmap/KPI và hàm mục tiêu.
Hình người có bảng đánh giá riêng tại mặt, ngực, bụng và chân.

Ví dụ tại điểm mặt: `Res = 2560`, `FOV = 85°`, camera cao `2.4 m`, điểm cách ngang `5 m`:
`r = √(5² + 0.8²) ≈ 5.06 m`, suy ra `PPM ≈ 296` nếu điểm nằm trong FOV và không bị khuất.

PPM này là mật độ ngang danh nghĩa, chưa hiệu chỉnh theo hướng mặt/bề mặt, ánh sáng,
nén video hoặc méo ống kính. Nhìn rõ mặt sàn hoặc đỉnh đầu không chứng minh nhận diện
được khuôn mặt. Phân tích lưới dùng vật cản dạng thể tích hộp xoay; người chưa được đưa
vào tính che khuất của heatmap/KPI và tối ưu. Trong Vùng quan sát 3D, shader dùng hình học
thực của mô hình, gồm người tĩnh và hàng trên kệ, nên ranh giới có thể khác phép lấy mẫu lưới.

Trong POV và Vùng quan sát, kích thước pixel camera `1/PPM` mét được quy đổi sang kích
thước hiển thị. Vùng nhiều camera nhìn thấy chọn PPM cao nhất. Bộ đệm độ sâu kiểm tra
bề mặt khuất, gồm cả tường tự ẩn và trần; phần chưa quan sát được là màu đen.
Camera tường trên mô hình có gá đưa ống kính vào phòng để tránh lún tường, nên tọa độ
ống kính hiển thị có thể lệch nhẹ điểm neo phân tích; camera trần dùng đúng tâm quang học
đã lưu tại `(x, y, height)`.

## 4. Phân lớp DORI và điểm

PPM được ánh xạ thành một mức:

| PPM | Mức | Hệ số `F` |
|---:|---|---:|
| `≥ 250` | Identification | 1.00 |
| `125–<250` | Recognition | 0.75 |
| `62,5–<125` | Observation | 0.40 |
| `25–<62,5` | Detection | 0.20 |
| `< 25` | Blind | 0.00 |

Khi có nhiều camera, ô dùng PPM tốt nhất:

```text
PPM_cell = max(PPM_cam(cell))
DORI_cell = DORI(PPM_cell)
```

Điểm có trọng số trên lưới frontend:

```text
Score = Σ_cell W_cell × F(DORI_cell)
```

Scorecard hiển thị thêm KPI:

```text
Red %    = 100 × số ô W≥4 có PPM≥250 / tổng số ô W≥4
Yellow % = 100 × số ô 2≤W<4 có PPM≥125 / tổng số ô 2≤W<4
```

Scorecard cũng hiển thị PPM thấp nhất trong các ô vùng Đỏ. Nếu một nhóm không có ô nào,
phần trăm nhóm đó được xem là 100%.

## 5. Greedy, Greedy + Local Search và kpi_hybrid

Thiết lập `optimization` gồm `algorithm: greedy | hybrid | kpi_hybrid` và
`mounts: wall | mixed | ceiling`, mặc định `kpi_hybrid` và `mixed` cùng `dualHeight`
(mặc định bật `true` trên giao diện thiết lập mới). Các thuật toán dùng chính xác cùng tập
ứng viên của một lần giải và cùng profile camera.

### Tập ứng viên hữu hạn

- Điểm tường đi dọc đường bao thật, bước neo ban đầu `max(gridM, 0.5 m)`.
- Điểm trần lấy trên lưới nội thất có bước mục tiêu ít nhất 1 m; điểm ngoài polygon,
  sát biên hoặc vướng vật thể cao được loại bỏ. Cao độ trần lấy từ chiều cao trần trừ
  khoảng hạ của profile. Camera tường giữ khoảng trống 0,3 m dưới trần.
- Pan mặc định `0°, 30°, ..., 330°`. Tilt tường thử góc profile (mặc định 20°) và hai góc
  lệch ±15°, giới hạn 0–90°. Tilt trần thử `35°, 55°, 75°, 90°` và góc profile nếu có.
- Giữ FOV, độ phân giải, tầm xa, model, FOV dọc và khoảng hạ theo từng profile. Kiểu lắp,
  vị trí, pan và tilt được chọn theo tập ứng viên; kiểu lắp profile không khóa phạm vi
  tìm kiếm, phạm vi do `optimization.mounts` quyết định.
- Các profile quang học giống nhau dùng chung bộ PPM đã tính. Tổng ngân sách mặc định
  là 1.500.000 giá trị ứng viên–ô và tối đa 12.000 cấu hình ứng viên trên các profile khác
  nhau. Khi vượt giới hạn, tăng bước vị trí gấp đôi; nếu vẫn quá lớn, lấy mẫu đều trong
  danh sách cấu hình. Sau đó loại ứng viên không nhìn thấy ô trống nào.

Giới hạn này giữ bộ tính hữu hạn; lấy mẫu thưa có thể bỏ qua vị trí tốt giữa các điểm.
Frontend/backend có thể khác nhẹ về làm tròn PPM và cách lấy neo, nên không cam kết cùng
một vị trí khi điểm các phương án gần bằng nhau.

### Bước Greedy

Với PPM tốt nhất hiện có `PPM_best` trên từng ô, phần điểm tăng của ứng viên `c`:

```text
Gain(c) = Σ_cell W_cell × [F(max(PPM_c, PPM_best)) - F(PPM_best)]
```

Mỗi bước chọn ứng viên tăng điểm nhiều nhất cho profile đang xét. Khi điểm bằng nhau,
ưu tiên tổng tăng PPM có trọng số, chặn PPM tại 250 để phá hòa. Không chọn trùng cấu hình
kiểu lắp/vị trí/pan/tilt/cao độ. Profile không có ứng viên hợp lệ được bỏ qua; kết quả có
thể ít camera hơn ngân sách khi không còn cấu hình khả dụng.

### Bước Local Search của Hybrid

Bắt đầu từ chính phương án Greedy. Lần lượt bỏ tạm một camera, giữ các camera khác và
thử thay bằng ứng viên thuộc profile của camera đó. Chỉ nhận thay đổi làm **tăng nghiêm
ngặt điểm DORI có trọng số**, với sai số so sánh `1e-9`. Thực hiện tối đa ba lượt qua các
camera, dừng sớm nếu một lượt không có thay đổi cải thiện. Số lần thay thành công được
trả ở `iterations`; đây không phải số lượt duyệt.

Vì chỉ chấp nhận cải thiện, điểm Hybrid không thấp hơn điểm Greedy khởi tạo trên cùng
tập ứng viên. Tuy nhiên cả hai là heuristic trên không gian lấy mẫu; giới hạn ba lượt
không bảo đảm đã tới tối ưu cục bộ, và không chứng minh tối ưu toàn cục.

`diagnostics` trả `algorithm`, `greedyScore`, `finalScore`, `iterations`, `candidateCount`
và `ms`. Điểm ở đây là tổng DORI có trọng số chưa làm tròn, không phải phần trăm diện tích.
KPI/Scorecard có thể không đổi dù điểm tổng tăng.

Bộ đo [ceiling-optimization.csv](../results/ceiling-optimization.csv) trên tám preset,
cố định `K=3`, mặc định tường + trần: năm mẫu tăng điểm, ba mẫu bằng Greedy; mức tăng
lớn nhất khoảng 2,03%. Thời gian trong CSV là của lần chạy tại máy phát triển, không
phải cam kết trên thiết bị khác. VN 02 và VN 05 có cùng bài toán phân tích vì người chưa
tham gia hàm mục tiêu. Kết quả không suy rộng thành mức cải thiện cho mọi mặt bằng.

### Thuật toán mặc định `kpi_hybrid` & Chấm điểm phân bậc 2 cao độ (`1.6 m + 1.0 m`)

1. **Two-Stage KPI + Local Search (`kpi_hybrid`):**
   - Giai đoạn 1 (`slot < max(1, ceil(0.67 * K))` khi `Red% < 95%`): tối đa hóa `ΔRed × (Σ W_j / max(1, |Red|)) + 0.1 × ΔW` để khóa sớm nhận dạng khuôn mặt vùng POS/cửa.
   - Giai đoạn 2 và tối đa 3 vòng Local Search 1-swap: tối ưu `ΔWeighted + (H(base) - H(base ∪ c))` với hệ số phạt hinge `λ_Red = 1.5`, `λ_Yel = 0.75` và (khi `dualHeight = true`) **`λ_Hand = 0.50`** cho phần thiếu hụt dưới mục tiêu **`handTargetPct = 80%`**.

2. **Cơ chế phân bậc 2 cao độ (`DUAL_HEIGHT_SCORING`, `optics.ts` / `greedy_optimizer.py`):**
   - `evaluate()` luôn tính song song `facePpm` tại `targetHeight` (`1.6 m`) và `handPpm` tại `handHeight = min(targetHeight, 1.0 m)` trong cùng vòng cắt XY 2D (`dualPpmAt`), đồng thời đếm ô chỉ thấy đầu `headOnly` (`facePpm >= 25` và `handPpm < 25`) và tính KPI **`handCoverage`** (`%` ô trống đạt `handPpm >= 62.5 PPM`, ngưỡng Quan sát DORI).
   - Khi bật `dualHeight = true`, thay cho ngưỡng cắt nhị phân cũ (gây sụt KPI từ `17/18` xuống `8/18` cửa hàng), hệ thống chỉ áp dụng giảm điểm có trọng số tại các ô ưu tiên **`W >= 3.0`** (`minWeightForHandCheck`):

   ```text
   M_hand(h):
     h >= 125.0 PPM  -> 1.00
     h >=  62.5 PPM  -> 0.85
     h >=  25.0 PPM  -> 0.50
     h <   25.0 PPM  -> 0.00

   Nếu W < 3.0 hoặc dualHeight = false:
     factor = F(facePpm)
   Nếu W >= 4.0 (Vùng Đỏ):
     factor = 0.65 × F(facePpm) + 0.35 × min(F(facePpm), F(facePpm) × M_hand(handPpm))
   Nếu 3.0 <= W < 4.0 (Kệ/Vùng Vàng trọng số cao):
     factor = 0.80 × F(facePpm) + 0.20 × min(F(facePpm), F(facePpm) × M_hand(handPpm))
   ```

   - **Chỉ số Đỏ (`>= 250 PPM`) & Vàng (`>= 125 PPM`):** đánh giá theo `facePpm` (`1.6 m`) nên không đánh rớt oan khi quầy POS cao `1.1 m` che tầm thấp sát chân quầy; trong khi **`handCoverage`** đo riêng độ phủ tầm tay `1.0 m >= 62.5 PPM` (mục tiêu `80%`).
   - Kết quả tinh chỉnh trên **18 mặt bằng mẫu**: đạt KPI **`17/18` (`94.4%`)** (so với **`8/18` = `44.4%`** ở mô hình nhị phân cũ), đẩy độ phủ tay vùng Đỏ lên **`98.7%`** và giảm **`44%`** ô chỉ thấy đầu (`11.8% → 6.6%`).

3. **Giảm số camera theo KPI vùng rủi ro (`minimumCamerasForTargets`):**

Tái sử dụng một lượt raycast ứng viên duy nhất rồi giải độc lập từng mức `count = 1..M` cho tới khi đạt đồng thời:

```text
Đỏ:   tỷ lệ ô có PPM (1.6 m) ≥ 250 ≥ 95%
Vàng: tỷ lệ ô có PPM (1.6 m) ≥ 125 ≥ 80%
```

Nếu phương án đủ ngân sách vẫn chưa đạt KPI, giữ phương án đó và báo tỷ lệ thực tế. Cờ
`target_coverage_reached` của API tối ưu vị trí lại dùng ngưỡng 95% ô trống đạt Detection;
không đồng nghĩa đạt KPI Đỏ/Vàng của giao diện.

## 6. BOM — chiều dài cáp ước tính

NVR được giả định đặt tại tâm POS; nếu không có POS, dùng `(0, 0)`. Với camera `i` tại
`(x_i, y_i)`, NVR tại `(x_N, y_N)`, chiều cao camera `H_i`:

```text
Cable_i = ceil(1.1 × (|x_i - x_N| + |y_i - y_N| + H_i + 3 m))
Cable_total = Σ_i Cable_i
Cost_total = N_camera × 1.250.000 VNĐ + 1.500.000 VNĐ (hạ tầng, nếu có camera)
```

Đây là ước lượng Manhattan cộng 3 m dư/thả cáp và 10% hao hụt; không theo tuyến ống/cáp
thực tế. Đơn giá được khai báo cố định trong mã, không phải báo giá nhà cung cấp.
