"""Precomputed geometry/visibility cache + fast vectorized OptiCam & parameter-sweep engine."""
from __future__ import annotations

import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from opticam_fast import compute_ppm_matrix, evaluate_opticam, get_opticam_candidates
from backend.greedy_optimizer import RISK_DEFAULTS, SHELF_RISK_PROFILES, _distance_to_obstacle, _value


@dataclass
class LayoutCache:
    """Cached per-layout geometry, distance fields, candidate visibility, and subset masks."""

    bundle: dict[str, Any]
    name: str
    xs: np.ndarray
    ys: np.ndarray
    ws_prod: np.ndarray
    obs_specs: list[dict[str, Any]]
    obs_dists: np.ndarray  # shape (N_obs, M_cells)
    row_col_indices: list[tuple[int, int]]
    cands: list[dict[str, Any]]
    ppm_mat: np.ndarray  # shape (N_cands_kept, M_cells)
    tie_mat: np.ndarray  # min(ppm_mat, 250.0)
    poses: list[tuple[Any, ...]]
    mask_wall: np.ndarray
    mask_az8: np.ndarray  # 8 yaw steps * 45 deg + default tilt only (pan/tilt ablation)
    pos_ent_cells: np.ndarray  # exact geometric mask of cells within default POS/entrance footprints (weight-agnostic)
    shelf_cells: np.ndarray    # exact geometric mask of cells near shelf footprints (weight-agnostic)


def build_layout_cache(bundle: dict[str, Any]) -> LayoutCache:
    """Precompute ray-cast visibility and obstacle distances once per layout."""
    layout = bundle["layout"]
    xs, ys, ws_prod = bundle["xs"], bundle["ys"], bundle["ws"]
    cands_all, _ = get_opticam_candidates(bundle, mounts="mixed")
    ppm_full = compute_ppm_matrix(
        cands_all, xs, ys, bundle["obstacles"], layout.targetHeight, layout.floorPolygon
    )
    keep = np.any(ppm_full > 0, axis=1)
    cands = [c for c, k in zip(cands_all, keep) if k]
    ppm_mat = ppm_full[keep]
    tie_mat = np.minimum(ppm_mat, 250.0)
    poses = [
        (c.get("mount", "wall"), c["x"], c["y"], c["pan"], c.get("tilt", 20.0), c["height"])
        for c in cands
    ]

    mask_wall = np.array([c.get("mount", "wall") == "wall" for c in cands], dtype=bool)
    # Azimuth-only subset: wall mount, pan multiples of 45, default tilt (20 deg)
    mask_az8 = np.array(
        [
            (c.get("mount", "wall") == "wall")
            and (abs(float(c["pan"]) % 45.0) < 1e-6)
            and (abs(float(c.get("tilt", 20.0)) - 20.0) < 1e-6)
            for c in cands
        ],
        dtype=bool,
    )
    if not np.any(mask_az8):
        # Fallback if custom angles differ
        mask_az8 = mask_wall.copy()

    # Cache obstacle distance matrix for sub-millisecond weight re-computation
    obs_specs: list[dict[str, Any]] = []
    n_cells = len(xs)
    dist_rows = []
    pos_ent_cells = np.zeros(n_cells, dtype=bool)
    shelf_cells = np.zeros(n_cells, dtype=bool)
    for obs in bundle["obstacles"]:
        otype = _value(obs, "type", "shelf")
        if otype not in RISK_DEFAULTS:
            continue
        dists = np.array([_distance_to_obstacle((float(x), float(y)), obs) for x, y in zip(xs, ys)], dtype=np.float64)
        obs_specs.append({
            "type": otype,
            "category": _value(obs, "riskCategory", "standard") or "standard",
            "custom_wmax": _value(obs, "riskWmax"),
            "custom_r0": _value(obs, "riskR0"),
            "custom_radius": _value(obs, "riskR"),
        })
        dist_rows.append(dists)
        cw = obs_spec_w = _value(obs, "riskWmax")
        if otype in ("pos", "entrance"):
            pos_ent_cells |= dists <= 0.65  # immediate cashier/doorway choke-point zone (physical geometry only)
        elif otype == "shelf" and (cw is None or float(cw) > 1.05):
            shelf_cells |= dists <= 0.65    # immediate shelf picking zone (excludes 1.0 dining/seating areas)

    obs_dists = np.stack(dist_rows, axis=0) if dist_rows else np.zeros((0, n_cells), dtype=np.float64)
    grid_m = float(layout.gridM)
    row_col_indices = [
        (math.floor(float(y) / grid_m - 0.5 + 1e-9), math.floor(float(x) / grid_m - 0.5 + 1e-9))
        for x, y in zip(xs, ys)
    ]

    return LayoutCache(
        bundle=bundle,
        name=bundle["filename"],
        xs=xs,
        ys=ys,
        ws_prod=ws_prod,
        obs_specs=obs_specs,
        obs_dists=obs_dists,
        row_col_indices=row_col_indices,
        cands=cands,
        ppm_mat=ppm_mat,
        tie_mat=tie_mat,
        poses=poses,
        mask_wall=mask_wall,
        mask_az8=mask_az8,
        pos_ent_cells=pos_ent_cells,
        shelf_cells=shelf_cells,
    )


