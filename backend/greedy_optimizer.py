import math
from shapely.geometry import Point, Polygon, LineString, box

class OptiCamGreedy:
    def __init__(self, room_width, room_length, obstacles_data):
        self.room_width = room_width
        self.room_length = room_length
        # Chuyển đổi tọa độ vật cản từ JSON thành đa giác (Polygon) trong không gian
        self.obstacles = [
            box(obs['start_x'], obs['start_y'], obs['end_x'], obs['end_y']) 
            for obs in obstacles_data
        ]
        
    def generate_grid(self, cell_size=0.5):
        """Lưới hóa mặt bằng thành các điểm (Grid points) cách nhau 0.5m"""
        grid_points = []
        x = cell_size / 2
        while x < self.room_width:
            y = cell_size / 2
            while y < self.room_length:
                pt = Point(x, y)
                # Bỏ qua các điểm lưới nằm lọt thỏm bên trong tường/cột
                if not any(obs.contains(pt) for obs in self.obstacles):
                    grid_points.append(pt)
                y += cell_size
            x += cell_size
        return grid_points

    def get_covered_points(self, cam_x, cam_y, radius, grid_points):
        """Thuật toán Ray-Casting: Xác định vùng phủ và điểm mù do vật cản"""
        cam_point = Point(cam_x, cam_y)
        covered = set()
        
        for i, pt in enumerate(grid_points):
            # 1. Lọc giới hạn: Điểm nằm ngoài bán kính (DORI) sẽ bỏ qua
            if cam_point.distance(pt) > radius:
                continue
            
            # 2. Ray-casting: Kẻ đường thẳng (tia nhìn) từ camera tới điểm mục tiêu
            line_of_sight = LineString([cam_point, pt])
            
            # 3. Quét va chạm: Nếu tia cắt ngang bất kỳ vật cản nào -> Điểm mù
            is_blocked = any(line_of_sight.intersects(obs) for obs in self.obstacles)
            if not is_blocked:
                covered.add(i) # Lưu vị trí điểm được chiếu sáng
                
        return covered

    def run_greedy(self, camera_candidates, radius, target_coverage=0.95):
        """Vòng lặp Tham Lam (Greedy) chọn vị trí tối ưu"""
        grid_points = self.generate_grid()
        total_points = len(grid_points)
        uncovered_indices = set(range(total_points))
        selected_cameras = []
        
        print(f"Bắt đầu phân tích: Tổng không gian = {total_points} ô lưới")
        
        # Lặp cho đến khi tỷ lệ ô chưa phủ nhỏ hơn mức cho phép (VD: < 5%)
        while len(uncovered_indices) / total_points > (1 - target_coverage):
            best_cam = None
            best_cover = set()
            
            # Chạy thử mọi vị trí tiềm năng
            for cam in camera_candidates:
                if cam in selected_cameras:
                    continue
                    
                covered = self.get_covered_points(cam[0], cam[1], radius, grid_points)
                # Chỉ lấy số lượng ô MỚI chưa từng được các camera trước đó phủ
                new_coverage = covered.intersection(uncovered_indices)
                
                if len(new_coverage) > len(best_cover):
                    best_cover = new_coverage
                    best_cam = cam
            
            if not best_cam or len(best_cover) == 0:
                print("Cảnh báo: Không thể tối ưu thêm do góc mù quá lớn!")
                break
                
            selected_cameras.append(best_cam)
            uncovered_indices -= best_cover
            
            current_coverage_percent = (1 - len(uncovered_indices)/total_points) * 100
            print(f"-> Đặt camera tại {best_cam}. Độ phủ toàn phòng: {current_coverage_percent:.2f}%")
            
        return selected_cameras

# --- BƯỚC TEST LOCAL CHO BẠN TRƯỚC KHI ĐẨY CODE ---
if __name__ == "__main__":
    # Giả lập file layout_v1.json của Gia Bảo
    mock_obstacles = [
        {"id": "wall_1", "start_x": 4.0, "start_y": 0.0, "end_x": 4.5, "end_y": 6.0}
    ]
    # Giả lập vị trí các ổ điện/góc tường có thể lắp camera
    candidates = [(0, 0), (10, 0), (0, 10), (10, 10), (5, 5)]
    
    # Chạy hệ thống trên phòng 10x10m, tầm nhìn camera 8m
    optimizer = OptiCamGreedy(room_width=10.0, room_length=10.0, obstacles_data=mock_obstacles)
    final_layout = optimizer.run_greedy(camera_candidates=candidates, radius=8.0, target_coverage=0.95)
    
    print(f"\nKết quả cuối cùng: Cần {len(final_layout)} camera tại các tọa độ: {final_layout}")