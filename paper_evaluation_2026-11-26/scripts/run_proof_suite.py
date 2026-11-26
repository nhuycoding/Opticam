"""Phase 3: Scientific Proof Suite (Ablation 2, Roache GCI & Scale, Held-Out N=50 Wilcoxon/Bootstrap).

Reads winning Phase 2 tuning parameters cleanly if phase2_tuning_results.json exists,
or falls back to parameterized best configuration. Outputs phase3_proof_results.json + CSVs.
"""
from __future__ import annotations

import copy
import csv
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from scipy.stats import binomtest, wilcoxon

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parents[1]
DATA_DIR = SCRIPTS_DIR.parent / "data"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from backend.greedy_optimizer import OptiCamGreedy
from fast_cache import LayoutCache, build_layout_cache, evaluate_from_ppm, solve_opticam_cached
from opticam_fast import compute_ppm_matrix, evaluate_opticam
from paper_algorithms import (
    DEFAULT_CAM,
    _erdem_candidate_pool,
    _solve_wang_socp,
    manual_four_corners,
    run_aziz_ga,
    run_erdem_max_coverage,
    run_erdem_set_cover,
    run_kim_ga,
)
from opticam_fast import compute_wang_q_matrix
from synthetic_layouts import get_dev_bundles, get_heldout_bundles, make_bundle_from_raw, random_layout_dict


def _cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    """Pairwise dominance effect size delta in [-1, 1] (>0 means OptiCam A tends to exceed B)."""
    diff = a[:, None] - b[None, :]
    n = a.size * b.size
    return float((np.sum(diff > 1e-9) - np.sum(diff < -1e-9)) / max(1, n))


def _paired_rank_biserial(diffs: np.ndarray) -> float:
    """Matched-pairs rank-biserial correlation r = (W+ - W-) / (W+ + W-) in [-1, 1]."""
    nz = diffs[np.abs(diffs) > 1e-9]
    if nz.size == 0:
        return 0.0
    ranks = np.argsort(np.argsort(np.abs(nz))) + 1.0
    # Average ties cleanly using scipy
    from scipy.stats import rankdata
    r = rankdata(np.abs(nz))
    w_plus = float(np.sum(r[nz > 0]))
    w_minus = float(np.sum(r[nz < 0]))
    return (w_plus - w_minus) / max(1e-12, w_plus + w_minus)


def _bootstrap_ci(vals: np.ndarray, n_boot: int = 10_000, seed: int = 2026) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, vals.size, size=(n_boot, vals.size))
    means = vals[idx].mean(axis=1)
    return round(float(np.percentile(means, 2.5)), 3), round(float(np.percentile(means, 97.5)), 3)


def _holm_bonferroni(p_vals: list[float]) -> list[float]:
    m = len(p_vals)
    order = np.argsort(p_vals)
    adj = np.empty(m, dtype=np.float64)
    prev = 0.0
    for rank, idx in enumerate(order):
        val = min(1.0, p_vals[idx] * (m - rank))
        prev = max(prev, val)
        adj[idx] = prev
    return [round(float(x), 6) for x in adj]


