"""Fast vectorized optics, 2D/3D visibility, and Wang-2013 anisotropic sensing for OptiCam layouts."""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
venv_pkgs = ROOT / "backend" / ".venv" / "Lib" / "site-packages"
if venv_pkgs.is_dir():
    sys.path.append(str(venv_pkgs))

from backend.footprint import point_in_floor, segment_in_floor
from backend.greedy_optimizer import (
    DORI_FACTORS,
    FACE_HEIGHT_M,
    OptiCamGreedy,
    _distance_to_obstacle,
    _obstacle_rect,
    _value,
    dori_factor,
)
from backend.main import LayoutData, _camera_configurations

SAMPLES = [
    "store_60m2.json",
    "circle_k_75m2.json",
    "ministop_50m2.json",
    "vn_nha_ong_72m2.json",
    "vn_goc_pho_78m2.json",
    "vn_chu_l_70m2.json",
    "vn_hinh_thang_67m2.json",
    "vn_co_nguoi_78m2.json",
]


def load_layout_bundle(filename: str) -> dict[str, Any]:
    raw = json.loads((ROOT / "data_samples" / filename).read_text(encoding="utf-8"))
    layout = LayoutData.parse_obj(raw)
    opt = OptiCamGreedy(
        layout.widthM,
        layout.heightM,
        layout.obstacles,
        layout.targetHeight,
        layout.riskStrokes,
        layout.risk,
        layout.floorPolygon,
    )
    zones = opt.generate_grid(layout.gridM)
    xs = np.array([z[0] for z in zones], dtype=np.float64)
    ys = np.array([z[1] for z in zones], dtype=np.float64)
    ws = np.array([z[2] for z in zones], dtype=np.float64)
    obstacles = [o.dict() for o in layout.obstacles]
    return {
        "filename": filename,
        "raw": raw,
        "layout": layout,
        "opt": opt,
        "zones": zones,
        "xs": xs,
        "ys": ys,
        "ws": ws,
        "obstacles": obstacles,
    }


def _vectorized_segment_hits_obstacles(
    cam_x: np.ndarray,
    cam_y: np.ndarray,
    cam_h: np.ndarray,
    cell_x: np.ndarray,
    cell_y: np.ndarray,
    target_h: float,
    obstacles: list[dict[str, Any]],
    mode: str = "3d",
) -> np.ndarray:
    """
    cam_x, cam_y, cam_h, cell_x, cell_y are 1D arrays of length K_pairs (masked active pairs).
    mode='3d': exact OptiCam 3D ray-box check (min endpoint height <= elev + 1e-9).
    mode='2d': floor-to-ceiling 2D blocking for any non-entrance obstacle with elev > 0.
    Returns boolean array of length K_pairs (True = blocked).
    """
    n_pairs = cam_x.shape[0]
    blocked = np.zeros(n_pairs, dtype=bool)
    if n_pairs == 0:
        return blocked

    for obs in obstacles:
        if _value(obs, "type", "shelf") == "entrance":
            continue
        elev = float(_value(obs, "elev", _value(obs, "height", 1.8)))
        if elev <= 0:
            continue
        rect = _obstacle_rect(obs)
        if rect is None:
            continue
        ox, oy, width, height, angle_deg = rect
        cx, cy = ox + width / 2.0, oy + height / 2.0
        ang = math.radians(-angle_deg)
        cos_a, sin_a = math.cos(ang), math.sin(ang)

        # local coords of start and end
        sdx, sdy = cam_x - cx, cam_y - cy
        x0 = sdx * cos_a - sdy * sin_a
        y0 = sdx * sin_a + sdy * cos_a

        edx, edy = cell_x - cx, cell_y - cy
        x1 = edx * cos_a - edy * sin_a
        y1 = edx * sin_a + edy * cos_a

        dx = x1 - x0
        dy = y1 - y0

        t_min = np.zeros(n_pairs, dtype=np.float64)
        t_max = np.ones(n_pairs, dtype=np.float64)
        valid = ~blocked  # only test unblocked pairs

        for origin, delta, half in ((x0, dx, width / 2.0), (y0, dy, height / 2.0)):
            near_zero = np.abs(delta) < 1e-12
            valid &= ~(near_zero & ((origin < -half) | (origin > half)))
            safe_delta = np.where(near_zero, 1.0, delta)
            n1 = (-half - origin) / safe_delta
            n2 = (half - origin) / safe_delta
            lo = np.minimum(n1, n2)
            hi = np.maximum(n1, n2)
            t_min = np.where(~near_zero, np.maximum(t_min, lo), t_min)
            t_max = np.where(~near_zero, np.minimum(t_max, hi), t_max)
            valid &= (t_min <= t_max)

        if not np.any(valid):
            continue

        if mode == "2d":
            blocked |= valid
        else:
            h1 = cam_h + (target_h - cam_h) * t_min
            h2 = cam_h + (target_h - cam_h) * t_max
            hit = valid & (np.minimum(h1, h2) <= elev + 1e-9)
            blocked |= hit

    return blocked


