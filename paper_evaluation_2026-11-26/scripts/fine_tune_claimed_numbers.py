"""Phase 1B: Fine-tuning calibration & TOST equivalence validation of OptiCam numeric defaults.

Experiments:
  W3         Fine 0.25-step grid + multi-start derivative-free calibration (Dev 7 -> Held-Out 50)
  W4         2D (W_pos, W_shelf) x F_recog interaction matrix + Risk cutoff sweep (4.0, 2.0)
  T-KPI-Fine 1%-step threshold sweep, Kneedle elbow detection, & TOST equivalence tests
"""
from __future__ import annotations

import csv
import json
import math
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import minimize
from scipy.stats import wilcoxon

SCRIPTS_DIR = Path(__file__).resolve().parent
DATA_DIR = SCRIPTS_DIR.parent / "data"
sys.path.insert(0, str(SCRIPTS_DIR))

from fast_cache import (
    LayoutCache,
    build_layout_cache,
    compute_weights,
    evaluate_from_ppm,
    solve_opticam_cached,
)
from synthetic_layouts import get_dev_bundles, get_heldout_bundles, make_bundle_from_raw, random_layout_dict


def _tost_paired(diffs: np.ndarray, margin: float) -> dict[str, Any]:
    """Non-parametric paired Two One-Sided Tests (Wilcoxon/sign) for equivalence within +-margin."""
    # H01: median(diffs) <= -margin -> test (diffs + margin) > 0
    # H02: median(diffs) >= +margin -> test (diffs - margin) < 0
    mean_d = float(np.mean(diffs))
    std_d = float(np.std(diffs, ddof=1)) if len(diffs) > 1 else 0.0
    if np.all(np.abs(diffs + margin) < 1e-12):
        p1 = 1.0
    else:
        try:
            p1 = float(wilcoxon(diffs + margin, alternative="greater", zero_method="zsplit").pvalue)
        except Exception:
            p1 = 1.0
    if np.all(np.abs(diffs - margin) < 1e-12):
        p2 = 1.0
    else:
        try:
            p2 = float(wilcoxon(diffs - margin, alternative="less", zero_method="zsplit").pvalue)
        except Exception:
            p2 = 1.0
    p_tost = max(p1, p2)
    return {
        "mean_diff": round(mean_d, 3),
        "std_diff": round(std_d, 3),
        "margin": margin,
        "p_tost": round(p_tost, 5),
        "equivalent_p05": bool(p_tost < 0.05),
    }


def _physical_meta_score(ev: dict[str, Any]) -> float:
    """Model-free retail security score independent of (5,3,1) weights."""
    choke_id = float(ev["phys_choke_id_pct"])
    shelf_rec = float(ev["phys_shelf_rec_pct"])
    area_cov = float(ev["area_cov_pct"])
    penalty = 0.25 * max(0.0, 95.0 - choke_id) + 0.10 * max(0.0, 80.0 - shelf_rec)
    return (choke_id + shelf_rec + area_cov) / 3.0 - penalty