def run_ablation2(dev_caches: list[LayoutCache], test_caches: list[LayoutCache], tuned_kw: dict[str, Any]) -> dict[str, Any]:
    """Proof 1 (Ablation 2): Isolate Random, Manual-4C, Uniform (1,1,1), Az8, Wall-Only, Greedy-NoLS, Hybrid, Tuned."""
    rng = np.random.default_rng(2026)
    rows = []

    for split_name, caches in [("dev_7", dev_caches), ("heldout_50", test_caches)]:
        for K in [3, 4]:
            configs = [
                ("A0_Random_K", "random"),
                ("A2_Uniform_NoRisk", "uniform"),
                ("A3_Wall_Az8_Only", "az8"),
                ("A4_Wall_Full_Hybrid", "wall"),
                ("A5_Mixed_Greedy_NoLS", "greedy_nols"),
                ("A6_OptiCam_Hybrid_Prod", "prod"),
                ("A7_OptiCam_Tuned", "tuned"),
            ]
            if K == 4:
                configs.insert(1, ("A1_Manual_4Corners", "manual4"))

            for label, mode in configs:
                metrics = {k: [] for k in ("weighted_pct", "red_pct", "yellow_pct", "area_cov_pct", "red_min_ppm", "kpi_pass", "runtime_ms", "iterations", "p1", "p2", "p3", "greedy_gain_pct")}
                for c in caches:
                    if mode == "random":
                        evs = []
                        n_c = len(c.cands)
                        for _ in range(5):
                            pick = rng.choice(n_c, size=min(K, n_c), replace=False)
                            bp = c.ppm_mat[pick].max(axis=0)
                            evs.append(evaluate_from_ppm(bp, c.ws_prod, cache=c, grid_m=float(c.bundle["layout"].gridM)))
                        ev = {m: float(np.mean([e[m] for e in evs])) for m in ("weighted_pct", "red_pct", "yellow_pct", "area_cov_pct", "red_min_ppm")}
                        ev["kpi_pass"] = float(np.mean([1.0 if e["kpi_pass"] else 0.0 for e in evs]))
                        ev["runtime_ms"] = 0.0
                        ev["iterations"] = 0
                        ev["passes_improved"] = [0, 0, 0]
                        ev["greedy_gain_pct"] = 0.0
                    elif mode == "manual4":
                        _, ev = manual_four_corners(c.bundle)
                        ev["iterations"] = 0
                        ev["passes_improved"] = [0, 0, 0]
                        ev["greedy_gain_pct"] = 0.0
                    elif mode == "uniform":
                        ws_u = np.ones_like(c.ws_prod)
                        sel, _ = solve_opticam_cached(c, ws=ws_u, budget_k=K, algorithm="hybrid")
                        bp = c.ppm_mat[sel].max(axis=0)
                        ev = evaluate_from_ppm(bp, c.ws_prod, cache=c, grid_m=float(c.bundle["layout"].gridM))
                        ev["runtime_ms"] = 0.0
                        ev["iterations"] = 0
                        ev["passes_improved"] = [0, 0, 0]
                        ev["greedy_gain_pct"] = 0.0
                    elif mode == "az8":
                        _, ev = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, cand_mask=c.mask_az8, algorithm="hybrid")
                        ev["greedy_gain_pct"] = 0.0
                    elif mode == "wall":
                        _, ev = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, cand_mask=c.mask_wall, algorithm="hybrid")
                        ev["greedy_gain_pct"] = (ev["weighted_raw"] - ev["greedy_score"]) / max(1e-9, ev["greedy_score"]) * 100.0
                    elif mode == "greedy_nols":
                        _, ev = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="greedy")
                        ev["greedy_gain_pct"] = 0.0
                    elif mode == "prod":
                        _, ev = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid")
                        ev["greedy_gain_pct"] = (ev["weighted_raw"] - ev["greedy_score"]) / max(1e-9, ev["greedy_score"]) * 100.0
                    else:  # tuned
                        sel, ev_t = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid", **tuned_kw)
                        bp = c.ppm_mat[sel].max(axis=0)
                        ev = evaluate_from_ppm(bp, c.ws_prod, cache=c, grid_m=float(c.bundle["layout"].gridM))
                        ev["runtime_ms"] = ev_t["runtime_ms"]
                        ev["iterations"] = ev_t["iterations"]
                        ev["passes_improved"] = ev_t["passes_improved"]
                        ev["greedy_gain_pct"] = 0.0

                    for m in ("weighted_pct", "red_pct", "yellow_pct", "area_cov_pct", "red_min_ppm", "runtime_ms", "iterations", "greedy_gain_pct"):
                        metrics[m].append(float(ev.get(m, 0.0)))
                    metrics["kpi_pass"].append(100.0 if (ev["kpi_pass"] is True or ev["kpi_pass"] >= 0.5) else float(ev["kpi_pass"]) * 100.0 if isinstance(ev["kpi_pass"], float) else 0.0)
                    pi = ev.get("passes_improved", [0, 0, 0])
                    metrics["p1"].append(100.0 if pi[0] > 0 else 0.0)
                    metrics["p2"].append(100.0 if pi[1] > 0 else 0.0)
                    metrics["p3"].append(100.0 if pi[2] > 0 else 0.0)

                rows.append({
                    "split": split_name, "K": K, "method": label,
                    "weighted_pct": round(float(np.mean(metrics["weighted_pct"])), 2),
                    "red_pct": round(float(np.mean(metrics["red_pct"])), 2),
                    "yellow_pct": round(float(np.mean(metrics["yellow_pct"])), 2),
                    "area_cov_pct": round(float(np.mean(metrics["area_cov_pct"])), 2),
                    "red_min_ppm": round(float(np.mean(metrics["red_min_ppm"])), 1),
                    "kpi_pass_pct": round(float(np.mean(metrics["kpi_pass"])), 1),
                    "runtime_ms": round(float(np.mean(metrics["runtime_ms"])), 1),
                    "mean_ls_swaps": round(float(np.mean(metrics["iterations"])), 2),
                    "ls_gain_pct": round(float(np.mean(metrics["greedy_gain_pct"])), 2),
                    "pass1_active_pct": round(float(np.mean(metrics["p1"])), 1),
                    "pass2_active_pct": round(float(np.mean(metrics["p2"])), 1),
                    "pass3_active_pct": round(float(np.mean(metrics["p3"])), 1),
                })
    return {"ablation2_rows": rows}


