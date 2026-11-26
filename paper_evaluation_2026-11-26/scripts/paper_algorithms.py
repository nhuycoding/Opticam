"""Faithful implementations of the 4 reference paper algorithms for OptiCam evaluation:
1. Erdem & Sclaroff (CVIU 2006) — 0-1 BIP Set Cover & Max-Coverage
2. Aziz et al. (ITcon 2024) — 2D GA #3 with ROI & overlap penalty
3. Kim et al. (ASCE JCEM 2019) — Semantic-Cost GA maximizing WVCR
4. Wang et al. (Sensors 2013) — Anisotropic Sensing + l1-relaxed SOCP (Clarabel)
"""
from __future__ import annotations

import math
import time
from typing import Any

import clarabel
import numpy as np
import scipy.sparse as sp
from scipy.optimize import Bounds, LinearConstraint, milp

from backend.footprint import point_in_floor
from backend.greedy_optimizer import _distance_to_obstacle
from backend.main import _wall_anchors
from opticam_fast import (
    _points_in_polygon_vec,
    compute_ppm_matrix,
    compute_vis2d_matrix,
    compute_wang_q_matrix,
    evaluate_opticam,
    get_opticam_candidates,
)

DEFAULT_CAM = {
    "fov": 85.0,
    "res": 2560.0,
    "range": 10.0,
    "height": 2.4,
    "tilt": 20.0,
    "model": "Dome IP 4MP (2560px, 2.8mm)",
}