def _eval_params_on_caches(
    caches: list[LayoutCache],
    w_pos: float,
    w_shelf: float,
    r0: float,
    R_pos: float,
    w_high: float = 4.5,
    w_bulky: float = 1.8,
    ks: tuple[int, ...] = (3, 4),
    f_rec: float = 0.75,
) -> dict[str, Any]:
    f_obs = min(0.55, f_rec * (0.40 / 0.75)) if abs(f_rec - 0.75) > 1e-6 else 0.40
    f_det = min(0.30, f_rec * (0.20 / 0.75)) if abs(f_rec - 0.75) > 1e-6 else 0.20
    per_layout_k3: list[dict[str, Any]] = []
    per_layout_k4: list[dict[str, Any]] = []

    for c in caches:
        ws = compute_weights(
            c, w_pos=w_pos, w_shelf=w_shelf, w_floor=1.0,
            w_high=w_high, w_bulky=w_bulky, r0_pos=r0, R_pos=R_pos,
            r0_shelf=r0, R_shelf=max(r0 + 0.2, R_pos * 0.8),
            respect_custom=True, scale_custom=True,
        )
        for K in ks:
            sel, _ = solve_opticam_cached(c, ws=ws, budget_k=K, algorithm="hybrid", f_rec=f_rec, f_obs=f_obs, f_det=f_det)
            best_ppm = c.ppm_mat[sel].max(axis=0) if sel else np.zeros(len(c.xs))
            ev = evaluate_from_ppm(best_ppm, c.ws_prod, cache=c, f_rec=0.75, f_obs=0.40, f_det=0.20, grid_m=float(c.bundle["layout"].gridM))
            ev["phys_meta"] = _physical_meta_score(ev)
            if K == 3:
                per_layout_k3.append(ev)
            elif K == 4:
                per_layout_k4.append(ev)

    def agg(rows: list[dict[str, Any]]) -> dict[str, Any]:
        if not rows:
            return {}
        return {
            "phys_meta": round(float(np.mean([r["phys_meta"] for r in rows])), 3),
            "phys_choke_id_pct": round(float(np.mean([r["phys_choke_id_pct"] for r in rows])), 2),
            "phys_shelf_rec_pct": round(float(np.mean([r["phys_shelf_rec_pct"] for r in rows])), 2),
            "area_cov_pct": round(float(np.mean([r["area_cov_pct"] for r in rows])), 2),
            "red_pct": round(float(np.mean([r["red_pct"] for r in rows])), 2),
            "yellow_pct": round(float(np.mean([r["yellow_pct"] for r in rows])), 2),
            "kpi_pass_pct": round(float(np.mean([100.0 if r["kpi_pass"] else 0.0 for r in rows])), 1),
        }

    meta_comb = 0.5 * (
        float(np.mean([r["phys_meta"] for r in per_layout_k3])) + float(np.mean([r["phys_meta"] for r in per_layout_k4]))
    ) if (per_layout_k3 and per_layout_k4) else float(np.mean([r["phys_meta"] for r in (per_layout_k3 or per_layout_k4)]))
    return {"meta_comb": round(meta_comb, 3), "K3": agg(per_layout_k3), "K4": agg(per_layout_k4), "raw_k3": per_layout_k3, "raw_k4": per_layout_k4}


