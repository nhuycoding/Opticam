from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Any
from greedy_optimizer import OptiCamWeightedGreedy

app = FastAPI(title="OptiCam API", description="API tối ưu hóa vị trí Camera cho team Ngũ Vị Hương")

# Định nghĩa cấu trúc JSON mà Frontend của Gia Bảo sẽ gửi lên
class LayoutRequest(BaseModel):
    room_width: float
    room_length: float
    obstacles: List[Dict[str, Any]]
    camera_candidates: List[List[float]] # VD: [[0, 0], [10, 0]]
    max_radius: float
    target_coverage: float = 0.95

@app.post("/api/optimize")
def optimize_layout(request: LayoutRequest):
    # 1. Khởi tạo class thuật toán bạn đã viết hôm qua
    optimizer = OptiCamWeightedGreedy(
        room_width=request.room_width,
        room_length=request.room_length,
        obstacles_data=request.obstacles
    )
    
    # 2. Định dạng lại danh sách tọa độ
    candidates = [(c[0], c[1]) for c in request.camera_candidates]
    
    # 3. Chạy thuật toán tối ưu (có dùng Caching và STRtree)
    final_layout = optimizer.run_optimized_greedy(
        camera_candidates=candidates,
        max_radius=request.max_radius,
        target_coverage=request.target_coverage
    )
    
    # 4. Trả kết quả về cho Frontend vẽ lên web
    return {
        "status": "success",
        "message": "Đã tính toán xong vị trí tối ưu!",
        "total_cameras_needed": len(final_layout),
        "optimized_positions": [{"x": pos[0], "y": pos[1]} for pos in final_layout]
    }