def run_gci_and_scaling(dev_caches: list[LayoutCache]) -> dict[str, Any]:
    """Proof 3: Roache Grid Convergence Index (h=1.00, 0.50, 0.25, 0.10 m) & K/Area Scaling."""
    rep_names = ("ministop_50m2.json", "store_60m2.json", "circle_k_75m2.json")
    rep_caches = [c for c in dev_caches if c.name in rep_names]
    hs = [1.00, 0.50, 0.25, 0.10]

    gci_rows = []
    cross_opt_rows = []

    for c in rep_caches:
        layout = c.bundle["layout"]
        # Optimize once on production grid h=0.50m at K=3 and K=4
        for K in [3, 4]:
            sel_prod, _ = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid")
            cams_prod = [c.cands[i] for i in sel_prod]

            eval_by_h: dict[float, dict[str, Any]] = {}
            for h in hs:
                b_h = copy.deepcopy(c.bundle["raw"])
                b_h["gridM"] = h
                bun_h = make_bundle_from_raw(b_h, filename=f"{c.name}_h{h}")
                ev_h = evaluate_opticam(cams_prod, bun_h)
                eval_by_h[h] = ev_h
                gci_rows.append({
                    "layout": c.name, "K": K, "h_m": h, "cells": len(bun_h["xs"]),
                    "weighted_pct": ev_h["weighted_pct"], "red_pct": ev_h["red_pct"],
                    "yellow_pct": ev_h["yellow_pct"], "area_cov_pct": ev_h["area_cov_pct"],
                    "kpi_pass": ev_h["kpi_pass"],
                })

            # Roache GCI across constant r=2.0 triplet (1.00, 0.50, 0.25) AND (0.50, 0.25, 0.10) drift
            f1, f2, f3 = eval_by_h[0.25]["weighted_pct"], eval_by_h[0.50]["weighted_pct"], eval_by_h[1.00]["weighted_pct"]
            e32 = f3 - f2
            e21 = f2 - f1
            if abs(e21) > 1e-6 and e32 * e21 > 0 and abs(e32 / e21) > 1.05:
                p_obs = min(4.0, max(0.5, math.log(abs(e32 / e21)) / math.log(2.0)))
                gci_21 = 1.25 * abs(e21 / max(1e-9, f1)) / (2.0 ** p_obs - 1.0) * 100.0
            else:
                p_obs = float("nan")
                gci_21 = 1.25 * abs(e21 / max(1e-9, f1)) * 100.0

            # Also optimize independently at h=0.25m and cross-evaluate BOTH on fine truth h=0.10m
            b_025 = copy.deepcopy(c.bundle["raw"])
            b_025["gridM"] = 0.25
            bun_025 = make_bundle_from_raw(b_025, filename=f"{c.name}_h025")
            c_025 = build_layout_cache(bun_025)
            sel_025, _ = solve_opticam_cached(c_025, ws=c_025.ws_prod, budget_k=K, algorithm="hybrid")
            cams_025 = [c_025.cands[i] for i in sel_025]

            b_010 = copy.deepcopy(c.bundle["raw"])
            b_010["gridM"] = 0.10
            bun_010 = make_bundle_from_raw(b_010, filename=f"{c.name}_h010")

            ev_prod_on_010 = evaluate_opticam(cams_prod, bun_010)
            ev_025_on_010 = evaluate_opticam(cams_025, bun_010)
            cross_opt_rows.append({
                "layout": c.name, "K": K,
                "prod_h050_self_w_pct": eval_by_h[0.50]["weighted_pct"],
                "prod_h050_on_h010_w_pct": ev_prod_on_010["weighted_pct"],
                "drift_050_to_010_w_pp": round(ev_prod_on_010["weighted_pct"] - eval_by_h[0.50]["weighted_pct"], 2),
                "drift_050_to_010_red_pp": round(ev_prod_on_010["red_pct"] - eval_by_h[0.50]["red_pct"], 2),
                "fine_h025_on_h010_w_pct": ev_025_on_010["weighted_pct"],
                "opt_gap_050_vs_025_on_010_pp": round(ev_025_on_010["weighted_pct"] - ev_prod_on_010["weighted_pct"], 2),
                "roache_p": round(p_obs, 2) if not math.isnan(p_obs) else None,
                "roache_gci_21_pct": round(gci_21, 2),
            })

    # Budget K=1..8 & Area scaling 30..200 m2
    k_stress = []
    for K in range(1, 9):
        ts, ws = [], []
        for c in rep_caches:
            _, ev = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid")
            ts.append(ev["runtime_ms"])
            ws.append(ev["weighted_pct"])
        k_stress.append({"K": K, "mean_solve_ms": round(float(np.mean(ts)), 1), "mean_w_pct": round(float(np.mean(ws)), 2)})

    area_scale = []
    dims = [(6.0, 5.0, "30m2"), (10.0, 5.0, "50m2"), (10.0, 8.0, "80m2"), (12.0, 10.0, "120m2"), (16.0, 12.5, "200m2")]
    for W, H, label in dims:
        raw = random_layout_dict(9900 + int(W * H))
        raw["widthM"], raw["heightM"] = W, H
        # Keep existing valid obstacles clamped cleanly inside W, H
        raw["obstacles"] = [o for o in raw["obstacles"] if o["x"] + o["w"] <= W - 0.5 and o["y"] + o["h"] <= H - 0.5]
        t0 = time.perf_counter()
        bun = make_bundle_from_raw(raw, filename=f"scale_{label}")
        cache = build_layout_cache(bun)
        build_ms = (time.perf_counter() - t0) * 1000.0
        _, ev = solve_opticam_cached(cache, ws=cache.ws_prod, budget_k=4, algorithm="hybrid")
        area_scale.append({
            "area_label": label, "area_m2": W * H, "cells": len(cache.xs), "cands": len(cache.cands),
            "cache_raycast_ms": round(build_ms, 1), "solve_k4_ms": ev["runtime_ms"], "total_ms": round(build_ms + ev["runtime_ms"], 1),
        })

    return {"gci_eval_rows": gci_rows, "cross_grid_summary": cross_opt_rows, "k_stress": k_stress, "area_scale": area_scale}