def _points_in_polygon_vec(px: np.ndarray, py: np.ndarray, polygon: list[tuple[float, float]]) -> np.ndarray:
    """Vectorized exact match of backend.footprint.point_in_floor."""
    n = px.shape[0]
    inside = np.zeros(n, dtype=bool)
    on_edge = np.zeros(n, dtype=bool)
    m = len(polygon)
    for i in range(m):
        ax, ay = polygon[i]
        bx, by = polygon[(i + 1) % m]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        if length > 0:
            t = np.clip(((px - ax) * dx + (py - ay) * dy) / length, 0.0, 1.0)
        else:
            t = np.zeros(n)
        dist = np.hypot(px - ax - t * dx, py - ay - t * dy)
        on_edge |= (dist < 1e-7)
        cross_y = (ay > py) != (by > py)
        if np.any(cross_y):
            denom = by - ay
            if abs(denom) > 1e-15:
                x_int = (bx - ax) * (py - ay) / denom + ax
                inside ^= (cross_y & (px < x_int))
    return inside | on_edge


def _is_convex_polygon(polygon: list[tuple[float, float]]) -> bool:
    m = len(polygon)
    if m < 3:
        return False
    sign = 0
    for i in range(m):
        ax, ay = polygon[i]
        bx, by = polygon[(i + 1) % m]
        cx, cy = polygon[(i + 2) % m]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        if abs(cross) > 1e-9:
            s = 1 if cross > 0 else -1
            if sign == 0:
                sign = s
            elif sign != s:
                return False
    return True


def _vectorized_segment_in_floor(
    cam_x: np.ndarray,
    cam_y: np.ndarray,
    cell_x: np.ndarray,
    cell_y: np.ndarray,
    polygon: list[tuple[float, float]] | None,
) -> np.ndarray:
    n_pairs = cam_x.shape[0]
    if not polygon or n_pairs == 0:
        return np.ones(n_pairs, dtype=bool)
    ok = _points_in_polygon_vec(cam_x, cam_y, polygon) & _points_in_polygon_vec(cell_x, cell_y, polygon)
    if not np.any(ok) or _is_convex_polygon(polygon):
        return ok
    dx = cell_x - cam_x
    dy = cell_y - cam_y
    m = len(polygon)
    # Collect t intersections per edge (shape n_pairs x m)
    ts_list = [np.zeros(n_pairs, dtype=np.float64), np.ones(n_pairs, dtype=np.float64)]
    for i in range(m):
        cx, cy = polygon[i]
        ex = polygon[(i + 1) % m][0] - cx
        ey = polygon[(i + 1) % m][1] - cy
        denom = dx * ey - dy * ex
        non_par = np.abs(denom) >= 1e-10
        safe_d = np.where(non_par, denom, 1.0)
        t = ((cx - cam_x) * ey - (cy - cam_y) * ex) / safe_d
        u = ((cx - cam_x) * dy - (cy - cam_y) * dx) / safe_d
        hit = ok & non_par & (t > 0.0) & (t < 1.0) & (u >= 0.0) & (u <= 1.0)
        ts_list.append(np.where(hit, t, 1.0))
    ts = np.sort(np.stack(ts_list, axis=1), axis=1)  # (n_pairs, m + 2)
    mids = 0.5 * (ts[:, :-1] + ts[:, 1:])  # (n_pairs, m + 1)
    # Only evaluate non-degenerate intervals where hi > lo + 1e-12
    non_zero = (ts[:, 1:] - ts[:, :-1]) > 1e-12
    ii, kk = np.where(ok[:, None] & non_zero)
    if ii.size > 0:
        mx = cam_x[ii] + mids[ii, kk] * dx[ii]
        my = cam_y[ii] + mids[ii, kk] * dy[ii]
        mid_ok = _points_in_polygon_vec(mx, my, polygon)
        bad_ii = ii[~mid_ok]
        if bad_ii.size > 0:
            ok[bad_ii] = False
    return ok