def compute_weights(
    cache: LayoutCache,
    w_pos: float = 5.0,
    w_shelf: float = 3.0,
    w_floor: float = 1.0,
    w_high: float = 4.5,
    w_bulky: float = 1.8,
    r0_pos: float = 1.0,
    R_pos: float = 2.5,
    r0_shelf: float = 1.0,
    R_shelf: float = 2.0,
    respect_custom: bool = True,
    scale_custom: bool = True,
) -> np.ndarray:
    """Compute grid weights for any risk configuration in <0.05 ms."""
    n_cells = len(cache.xs)
    ws = np.full(n_cells, float(w_floor), dtype=np.float64)
    shelf_map = {"high": w_high, "standard": w_shelf, "bulky": w_bulky, "custom": w_shelf}
    pos_ratio = (w_pos - w_floor) / 4.0
    shelf_ratio = (w_shelf - w_floor) / 2.0

    for idx, spec in enumerate(cache.obs_specs):
        otype = spec["type"]
        if otype in ("pos", "entrance"):
            base_w, base_r0, base_R = w_pos, r0_pos, R_pos
        else:
            base_w = shelf_map.get(spec["category"], w_shelf)
            base_r0, base_R = r0_shelf, R_shelf

        cw = spec["custom_wmax"]
        if respect_custom and cw is not None:
            cw_f = float(cw)
            if not scale_custom:
                wmax = cw_f
            elif cw_f <= 1.05:
                wmax = float(w_floor)
            elif otype in ("pos", "entrance") or cw_f >= 4.9:
                wmax = float(w_floor) + (cw_f - 1.0) * pos_ratio
            elif abs(cw_f - 4.5) < 0.1:
                wmax = float(w_high)
            elif abs(cw_f - 2.0) < 0.25 and abs(w_bulky - 1.8) > 1e-6:
                wmax = float(w_bulky)
            else:
                wmax = float(w_floor) + (cw_f - 1.0) * shelf_ratio
        else:
            wmax = float(base_w)

        r0 = float(spec["custom_r0"]) if (respect_custom and spec["custom_r0"] is not None) else float(base_r0)
        rad = float(spec["custom_radius"]) if (respect_custom and spec["custom_radius"] is not None) else float(base_R)
        if respect_custom and scale_custom and spec["custom_r0"] is not None and abs(r0_pos - 1.0) > 1e-6:
            r0 = r0 * (r0_pos if otype in ("pos", "entrance") else r0_shelf)
        if respect_custom and scale_custom and spec["custom_radius"] is not None and abs(R_pos - 2.5) > 1e-6:
            rad = rad * ((R_pos / 2.5) if otype in ("pos", "entrance") else (R_shelf / 2.0))

        d = cache.obs_dists[idx]
        if rad <= r0:
            contrib = np.where(d <= r0, wmax, float(w_floor))
        else:
            t = np.clip((d - r0) / (rad - r0), 0.0, 1.0)
            contrib = np.where(d <= r0, wmax, float(w_floor) + (wmax - float(w_floor)) * (1.0 - t))
        ws = np.maximum(ws, contrib)

    layout = cache.bundle["layout"]
    if layout.legacy_risk if hasattr(layout, "legacy_risk") else layout.risk:
        risk_dict = layout.risk or {}
        for j, (r_idx, c_idx) in enumerate(cache.row_col_indices):
            key = f"{r_idx}_{c_idx}"
            if key in risk_dict:
                ws[j] = float(risk_dict[key])

    if layout.riskStrokes:
        scale_ratio = w_pos / 5.0 if abs(w_pos - 5.0) > 1e-9 else 1.0
        for stroke in layout.riskStrokes:
            dist_s = np.hypot(cache.xs - float(stroke.x), cache.ys - float(stroke.y))
            hit = dist_s <= float(stroke.radius)
            sw = float(stroke.weight)
            # Preserve exact production weights at default, scale proportionately when sweeping non-custom strokes
            if not respect_custom and sw >= 4.0:
                sw = sw * scale_ratio
            ws[hit] = sw

    return ws