def _solve_wang_fast(bundle: dict[str, Any], weighted: bool, mounts: str) -> tuple[list[dict[str, Any]], np.ndarray, np.ndarray, np.ndarray, float]:
    t0 = time.perf_counter()
    cands = _erdem_candidate_pool(bundle, mounts=mounts)
    if len(cands) > 900:
        cands = [cands[int(i * len(cands) / 900)] for i in range(900)]
    xs, ws = bundle["xs"], bundle["ws"]
    layout = bundle["layout"]
    B_full = compute_wang_q_matrix(cands, xs, bundle["ys"], bundle["obstacles"], layout.floorPolygon, occlusion_mode="2d", target_height=layout.targetHeight)
    keep = np.any(B_full >= 0.1, axis=1)
    cands = [c for c, k in zip(cands, keep) if k]
    B = B_full[keep].T
    w_vec = ws if weighted else np.ones_like(ws)
    z_star = _solve_wang_socp(B, w_vec, Q0=0.1, E0=1.8)
    ranked = np.argsort(-z_star)
    return cands, B, w_vec, ranked, (time.perf_counter() - t0) * 1000.0


def run_heldout_n50_benchmark(test_caches: list[LayoutCache], tuned_kw: dict[str, Any]) -> dict[str, Any]:
    """Proof 4: Head-to-head OptiCam vs 4 Papers + Tuned OptiCam across N=50 unseen synthetic stores."""
    per_store_rows = []
    methods = [
        "OptiCam-Hybrid",
        "OptiCam-Tuned",
        "OptiCam-Wall",
        "Erdem-06",
        "Aziz-24",
        "Kim-19",
        "Wang-13-Unif",
        "Wang-13-Crit",
    ]

    for idx, c in enumerate(test_caches):
        bun = c.bundle
        # Cache Wang SOCP once per store
        w_unif = _solve_wang_fast(bun, weighted=False, mounts="mixed")
        w_crit = _solve_wang_fast(bun, weighted=True, mounts="wall")

        for K in [3, 4]:
            res_map: dict[str, dict[str, Any]] = {}

            _, res_map["OptiCam-Hybrid"] = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid")

            sel_t, ev_t = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid", **tuned_kw)
            bp_t = c.ppm_mat[sel_t].max(axis=0)
            ev_t_std = evaluate_from_ppm(bp_t, c.ws_prod, cache=c, grid_m=float(bun["layout"].gridM))
            ev_t_std["runtime_ms"] = ev_t["runtime_ms"]
            res_map["OptiCam-Tuned"] = ev_t_std

            _, res_map["OptiCam-Wall"] = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, cand_mask=c.mask_wall, algorithm="hybrid")
            _, ev_erdem = run_erdem_max_coverage(bun, budget_k=K, mounts="mixed", min_ppm=25.0)
            if "weighted_pct" not in ev_erdem:
                rt = ev_erdem.get("runtime_ms", 0.0)
                ev_erdem = evaluate_opticam([], bun)
                ev_erdem["runtime_ms"] = rt
            res_map["Erdem-06"] = ev_erdem
            # Single deterministic seed 2026+idx across N=50 stores (matches 1-run/store variance across N=50)
            _, res_map["Aziz-24"] = run_aziz_ga(bun, budget_k=K, overlap_penalty=0.5, seed=2026 + idx, max_gens=75, patience=35)
            _, res_map["Kim-19"] = run_kim_ga(bun, budget_k=K, seed=2026 + idx, max_gens=75, patience=35)

            # Wang fixed K
            for wkey, wcache in [("Wang-13-Unif", w_unif), ("Wang-13-Crit", w_crit)]:
                wcands, _, _, wranked, wms = wcache
                wsel = [{**wcands[int(i)], "id": f"W-{j+1}"} for j, i in enumerate(wranked[:K])]
                wev = evaluate_opticam(wsel, bun)
                wev["runtime_ms"] = round(wms, 1)
                res_map[wkey] = wev

            for m_name in methods:
                ev = res_map[m_name]
                per_store_rows.append({
                    "store_idx": idx, "layout": c.name, "K": K, "method": m_name,
                    "weighted_pct": ev["weighted_pct"], "red_pct": ev["red_pct"], "yellow_pct": ev["yellow_pct"],
                    "area_cov_pct": ev["area_cov_pct"], "red_min_ppm": ev["red_min_ppm"],
                    "kpi_pass": 1 if ev["kpi_pass"] else 0, "runtime_ms": ev["runtime_ms"],
                })

        if (idx + 1) % 10 == 0:
            print(f"  [Proof 4] Completed {idx + 1}/{len(test_caches)} unseen stores...", flush=True)

    # Compute summary means, 10,000-bootstrap 95% CIs, Wilcoxon signed-rank + Holm-Bonferroni vs baselines
    summary_rows = []
    stat_tests = []
    for K in [3, 4]:
        k_rows = [r for r in per_store_rows if r["K"] == K]
        by_method: dict[str, list[dict[str, Any]]] = {
            m: sorted([r for r in k_rows if r["method"] == m], key=lambda x: x["store_idx"]) for m in methods
        }
        for m in methods:
            mr = by_method[m]
            w_arr = np.array([r["weighted_pct"] for r in mr])
            r_arr = np.array([r["red_pct"] for r in mr])
            y_arr = np.array([r["yellow_pct"] for r in mr])
            a_arr = np.array([r["area_cov_pct"] for r in mr])
            k_arr = np.array([r["kpi_pass"] * 100.0 for r in mr])
            ci_w = _bootstrap_ci(w_arr)
            ci_r = _bootstrap_ci(r_arr)
            summary_rows.append({
                "K": K, "method": m, "n": len(mr),
                "weighted_pct_mean": round(float(np.mean(w_arr)), 2), "weighted_ci95": f"[{ci_w[0]:.2f}, {ci_w[1]:.2f}]",
                "red_pct_mean": round(float(np.mean(r_arr)), 2), "red_ci95": f"[{ci_r[0]:.2f}, {ci_r[1]:.2f}]",
                "yellow_pct_mean": round(float(np.mean(y_arr)), 2),
                "area_cov_mean": round(float(np.mean(a_arr)), 2),
                "kpi_pass_pct": round(float(np.mean(k_arr)), 1),
                "kpi_pass_count": int(sum(r["kpi_pass"] for r in mr)),
                "mean_ms": round(float(np.mean([r["runtime_ms"] for r in mr])), 1),
            })

        # Pairwise Wilcoxon vs OptiCam-Hybrid & OptiCam-Tuned across all non-OptiCam competitors
        competitors = ["OptiCam-Wall", "Erdem-06", "Aziz-24", "Kim-19", "Wang-13-Unif", "Wang-13-Crit"]
        for anchor in ("OptiCam-Hybrid", "OptiCam-Tuned"):
            a_w = np.array([r["weighted_pct"] for r in by_method[anchor]])
            a_r = np.array([r["red_pct"] for r in by_method[anchor]])
            a_k = np.array([r["kpi_pass"] for r in by_method[anchor]])
            raw_p_w, raw_p_r, tmp_rows = [], [], []
            for comp in competitors + (["OptiCam-Hybrid"] if anchor == "OptiCam-Tuned" else []):
                c_w = np.array([r["weighted_pct"] for r in by_method[comp]])
                c_r = np.array([r["red_pct"] for r in by_method[comp]])
                c_k = np.array([r["kpi_pass"] for r in by_method[comp]])
                dw = a_w - c_w
                dr = a_r - c_r
                pw = float(wilcoxon(dw, zero_method="zsplit").pvalue) if np.any(np.abs(dw) > 1e-9) else 1.0
                pr = float(wilcoxon(dr, zero_method="zsplit").pvalue) if np.any(np.abs(dr) > 1e-9) else 1.0
                # Exact McNemar binomial test on discordant KPI pass pairs
                b10 = int(np.sum((a_k == 1) & (c_k == 0)))
                b01 = int(np.sum((a_k == 0) & (c_k == 1)))
                p_mcnemar = float(binomtest(b10, b10 + b01, 0.5).pvalue) if (b10 + b01) > 0 else 1.0
                raw_p_w.append(pw)
                raw_p_r.append(pr)
                tmp_rows.append({
                    "K": K, "anchor": anchor, "competitor": comp,
                    "delta_w_pp": round(float(np.mean(dw)), 2), "delta_w_ci95": list(_bootstrap_ci(dw)),
                    "w_win_tie_loss": f"{int(np.sum(dw>1e-6))}/{int(np.sum(np.abs(dw)<=1e-6))}/{int(np.sum(dw<-1e-6))}",
                    "rank_biserial_w": round(_paired_rank_biserial(dw), 3),
                    "cliffs_delta_w": round(_cliffs_delta(a_w, c_w), 3),
                    "p_wilcoxon_w": pw,
                    "delta_red_pp": round(float(np.mean(dr)), 2),
                    "p_wilcoxon_red": pr,
                    "kpi_b10_vs_b01": f"{b10} vs {b01}",
                    "p_mcnemar_kpi": round(p_mcnemar, 6),
                })
            adj_w = _holm_bonferroni(raw_p_w)
            adj_r = _holm_bonferroni(raw_p_r)
            for tr, aw, ar in zip(tmp_rows, adj_w, adj_r):
                tr["p_holm_w"] = aw
                tr["p_holm_red"] = ar
                tr["p_wilcoxon_w"] = round(tr["p_wilcoxon_w"], 6)
                tr["p_wilcoxon_red"] = round(tr["p_wilcoxon_red"], 6)
                stat_tests.append(tr)

    return {"per_store": per_store_rows, "summary": summary_rows, "stat_tests": stat_tests}