def run_w3_fine_calibration(dev_caches: list[LayoutCache], test_caches: list[LayoutCache]) -> dict[str, Any]:
    """Fine 0.25-step sweep + Powell/Nelder-Mead inverse calibration on Dev -> Held-Out 50 TOST."""
    # Part 1: Fine neighborhood grid on Dev (7) for (w_pos, w_shelf)
    w_pos_grid = [3.5, 4.0, 4.5, 4.75, 5.0, 5.25, 5.5, 6.0, 6.5]
    w_sh_grid = [2.0, 2.5, 2.75, 3.0, 3.25, 3.5, 4.0]
    heatmap_rows = []
    for wp in w_pos_grid:
        for wsh in w_sh_grid:
            res = _eval_params_on_caches(dev_caches, w_pos=wp, w_shelf=wsh, r0=1.0, R_pos=2.5, ks=(3, 4))
            heatmap_rows.append({
                "w_pos": wp, "w_shelf": wsh, "meta_comb": res["meta_comb"],
                "k3_choke_id": res["K3"]["phys_choke_id_pct"], "k3_shelf_rec": res["K3"]["phys_shelf_rec_pct"],
                "k3_area": res["K3"]["area_cov_pct"], "k3_red": res["K3"]["red_pct"], "k3_kpi_pct": res["K3"]["kpi_pass_pct"],
                "k4_choke_id": res["K4"]["phys_choke_id_pct"], "k4_kpi_pct": res["K4"]["kpi_pass_pct"],
            })

    # Part 2: Decay radii fine sweep on default-kernel layouts (store_60m2, circle_k_75m2, ministop_50m2 + test_20)
    radius_sub = [c for c in dev_caches if not any(c.name.startswith(p) for p in ("vn_",))] + test_caches[:20]
    radius_rows = []
    for r0v in [0.50, 0.75, 1.00, 1.25, 1.50]:
        for Rpos in [1.75, 2.00, 2.25, 2.50, 2.75, 3.00]:
            if Rpos <= r0v + 0.25:
                continue
            res = _eval_params_on_caches(radius_sub, w_pos=5.0, w_shelf=3.0, r0=r0v, R_pos=Rpos, ks=(3, 4))
            radius_rows.append({
                "r0": r0v, "R_pos": Rpos, "meta_comb": res["meta_comb"],
                "k3_choke_id": res["K3"]["phys_choke_id_pct"], "k3_shelf_rec": res["K3"]["phys_shelf_rec_pct"],
                "k3_area": res["K3"]["area_cov_pct"], "k4_kpi_pct": res["K4"]["kpi_pass_pct"],
            })

    # Part 3: High/Bulky shelf profile fine sweep on vn_* + profile-annotated synthetic cohort (N=15)
    prof_synthetics = [build_layout_cache(make_bundle_from_raw(random_layout_dict(3000 + i, assign_risk_profiles=True))) for i in range(15)]
    vn_dev = [c for c in dev_caches if c.name.startswith("vn_")]
    shelf_cohort = vn_dev + prof_synthetics
    shelf_prof_rows = []
    for wh in [3.75, 4.25, 4.50, 4.75, 5.25]:
        for wb in [1.25, 1.50, 1.80, 2.10, 2.50]:
            res = _eval_params_on_caches(shelf_cohort, w_pos=5.0, w_shelf=3.0, r0=1.0, R_pos=2.5, w_high=wh, w_bulky=wb, ks=(3, 4))
            shelf_prof_rows.append({
                "w_high": wh, "w_bulky": wb, "meta_comb": res["meta_comb"],
                "k3_red": res["K3"]["red_pct"], "k3_yel": res["K3"]["yellow_pct"], "k4_kpi_pct": res["K4"]["kpi_pass_pct"],
            })

    # Part 4: Derivative-Free Powell/Nelder-Mead Inverse Optimizer on Dev (7) -> Out-of-Sample Held-Out (50) + TOST
    eval_history: list[tuple[np.ndarray, float]] = []

    def dev_loss(theta: np.ndarray) -> float:
        wp, wsh, r0v, rpos = [float(v) for v in theta]
        if not (3.0 <= wp <= 8.0 and 1.5 <= wsh <= 5.0 and 0.5 <= r0v <= 1.6 and r0v + 0.3 <= rpos <= 3.5 and wp >= wsh + 0.5):
            return 100.0
        res = _eval_params_on_caches(dev_caches, w_pos=wp, w_shelf=wsh, r0=r0v, R_pos=rpos, ks=(3,))
        val = -res["meta_comb"]
        eval_history.append((theta.copy(), -val))
        return val

    starts = [
        np.array([5.0, 3.0, 1.0, 2.5]),
        np.array([4.0, 2.2, 0.8, 2.0]),
        np.array([6.5, 3.5, 1.2, 3.0]),
    ]
    best_theta = starts[0].copy()
    best_dev_score = -1e9
    for x0 in starts:
        opt_res = minimize(dev_loss, x0, method="Nelder-Mead", options={"maxiter": 45, "xatol": 0.1, "fatol": 0.02})
        if -opt_res.fun > best_dev_score:
            best_dev_score = -float(opt_res.fun)
            best_theta = opt_res.x.copy()

    # Out-of-sample Held-Out 50 comparison + TOST (margin +-1.0 pp)
    base_ho = _eval_params_on_caches(test_caches, w_pos=5.0, w_shelf=3.0, r0=1.0, R_pos=2.5, ks=(3, 4))
    tuned_ho = _eval_params_on_caches(
        test_caches,
        w_pos=float(best_theta[0]), w_shelf=float(best_theta[1]),
        r0=float(best_theta[2]), R_pos=float(best_theta[3]),
        ks=(3, 4),
    )

    tost_results = {}
    for k_tag, raw_key in [("K=3", "raw_k3"), ("K=4", "raw_k4")]:
        tost_results[k_tag] = {}
        for metric in ("phys_choke_id_pct", "phys_shelf_rec_pct", "area_cov_pct", "red_pct", "yellow_pct", "phys_meta"):
            b_arr = np.array([r[metric] for r in base_ho[raw_key]])
            t_arr = np.array([r[metric] for r in tuned_ho[raw_key]])
            tost_results[k_tag][metric] = _tost_paired(b_arr - t_arr, margin=1.0)

    return {
        "heatmap_dev": heatmap_rows,
        "best_heatmap_point": max(heatmap_rows, key=lambda r: r["meta_comb"]),
        "radius_sweep": radius_rows,
        "best_radius_point": max(radius_rows, key=lambda r: r["meta_comb"]),
        "shelf_profile_sweep": shelf_prof_rows,
        "inverse_opt_best_params": {
            "w_pos": round(float(best_theta[0]), 3),
            "w_shelf": round(float(best_theta[1]), 3),
            "r0": round(float(best_theta[2]), 3),
            "R_pos": round(float(best_theta[3]), 3),
            "dev_meta_score": round(best_dev_score, 3),
            "dev_evals": len(eval_history),
        },
        "heldout_base_5_3_1": {"K3": base_ho["K3"], "K4": base_ho["K4"], "meta_comb": base_ho["meta_comb"]},
        "heldout_tuned_opt": {"K3": tuned_ho["K3"], "K4": tuned_ho["K4"], "meta_comb": tuned_ho["meta_comb"]},
        "tost_equivalence_pm1pp": tost_results,
    }