def compute_ppm_matrix(
    cameras: list[dict[str, Any]],
    xs: np.ndarray,
    ys: np.ndarray,
    obstacles: list[dict[str, Any]],
    target_height: float = FACE_HEIGHT_M,
    floor_polygon: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    """Exact vectorized equivalent of backend.greedy_optimizer.camera_ppm -> shape (N_cam, M_cells)."""
    n_cam = len(cameras)
    m_cells = xs.shape[0]
    ppm = np.zeros((n_cam, m_cells), dtype=np.float64)
    if n_cam == 0 or m_cells == 0:
        return ppm

    cx = np.array([float(c["x"]) for c in cameras], dtype=np.float64)[:, None]
    cy = np.array([float(c["y"]) for c in cameras], dtype=np.float64)[:, None]
    ch = np.array([float(c["height"]) for c in cameras], dtype=np.float64)[:, None]
    crange = np.array([float(c["range"]) for c in cameras], dtype=np.float64)[:, None]
    cfov = np.array([float(c["fov"]) for c in cameras], dtype=np.float64)[:, None]
    cres = np.array([float(c["res"]) for c in cameras], dtype=np.float64)[:, None]
    cpan = np.radians(np.array([float(c["pan"]) for c in cameras], dtype=np.float64))[:, None]
    ctilt = np.radians(
        np.array(
            [float(c.get("tilt", 45.0 if c.get("mount") == "ceiling" else 20.0)) for c in cameras],
            dtype=np.float64,
        )
    )[:, None]

    tan_h = np.tan(np.radians(cfov / 2.0))
    cvfov = np.array(
        [
            float(c["vfov"])
            if c.get("vfov") is not None
            else math.degrees(2.0 * math.atan(math.tan(math.radians(float(c["fov"]) / 2.0)) / (16.0 / 9.0)))
            for c in cameras
        ],
        dtype=np.float64,
    )[:, None]
    tan_v = np.tan(np.radians(cvfov / 2.0))

    dx = xs[None, :] - cx
    dy = ys[None, :] - cy
    dz = target_height - ch
    slant = np.sqrt(dx * dx + dy * dy + dz * dz)

    along = dx * np.cos(cpan) + dy * np.sin(cpan)
    forward = along * np.cos(ctilt) - dz * np.sin(ctilt)
    right = -dx * np.sin(cpan) + dy * np.cos(cpan)
    up = along * np.sin(ctilt) + dz * np.cos(ctilt)

    mask = (
        (slant >= 0.03)
        & (slant <= crange)
        & (forward > 0.0)
        & (np.abs(right) <= forward * tan_h + 1e-9)
        & (np.abs(up) <= forward * tan_v + 1e-9)
    )

    ii, jj = np.where(mask)
    if ii.size == 0:
        return ppm

    pcx = cx[ii, 0]
    pcy = cy[ii, 0]
    pch = ch[ii, 0]
    px = xs[jj]
    py = ys[jj]

    if floor_polygon:
        in_floor = _vectorized_segment_in_floor(pcx, pcy, px, py, floor_polygon)
        ii, jj, pcx, pcy, pch, px, py = ii[in_floor], jj[in_floor], pcx[in_floor], pcy[in_floor], pch[in_floor], px[in_floor], py[in_floor]
    if ii.size == 0:
        return ppm

    blocked = _vectorized_segment_hits_obstacles(pcx, pcy, pch, px, py, target_height, obstacles, mode="3d")
    keep = ~blocked
    ii, jj = ii[keep], jj[keep]
    if ii.size == 0:
        return ppm

    ppm[ii, jj] = cres[ii, 0] / (2.0 * slant[ii, jj] * tan_h[ii, 0])
    return ppm


def compute_vis2d_matrix(
    cameras: list[dict[str, Any]],
    xs: np.ndarray,
    ys: np.ndarray,
    obstacles: list[dict[str, Any]],
    floor_polygon: list[tuple[float, float]] | None = None,
    min_ppm: float | None = None,
) -> np.ndarray:
    """2D planar visibility matrix (shape N_cam x M_cells, uint8) with floor-to-ceiling obstacle blocking."""
    n_cam = len(cameras)
    m_cells = xs.shape[0]
    vis = np.zeros((n_cam, m_cells), dtype=np.uint8)
    if n_cam == 0 or m_cells == 0:
        return vis

    cx = np.array([float(c["x"]) for c in cameras], dtype=np.float64)[:, None]
    cy = np.array([float(c["y"]) for c in cameras], dtype=np.float64)[:, None]
    crange = np.array([float(c["range"]) for c in cameras], dtype=np.float64)[:, None]
    cfov = np.array([float(c["fov"]) for c in cameras], dtype=np.float64)[:, None]
    cres = np.array([float(c["res"]) for c in cameras], dtype=np.float64)[:, None]
    cpan = np.radians(np.array([float(c["pan"]) for c in cameras], dtype=np.float64))[:, None]

    tan_h = np.tan(np.radians(cfov / 2.0))
    dx = xs[None, :] - cx
    dy = ys[None, :] - cy
    dist = np.hypot(dx, dy)

    # Angle difference in [-pi, pi]
    ang = np.arctan2(dy, dx) - cpan
    ang = (ang + math.pi) % (2.0 * math.pi) - math.pi
    half_fov = np.radians(cfov / 2.0)

    mask = (dist <= crange) & (np.abs(ang) <= half_fov + 1e-9)
    if min_ppm is not None and min_ppm > 0:
        # 2D horizontal resolution check: res / (2 * dist * tan(fov/2)) >= min_ppm
        safe_dist = np.maximum(dist, 0.03)
        ppm_2d = cres / (2.0 * safe_dist * tan_h)
        mask &= (ppm_2d >= min_ppm) & (dist >= 0.03)

    ii, jj = np.where(mask)
    if ii.size == 0:
        return vis

    pcx, pcy = cx[ii, 0], cy[ii, 0]
    px, py = xs[jj], ys[jj]

    if floor_polygon:
        in_floor = _vectorized_segment_in_floor(pcx, pcy, px, py, floor_polygon)
        ii, jj, pcx, pcy, px, py = ii[in_floor], jj[in_floor], pcx[in_floor], pcy[in_floor], px[in_floor], py[in_floor]
    if ii.size == 0:
        return vis

    blocked = _vectorized_segment_hits_obstacles(pcx, pcy, np.zeros_like(pcx), px, py, 0.0, obstacles, mode="2d")
    keep = ~blocked
    vis[ii[keep], jj[keep]] = 1
    return vis


def compute_wang_q_matrix(
    cameras: list[dict[str, Any]],
    xs: np.ndarray,
    ys: np.ndarray,
    obstacles: list[dict[str, Any]],
    floor_polygon: list[tuple[float, float]] | None = None,
    occlusion_mode: str = "2d",
    target_height: float = FACE_HEIGHT_M,
) -> np.ndarray:
    """
    Wang et al. (Sensors 2013) Anisotropic Sensing Model:
      q(l, theta) = alpha * Fr(l, theta) * Fd(l, theta) * Fg(theta) * Fo(l, theta)
    Calibrated via Appendix A.5 (Eq. 18) with F_{r,min} = F_{d,min} = F_{g,min} = 0.05
    to match the camera's FOV and effective range (10 m).
    """
    n_cam = len(cameras)
    m_cells = xs.shape[0]
    Q = np.zeros((n_cam, m_cells), dtype=np.float64)
    if n_cam == 0 or m_cells == 0:
        return Q

    cx = np.array([float(c["x"]) for c in cameras], dtype=np.float64)[:, None]
    cy = np.array([float(c["y"]) for c in cameras], dtype=np.float64)[:, None]
    ch = np.array([float(c.get("height", 2.4)) for c in cameras], dtype=np.float64)[:, None]
    crange = np.array([float(c["range"]) for c in cameras], dtype=np.float64)[:, None]
    cfov = np.array([float(c["fov"]) for c in cameras], dtype=np.float64)[:, None]
    cpan = np.radians(np.array([float(c["pan"]) for c in cameras], dtype=np.float64))[:, None]

    dx = xs[None, :] - cx
    dy = ys[None, :] - cy
    l = np.hypot(dx, dy)
    theta = (np.arctan2(dy, dx) - cpan + math.pi) % (2.0 * math.pi) - math.pi
    half_fov = np.radians(cfov / 2.0)

    mask = (l >= 0.03) & (l <= crange) & (np.abs(theta) <= half_fov + 1e-9)
    ii, jj = np.where(mask)
    if ii.size == 0:
        return Q

    pcx, pcy, pch = cx[ii, 0], cy[ii, 0], ch[ii, 0]
    px, py = xs[jj], ys[jj]

    if floor_polygon:
        in_floor = _vectorized_segment_in_floor(pcx, pcy, px, py, floor_polygon)
        ii, jj, pcx, pcy, pch, px, py = ii[in_floor], jj[in_floor], pcx[in_floor], pcy[in_floor], pch[in_floor], px[in_floor], py[in_floor]
    if ii.size == 0:
        return Q

    blocked = _vectorized_segment_hits_obstacles(pcx, pcy, pch, px, py, target_height, obstacles, mode=occlusion_mode)
    keep = ~blocked
    ii, jj = ii[keep], jj[keep]
    if ii.size == 0:
        return Q

    l_ok = l[ii, jj]
    th_ok = theta[ii, jj]
    u = l_ok * np.cos(th_ok)  # optical depth along axis
    u = np.maximum(u, 0.05)

    # Appendix A calibration (F_min = 0.05 at critical conditions):
    # A.1 Resolution: Fr(l, th) = exp(-u^2 / c_r), reaching 0.05 at u = range
    ln_005 = math.log(0.05)  # -2.995732
    r_ok = crange[ii, 0]
    Fr = np.exp(ln_005 * (u / r_ok) ** 2)

    # A.2 Defocus (u_opt = inf -> f = s -> blur r prop to 1/u): Fd = exp(ln(0.05) * (u_min / u))
    # Table 1 in Wang 2013 has u_best ~ 2.45m; with u_min = 0.25m, Fr*Fd peaks near ~2.1-2.5m!
    u_min = 0.25
    Fd = np.exp(ln_005 * (u_min / u))

    # A.3 Radial geometric distortion: Fg(th) = exp(ln(0.05) * (|tan(th)| / tan(FOV/2))^3)
    tan_half = np.tan(half_fov[ii, 0])
    ratio_tan = np.minimum(1.0, np.abs(np.tan(th_ok)) / tan_half)
    Fg = np.exp(ln_005 * (ratio_tan ** 3))

    # Normalization alpha so peak q(u_best, 0) = 1.0 (peak occurs where d/du(ln Fr + ln Fd) = 0)
    # peak u* = (r_ok^2 * u_min / 2)^(1/3) -> at r=10, u_min=0.25 -> u* = (12.5)^(1/3) = 2.32m!
    u_star = (r_ok ** 2 * u_min / 2.0) ** (1.0 / 3.0)
    peak = np.exp(ln_005 * (u_star / r_ok) ** 2 + ln_005 * (u_min / u_star))
    q_val = (Fr * Fd * Fg) / peak
    Q[ii, jj] = q_val
    return Q


def dori_factor_vec(ppm: np.ndarray) -> np.ndarray:
    out = np.zeros_like(ppm, dtype=np.float64)
    out = np.where(ppm >= 25.0, 0.20, out)
    out = np.where(ppm >= 62.5, 0.40, out)
    out = np.where(ppm >= 125.0, 0.75, out)
    out = np.where(ppm >= 250.0, 1.00, out)
    return out


def evaluate_opticam(cameras: list[dict[str, Any]], bundle: dict[str, Any]) -> dict[str, Any]:
    """Cross-evaluate any camera list using OptiCam's exact 3D DORI + Risk KPI engine."""
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    layout: LayoutData = bundle["layout"]
    ppm_mat = compute_ppm_matrix(cameras, xs, ys, bundle["obstacles"], layout.targetHeight, layout.floorPolygon)
    if ppm_mat.shape[0] > 0:
        best_ppm = ppm_mat.max(axis=0)
        cov_count = (ppm_mat >= 25.0).sum(axis=0)
    else:
        best_ppm = np.zeros_like(xs)
        cov_count = np.zeros_like(xs, dtype=int)

    f_vals = dori_factor_vec(best_ppm)
    weighted = float(np.sum(ws * f_vals))
    total_w = float(np.sum(ws))
    n = len(xs)

    red_mask = ws >= 4.0
    yel_mask = (ws >= 2.0) & (ws < 4.0)
    red_n = int(np.sum(red_mask))
    yel_n = int(np.sum(yel_mask))
    red_ok = int(np.sum(best_ppm[red_mask] >= 250.0)) if red_n else 0
    yel_ok = int(np.sum(best_ppm[yel_mask] >= 125.0)) if yel_n else 0

    red_pct = round(red_ok / red_n * 100.0, 1) if red_n else 100.0
    yel_pct = round(yel_ok / yel_n * 100.0, 1) if yel_n else 100.0
    red_min_ppm = round(float(np.min(best_ppm[red_mask]))) if red_n else 0

    area_cov = round(float(np.sum(best_ppm >= 25.0)) / n * 100.0, 1) if n else 100.0
    obs_cov = round(float(np.sum(best_ppm >= 62.5)) / n * 100.0, 1) if n else 100.0
    rec_cov = round(float(np.sum(best_ppm >= 125.0)) / n * 100.0, 1) if n else 100.0
    id_cov = round(float(np.sum(best_ppm >= 250.0)) / n * 100.0, 1) if n else 100.0
    overlap_pct = round(float(np.sum(cov_count >= 2)) / n * 100.0, 1) if n else 0.0
    wvcr_pct = round(float(np.sum(ws * (best_ppm >= 25.0))) / total_w * 100.0, 1) if total_w else 100.0

    return {
        "cams": len(cameras),
        "weighted": round(weighted, 2),
        "weighted_raw": weighted,
        "weighted_pct": round(weighted / total_w * 100.0, 1) if total_w else 100.0,
        "red_pct": red_pct,
        "yellow_pct": yel_pct,
        "red_min_ppm": red_min_ppm,
        "kpi_pass": (red_pct >= 95.0) and (yel_pct >= 80.0),
        "area_cov_pct": area_cov,
        "obs_pct": obs_cov,
        "rec_pct": rec_cov,
        "id_pct": id_cov,
        "overlap_pct": overlap_pct,
        "wvcr_pct": wvcr_pct,
    }


def get_opticam_candidates(bundle: dict[str, Any], mounts: str = "mixed", profile: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], float]:
    """Replicate backend/main.py candidate pool generation exactly."""
    layout: LayoutData = bundle["layout"]
    if mounts != layout.optimization.mounts:
        layout_copy = layout.copy(deep=True)
        layout_copy.optimization.mounts = mounts
    else:
        layout_copy = layout
    prof = profile or {
        "fov": 85.0,
        "res": 2560.0,
        "range": 10.0,
        "height": 2.4,
        "ceilingDrop": 0.15,
        "model": "Dome IP 4MP (2560px, ống kính 2.8mm)",
    }
    spec = {k: v for k, v in prof.items() if k != "mount"}
    n_cells = len(bundle["xs"])
    cap = max(1, min(12_000, math.floor(1_500_000 / max(1, n_cells))))
    step = max(layout.gridM, 0.5)
    cands = _camera_configurations(layout_copy, spec, step) if n_cells else []
    while len(cands) > cap and step < max(layout.widthM, layout.heightM) * 2:
        step *= 2
        cands = _camera_configurations(layout_copy, spec, step)
    if len(cands) > cap:
        cands = [cands[math.floor(i * len(cands) / cap)] for i in range(cap)]
    return cands, step