def _select_best_phase2_kw() -> dict[str, Any]:
    """Read Phase 2 winner from phase2_tuning_results.json if available, else default tuned params."""
    p2_file = DATA_DIR / "phase2_tuning_results.json"
    default_kw = dict(f_rec=0.55, f_obs=0.30, f_det=0.15, kpi_mode="twostage", lambda_red=1.5, lambda_yel=0.75)
    if not p2_file.exists():
        return default_kw
    try:
        p2 = json.loads(p2_file.read_text(encoding="utf-8"))
        # Pick highest KPI-pass K=3 dev variant without W% drop > 2pp at K=4; or best combined
        dev_k3 = [r for r in p2["t1_t2_rows"] if r["split"] == "dev_7" and r["budget"] == "K=3"]
        best = max(dev_k3, key=lambda r: (r["kpi_pass_pct"], r["red_pct"], r["weighted_pct"]))
        v = best["variant"]
        if v == "T2_TwoStage_F0.55_L1.5":
            return default_kw
        if v == "T2_TwoStage_L1.5":
            return dict(f_rec=0.75, f_obs=0.40, f_det=0.20, kpi_mode="twostage", lambda_red=1.5, lambda_yel=0.75)
        if v.startswith("T2_Hinge_L"):
            lam = float(v.split("L")[1])
            return dict(f_rec=0.75, f_obs=0.40, f_det=0.20, kpi_mode="hinge", lambda_red=lam, lambda_yel=lam * 0.5)
        if v.startswith("T1_"):
            parts = v.split("_")
            return dict(f_rec=float(parts[2]), f_obs=float(parts[3]), f_det=float(parts[4]), kpi_mode="none")
    except Exception:
        pass
    return default_kw