def dori_factor_param(ppm: np.ndarray, f_rec: float = 0.75, f_obs: float = 0.40, f_det: float = 0.20) -> np.ndarray:
    """Parameterized piecewise-constant DORI factor array."""
    out = np.zeros_like(ppm, dtype=np.float64)
    out = np.where(ppm >= 25.0, f_det, out)
    out = np.where(ppm >= 62.5, f_obs, out)
    out = np.where(ppm >= 125.0, f_rec, out)
    out = np.where(ppm >= 250.0, 1.00, out)
    return out


def evaluate_from_ppm(
    best_ppm: np.ndarray,
    ws: np.ndarray,
    cache: LayoutCache | None = None,
    t_red: float = 4.0,
    t_yel: float = 2.0,
    tau_red: float = 95.0,
    tau_yel: float = 80.0,
    f_rec: float = 0.75,
    f_obs: float = 0.40,
    f_det: float = 0.20,
    grid_m: float = 0.5,
) -> dict[str, Any]:
    """Fast array-based evaluator returning exact OptiCam metrics + weight-agnostic physical metrics."""
    n = len(ws)
    total_w = float(np.sum(ws))
    f_vals = dori_factor_param(best_ppm, f_rec=f_rec, f_obs=f_obs, f_det=f_det)
    weighted = float(np.sum(ws * f_vals))

    red_mask = ws >= t_red
    yel_mask = (ws >= t_yel) & (ws < t_red)
    red_n = int(np.sum(red_mask))
    yel_n = int(np.sum(yel_mask))
    red_ok = int(np.sum(best_ppm[red_mask] >= 250.0)) if red_n else 0
    yel_ok = int(np.sum(best_ppm[yel_mask] >= 125.0)) if yel_n else 0

    red_pct = (red_ok / red_n * 100.0) if red_n else 100.0
    yel_pct = (yel_ok / yel_n * 100.0) if yel_n else 100.0
    red_min_ppm = float(np.min(best_ppm[red_mask])) if red_n else 0.0
    uncov_red_m2 = float((red_n - red_ok) * (grid_m * grid_m))

    area_cov = float(np.sum(best_ppm >= 25.0)) / n * 100.0 if n else 100.0
    obs_cov = float(np.sum(best_ppm >= 62.5)) / n * 100.0 if n else 100.0
    rec_cov = float(np.sum(best_ppm >= 125.0)) / n * 100.0 if n else 100.0
    id_cov = float(np.sum(best_ppm >= 250.0)) / n * 100.0 if n else 100.0

    # Weight-agnostic physical choke-point/shelf metrics (computed on fixed geometric masks!)
    out: dict[str, Any] = {
        "weighted": round(weighted, 2),
        "weighted_raw": weighted,
        "weighted_pct": round(weighted / total_w * 100.0, 2) if total_w else 100.0,
        "red_pct": round(red_pct, 1),
        "yellow_pct": round(yel_pct, 1),
        "red_min_ppm": round(red_min_ppm, 1),
        "uncov_red_m2": round(uncov_red_m2, 3),
        "kpi_pass": (round(red_pct, 1) >= tau_red) and (round(yel_pct, 1) >= tau_yel),
        "area_cov_pct": round(area_cov, 1),
        "obs_pct": round(obs_cov, 1),
        "rec_pct": round(rec_cov, 1),
        "id_pct": round(id_cov, 1),
        "red_cells": red_n,
        "yellow_cells": yel_n,
    }
    if cache is not None:
        pe = cache.pos_ent_cells
        sh = cache.shelf_cells & (~pe)
        if np.any(pe):
            out["phys_choke_id_pct"] = round(float(np.mean(best_ppm[pe] >= 250.0) * 100.0), 2)
            out["phys_choke_rec_pct"] = round(float(np.mean(best_ppm[pe] >= 125.0) * 100.0), 2)
            out["phys_choke_min_ppm"] = round(float(np.min(best_ppm[pe])), 1)
        else:
            out["phys_choke_id_pct"] = 100.0
            out["phys_choke_rec_pct"] = 100.0
            out["phys_choke_min_ppm"] = 0.0
        out["phys_shelf_rec_pct"] = round(float(np.mean(best_ppm[sh] >= 125.0) * 100.0), 2) if np.any(sh) else 100.0
    return out


