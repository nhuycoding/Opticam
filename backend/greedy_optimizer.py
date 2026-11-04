import math
import time
from shapely.geometry import Point, LineString, box
from shapely.strtree import STRtree # <-- TỐI ƯU 1: Import R-Tree của Shapely

class OptiCamWeightedGreedy:
    def __init__(self, room_width, room_length, obstacles_data):
        self.room_width = room_width
        self.room_length = room_length
        self.obstacles = [
            box(obs['start_x'], obs['start_y'], obs['end_x'], obs['end_y']) 
            for obs in obstacles_data
        ]
        # TỐI ƯU 1: Xây dựng cây không gian STRtree cho vật cản để truy vấn siêu tốc
        self.obstacle_tree = STRtree(self.obstacles)
        
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
        if distance <= 2.0: return 4
        elif distance <= 4.0: return 3
        elif distance <= 6.0: return 2
        elif distance <= 8.0: return 1
        return 0

    def evaluate_camera_position(self, cam_x, cam_y, max_radius, grid_points):
        cam_point = Point(cam_x, cam_y)
        covered_info = {}
        
        for i, pt in enumerate(grid_points):
            dist = cam_point.distance(pt)
            if dist > max_radius:
                continue
                
            weight = self.get_dori_weight(dist)
            if weight == 0:
                continue
                
            line_of_sight = LineString([cam_point, pt])
            
            # TỐI ƯU 1: STRtree lọc trước các vật cản có khả năng chạm vào tia sáng
            possible_obs_indices = self.obstacle_tree.query(line_of_sight)
            is_blocked = False
            for obs_idx in possible_obs_indices:
                if line_of_sight.intersects(self.obstacles[obs_idx]):
                    is_blocked = True
                    break
            
            if not is_blocked:
                # Bỏ qua logic tính khoảng cách phạt góc mù phức tạp để ưu tiên tốc độ (Trade-off hiệu năng)
                covered_info[i] = weight
                
        return covered_info

    def run_optimized_greedy(self, camera_candidates, max_radius, target_coverage=0.95):
        start_time = time.time() # Bắt đầu bấm giờ
        grid_points = self.generate_grid()
        total_points = len(grid_points)
        
        print(f"Bắt đầu phân tích: {total_points} ô lưới.")
        print("Đang tiền xử lý (Caching) vùng phủ của các camera...")
        
        # TỐI ƯU 2: CACHING. Tính toán tia sáng 1 lần duy nhất cho toàn bộ camera
        precalculated_coverage = {}
        for cam in camera_candidates:
            precalculated_coverage[cam] = self.evaluate_camera_position(cam[0], cam[1], max_radius, grid_points)
            
        print(f"-> Tiền xử lý hoàn tất trong {time.time() - start_time:.3f}s. Vào vòng lặp Greedy:")
        
        grid_best_weights = {i: 0 for i in range(total_points)}
        selected_cameras = []
        
        while True:
            covered_count = sum(1 for w in grid_best_weights.values() if w > 0)
            if covered_count / total_points > target_coverage:
                break
                
            best_cam = None
            best_score_gain = 0
            best_cam_coverage = {}
            
            for cam in camera_candidates:
                if cam in selected_cameras:
                    continue
                    
                # Lấy dữ liệu từ Cache (O(1)) thay vì chạy lại hàm evaluate_camera_position
                cam_coverage = precalculated_coverage[cam]
                score_gain = 0
                
                for pt_idx, new_weight in cam_coverage.items():
                    current_weight = grid_best_weights[pt_idx]
                    if new_weight > current_weight:
                        score_gain += (new_weight - current_weight)
                        
                if score_gain > best_score_gain:
                    best_score_gain = score_gain
                    best_cam = cam
                    best_cam_coverage = cam_coverage
            
            if not best_cam or best_score_gain == 0:
                break
                
            selected_cameras.append(best_cam)
            for pt_idx, new_weight in best_cam_coverage.items():
                if new_weight > grid_best_weights[pt_idx]:
                    grid_best_weights[pt_idx] = new_weight
            
            current_coverage = (sum(1 for w in grid_best_weights.values() if w > 0) / total_points) * 100
            print(f"  + Chốt camera {best_cam} | Độ phủ: {current_coverage:.2f}%")
            
        total_time = time.time() - start_time
        print(f"\n[Hoàn thành] Tổng thời gian chạy thuật toán: {total_time:.4f} giây")
        return selected_cameras

if __name__ == "__main__":
    mock_obstacles = [
        {"id": "wall_1", "start_x": 4.0, "start_y": 0.0, "end_x": 4.5, "end_y": 6.0},
        {"id": "pillar", "start_x": 7.0, "start_y": 7.0, "end_x": 8.0, "end_y": 8.0}
    ]
    # Thêm nhiều điểm camera hơn để thấy rõ sức mạnh của bộ nhớ Cache
    candidates = [(0, 0), (10, 0), (0, 10), (10, 10), (5, 5), (0, 5), (5, 0), (10, 5), (5, 10)]
    
    optimizer = OptiCamWeightedGreedy(room_width=10.0, room_length=10.0, obstacles_data=mock_obstacles)
    final_layout = optimizer.run_optimized_greedy(camera_candidates=candidates, max_radius=8.0, target_coverage=0.95)
    
    print(f"Số lượng camera cần thiết: {len(final_layout)}")