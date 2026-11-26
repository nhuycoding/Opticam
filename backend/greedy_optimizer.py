"""Greedy camera placement with field-of-view and obstacle line-of-sight checks."""

from __future__ import annotations

import math
from array import array
import time
from typing import Any, Sequence

if __package__:
    from .footprint import point_in_floor, segment_in_floor
else:
    from footprint import point_in_floor, segment_in_floor

FACE_HEIGHT_M = 1.6
DORI_FACTORS = ((250, 1.0), (125, 0.75), (62.5, 0.4), (25, 0.2), (0, 0.0))
RISK_RED_THRESHOLD = 4.0
RISK_YELLOW_THRESHOLD = 2.0
ID_PPM = 250.0
REC_PPM = 125.0

GridPoint = tuple[float, float, float]
RISK_DEFAULTS = {
    "pos": (5.0, 1.0, 2.5),
    "entrance": (5.0, 1.0, 2.5),
    "shelf": (3.0, 1.0, 2.0),
}
SHELF_RISK_PROFILES = {"high": 4.5, "standard": 3.0, "bulky": 1.8, "custom": 3.0}


def risk_weight_at(distance: float, wmax: float, r0: float, radius: float) -> float:
    if radius <= r0 or distance <= r0:
        return wmax
    if distance >= radius:
        return 1.0
    t = (distance - r0) / (radius - r0)
    return 1.0 + (wmax - 1.0) * (1.0 - t)


def dori_factor(ppm: float) -> float:
    for threshold, factor in DORI_FACTORS:
        if ppm >= threshold:
            return factor
    return 0.0


def _value(obstacle: Any, key: str, default: Any = None) -> Any:
    if isinstance(obstacle, dict):
        return obstacle.get(key, default)
    if hasattr(obstacle, key):
        return getattr(obstacle, key)
    if hasattr(obstacle, "dict"):
        return obstacle.dict().get(key, default)
    return default


def _obstacle_rect(obstacle: Any) -> tuple[float, float, float, float, float] | None:
    if _value(obstacle, "start_x") is not None:
        x1 = float(_value(obstacle, "start_x"))
        y1 = float(_value(obstacle, "start_y"))
        x2 = float(_value(obstacle, "end_x"))
        y2 = float(_value(obstacle, "end_y"))
        return (min(x1, x2), min(y1, y2), abs(x2 - x1), abs(y2 - y1), 0.0)
    x, y = _value(obstacle, "x"), _value(obstacle, "y")
    width = _value(obstacle, "w", _value(obstacle, "width"))
    height = _value(obstacle, "h", _value(obstacle, "length"))
    if None in (x, y, width, height):
        return None
    return float(x), float(y), float(width), float(height), float(_value(obstacle, "angle", 0))