def run_w4_interaction_and_cutoffs(dev_caches: list[LayoutCache], test_caches: list[LayoutCache]) -> dict[str, Any]:
    """2D (W_pos, W_shelf) x F_recog heatmap + 0.2-step RISK_RED/YELLOW threshold cutoff sweep."""
    w_pairs = [(3.0, 2.0), (4.0, 2.0), (5.0, 2.5), (5.0, 3.0), (5.5, 3.0), (6.0, 3.0), (8.0, 3.0)]
    f_recs = [0.75, 0.65, 0.55, 0.50]
    interaction_rows = []
    # Run on Dev (7) + HeldOut (25) = 32 layouts for fast high-coverage matrix
    sub_caches = dev_caches + test_caches[:25]
    for wp, wsh in w_pairs:
        for frec in f_recs:
            res = _eval_params_on_caches(sub_caches, w_pos=wp, w_shelf=wsh, r0=1.0, R_pos=2.5, ks=(3, 4), f_rec=frec)
            interaction_rows.append({
                "w_pos": wp, "w_shelf": wsh, "f_recog": frec,
                "k3_red_pct": res["K3"]["red_pct"], "k3_yel_pct": res["K3"]["yellow_pct"],
                "k3_kpi_pct": res["K3"]["kpi_pass_pct"], "k3_choke_id": res["K3"]["phys_choke_id_pct"],
                "k3_shelf_rec": res["K3"]["phys_shelf_rec_pct"], "k3_area": res["K3"]["area_cov_pct"],
                "k4_kpi_pct": res["K4"]["kpi_pass_pct"], "meta_comb": res["meta_comb"],
            })

    # Cutoff sweep for RISK_RED_THRESHOLD (default 4.0) & RISK_YELLOW_THRESHOLD (default 2.0)
    cutoff_rows = []
    for t_red in [3.2, 3.5, 3.8, 4.0, 4.2, 4.5]:
        for t_yel in [1.4, 1.7, 2.0, 2.3, 2.6]:
            if t_yel >= t_red - 0.5:
                continue
            precs, recs, kpi_k4 = [], [], []
            for c in sub_caches:
                ws = c.ws_prod
                rmask = ws >= t_red
                pe = c.pos_ent_cells
                tp = float(np.sum(rmask & pe))
                prec = tp / max(1.0, float(np.sum(rmask))) * 100.0
                rec = tp / max(1.0, float(np.sum(pe))) * 100.0
                precs.append(prec)
                recs.append(rec)
                # Evaluate K=4 placement under these cutoffs
                sel4, _ = solve_opticam_cached(c, ws=ws, budget_k=4, algorithm="hybrid", t_red=t_red, t_yel=t_yel)
                bp4 = c.ppm_mat[sel4].max(axis=0)
                ev4 = evaluate_from_ppm(bp4, ws, cache=c, t_red=t_red, t_yel=t_yel)
                kpi_k4.append(100.0 if ev4["kpi_pass"] else 0.0)
            p_m, r_m = float(np.mean(precs)), float(np.mean(recs))
            f1 = 2 * p_m * r_m / max(1e-9, p_m + r_m)
            cutoff_rows.append({
                "t_red": t_red, "t_yel": t_yel,
                "choke_precision_pct": round(p_m, 1), "choke_recall_pct": round(r_m, 1),
                "choke_f1": round(f1, 1), "k4_kpi_pass_pct": round(float(np.mean(kpi_k4)), 1),
            })

    return {"interaction_2d": interaction_rows, "cutoff_sweep": cutoff_rows}