def main() -> None:
    t0 = time.perf_counter()
    print("[Phase 3] Loading Dev (7) + Held-Out (50) caches...", flush=True)
    dev_caches = [build_layout_cache(b) for b in get_dev_bundles(deduplicate=True)]
    test_caches = [build_layout_cache(b) for b in get_heldout_bundles(n_stores=50, seed0=2026)]
    tuned_kw = _select_best_phase2_kw()
    print(f"  Using Tuned Config: {tuned_kw}", flush=True)

    print("[Proof 1 / Ablation 2] Isolating architectural component gains...", flush=True)
    abl2 = run_ablation2(dev_caches, test_caches, tuned_kw)

    print("[Proof 3 / Roache GCI + Scale] Checking spatial convergence h=1.00..0.10m...", flush=True)
    gci = run_gci_and_scaling(dev_caches)

    print("[Proof 4 / Held-Out N=50] Running 8-method comparison + Wilcoxon/Holm/Bootstrap...", flush=True)
    ho50 = run_heldout_n50_benchmark(test_caches, tuned_kw)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {
        "tuned_config": tuned_kw,
        "ablation2": abl2,
        "gci_scaling": gci,
        "heldout_n50": {"summary": ho50["summary"], "stat_tests": ho50["stat_tests"], "per_store": ho50["per_store"]},
        "runtime_s": round(time.perf_counter() - t0, 1),
    }
    (DATA_DIR / "phase3_proof_results.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    with open(DATA_DIR / "phase3_ablation2.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(abl2["ablation2_rows"][0].keys()))
        w.writeheader()
        w.writerows(abl2["ablation2_rows"])

    with open(DATA_DIR / "phase3_heldout_n50_summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(ho50["summary"][0].keys()))
        w.writeheader()
        w.writerows(ho50["summary"])

    with open(DATA_DIR / "phase3_stat_tests.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(ho50["stat_tests"][0].keys()))
        w.writeheader()
        w.writerows(ho50["stat_tests"])

    print(f"\nDONE Phase 3 Proof Suite in {time.perf_counter() - t0:.1f}s -> {DATA_DIR / 'phase3_proof_results.json'}", flush=True)
    for r in [x for x in ho50["summary"] if x["K"] == 4]:
        print(f"  [N=50 K=4] {r['method']:16s} | W%={r['weighted_pct_mean']:5.2f} {r['weighted_ci95']} | Red={r['red_pct_mean']:5.2f}% | KPI={r['kpi_pass_count']:2d}/50 ({r['kpi_pass_pct']}%)")


if __name__ == "__main__":
    main()
