import math
from shapely.geometry import Point, LineString, box

class OptiCamWeightedGreedy:
    def __init__(self, room_width, room_length, obstacles_data):
        self.room_width = room_width
        self.room_length = room_length
        self.obstacles = [
            box(obs['start_x'], obs['start_y'], obs['end_x'], obs['end_y']) 
            for obs in obstacles_data
        ]
        
    def generate_grid(self, cell_size=0.5):
        grid_points = []
        x = cell_size / 2
        while x < self.room_width:
            y = cell_size / 2
            while y < self.room_length:
                pt = Point(x, y)
                if not any(obs.contains(pt) for obs in self.obstacles):
                    grid_points.append(pt)
                y += cell_size
            x += cell_size
        return grid_points

    def get_dori_weight(self, distance):
        """
        Tiêu chuẩn IEC 62676-4 DORI phân cấp trọng số theo khoảng cách:
        - Identification (Nhận diện mặt): < 2m -> Trọng số 4
        - Recognition (Nhận biết người quen): < 4m -> Trọng số 3
        - Observation (Quan sát hành vi): < 6m -> Trọng số 2
        - Detection (Phát hiện chuyển động): < 8m -> Trọng số 1
        """
        if distance <= 2.0: return 4
        elif distance <= 4.0: return 3
        elif distance <= 6.0: return 2
        elif distance <= 8.0: return 1
        return 0

    def evaluate_camera_position(self, cam_x, cam_y, max_radius, grid_points):
        """Ray-Casting kết hợp đánh giá điểm số (Weighted Score)"""
        cam_point = Point(cam_x, cam_y)
        covered_info = {} # Lưu {index_điểm: trọng_số}
        
        for i, pt in enumerate(grid_points):
            dist = cam_point.distance(pt)
            if dist > max_radius:
                continue
                
            weight = self.get_dori_weight(dist)
            if weight == 0:
                continue
                
            line_of_sight = LineString([cam_point, pt])
            is_blocked = any(line_of_sight.intersects(obs) for obs in self.obstacles)
            
            if not is_blocked:
                # Phạt trọng số nếu điểm đó nằm sát vách tường (điểm mù tiềm ẩn)
                distance_to_nearest_obs = min([pt.distance(obs) for obs in self.obstacles] + [99])
                if distance_to_nearest_obs < 0.5:
                    weight *= 0.8 # Giảm 20% giá trị nếu cách tường dưới 0.5m
                
                covered_info[i] = weight
                
        return covered_info

    def run_weighted_greedy(self, camera_candidates, max_radius, target_coverage=0.95):
        grid_points = self.generate_grid()
        total_points = len(grid_points)
        
        # Danh sách lưu điểm tốt nhất mỗi ô lưới đang nhận được
        # Khởi tạo toàn bộ bằng 0 (chưa phủ)
        grid_best_weights = {i: 0 for i in range(total_points)}
        selected_cameras = []
        
        print(f"Bắt đầu phân tích Weighted Greedy: Tổng không gian = {total_points} ô lưới")
        
        while True:
            # Tính % diện tích đã được phủ (những ô có trọng số > 0)
            covered_count = sum(1 for w in grid_best_weights.values() if w > 0)
            if covered_count / total_points > target_coverage:
                break
                
            best_cam = None
            best_score_gain = 0
            best_cam_coverage = {}
            
            for cam in camera_candidates:
                if cam in selected_cameras:
                    continue
                    
                cam_coverage = self.evaluate_camera_position(cam[0], cam[1], max_radius, grid_points)
                score_gain = 0
                
                # Chỉ cộng điểm cho phần giá trị "gia tăng" (Camera mới chiếu rõ hơn camera cũ)
                for pt_idx, new_weight in cam_coverage.items():
                    current_weight = grid_best_weights[pt_idx]
                    if new_weight > current_weight:
                        score_gain += (new_weight - current_weight)
                        
                if score_gain > best_score_gain:
                    best_score_gain = score_gain
                    best_cam = cam
                    best_cam_coverage = cam_coverage
            
            if not best_cam or best_score_gain == 0:
                print("Cảnh báo: Không thể tăng thêm độ phủ/chất lượng DORI!")
                break
                
            selected_cameras.append(best_cam)
            # Cập nhật lại bản đồ trọng số
            for pt_idx, new_weight in best_cam_coverage.items():
                if new_weight > grid_best_weights[pt_idx]:
                    grid_best_weights[pt_idx] = new_weight
            
            current_coverage_percent = (sum(1 for w in grid_best_weights.values() if w > 0) / total_points) * 100
            print(f"-> Đặt camera tại {best_cam} | Điểm chất lượng tăng: {best_score_gain:.1f} | Độ phủ: {current_coverage_percent:.2f}%")
            
        return selected_cameras

if __name__ == "__main__":
    mock_obstacles = [
        {"id": "wall_1", "start_x": 4.0, "start_y": 0.0, "end_x": 4.5, "end_y": 6.0}
    ]
    candidates = [(0, 0), (10, 0), (0, 10), (10, 10), (5, 5)]
    
    optimizer = OptiCamWeightedGreedy(room_width=10.0, room_length=10.0, obstacles_data=mock_obstacles)
    final_layout = optimizer.run_weighted_greedy(camera_candidates=candidates, max_radius=8.0, target_coverage=0.95)
    
    print(f"\nKết quả cuối cùng: Cần {len(final_layout)} camera tại các tọa độ: {final_layout}")