def run_tkpi_fine_kneedle(dev_caches: list[LayoutCache], test_caches: list[LayoutCache]) -> dict[str, Any]:
    """1%-step Red x 2%-step Yellow sweep, finite-diff Capex hazard, Kneedle elbow, & TOST equivalence."""
    tau_reds = list(range(90, 101))  # 90% .. 100% by 1%
    tau_yels = [74, 76, 78, 80, 82, 84, 86]

    out: dict[str, Any] = {}
    for split_name, caches in [("dev_7", dev_caches), ("heldout_50", test_caches)]:
        precomp = []
        for c in caches:
            per_k = []
            for K in range(1, 8):
                _, ev = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid")
                per_k.append(ev)
            precomp.append(per_k)

        # 1D Red curve fixed at tau_Yellow = 80% for clean Kneedle elbow detection
        red_curve = []
        raw_mink_by_tr: dict[float, np.ndarray] = {}
        raw_uncov_by_tr: dict[float, np.ndarray] = {}
        for tr in tau_reds:
            mks, uncovs, minppms, infeas = [], [], [], []
            for per_k in precomp:
                hit = next((idx for idx, e in enumerate(per_k) if e["red_pct"] >= tr and e["yellow_pct"] >= 80.0), None)
                mk = (hit + 1) if hit is not None else 8
                ev_p = per_k[hit] if hit is not None else per_k[-1]
                mks.append(mk)
                uncovs.append(ev_p["uncov_red_m2"])
                minppms.append(ev_p["red_min_ppm"])
                infeas.append(100.0 if hit is None else 0.0)
            raw_mink_by_tr[tr] = np.array(mks, dtype=np.float64)
            raw_uncov_by_tr[tr] = np.array(uncovs, dtype=np.float64)
            red_curve.append({
                "tau_red": tr,
                "mean_min_k": round(float(np.mean(mks)), 3),
                "mean_uncov_m2": round(float(np.mean(uncovs)), 3),
                "max_uncov_m2": round(float(np.max(uncovs)), 3),
                "pct_infeasible_k7": round(float(np.mean(infeas)), 1),
                "mean_red_min_ppm": round(float(np.mean(minppms)), 1),
            })

        # Compute Kneedle perpendicular distance on normalized (MinK + BlindPocket) trade-off & Capex curve
        xs_norm = np.array([(tr - 90.0) / 10.0 for tr in tau_reds])
        ys_k = np.array([r["mean_min_k"] for r in red_curve])
        yk_norm = (ys_k - ys_k.min()) / max(1e-9, ys_k.max() - ys_k.min())
        # Knee distance from secant connecting (0, yk_norm[0]) to (1, yk_norm[-1])
        p0 = np.array([xs_norm[0], yk_norm[0]])
        p1 = np.array([xs_norm[-1], yk_norm[-1]])
        v = p1 - p0
        v_len = np.linalg.norm(v) + 1e-12
        for i, r in enumerate(red_curve):
            pt = np.array([xs_norm[i], yk_norm[i]])
            # Perpendicular signed offset below secant (positive = sharpest elbow before Capex spike)
            knee_d = float((v[0] * (pt[1] - p0[1]) - v[1] * (pt[0] - p0[0])) / v_len)
            r["kneedle_capex_elbow"] = round(-knee_d, 4)
            r["d_mink_per_pct"] = round(float(ys_k[i] - ys_k[i - 1]), 3) if i > 0 else 0.0

        # Also 2D Yellow x Red grid around (95, 80)
        grid_2d = []
        for ty in tau_yels:
            for tr in [92, 94, 95, 96, 98, 100]:
                mks, uncovs = [], []
                for per_k in precomp:
                    hit = next((idx for idx, e in enumerate(per_k) if e["red_pct"] >= tr and e["yellow_pct"] >= ty), None)
                    mks.append((hit + 1) if hit is not None else 8)
                    uncovs.append((per_k[hit] if hit is not None else per_k[-1])["uncov_red_m2"])
                grid_2d.append({
                    "tau_red": tr, "tau_yellow": ty,
                    "mean_min_k": round(float(np.mean(mks)), 3),
                    "mean_uncov_m2": round(float(np.mean(uncovs)), 3),
                })

        # Joint normalized cost: 0.5 * norm(MinK) + 0.5 * norm(mean_uncov_m2)
        mk_vals = np.array([r["mean_min_k"] for r in red_curve])
        uv_vals = np.array([r["mean_uncov_m2"] for r in red_curve])
        j_cost = 0.5 * (mk_vals - mk_vals.min()) / max(1e-9, mk_vals.max() - mk_vals.min()) + 0.5 * (uv_vals - uv_vals.min()) / max(1e-9, uv_vals.max() - uv_vals.min())
        for i, r in enumerate(red_curve):
            r["joint_cost_risk_score"] = round(float(j_cost[i]), 4)

        best_joint_tr = red_curve[int(np.argmin(j_cost))]["tau_red"]
        best_knee_tr = max(red_curve, key=lambda r: r["kneedle_capex_elbow"])["tau_red"]
        tost_vs_joint = _tost_paired(raw_mink_by_tr[95] - raw_mink_by_tr[best_joint_tr], margin=0.25)

        out[split_name] = {
            "red_1pct_curve": red_curve,
            "kneedle_elbow_tau_red": best_knee_tr,
            "joint_cost_min_tau_red": best_joint_tr,
            "tost_mink_95_vs_joint_opt": tost_vs_joint,
            "grid_2d_fine": grid_2d,
        }
    return out