def manual_four_corners(bundle: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Baseline: 4 wall corner cameras pointing toward room center (OptiCam manualFourCorners)."""
    layout = bundle["layout"]
    W, H = layout.widthM, layout.heightM
    corners = [(0.0, 0.0, 45.0), (W, 0.0, 135.0), (W, H, 225.0), (0.0, H, 315.0)]
    if layout.floorPolygon:
        poly = layout.floorPolygon
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        anchors = _wall_anchors(W, H, max(layout.gridM, 0.5), poly)
        cams = []
        for idx, (x0, y0, _) in enumerate(corners):
            ax, ay = min(anchors, key=lambda p: (p[0] - x0) ** 2 + (p[1] - y0) ** 2)
            pan = (math.degrees(math.atan2(cy - ay, cx - ax)) + 360.0) % 360.0
            cams.append({**DEFAULT_CAM, "id": f"MAN-{idx+1:02d}", "x": ax, "y": ay, "pan": pan, "mount": "wall"})
    else:
        cams = [
            {**DEFAULT_CAM, "id": f"MAN-{idx+1:02d}", "x": x, "y": y, "pan": pan, "mount": "wall"}
            for idx, (x, y, pan) in enumerate(corners)
        ]
    ev = evaluate_opticam(cams, bundle)
    ev["runtime_ms"] = 0.0
    return cams, ev


# ---------------------------------------------------------------------------
# 1. Erdem & Sclaroff (CVIU 2006) — 0-1 Binary Integer Programming
# ---------------------------------------------------------------------------
def _erdem_candidate_pool(bundle: dict[str, Any], mounts: str = "mixed") -> list[dict[str, Any]]:
    """Distinct 2D (mount, x, y, pan) poses from OptiCam's spatial anchors (no tilt duplicates)."""
    layout = bundle["layout"]
    step = max(layout.gridM, 0.5)
    cands: list[dict[str, Any]] = []
    drop = min(0.15, layout.ceilingHeight - 1.8)
    ceil_h = layout.ceilingHeight - drop
    wall_h = min(2.4, layout.ceilingHeight - 0.3)

    if mounts != "ceiling":
        for x, y in _wall_anchors(layout.widthM, layout.heightM, step, layout.floorPolygon):
            if any(o.type != "entrance" and o.elev >= wall_h - 0.08 and _distance_to_obstacle((x, y), o) < 0.12 for o in layout.obstacles):
                continue
            for pan in range(0, 360, 30):
                cands.append({**DEFAULT_CAM, "x": float(x), "y": float(y), "pan": float(pan), "tilt": 20.0, "height": wall_h, "mount": "wall"})
    if mounts != "wall":
        nx = max(1, math.ceil(layout.widthM / max(1.0, step)))
        ny = max(1, math.ceil(layout.heightM / max(1.0, step)))
        poly = layout.floorPolygon or [(0, 0), (layout.widthM, 0), (layout.widthM, layout.heightM), (0, layout.heightM)]
        for ix in range(nx):
            for iy in range(ny):
                x = layout.widthM * (ix + 0.5) / nx
                y = layout.heightM * (iy + 0.5) / ny
                if not all(point_in_floor((x + dx, y + dy), poly) for dx, dy in [(0, 0), (.12, 0), (-.12, 0), (0, .12), (0, -.12)]):
                    continue
                if any(o.type != "entrance" and o.elev >= ceil_h - 0.08 and _distance_to_obstacle((x, y), o) < 0.12 for o in layout.obstacles):
                    continue
                for pan in range(0, 360, 30):
                    cands.append({**DEFAULT_CAM, "x": float(x), "y": float(y), "pan": float(pan), "tilt": 35.0, "height": ceil_h, "mount": "ceiling", "ceilingDrop": drop})
    return cands


def run_erdem_max_coverage(bundle: dict[str, Any], budget_k: int = 3, mounts: str = "mixed", min_ppm: float = 25.0) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Erdem & Sclaroff (2006) Max-Coverage 0-1 MILP (fixed budget K, uniform binary 2D visibility)."""
    t0 = time.perf_counter()
    cands = _erdem_candidate_pool(bundle, mounts=mounts)
    xs, ys = bundle["xs"], bundle["ys"]
    layout = bundle["layout"]
    vis = compute_vis2d_matrix(cands, xs, ys, bundle["obstacles"], layout.floorPolygon, min_ppm=min_ppm)
    keep = np.any(vis > 0, axis=1)
    cands = [c for c, k in zip(cands, keep) if k]
    vis = vis[keep]  # (N, M)
    n_cands, m_cells = vis.shape

    # Variables: [x_0..x_{N-1}, y_0..y_{M-1}]
    # Maximize sum(y_j) <=> Minimize -sum(y_j) + 1e-4 * sum(x_i)
    c_obj = np.concatenate([np.full(n_cands, 1e-4), -np.ones(m_cells)])
    integrality = np.concatenate([np.ones(n_cands), np.zeros(m_cells)])
    lb = np.zeros(n_cands + m_cells)
    ub = np.ones(n_cands + m_cells)

    # Constraints:
    # 1) sum(x_i) <= K
    # 2) y_j - sum_{i: vis[i,j]==1} x_i <= 0  for all j
    rows_sp, cols_sp, vals_sp = [], [], []
    # budget row 0
    for i in range(n_cands):
        rows_sp.append(0)
        cols_sp.append(i)
        vals_sp.append(1.0)
    # coverage rows 1..M
    ii, jj = np.where(vis)
    rows_sp.extend((jj + 1).tolist())
    cols_sp.extend(ii.tolist())
    vals_sp.extend([-1.0] * len(ii))
    for j in range(m_cells):
        rows_sp.append(j + 1)
        cols_sp.append(n_cands + j)
        vals_sp.append(1.0)

    A = sp.csc_matrix((vals_sp, (rows_sp, cols_sp)), shape=(1 + m_cells, n_cands + m_cells))
    row_lb = np.full(1 + m_cells, -np.inf)
    row_ub = np.concatenate([[float(budget_k)], np.zeros(m_cells)])

    res = milp(
        c=c_obj,
        integrality=integrality,
        bounds=Bounds(lb, ub),
        constraints=LinearConstraint(A, row_lb, row_ub),
        options={"time_limit": 20.0, "mip_rel_gap": 1e-4},
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if not res.success and res.x is None:
        return [], {"cams": 0, "status": res.message, "runtime_ms": round(elapsed_ms, 1)}
    x_sol = np.round(res.x[:n_cands]).astype(int)
    sel_cams = [cands[i] for i in np.where(x_sol > 0)[0]]
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(elapsed_ms, 1)
    ev["native_cov_2d_pct"] = round(float(np.mean(np.any(vis[x_sol > 0], axis=0)) * 100.0), 1) if len(sel_cams) else 0.0
    ev["mip_status"] = res.status
    return sel_cams, ev


def run_erdem_set_cover(bundle: dict[str, Any], mounts: str = "mixed", min_ppm: float = 25.0, hotspot_ppm: float | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Erdem & Sclaroff (2006) Eq. 6 Exact 0-1 BIP Set Cover:
      min sum(x_i)  s.t. A^T x >= 1 (on all 2D-coverable cells).
    If hotspot_ppm is provided (Problem 4, Sec 6.3), Red cells (W >= 4) require hotspot_ppm
    while non-Red cells require min_ppm.
    """
    t0 = time.perf_counter()
    cands = _erdem_candidate_pool(bundle, mounts=mounts)
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    layout = bundle["layout"]

    vis_base = compute_vis2d_matrix(cands, xs, ys, bundle["obstacles"], layout.floorPolygon, min_ppm=min_ppm)
    if hotspot_ppm is not None:
        vis_hot = compute_vis2d_matrix(cands, xs, ys, bundle["obstacles"], layout.floorPolygon, min_ppm=hotspot_ppm)
        red_mask = ws >= 4.0
        vis = vis_base.copy()
        vis[:, red_mask] = vis_hot[:, red_mask]
    else:
        vis = vis_base

    keep = np.any(vis > 0, axis=1)
    cands = [c for c, k in zip(cands, keep) if k]
    vis = vis[keep]
    n_cands, m_cells = vis.shape

    coverable = np.any(vis > 0, axis=0)
    cov_idx = np.where(coverable)[0]
    vis_sub = vis[:, cov_idx]  # (N, M_cov)
    m_cov = cov_idx.size

    c_obj = np.ones(n_cands)
    integrality = np.ones(n_cands)
    A = sp.csc_matrix(vis_sub.T.astype(np.float64))  # (M_cov, N)
    res = milp(
        c=c_obj,
        integrality=integrality,
        bounds=Bounds(0.0, 1.0),
        constraints=LinearConstraint(A, np.ones(m_cov), np.full(m_cov, np.inf)),
        options={"time_limit": 20.0, "mip_rel_gap": 0.0},
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    if not res.success and res.x is None:
        return [], {"cams": 0, "status": res.message, "runtime_ms": round(elapsed_ms, 1)}
    x_sol = np.round(res.x).astype(int)
    sel_cams = [cands[i] for i in np.where(x_sol > 0)[0]]
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(elapsed_ms, 1)
    ev["coverable_pct"] = round(float(m_cov / m_cells * 100.0), 1)
    return sel_cams, ev


# ---------------------------------------------------------------------------
# 2. Aziz et al. (ITcon 2024) — 2D GA #3 with ROI and Overlap Penalty
# ---------------------------------------------------------------------------
def _sample_valid_floor_points(bundle: dict[str, Any], rng: np.random.Generator, count: int) -> tuple[np.ndarray, np.ndarray]:
    layout = bundle["layout"]
    W, H = layout.widthM, layout.heightM
    poly = layout.floorPolygon
    obstacles = bundle["obstacles"]
    xs_out, ys_out = [], []
    margin = 0.12
    while len(xs_out) < count:
        need = count - len(xs_out)
        cand_x = rng.uniform(margin, W - margin, size=need * 4)
        cand_y = rng.uniform(margin, H - margin, size=need * 4)
        ok = np.ones(cand_x.shape[0], dtype=bool)
        if poly:
            ok &= _points_in_polygon_vec(cand_x, cand_y, poly)
            for dx, dy in [(margin, 0), (-margin, 0), (0, margin), (0, -margin)]:
                ok &= _points_in_polygon_vec(cand_x + dx, cand_y + dy, poly)
        for idx in np.where(ok)[0]:
            x, y = float(cand_x[idx]), float(cand_y[idx])
            if any(o["type"] != "entrance" and _distance_to_obstacle((x, y), o) < 0.05 for o in obstacles):
                continue
            xs_out.append(x)
            ys_out.append(y)
            if len(xs_out) >= count:
                break
    return np.array(xs_out[:count]), np.array(ys_out[:count])


def _is_valid_floor_point(x: float, y: float, bundle: dict[str, Any]) -> bool:
    layout = bundle["layout"]
    margin = 0.12
    if not (margin <= x <= layout.widthM - margin and margin <= y <= layout.heightM - margin):
        return False
    poly = layout.floorPolygon
    if poly:
        for dx, dy in [(0, 0), (margin, 0), (-margin, 0), (0, margin), (0, -margin)]:
            if not point_in_floor((x + dx, y + dy), poly):
                return False
    if any(o["type"] != "entrance" and _distance_to_obstacle((x, y), o) < 0.05 for o in bundle["obstacles"]):
        return False
    return True


def run_aziz_ga(
    bundle: dict[str, Any],
    budget_k: int = 3,
    overlap_penalty: float = 0.5,
    seed: int = 2026,
    max_gens: int = 120,
    patience: int = 50,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Aziz et al. (2024) GA #3:
      pop_size = 80, elitism = 0.05 (4), mutation_rate = 0.5, tournament = 3, single-point crossover.
      Fitness Eq. (1): (coverage + roi_coverage - fr_coverage - overlap_penalty * overlap) / total_cells
    """
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    layout = bundle["layout"]
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    m_cells = len(xs)
    roi_mask = (ws >= 4.0)  # POS and entrances = Regions of Interest
    drop = min(0.15, layout.ceilingHeight - 1.8)
    ceil_h = layout.ceilingHeight - drop

    pop_size = 80
    elite_n = 4  # 5% of 80
    mut_rate = 0.5
    tourn_size = 3
    step_xy = max(layout.widthM, layout.heightM) * 0.15
    step_ang = 45.0

    # Initialize population: shape (pop_size, K, 3) -> [x, y, pan]
    init_x, init_y = _sample_valid_floor_points(bundle, rng, pop_size * budget_k)
    init_ang = rng.uniform(0.0, 360.0, size=pop_size * budget_k)
    pop = np.stack([init_x, init_y, init_ang], axis=1).reshape(pop_size, budget_k, 3)

    def eval_population(pop_arr: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        flat = pop_arr.reshape(-1, 3)
        cams = [
            {
                **DEFAULT_CAM,
                "x": float(r[0]),
                "y": float(r[1]),
                "pan": float(r[2] % 360.0),
                "tilt": 35.0,
                "height": ceil_h,
                "mount": "ceiling",
                "ceilingDrop": drop,
            }
            for r in flat
        ]
        vis = compute_vis2d_matrix(cams, xs, ys, bundle["obstacles"], layout.floorPolygon, min_ppm=None)
        vis = vis.reshape(pop_size, budget_k, m_cells)
        cov_cnt = vis.sum(axis=1)  # (pop_size, m_cells)
        cov = (cov_cnt >= 1).sum(axis=1)
        roi_cov = ((cov_cnt[:, roi_mask] >= 1).sum(axis=1)) if np.any(roi_mask) else np.zeros(pop_size)
        overlap = (cov_cnt >= 2).sum(axis=1)
        fit = (cov + roi_cov - overlap_penalty * overlap) / float(m_cells)
        return fit, vis

    best_fit = -1e9
    best_chrom = None
    stagnant = 0
    gens_run = 0

    for gen in range(max_gens):
        gens_run = gen + 1
        fit, _ = eval_population(pop)
        order = np.argsort(-fit)
        if fit[order[0]] > best_fit + 1e-9:
            best_fit = float(fit[order[0]])
            best_chrom = pop[order[0]].copy()
            stagnant = 0
        else:
            stagnant += 1
            if stagnant >= patience:
                break

        new_pop = [pop[idx].copy() for idx in order[:elite_n]]

        # Tournament selection + single-point crossover (Eqs. 5-7)
        flat_len = budget_k * 3
        while len(new_pop) < pop_size:
            def tourn():
                cand = rng.integers(0, pop_size, size=tourn_size)
                return pop[cand[int(np.argmax(fit[cand]))]].reshape(flat_len)

            p1 = tourn()
            p2 = tourn()
            if flat_len > 1:
                cp = int(rng.integers(1, flat_len))
                c1 = np.concatenate([p1[:cp], p2[cp:]]).reshape(budget_k, 3)
                c2 = np.concatenate([p2[:cp], p1[cp:]]).reshape(budget_k, 3)
            else:
                c1, c2 = p1.reshape(budget_k, 3).copy(), p2.reshape(budget_k, 3).copy()

            for child in (c1, c2):
                for k in range(budget_k):
                    if rng.random() < mut_rate:
                        if rng.random() < 0.15:
                            # Global exploration jump
                            nx, ny = _sample_valid_floor_points(bundle, rng, 1)
                            child[k, 0], child[k, 1] = float(nx[0]), float(ny[0])
                            child[k, 2] = float(rng.uniform(0.0, 360.0))
                        else:
                            dx = float(rng.uniform(-step_xy, step_xy))
                            dy = float(rng.uniform(-step_xy, step_xy))
                            dth = float(rng.uniform(-step_ang, step_ang))
                            nx, ny = float(child[k, 0] + dx), float(child[k, 1] + dy)
                            if _is_valid_floor_point(nx, ny, bundle):
                                child[k, 0], child[k, 1] = nx, ny
                            child[k, 2] = float((child[k, 2] + dth) % 360.0)
                    # Ensure valid floor point even after crossover
                    if not _is_valid_floor_point(float(child[k, 0]), float(child[k, 1]), bundle):
                        nx, ny = _sample_valid_floor_points(bundle, rng, 1)
                        child[k, 0], child[k, 1] = float(nx[0]), float(ny[0])
                new_pop.append(child)
                if len(new_pop) >= pop_size:
                    break
        pop = np.stack(new_pop[:pop_size], axis=0)

    sel_cams = [
        {
            **DEFAULT_CAM,
            "id": f"AZIZ-{k+1:02d}",
            "x": round(float(best_chrom[k, 0]), 3),
            "y": round(float(best_chrom[k, 1]), 3),
            "pan": round(float(best_chrom[k, 2] % 360.0), 1),
            "tilt": 35.0,
            "height": ceil_h,
            "mount": "ceiling",
            "ceilingDrop": drop,
        }
        for k in range(budget_k)
    ]
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(elapsed_ms, 1)
    ev["native_fitness"] = round(best_fit, 4)
    ev["gens"] = gens_run
    return sel_cams, ev


# ---------------------------------------------------------------------------
# 3. Kim et al. (ASCE JCEM 2019) — Semantic-Cost GA maximizing WVCR
# ---------------------------------------------------------------------------
def run_kim_ga(
    bundle: dict[str, Any],
    budget_k: int = 3,
    seed: int = 2026,
    max_gens: int = 100,
    patience: int = 50,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Kim et al. (2019) Semantic-Cost GA:
      - Installable locations on wall boundaries (_wall_anchors).
      - Spatial-contextual weights w_j = OptiCam W_j; binary coverage (PPM >= 25 within sector, no DORI tiers).
      - Stochastic uniform selection, 5% elitism, 95% split into 80% semantic scattered crossover / 20% adaptive+uniform mutation.
      - Terminal: 50 stagnant gens or 100 max gens.
    """
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    layout = bundle["layout"]
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    total_w = float(np.sum(ws))
    step = max(layout.gridM, 0.5)
    wall_h = min(2.4, layout.ceilingHeight - 0.3)

    anchors = [
        (float(x), float(y))
        for x, y in _wall_anchors(layout.widthM, layout.heightM, step, layout.floorPolygon)
        if not any(o.type != "entrance" and o.elev >= wall_h - 0.08 and _distance_to_obstacle((x, y), o) < 0.12 for o in layout.obstacles)
    ]
    n_anc = len(anchors)
    n_angles = 24  # 15 deg resolution on pan
    angles = [i * 15.0 for i in range(n_angles)]

    # Precompute binary coverage matrix over (n_anc * n_angles) candidates
    cands = [
        {**DEFAULT_CAM, "x": ax, "y": ay, "pan": pan, "tilt": 20.0, "height": wall_h, "mount": "wall"}
        for (ax, ay) in anchors
        for pan in angles
    ]
    ppm_all = compute_ppm_matrix(cands, xs, ys, bundle["obstacles"], layout.targetHeight, layout.floorPolygon)
    cov_bin = (ppm_all >= 25.0).reshape(n_anc, n_angles, len(xs))

    pop_size = 80
    elite_n = 4  # 5%
    rem_n = pop_size - elite_n  # 76
    cross_n = round(0.80 * rem_n)  # 61

    # Chromosome: (budget_k, 2) -> [anchor_idx, angle_idx]
    pop = np.zeros((pop_size, budget_k, 2), dtype=int)
    for p in range(pop_size):
        chosen_anc = rng.choice(n_anc, size=budget_k, replace=(n_anc < budget_k))
        chosen_ang = rng.integers(0, n_angles, size=budget_k)
        pop[p, :, 0] = chosen_anc
        pop[p, :, 1] = chosen_ang

    def eval_pop(pop_arr: np.ndarray) -> np.ndarray:
        a_idx = pop_arr[:, :, 0]
        t_idx = pop_arr[:, :, 1]
        cov = np.any(cov_bin[a_idx, t_idx], axis=1)  # (pop_size, m_cells)
        return (cov @ ws) / total_w

    best_fit = -1.0
    best_chrom = None
    stagnant = 0
    gens_run = 0
    mut_step_anc = max(1, n_anc // 10)
    mut_step_ang = 3

    for gen in range(max_gens):
        gens_run = gen + 1
        fit = eval_pop(pop)
        order = np.argsort(-fit)
        if fit[order[0]] > best_fit + 1e-9:
            best_fit = float(fit[order[0]])
            best_chrom = pop[order[0]].copy()
            stagnant = 0
            mut_step_anc = max(1, mut_step_anc)
        else:
            stagnant += 1
            if stagnant >= patience:
                break

        # Stochastic uniform selection proportional to fitness (SUS)
        probs = np.maximum(fit, 1e-9)
        probs = probs / probs.sum()
        cdf = np.cumsum(probs)
        start = rng.uniform(0.0, 1.0 / rem_n)
        pointers = start + np.arange(rem_n) / rem_n
        pool_idx = np.searchsorted(cdf, pointers)
        rng.shuffle(pool_idx)

        new_pop = [pop[idx].copy() for idx in order[:elite_n]]

        # 80% Semantic scattered crossover (swaps loc or orientation cleanly, never mixing loc with angle)
        for idx_p in range(0, cross_n, 2):
            p1 = pop[pool_idx[idx_p % rem_n]].copy()
            p2 = pop[pool_idx[(idx_p + 1) % rem_n]].copy()
            c1, c2 = p1.copy(), p2.copy()
            for k in range(budget_k):
                if rng.random() < 0.5:
                    c1[k, 0], c2[k, 0] = p2[k, 0], p1[k, 0]
                if rng.random() < 0.5:
                    c1[k, 1], c2[k, 1] = p2[k, 1], p1[k, 1]
            # Enforce unique anchor per Eq. 6
            for child in (c1, c2):
                seen = set()
                for k in range(budget_k):
                    while child[k, 0] in seen and n_anc >= budget_k:
                        child[k, 0] = int(rng.integers(0, n_anc))
                    seen.add(int(child[k, 0]))
            new_pop.append(c1)
            if len(new_pop) < elite_n + cross_n:
                new_pop.append(c2)

        # 20% Adaptive feasible + uniform random mutation
        while len(new_pop) < pop_size:
            parent = pop[pool_idx[len(new_pop) % rem_n]].copy()
            k = int(rng.integers(0, budget_k))
            if rng.random() < 0.5:
                # Adaptive local move along perimeter & angle
                da = int(rng.integers(-mut_step_anc, mut_step_anc + 1))
                dt = int(rng.integers(-mut_step_ang, mut_step_ang + 1))
                parent[k, 0] = (parent[k, 0] + da) % n_anc
                parent[k, 1] = (parent[k, 1] + dt) % n_angles
            else:
                # Uniform random exploration
                parent[k, 0] = int(rng.integers(0, n_anc))
                parent[k, 1] = int(rng.integers(0, n_angles))
            # Enforce unique anchor per Eq. 6
            others = {int(parent[j, 0]) for j in range(budget_k) if j != k}
            while int(parent[k, 0]) in others and n_anc >= budget_k:
                parent[k, 0] = int(rng.integers(0, n_anc))
            new_pop.append(parent)

        pop = np.stack(new_pop[:pop_size], axis=0)

    sel_cams = [
        {
            **DEFAULT_CAM,
            "id": f"KIM-{k+1:02d}",
            "x": anchors[int(best_chrom[k, 0])][0],
            "y": anchors[int(best_chrom[k, 0])][1],
            "pan": angles[int(best_chrom[k, 1])],
            "tilt": 20.0,
            "height": wall_h,
            "mount": "wall",
        }
        for k in range(budget_k)
    ]
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(elapsed_ms, 1)
    ev["native_wvcr_pct"] = round(best_fit * 100.0, 1)
    ev["gens"] = gens_run
    return sel_cams, ev


# ---------------------------------------------------------------------------
# 4. Wang et al. (Sensors 2013) — Anisotropic Sensing + l1-Relaxed SOCP
# ---------------------------------------------------------------------------
def _solve_wang_socp(B: np.ndarray, w_vec: np.ndarray, Q0: float = 0.1, E0: float = 1.8) -> np.ndarray:
    """
    Solve Wang et al. (2013) Eq. (8) via Clarabel interior-point SOCP:
      min  sum(z) + ||(I - 1/n 11^T) W B z||_2 + 1000 * sum(s)
      s.t. W B z + s >= Q0 * 1,  b^T z + s_e >= E0,  0 <= z <= 1,  s >= 0, s_e >= 0
    Notice mu = sqrt(n) cancels 1/sqrt(n) in B_v = 1/sqrt(n)(I - 1/n 11^T) W B!
    """
    n, m = B.shape
    W_inv = (1.0 / w_vec)[:, None]
    WB = W_inv * B  # (n, m)
    mean_row = WB.mean(axis=0, keepdims=True)  # b^T = (1, m)
    Bv_scaled = WB - mean_row  # mu * B_v = (I - 1/n 11^T) W B

    # Variables: [z (m), t (1), s (n), s_e (1)]  -> total N_var = m + 1 + n + 1
    # Objective: sum(z) + t + 1000 * sum(s) + 1000 * s_e
    N_var = m + 1 + n + 1
    q_obj = np.zeros(N_var, dtype=np.float64)
    q_obj[:m] = 1.0
    q_obj[m] = 1.0
    q_obj[m + 1:] = 1000.0
    P = sp.csc_matrix((N_var, N_var), dtype=np.float64)

    # Cones in Clarabel: NonnegativeConeT (linear inequalities A x + s_cone = b_rhs, s_cone >= 0)
    # and SecondOrderConeT(1 + n) for ||Bv_scaled z||_2 <= t
    blocks_A = []
    blocks_b = []
    cones = []

    # 1) -W B z - s <= -Q0 * 1  <=> -W B z - s + s_cone = -Q0 * 1
    A1 = sp.hstack([-sp.csc_matrix(WB), sp.csc_matrix((n, 1)), -sp.eye(n, format="csc"), sp.csc_matrix((n, 1))], format="csc")
    b1 = np.full(n, -Q0, dtype=np.float64)
    blocks_A.append(A1)
    blocks_b.append(b1)

    # 2) -b^T z - s_e <= -E0
    A2 = sp.hstack([-sp.csc_matrix(mean_row), sp.csc_matrix((1, 1 + n)), -sp.csc_matrix([[1.0]])], format="csc")
    b2 = np.array([-E0], dtype=np.float64)
    blocks_A.append(A2)
    blocks_b.append(b2)

    # 3) z <= 1, -z <= 0, -s <= 0, -s_e <= 0
    A3 = sp.hstack([sp.eye(m, format="csc"), sp.csc_matrix((m, 1 + n + 1))], format="csc")
    b3 = np.ones(m, dtype=np.float64)
    blocks_A.append(A3)
    blocks_b.append(b3)

    A4 = sp.hstack([-sp.eye(m, format="csc"), sp.csc_matrix((m, 1 + n + 1))], format="csc")
    b4 = np.zeros(m, dtype=np.float64)
    blocks_A.append(A4)
    blocks_b.append(b4)

    A5 = sp.hstack([sp.csc_matrix((n + 1, m + 1)), -sp.eye(n + 1, format="csc")], format="csc")
    b5 = np.zeros(n + 1, dtype=np.float64)
    blocks_A.append(A5)
    blocks_b.append(b5)

    cones.append(clarabel.NonnegativeConeT(n + 1 + m + m + n + 1))

    # 4) SOC: (t, Bv_scaled z) in SOC_{n+1}  <=>  [-e_t; -Bv_scaled] x + s_soc = 0
    A_soc_top = sp.hstack([sp.csc_matrix((1, m)), sp.csc_matrix([[-1.0]]), sp.csc_matrix((1, n + 1))], format="csc")
    A_soc_bot = sp.hstack([-sp.csc_matrix(Bv_scaled), sp.csc_matrix((n, 1 + n + 1))], format="csc")
    blocks_A.extend([A_soc_top, A_soc_bot])
    blocks_b.extend([np.zeros(1), np.zeros(n)])
    cones.append(clarabel.SecondOrderConeT(1 + n))

    A_all = sp.vstack(blocks_A, format="csc")
    b_all = np.concatenate(blocks_b)

    settings = clarabel.DefaultSettings()
    settings.verbose = False
    solver = clarabel.DefaultSolver(P, q_obj, A_all, b_all, cones, settings)
    sol = solver.solve()
    return np.clip(np.array(sol.x[:m], dtype=np.float64), 0.0, 1.0)


def run_wang_sparse(
    bundle: dict[str, Any],
    budget_k: int | None = 3,
    mounts: str = "mixed",
    weighted: bool = False,
    Q0: float = 0.1,
    E0: float = 1.8,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Wang et al. (Sensors 2013):
      - weighted=False (Sec 3.2.1): uniform weights w(p) = 1.0
      - weighted=True  (Sec 3.2.2): critical weights w(p) = W_j
      - budget_k=None: native threshold stopping (collect descending z until W B z_bin >= Q0 on coverable points)
      - budget_k=K: select top-K distinct poses from non-zero relaxed support ranked by z*
    """
    t0 = time.perf_counter()
    cands = _erdem_candidate_pool(bundle, mounts=mounts)
    # Subsample slightly if huge to keep Clarabel <= 1-2s (Wang 2013 uses <= 1000 poses)
    if len(cands) > 900:
        cands = [cands[math.floor(i * len(cands) / 900)] for i in range(900)]
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    layout = bundle["layout"]

    B_full = compute_wang_q_matrix(cands, xs, ys, bundle["obstacles"], layout.floorPolygon, occlusion_mode="2d", target_height=layout.targetHeight)
    keep = np.any(B_full >= Q0, axis=1)
    cands = [c for c, k in zip(cands, keep) if k]
    B = B_full[keep].T  # (n_cells, m_cands)

    w_vec = ws if weighted else np.ones_like(ws)
    z_star = _solve_wang_socp(B, w_vec, Q0=Q0, E0=E0)
    ranked = np.argsort(-z_star)

    if budget_k is None:
        # Native Wang 2013 selection: add cameras in descending z_star until coverable constraints satisfied
        # Check coverable points with max possible (all cameras = 1 -> B.sum(axis=1) / w_vec >= Q0)
        coverable = (B.sum(axis=1) / w_vec) >= Q0
        sel_idx = []
        acc_q = np.zeros(len(xs), dtype=np.float64)
        for idx in ranked:
            sel_idx.append(int(idx))
            acc_q += B[:, idx]
            ok_pt = (not np.any(coverable)) or bool(np.all((acc_q[coverable] / w_vec[coverable]) >= Q0))
            ok_avg = float(np.mean(acc_q / w_vec)) >= min(E0, float(np.mean(B.sum(axis=1) / w_vec)) * 0.99)
            if ok_pt and ok_avg:
                break
    else:
        # Fixed-K selection: pick top-K from descending z_star, avoiding exact same (x,y) overlap if redundant,
        # OR pure top-K descending z_star (exact paper rounding rule). Let's implement exact descending z_star!
        sel_idx = [int(i) for i in ranked[:budget_k]]

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    sel_cams = [{**cands[i], "id": f"WANG-{k+1:02d}"} for k, i in enumerate(sel_idx)]
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(elapsed_ms, 1)
    ev["nonzero_gt_01"] = int(np.sum(z_star > 0.1))
    if sel_idx:
        q_sum = B[:, sel_idx].sum(axis=1)
        ev["native_wang_cov_pct"] = round(float(np.mean(q_sum >= Q0) * 100.0), 1)
        ev["native_wang_eq"] = round(float(np.mean(q_sum / w_vec)), 2)
        ev["native_wang_dq"] = round(float(np.var(q_sum / w_vec)), 2)
    return sel_cams, ev
