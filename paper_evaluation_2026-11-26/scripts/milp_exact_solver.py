"""Phase 3 (Proof 2): Exact Global MILP Optimality Gap Verification via HiGHS.

Formulates OptiCam's exact candidate selection & piecewise-linear DORI coverage as a
totally-unimodular 0-1 MILP:
  max  sum_{j,m} w_j * dF_m * y_{j,m} - eps * sum_i x_i
  s.t. sum_i x_i <= K
       y_{j,m} - sum_{i: PPM(i,j) >= T_m} x_i <= 0   for all j, m in {1..4}
       x_i in {0, 1},   0 <= y_{j,m} <= 1
where T = [25, 62.5, 125, 250] PPM and dF = [0.20, 0.20, 0.35, 0.25] (sum = 1.00).
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import scipy.sparse as sp
from scipy.optimize import Bounds, LinearConstraint, milp

SCRIPTS_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPTS_DIR.parent / "data"
sys.path.insert(0, str(SCRIPTS_DIR))

from fast_cache import LayoutCache, build_layout_cache, evaluate_from_ppm, solve_opticam_cached
from synthetic_layouts import get_dev_bundles, get_heldout_bundles

DORI_TIERS = (25.0, 62.5, 125.0, 250.0)
DELTA_F = (0.20, 0.20, 0.35, 0.25)


def solve_exact_milp(
    cache: LayoutCache,
    budget_k: int,
    cand_mask: np.ndarray | None = None,
    time_limit_s: float = 90.0,
) -> dict[str, Any]:
    """Solve exact 0-1 MILP over discrete candidate pool C using HiGHS."""
    t0 = time.perf_counter()
    ppm_mat = cache.ppm_mat
    ws = cache.ws_prod
    if cand_mask is not None:
        idx_map = np.where(cand_mask)[0]
        ppm_sub = ppm_mat[idx_map]
    else:
        idx_map = np.arange(ppm_mat.shape[0])
        ppm_sub = ppm_mat

    n_cands, m_cells = ppm_sub.shape
    n_y = 4 * m_cells
    n_vars = n_cands + n_y
    w_y_flat = np.concatenate([ws * df for df in DELTA_F])

    # Objective: Minimize sum_i 1e-6 x_i - sum_{j,m} w_j dF_m y_{j,m}
    c_obj = np.concatenate([np.full(n_cands, 1e-6), -w_y_flat])
    integrality = np.concatenate([np.ones(n_cands), np.zeros(n_y)])
    lb = np.zeros(n_vars)
    ub = np.ones(n_vars)

    # Constraints:
    # 0) sum_i x_i <= budget_k
    # 1..n_y) y_{j,m} - sum_i a_{i,j,m} x_i <= 0
    rows_sp = [np.zeros(n_cands, dtype=np.int32)]
    cols_sp = [np.arange(n_cands, dtype=np.int32)]
    vals_sp = [np.ones(n_cands, dtype=np.float64)]

    # Diagonal y_{j,m} coefficients (+1) across rows 1..n_y
    y_rows = np.arange(1, 1 + n_y, dtype=np.int32)
    y_cols = np.arange(n_cands, n_cands + n_y, dtype=np.int32)
    rows_sp.append(y_rows)
    cols_sp.append(y_cols)
    vals_sp.append(np.ones(n_y, dtype=np.float64))

    for m_idx, t_ppm in enumerate(DORI_TIERS):
        vis_t = ppm_sub >= t_ppm
        ci, cj = np.where(vis_t)
        rows_sp.append(1 + m_idx * m_cells + cj.astype(np.int32))
        cols_sp.append(ci.astype(np.int32))
        vals_sp.append(np.full(ci.size, -1.0, dtype=np.float64))

    A = sp.csc_matrix(
        (np.concatenate(vals_sp), (np.concatenate(rows_sp), np.concatenate(cols_sp))),
        shape=(1 + n_y, n_vars),
    )
    row_ub = np.concatenate([np.array([float(budget_k)]), np.zeros(n_y)])
    row_lb = np.full(1 + n_y, -np.inf)

    res = milp(
        c=c_obj,
        integrality=integrality,
        bounds=Bounds(lb, ub),
        constraints=LinearConstraint(A, row_lb, row_ub),
        options={"time_limit": time_limit_s, "mip_rel_gap": 0.0, "presolve": True},
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    sel_local = [int(i) for i in np.where(res.x[:n_cands] > 0.5)[0]] if res.x is not None else []
    sel_global = [int(idx_map[i]) for i in sel_local]
    best_ppm = ppm_mat[sel_global].max(axis=0) if sel_global else np.zeros(m_cells)
    ev = evaluate_from_ppm(best_ppm, ws, cache=cache, grid_m=float(cache.bundle["layout"].gridM))

    ub_score = -float(res.mip_dual_bound) if hasattr(res, "mip_dual_bound") and res.mip_dual_bound is not None else ev["weighted_raw"]
    # Note: res.mip_dual_bound may reflect slight 1e-6*K offset; true score upper bound <= ub_score + K*1e-6
    gap_pct = 0.0
    if hasattr(res, "mip_gap") and res.mip_gap is not None:
        gap_pct = round(float(res.mip_gap) * 100.0, 4)

    return {
        "status": int(res.status),
        "success": bool(res.success),
        "mip_gap_pct": gap_pct,
        "z_milp_raw": ev["weighted_raw"],
        "z_milp_ub": round(float(ub_score), 4),
        "weighted_pct": ev["weighted_pct"],
        "red_pct": ev["red_pct"],
        "yellow_pct": ev["yellow_pct"],
        "kpi_pass": ev["kpi_pass"],
        "selected_idx": sel_global,
        "solve_ms": round(elapsed_ms, 1),
    }


def verify_bruteforce_parity(cache: LayoutCache) -> dict[str, Any]:
    """Exactness sanity check: compare MILP vs brute-force enumeration on reduced azimuth pool (K=2)."""
    az_idx = np.where(cache.mask_az8)[0]
    # Subsample cleanly <= 45 candidates for fast C(45,2)=990 brute-force exact check
    step = max(1, len(az_idx) // 40)
    sub_idx = az_idx[::step][:40]
    sub_mask = np.zeros(len(cache.cands), dtype=bool)
    sub_mask[sub_idx] = True

    milp_res = solve_exact_milp(cache, budget_k=2, cand_mask=sub_mask, time_limit_s=30.0)

    # Brute-force all pairs in sub_idx
    from fast_cache import dori_factor_param
    f_sub = dori_factor_param(cache.ppm_mat[sub_idx])
    ws = cache.ws_prod
    best_bf = -1.0
    n_s = len(sub_idx)
    for i in range(n_s):
        fi = f_sub[i]
        for j in range(i + 1, n_s):
            sc = float(np.dot(ws, np.maximum(fi, f_sub[j])))
            if sc > best_bf:
                best_bf = sc
    return {
        "layout": cache.name,
        "n_sub_cands": int(n_s),
        "milp_score": round(milp_res["z_milp_raw"], 6),
        "bruteforce_score": round(best_bf, 6),
        "abs_diff": round(abs(milp_res["z_milp_raw"] - best_bf), 9),
        "parity_exact": abs(milp_res["z_milp_raw"] - best_bf) < 1e-6,
    }


def main() -> None:
    t0 = time.perf_counter()
    print("[Phase 3 / Proof 2] Loading Dev (7) + Held-Out subset (15) for Exact HiGHS MILP...", flush=True)
    dev_caches = [build_layout_cache(b) for b in get_dev_bundles(deduplicate=True)]
    test_caches = [build_layout_cache(b) for b in get_heldout_bundles(n_stores=15, seed0=2026)]

    # 1) Small-instance brute-force exactness verification
    bf_checks = [verify_bruteforce_parity(c) for c in dev_caches[:3]]
    for chk in bf_checks:
        print(f"  [BF Parity K=2] {chk['layout']:20s} | diff={chk['abs_diff']:.2e} | exact={chk['parity_exact']}", flush=True)
        assert chk["parity_exact"], f"MILP parity check failed on {chk}"

    rows = []
    for split, caches, k_list, tlim in [("dev_7", dev_caches, (2, 3, 4), 40.0), ("heldout_15", test_caches, (3, 4), 25.0)]:
        for c in caches:
            for K in k_list:
                _, ev_greedy = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="greedy")
                _, ev_hybrid = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid")
                milp_res = solve_exact_milp(c, budget_k=K, time_limit_s=tlim)
                z_m = max(1e-9, milp_res["z_milp_raw"])
                row = {
                    "split": split,
                    "layout": c.name,
                    "cells": len(c.xs),
                    "cands": len(c.cands),
                    "K": K,
                    "greedy_score": ev_greedy["weighted_raw"],
                    "hybrid_score": ev_hybrid["weighted_raw"],
                    "milp_score": milp_res["z_milp_raw"],
                    "milp_gap_pct": milp_res["mip_gap_pct"],
                    "greedy_over_milp_pct": round(ev_greedy["weighted_raw"] / z_m * 100.0, 2),
                    "hybrid_over_milp_pct": round(ev_hybrid["weighted_raw"] / z_m * 100.0, 2),
                    "hybrid_ms": ev_hybrid["runtime_ms"],
                    "milp_ms": milp_res["solve_ms"],
                    "hybrid_red_pct": ev_hybrid["red_pct"],
                    "milp_red_pct": milp_res["red_pct"],
                }
                rows.append(row)
                print(
                    f"  [MILP {split:10s} K={K}] {c.name:22s} | Gr/MILP={row['greedy_over_milp_pct']:5.2f}% | "
                    f"Hyb/MILP={row['hybrid_over_milp_pct']:5.2f}% | mip_gap={row['milp_gap_pct']:.2f}% | "
                    f"Hyb={row['hybrid_ms']:5.1f}ms vs MILP={row['milp_ms']:7.1f}ms",
                    flush=True,
                )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {"bf_parity_checks": bf_checks, "milp_rows": rows, "runtime_s": round(time.perf_counter() - t0, 1)}
    (DATA_DIR / "phase3_milp_gaps.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    with open(DATA_DIR / "phase3_milp_gaps.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\nDONE MILP Suite in {time.perf_counter() - t0:.1f}s -> {DATA_DIR / 'phase3_milp_gaps.json'}", flush=True)


if __name__ == "__main__":
    main()