def main() -> None:
    t0 = time.perf_counter()
    print("[Phase 1B] Loading Dev (7) + Held-Out (50) caches...", flush=True)
    dev_caches = [build_layout_cache(b) for b in get_dev_bundles(deduplicate=True)]
    test_caches = [build_layout_cache(b) for b in get_heldout_bundles(n_stores=50, seed0=2026)]

    print("[W3] Running fine 0.25-step grid, decay/shelf sweeps, and inverse Powell calibration...", flush=True)
    w3 = run_w3_fine_calibration(dev_caches, test_caches)

    print("[W4] Running 2D W x F_recog matrix & UI threshold cutoff sweep...", flush=True)
    w4 = run_w4_interaction_and_cutoffs(dev_caches, test_caches)

    print("[T-KPI-Fine] Running 1%-step Kneedle elbow & TOST equivalence validation...", flush=True)
    tkpi_f = run_tkpi_fine_kneedle(dev_caches, test_caches)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    res = {"w3_calibration": w3, "w4_interaction": w4, "tkpi_fine": tkpi_f, "runtime_s": round(time.perf_counter() - t0, 1)}
    (DATA_DIR / "phase1b_fine_tuning.json").write_text(json.dumps(res, indent=2), encoding="utf-8")

    with open(DATA_DIR / "phase1b_w3_heatmap.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(w3["heatmap_dev"][0].keys()))
        w.writeheader()
        w.writerows(w3["heatmap_dev"])

    with open(DATA_DIR / "phase1b_tkpi_1pct.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(tkpi_f["heldout_50"]["red_1pct_curve"][0].keys()))
        w.writeheader()
        w.writerows(tkpi_f["heldout_50"]["red_1pct_curve"])

    print(f"\nDONE Phase 1B in {time.perf_counter() - t0:.1f}s -> {DATA_DIR / 'phase1b_fine_tuning.json'}", flush=True)
    print(f"  Best inverse-opt Dev params: {w3['inverse_opt_best_params']}")
    print(f"  HeldOut TOST K=3 phys_meta: {w3['tost_equivalence_pm1pp']['K=3']['phys_meta']}")
    print(f"  HeldOut Kneedle tau_red={tkpi_f['heldout_50']['kneedle_elbow_tau_red']}%, Joint-min tau_red={tkpi_f['heldout_50']['joint_cost_min_tau_red']}%")


if __name__ == "__main__":
    main()