def segment_hits_obstacle(
    start: tuple[float, float],
    end: tuple[float, float],
    obstacle: Any,
    camera_height: float = 2.4,
    target_height: float = FACE_HEIGHT_M,
) -> bool:
    """Return whether the 3D sightline crosses the obstacle's occupied volume."""
    obstacle_type = _value(obstacle, "type", "shelf")
    elevation = float(_value(obstacle, "elev", _value(obstacle, "height", 1.8)))
    if obstacle_type == "entrance" or elevation <= 0:
        return False
    rect = _obstacle_rect(obstacle)
    if rect is None:
        return False
    x, y, width, height, angle_deg = rect
    cx, cy = x + width / 2, y + height / 2
    angle = math.radians(-angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    def local(point: tuple[float, float]) -> tuple[float, float]:
        dx, dy = point[0] - cx, point[1] - cy
        return dx * cos_a - dy * sin_a, dx * sin_a + dy * cos_a

    x0, y0 = local(start)
    x1, y1 = local(end)
    dx, dy = x1 - x0, y1 - y0
    t_min, t_max = 0.0, 1.0
    for origin, delta, half_size in ((x0, dx, width / 2), (y0, dy, height / 2)):
        if abs(delta) < 1e-12:
            if origin < -half_size or origin > half_size:
                return False
            continue
        near = (-half_size - origin) / delta
        far = (half_size - origin) / delta
        t_min = max(t_min, min(near, far))
        t_max = min(t_max, max(near, far))
        if t_min > t_max:
            return False
    if t_max < t_min:
        return False
    heights = (
        camera_height + (target_height - camera_height) * t_min,
        camera_height + (target_height - camera_height) * t_max,
    )
    return min(heights) <= elevation + 1e-9


def _point_inside_obstacle(point: tuple[float, float], obstacle: Any) -> bool:
    if _value(obstacle, "type", "shelf") == "entrance":
        return False
    rect = _obstacle_rect(obstacle)
    if rect is None:
        return False
    x, y, width, height, angle_deg = rect
    cx, cy = x + width / 2, y + height / 2
    angle = math.radians(-angle_deg)
    dx, dy = point[0] - cx, point[1] - cy
    local_x = dx * math.cos(angle) - dy * math.sin(angle)
    local_y = dx * math.sin(angle) + dy * math.cos(angle)
    return abs(local_x) <= width / 2 and abs(local_y) <= height / 2


def _distance_to_obstacle(point: tuple[float, float], obstacle: Any) -> float:
    rect = _obstacle_rect(obstacle)
    if rect is None:
        return math.inf
    x, y, width, height, angle_deg = rect
    cx, cy = x + width / 2, y + height / 2
    angle = math.radians(-angle_deg)
    dx, dy = point[0] - cx, point[1] - cy
    local_x = dx * math.cos(angle) - dy * math.sin(angle)
    local_y = dx * math.sin(angle) + dy * math.cos(angle)
    return math.hypot(max(0.0, abs(local_x) - width / 2), max(0.0, abs(local_y) - height / 2))


def obstacle_risk_weight(point: tuple[float, float], obstacles: Sequence[Any]) -> float:
    weight = 1.0
    for obstacle in obstacles:
        obstacle_type = _value(obstacle, "type", "shelf")
        defaults = RISK_DEFAULTS.get(obstacle_type)
        if defaults is None:
            continue
        wmax, r0, radius = defaults
        category = _value(obstacle, "riskCategory", "standard") or "standard"
        category_wmax = SHELF_RISK_PROFILES.get(category, defaults[0]) if obstacle_type == "shelf" else defaults[0]
        custom_wmax = _value(obstacle, "riskWmax")
        custom_r0 = _value(obstacle, "riskR0")
        custom_radius = _value(obstacle, "riskR")
        wmax = float(category_wmax if custom_wmax is None else custom_wmax)
        r0 = float(r0 if custom_r0 is None else custom_r0)
        radius = float(radius if custom_radius is None else custom_radius)
        weight = max(weight, risk_weight_at(_distance_to_obstacle(point, obstacle), wmax, r0, radius))
    return weight


def camera_ppm(
    camera: dict[str, Any],
    point: tuple[float, float],
    obstacles: Sequence[Any],
    target_height: float = FACE_HEIGHT_M,
    floor_polygon=None,
) -> float:
    dx, dy = point[0] - camera["x"], point[1] - camera["y"]
    dz = target_height - camera["height"]
    slant_distance = math.sqrt(dx * dx + dy * dy + dz * dz)
    if slant_distance < 0.03 or slant_distance > camera["range"]:
        return 0.0
    pan = math.radians(camera["pan"])
    tilt = math.radians(camera.get("tilt", 45 if camera.get("mount") == "ceiling" else 20))
    forward = (dx * math.cos(pan) + dy * math.sin(pan)) * math.cos(tilt) - dz * math.sin(tilt)
    right = -dx * math.sin(pan) + dy * math.cos(pan)
    up = (dx * math.cos(pan) + dy * math.sin(pan)) * math.sin(tilt) + dz * math.cos(tilt)
    tan_h = math.tan(math.radians(camera["fov"] / 2))
    vfov = camera.get("vfov") or math.degrees(2 * math.atan(tan_h / (16 / 9)))
    if forward <= 0 or abs(right) > forward * tan_h + 1e-9 or abs(up) > forward * math.tan(math.radians(vfov / 2)) + 1e-9:
        return 0.0
    origin = (camera["x"], camera["y"])
    if floor_polygon and not segment_in_floor(origin, point, floor_polygon):
        return 0.0
    if any(segment_hits_obstacle(origin, point, obstacle, camera["height"], target_height) for obstacle in obstacles):
        return 0.0
    return camera["res"] / (2 * slant_distance * math.tan(math.radians(camera["fov"] / 2)))


class OptiCamGreedy:
    """Select wall-mounted camera candidates by weighted DORI gain."""

    def __init__(
        self,
        room_width: float,
        room_length: float,
        obstacles_data: Sequence[Any],
        target_height: float = FACE_HEIGHT_M,
        risk_strokes: Sequence[Any] = (),
        legacy_risk: dict[str, float] | None = None,
        floor_polygon=None,
    ):
        self.floor_polygon = floor_polygon
        self.room_width = room_width
        self.room_length = room_length
        self.obstacles = [obstacle.dict() if hasattr(obstacle, "dict") else obstacle for obstacle in obstacles_data]
        self.target_height = target_height
        self.risk_strokes = list(risk_strokes)
        self.legacy_risk = legacy_risk or {}

    def generate_grid(
        self,
        cell_size: float = 0.5,
        risk_matrix: Sequence[Sequence[int]] | None = None,
        blocked_matrix: Sequence[Sequence[int]] | None = None,
    ) -> list[GridPoint]:
        rows = math.floor(self.room_length / cell_size + 0.5)
        cols = math.floor(self.room_width / cell_size + 0.5)
        points: list[GridPoint] = []
        for row in range(rows):
            for col in range(cols):
                x, y = (col + 0.5) * cell_size, (row + 0.5) * cell_size
                if self.floor_polygon and not point_in_floor((x, y), self.floor_polygon):
                    continue
                if blocked_matrix is not None and blocked_matrix[row][col]:
                    continue
                if blocked_matrix is None and any(
                    _point_inside_obstacle((x, y), obstacle) for obstacle in self.obstacles
                ):
                    continue
                weight = risk_matrix[row][col] if risk_matrix is not None else obstacle_risk_weight((x, y), self.obstacles)
                if risk_matrix is None:
                    weight = float(self.legacy_risk.get(f"{row}_{col}", weight))
                    for stroke in self.risk_strokes:
                        sx, sy = float(_value(stroke, "x", 0)), float(_value(stroke, "y", 0))
                        radius = float(_value(stroke, "radius", 0))
                        if math.hypot(x - sx, y - sy) <= radius:
                            weight = float(_value(stroke, "weight", weight))
                points.append((x, y, weight))
        return points

    def get_covered_points(
        self,
        cam_x: float,
        cam_y: float,
        radius: float,
        grid_points: Sequence[GridPoint],
        pan_angle_deg: float = 180,
        fov_deg: float = 360,
        resolution: float = 2560,
        camera_height: float = 2.4,
    ) -> set[int]:
        """Return grid indices meeting the minimum DORI detection threshold."""
        camera = {
            "x": cam_x,
            "y": cam_y,
            "pan": pan_angle_deg,
            "fov": fov_deg,
            "res": resolution,
            "range": radius,
            "height": camera_height,
        }
        covered = set()
        for index, (x, y, _) in enumerate(grid_points):
            point = (x, y)
            if fov_deg >= 360:
                distance = math.hypot(x - cam_x, y - cam_y)
                visible = distance <= radius and (not self.floor_polygon or segment_in_floor((cam_x, cam_y), point, self.floor_polygon)) and not any(
                    segment_hits_obstacle((cam_x, cam_y), point, obstacle, camera_height, self.target_height)
                    for obstacle in self.obstacles
                )
            else:
                visible = camera_ppm(camera, point, self.obstacles, self.target_height, self.floor_polygon) >= 25
            if visible:
                covered.add(index)
        return covered

    def run_greedy(
        self, camera_candidates, grid_points, camera_budget, target_coverage=0.95,
        camera_candidate_groups=None, algorithm="greedy",
        red_target=95.0, yellow_target=80.0, lambda_red=1.5, lambda_yel=0.75,
    ):
        """Greedy, hybrid local search, and Two-Stage KPI-aware hybrid search on the shared candidate pool."""
        started = time.perf_counter()
        groups = camera_candidate_groups or [camera_candidates]
        count = len(grid_points)
        weights = [w for _, _, w in grid_points]
        is_kpi = algorithm == "kpi_hybrid"
        red_mask = [w >= RISK_RED_THRESHOLD for w in weights]
        yel_mask = [RISK_YELLOW_THRESHOLD <= w < RISK_RED_THRESHOLD for w in weights]
        red_n = sum(1 for m in red_mask if m)
        yel_n = sum(1 for m in yel_mask if m)
        total_w = sum(weights)

        cache = {}
        candidate_groups = []
        for group in groups:
            if id(group) not in cache:
                candidates = []
                for camera in group:
                    ppm = array('f', (camera_ppm(camera, (x, y), self.obstacles, self.target_height, self.floor_polygon) for x, y, _ in grid_points))
                    if any(ppm):
                        candidates.append((camera, ppm))
                cache[id(group)] = candidates
            candidate_groups.append(cache[id(group)])

        def pose(camera):
            return (camera.get("mount", "wall"), camera["x"], camera["y"], camera["pan"], camera.get("tilt", 20), camera["height"])

        selected = []

        def merge(except_index=-1):
            result = [0.0] * count
            for i, (candidate, _) in enumerate(selected):
                if i != except_index:
                    result = [max(a, b) for a, b in zip(result, candidate[1])]
            return result

        def base_kpi_stats(base):
            red_ok = sum(1 for rm, p in zip(red_mask, base) if rm and p >= ID_PPM)
            yel_ok = sum(1 for ym, p in zip(yel_mask, base) if ym and p >= REC_PPM)
            red_pct = (100.0 * red_ok / red_n) if red_n else 100.0
            yel_pct = (100.0 * yel_ok / yel_n) if yel_n else 100.0
            hinge = total_w * 0.01 * (lambda_red * max(0.0, red_target - red_pct) + lambda_yel * max(0.0, yellow_target - yel_pct))
            return red_ok, yel_ok, red_pct, hinge

        def addition(base, candidate, stage1_red=False, stats=None):
            delta_w = tie = 0.0
            add_red = add_yel = 0
            for old, new, w, rm, ym in zip(base, candidate[1], weights, red_mask, yel_mask):
                if new > old:
                    delta_w += w * (dori_factor(new) - dori_factor(old))
                    tie += w * (min(new, ID_PPM) - min(old, ID_PPM))
                    if is_kpi:
                        if rm and old < ID_PPM <= new:
                            add_red += 1
                        if ym and old < REC_PPM <= new:
                            add_yel += 1
            if not is_kpi or stats is None:
                return delta_w, tie
            if stage1_red:
                return add_red * (total_w / max(1, red_n)) + 0.1 * delta_w, tie
            red_ok, yel_ok, _, base_hinge = stats
            new_red_pct = (100.0 * (red_ok + add_red) / red_n) if red_n else 100.0
            new_yel_pct = (100.0 * (yel_ok + add_yel) / yel_n) if yel_n else 100.0
            new_hinge = total_w * 0.01 * (lambda_red * max(0.0, red_target - new_red_pct) + lambda_yel * max(0.0, yellow_target - new_yel_pct))
            return delta_w + (base_hinge - new_hinge), tie

        def better(score, tie, best_score, best_tie):
            return score > best_score + 1e-9 or (abs(score - best_score) <= 1e-9 and tie > best_tie + 1e-9)

        max_red_slots = max(1, math.ceil(0.67 * camera_budget))
        for slot in range(camera_budget):
            group = candidate_groups[min(slot, len(candidate_groups) - 1)]
            base = merge()
            used = {pose(candidate[0]) for candidate, _ in selected}
            stats = base_kpi_stats(base) if is_kpi else None
            stage1_red = bool(is_kpi and red_n > 0 and slot < max_red_slots and stats[2] < red_target)
            best, best_score, best_tie = None, -1.0, -1.0
            for candidate in group:
                if pose(candidate[0]) in used:
                    continue
                score, tie = addition(base, candidate, stage1_red, stats)
                if better(score, tie, best_score, best_tie):
                    best, best_score, best_tie = candidate, score, tie
            if best is not None:
                selected.append((best, slot))

        def objective(ppm):
            return sum(w * dori_factor(p) for w, p in zip(weights, ppm))

        greedy_score = objective(merge())
        iterations = 0
        if algorithm in ("hybrid", "kpi_hybrid"):
            for _ in range(3):
                improved = False
                for index, (old, slot) in enumerate(selected):
                    base = merge(index)
                    used = {pose(c[0]) for i, (c, _) in enumerate(selected) if i != index}
                    stats = base_kpi_stats(base) if is_kpi else None
                    old_gain, old_tie = addition(base, old, False, stats)
                    best, best_gain, best_tie = old, old_gain, old_tie
                    for candidate in candidate_groups[min(slot, len(candidate_groups) - 1)]:
                        if pose(candidate[0]) in used:
                            continue
                        gain, tie = addition(base, candidate, False, stats)
                        if better(gain, tie, best_gain, best_tie):
                            best, best_gain, best_tie = candidate, gain, tie
                    if best_gain > old_gain + 1e-9:
                        selected[index] = (best, slot)
                        improved, iterations = True, iterations + 1
                if not improved:
                    break
        ppm = merge()
        final_score = objective(ppm)
        coverage = sum(p >= 25 for p in ppm) / count * 100 if count else 100
        return [candidate[0] for candidate, _ in selected], {
            "area_coverage_pct": round(coverage, 1),
            "target_coverage_reached": coverage / 100 >= target_coverage,
            "weighted_coverage_pct": round(final_score / total_w * 100, 1) if total_w else 100,
            "diagnostics": {"algorithm": algorithm, "greedyScore": greedy_score, "finalScore": final_score,
                            "iterations": iterations, "candidateCount": sum(len(c) for c in cache.values()),
                            "ms": (time.perf_counter() - started) * 1000},
        }