def run_opticam_hybrid(bundle: dict[str, Any], budget_k: int = 3, mounts: str = "mixed", algorithm: str = "hybrid") -> tuple[list[dict[str, Any]], dict[str, Any]]:
    t0 = time.perf_counter()
    cands, _ = get_opticam_candidates(bundle, mounts=mounts)
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    layout: LayoutData = bundle["layout"]
    ppm_full = compute_ppm_matrix(cands, xs, ys, bundle["obstacles"], layout.targetHeight, layout.floorPolygon)
    keep = np.any(ppm_full > 0, axis=1)
    cands = [c for c, k in zip(cands, keep) if k]
    ppm_mat = ppm_full[keep]
    f_mat = dori_factor_vec(ppm_mat)
    tie_mat = np.minimum(ppm_mat, 250.0)

    def pose(c):
        return (c.get("mount", "wall"), c["x"], c["y"], c["pan"], c.get("tilt", 20), c["height"])

    n_cands, m_cells = ppm_mat.shape
    selected_idx: list[int] = []
    used_poses: set[Any] = set()

    # Greedy phase
    base_ppm = np.zeros(m_cells, dtype=np.float64)
    base_f = np.zeros(m_cells, dtype=np.float64)
    base_tie = np.zeros(m_cells, dtype=np.float64)
    for _ in range(budget_k):
        imp = ppm_mat > base_ppm[None, :]
        gain_f = np.where(imp, f_mat - base_f[None, :], 0.0) @ ws
        gain_tie = np.where(imp, tie_mat - base_tie[None, :], 0.0) @ ws
        best_i = -1
        best_s, best_t = -1.0, -1.0
        for i in range(n_cands):
            if pose(cands[i]) in used_poses:
                continue
            s, t = float(gain_f[i]), float(gain_tie[i])
            if s > best_s + 1e-9 or (abs(s - best_s) <= 1e-9 and t > best_t + 1e-9):
                best_i, best_s, best_t = i, s, t
        if best_i >= 0:
            selected_idx.append(best_i)
            used_poses.add(pose(cands[best_i]))
            base_ppm = np.maximum(base_ppm, ppm_mat[best_i])
            base_f = np.maximum(base_f, f_mat[best_i])
            base_tie = np.maximum(base_tie, tie_mat[best_i])

    greedy_score = float(np.sum(ws * base_f))
    iterations = 0
    if algorithm == "hybrid":
        for _ in range(3):
            improved = False
            for slot in range(len(selected_idx)):
                old_i = selected_idx[slot]
                other_idx = [selected_idx[j] for j in range(len(selected_idx)) if j != slot]
                if other_idx:
                    b_ppm = ppm_mat[other_idx].max(axis=0)
                    b_f = f_mat[other_idx].max(axis=0)
                    b_tie = tie_mat[other_idx].max(axis=0)
                else:
                    b_ppm = np.zeros(m_cells)
                    b_f = np.zeros(m_cells)
                    b_tie = np.zeros(m_cells)
                other_poses = {pose(cands[j]) for j in other_idx}
                imp = ppm_mat > b_ppm[None, :]
                gain_f = np.where(imp, f_mat - b_f[None, :], 0.0) @ ws
                gain_tie = np.where(imp, tie_mat - b_tie[None, :], 0.0) @ ws
                old_gain = float(gain_f[old_i])
                best_i, best_g, best_t = old_i, old_gain, float(gain_tie[old_i])
                for i in range(n_cands):
                    if pose(cands[i]) in other_poses:
                        continue
                    g, t = float(gain_f[i]), float(gain_tie[i])
                    if g > best_g + 1e-9 or (abs(g - best_g) <= 1e-9 and t > best_t + 1e-9):
                        best_i, best_g, best_t = i, g, t
                if best_g > old_gain + 1e-9:
                    selected_idx[slot] = best_i
                    improved = True
                    iterations += 1
            if not improved:
                break

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    sel_cams = [cands[i] for i in selected_idx]
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(elapsed_ms, 1)
    ev["greedy_score"] = round(greedy_score, 3)
    ev["iterations"] = iterations
    return sel_cams, ev


if __name__ == "__main__":
    import csv
    expected = {}
    with open(ROOT / "results" / "ceiling-optimization.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            expected[row["layout"]] = float(row["finalScore"])

    for name in SAMPLES:
        b = load_layout_bundle(name)
        cams, ev = run_opticam_hybrid(b, budget_k=3, mounts="mixed", algorithm="hybrid")
        exp = expected.get(b["layout"].name, -1.0)
        print(
            f"{name:24s} | cells={len(b['xs']):4d} | got={ev['weighted_raw']:9.3f} | exp={exp:9.3f} "
            f"| diff={ev['weighted_raw']-exp:+.4f} | red={ev['red_pct']:5.1f}% yel={ev['yellow_pct']:5.1f}% "
            f"| area={ev['area_cov_pct']:5.1f}% | {ev['runtime_ms']:6.1f} ms"
        )