def solve_opticam_cached(
    cache: LayoutCache,
    ws: np.ndarray | None = None,
    budget_k: int = 3,
    cand_mask: np.ndarray | None = None,
    algorithm: str = "hybrid",
    f_rec: float = 0.75,
    f_obs: float = 0.40,
    f_det: float = 0.20,
    kpi_mode: str = "none",  # 'none' | 'hinge' | 'twostage'
    lambda_red: float = 8.0,
    lambda_yel: float = 4.0,
    t_red: float = 4.0,
    t_yel: float = 2.0,
    tau_red: float = 95.0,
    tau_yel: float = 80.0,
) -> tuple[list[int], dict[str, Any]]:
    """Run Greedy or Hybrid local search over cached PPM tensor with customizable weights/DORI/KPI guidance."""
    t0 = time.perf_counter()
    if ws is None:
        ws = cache.ws_prod

    ppm_mat = cache.ppm_mat
    tie_mat = cache.tie_mat
    f_mat = dori_factor_param(ppm_mat, f_rec=f_rec, f_obs=f_obs, f_det=f_det)
    n_cands, m_cells = ppm_mat.shape

    allowed = np.ones(n_cands, dtype=bool) if cand_mask is None else cand_mask.copy()
    blocked_global = ~allowed

    red_mask = ws >= t_red
    yel_mask = (ws >= t_yel) & (ws < t_red)
    red_n = max(1, int(np.sum(red_mask)))
    yel_n = max(1, int(np.sum(yel_mask)))
    total_w = max(1e-9, float(np.sum(ws)))
    # Precompute binary ID/Rec indicators for fast hinge-penalty KPI evaluation
    id_mat = (ppm_mat >= 250.0) & red_mask[None, :] if kpi_mode != "none" else None
    rec_mat = (ppm_mat >= 125.0) & yel_mask[None, :] if kpi_mode != "none" else None

    def _tie_val(idx: int, b_ppm: np.ndarray, b_tie: np.ndarray) -> float:
        imp_row = ppm_mat[idx] > b_ppm
        return float(np.dot(np.where(imp_row, tie_mat[idx] - b_tie, 0.0), ws))

    def _pick_cand(gain_f: np.ndarray, b_ppm: np.ndarray, b_tie: np.ndarray, blocked: np.ndarray, min_g: float, min_t: float) -> tuple[int, float, float]:
        scores = np.where(blocked, -1e30, gain_f)
        max_s = float(np.max(scores))
        if max_s < min_g - 1e-9:
            return -1, max_s, -1e30
        frontier = np.where((~blocked) & (scores >= max_s - 2.1e-9))[0]
        if frontier.size == 0:
            return -1, -1e30, -1e30
        if frontier.size == 1 and float(gain_f[frontier[0]]) > min_g + 1e-9:
            idx0 = int(frontier[0])
            return idx0, float(gain_f[idx0]), 0.0
        best_i, best_s, best_t = -1, min_g, min_t
        for i in frontier:
            s = float(gain_f[i])
            t = _tie_val(int(i), b_ppm, b_tie)
            if s > best_s + 1e-9 or (abs(s - best_s) <= 1e-9 and t > best_t + 1e-9):
                best_i, best_s, best_t = int(i), s, t
        return best_i, best_s, best_t

    def obj_with_hinge(base_ppm: np.ndarray, base_f: np.ndarray) -> tuple[np.ndarray, float]:
        delta_w = np.maximum(0.0, f_mat - base_f[None, :]) @ ws
        if kpi_mode == "none":
            return delta_w, float(np.sum(ws * base_f))
        cur_red_ok = base_ppm >= 250.0
        cur_yel_ok = base_ppm >= 125.0
        base_red_pct = float(np.sum(cur_red_ok & red_mask)) / red_n * 100.0
        base_yel_pct = float(np.sum(cur_yel_ok & yel_mask)) / yel_n * 100.0
        base_hinge = total_w * 0.01 * (lambda_red * max(0.0, tau_red - base_red_pct) + lambda_yel * max(0.0, tau_yel - base_yel_pct))

        new_red_pct = (np.sum(cur_red_ok[None, :] & red_mask[None, :], axis=1) + np.sum(id_mat & (~cur_red_ok[None, :]), axis=1)) / red_n * 100.0
        new_yel_pct = (np.sum(cur_yel_ok[None, :] & yel_mask[None, :], axis=1) + np.sum(rec_mat & (~cur_yel_ok[None, :]), axis=1)) / yel_n * 100.0
        new_hinge = total_w * 0.01 * (lambda_red * np.maximum(0.0, tau_red - new_red_pct) + lambda_yel * np.maximum(0.0, tau_yel - new_yel_pct))
        return delta_w + (base_hinge - new_hinge), float(np.sum(ws * base_f)) - base_hinge

    selected_idx: list[int] = []
    used_poses: set[Any] = set()
    base_ppm = np.zeros(m_cells, dtype=np.float64)
    base_f = np.zeros(m_cells, dtype=np.float64)
    base_tie = np.zeros(m_cells, dtype=np.float64)

    for step_idx in range(budget_k):
        blocked = blocked_global.copy()
        for idx, p in enumerate(cache.poses):
            if p in used_poses:
                blocked[idx] = True

        if kpi_mode == "twostage":
            cur_red_pct = float(np.sum((base_ppm >= 250.0) & red_mask)) / red_n * 100.0
            max_red_k = max(1, math.ceil(0.67 * budget_k))
            if cur_red_pct < tau_red and step_idx < max_red_k:
                red_gain = np.sum(id_mat & (~(base_ppm >= 250.0)[None, :]), axis=1).astype(np.float64) * (total_w / red_n)
                gain_f = red_gain + 0.1 * (np.maximum(0.0, f_mat - base_f[None, :]) @ ws)
            else:
                gain_f, _ = obj_with_hinge(base_ppm, base_f)
        else:
            gain_f, _ = obj_with_hinge(base_ppm, base_f)

        best_i, _, _ = _pick_cand(gain_f, base_ppm, base_tie, blocked, min_g=-1.0, min_t=-1.0)
        if best_i >= 0:
            selected_idx.append(best_i)
            used_poses.add(cache.poses[best_i])
            base_ppm = np.maximum(base_ppm, ppm_mat[best_i])
            base_f = np.maximum(base_f, f_mat[best_i])
            base_tie = np.maximum(base_tie, tie_mat[best_i])

    greedy_score = float(np.sum(ws * base_f))
    iterations = 0
    passes_improved = [0, 0, 0]

    if algorithm == "hybrid" and selected_idx:
        for pass_idx in range(3):
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

                other_poses = {cache.poses[j] for j in other_idx}
                blocked = blocked_global.copy()
                for idx, p in enumerate(cache.poses):
                    if p in other_poses:
                        blocked[idx] = True

                if kpi_mode != "none":
                    gain_f, _ = obj_with_hinge(b_ppm, b_f)
                else:
                    gain_f = np.maximum(0.0, f_mat - b_f[None, :]) @ ws

                old_gain = float(gain_f[old_i])
                old_tie = _tie_val(old_i, b_ppm, b_tie)
                best_i, best_g, _ = _pick_cand(gain_f, b_ppm, b_tie, blocked, min_g=old_gain, min_t=old_tie)
                if best_i >= 0 and best_g > old_gain + 1e-9:
                    selected_idx[slot] = best_i
                    improved = True
                    iterations += 1
                    passes_improved[pass_idx] += 1
            if not improved:
                break

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    final_ppm = ppm_mat[selected_idx].max(axis=0) if selected_idx else np.zeros(m_cells)
    ev = evaluate_from_ppm(
        final_ppm,
        ws,
        cache=cache,
        t_red=t_red,
        t_yel=t_yel,
        tau_red=tau_red,
        tau_yel=tau_yel,
        f_rec=f_rec,
        f_obs=f_obs,
        f_det=f_det,
        grid_m=float(cache.bundle["layout"].gridM),
    )
    ev["cams"] = len(selected_idx)
    ev["runtime_ms"] = round(elapsed_ms, 2)
    ev["greedy_score"] = round(greedy_score, 3)
    ev["iterations"] = iterations
    ev["passes_improved"] = passes_improved
    return selected_idx, ev
