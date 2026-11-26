"""Phase 1: Scientific justification of (5, 3, 1) risk weights and (95%, 80%) KPI thresholds.

Experiments:
  W1    Pareto-Knee & contrast-collapse sweep across (1,1,1) .. (12,3,1) on Dev (7) + Held-Out (50)
  W2    Local perturbation plateau stability & Saltelli Sobol sensitivity (analytical + endogenous optimizer)
  T-KPI Acceptance threshold sweep (tau_Red, tau_Yellow): Blind-Pocket Risk vs Last-Cell Capex Explosion

Outputs saved under paper_evaluation_2026-11-26/data/.
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
from scipy.stats import qmc

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
from synthetic_layouts import get_dev_bundles, get_heldout_bundles


def _pose_overlap(cands: list[dict[str, Any]], idx_a: list[int], idx_b: list[int], pos_tol: float = 0.75, pan_tol: float = 35.0) -> float:
    """Fraction of cameras in A matched to a distinct camera in B within (pos_tol m, pan_tol deg)."""
    if not idx_a or not idx_b:
        return 0.0
    used_b: set[int] = set()
    matched = 0
    for ia in idx_a:
        ca = cands[ia]
        for j, ib in enumerate(idx_b):
            if j in used_b:
                continue
            cb = cands[ib]
            if ca.get("mount") != cb.get("mount"):
                continue
            dist = math.hypot(float(ca["x"]) - float(cb["x"]), float(ca["y"]) - float(cb["y"]))
            dpan = abs(((float(ca["pan"]) - float(cb["pan"]) + 180.0) % 360.0) - 180.0)
            if dist <= pos_tol and dpan <= pan_tol:
                used_b.add(j)
                matched += 1
                break
    return matched / max(len(idx_a), len(idx_b)) * 100.0


def _utopia_dist(choke_id: float, shelf_rec: float, area_cov: float) -> float:
    """Normalized Euclidean distance to ideal (100%, 100%, 100%) on weight-agnostic physical metrics."""
    return math.sqrt(((100.0 - choke_id) ** 2 + (100.0 - shelf_rec) ** 2 + (100.0 - area_cov) ** 2) / 3.0)


def _pareto_flags(rows: list[dict[str, Any]], keys: tuple[str, str, str] = ("phys_choke_id_pct", "phys_shelf_rec_pct", "area_cov_pct")) -> list[bool]:
    """Identify non-dominated rows maximizing the 3 specified metrics."""
    out = []
    for i, r in enumerate(rows):
        dom = False
        for j, o in enumerate(rows):
            if i == j:
                continue
            if all(o[k] >= r[k] - 1e-9 for k in keys) and any(o[k] > r[k] + 1e-9 for k in keys):
                dom = True
                break
        out.append(not dom)
    return out


def run_w1_pareto(dev_caches: list[LayoutCache], test_caches: list[LayoutCache]) -> dict[str, Any]:
    """Compare risk weight triples (W_pos, W_shelf, W_floor) on model-free physical security metrics."""
    profiles = [
        ("1_1_1_Uniform", 1.0, 1.0, 1.0),
        ("2_1.5_1_Low", 2.0, 1.5, 1.0),
        ("4_2_1_LinMid", 4.0, 2.0, 1.0),
        ("5_3_1_OptiCam", 5.0, 3.0, 1.0),
        ("8_3_1_HighPOS", 8.0, 3.0, 1.0),
        ("12_3_1_Tunnel", 12.0, 3.0, 1.0),
    ]
    out: dict[str, Any] = {"profiles": [], "summary_csv": []}

    for split_name, caches in [("dev_7", dev_caches), ("heldout_50", test_caches)]:
        for K in [3, 4]:
            split_rows = []
            for label, wp, ws_v, wf in profiles:
                vals: dict[str, list[float]] = {
                    "phys_choke_id_pct": [], "phys_choke_rec_pct": [], "phys_choke_min_ppm": [],
                    "phys_shelf_rec_pct": [], "area_cov_pct": [], "obs_pct": [], "rec_pct": [], "id_pct": [],
                    "red_pct": [], "yellow_pct": [], "kpi_pass": [], "weighted_pct": [], "uncov_red_m2": [],
                }
                for cache in caches:
                    ws = compute_weights(cache, w_pos=wp, w_shelf=ws_v, w_floor=wf, respect_custom=True, scale_custom=True)
                    sel_idx, _ = solve_opticam_cached(cache, ws=ws, budget_k=K, algorithm="hybrid")
                    best_ppm = cache.ppm_mat[sel_idx].max(axis=0) if sel_idx else np.zeros(len(cache.xs))
                    # Evaluate BOTH on objective weights and fixed default production weights (for KPI pass check)
                    ev_prod = evaluate_from_ppm(best_ppm, cache.ws_prod, cache=cache, grid_m=float(cache.bundle["layout"].gridM))
                    for k_m in vals:
                        vals[k_m].append(float(ev_prod[k_m]))
                row = {
                    "split": split_name,
                    "K": K,
                    "label": label,
                    "w_pos": wp,
                    "w_shelf": ws_v,
                    "w_floor": wf,
                    **{k: round(float(np.mean(v)), 2) for k, v in vals.items() if k != "kpi_pass"},
                    "kpi_pass_pct": round(float(np.mean(vals["kpi_pass"]) * 100.0), 1),
                    "utopia_dist": round(_utopia_dist(float(np.mean(vals["phys_choke_id_pct"])), float(np.mean(vals["phys_shelf_rec_pct"])), float(np.mean(vals["area_cov_pct"]))), 2),
                }
                split_rows.append(row)

            pareto = _pareto_flags(split_rows)
            for r, pflag in zip(split_rows, pareto):
                r["pareto_optimal"] = pflag
                out["summary_csv"].append(r)
            out["profiles"].extend(split_rows)
    return out


def run_w2_stability_and_sobol(dev_caches: list[LayoutCache], test_caches: list[LayoutCache]) -> dict[str, Any]:
    """Measure local perturbation plateau around (5,3,1) and compute Saltelli/Sobol sensitivity indices."""
    # Baseline cache evaluations at K=3, K=4
    sub_caches = dev_caches + test_caches[:25]
    base_solutions: dict[tuple[int, int], tuple[list[int], dict[str, Any]]] = {}
    for K in [3, 4]:
        for idx, cache in enumerate(sub_caches):
            sel, ev = solve_opticam_cached(cache, ws=cache.ws_prod, budget_k=K, algorithm="hybrid")
            base_solutions[(K, idx)] = (sel, ev)

    perturbations = [
        ("W_pos_4.25 (-15%)", dict(w_pos=4.25)),
        ("W_pos_5.75 (+15%)", dict(w_pos=5.75)),
        ("W_shelf_2.55 (-15%)", dict(w_shelf=2.55)),
        ("W_shelf_3.45 (+15%)", dict(w_shelf=3.45)),
        ("r0_0.80 (-20%)", dict(r0_pos=0.80, r0_shelf=0.80)),
        ("r0_1.20 (+20%)", dict(r0_pos=1.20, r0_shelf=1.20)),
        ("r0_1.50 (RESEARCH)", dict(r0_pos=1.50, r0_shelf=1.20)),
        ("R_pos_2.00 (-20%)", dict(R_pos=2.00)),
        ("R_pos_3.00 (+20%)", dict(R_pos=3.00)),
    ]

    pert_rows = []
    for K in [3, 4]:
        for pname, kwargs in perturbations:
            agrees, overlaps, d_id, d_sh, d_area = [], [], [], [], []
            for idx, cache in enumerate(sub_caches):
                ws = compute_weights(cache, respect_custom=True, scale_custom=True, **kwargs)
                sel, _ = solve_opticam_cached(cache, ws=ws, budget_k=K, algorithm="hybrid")
                best_ppm = cache.ppm_mat[sel].max(axis=0) if sel else np.zeros(len(cache.xs))
                ev = evaluate_from_ppm(best_ppm, cache.ws_prod, cache=cache, grid_m=float(cache.bundle["layout"].gridM))
                b_sel, b_ev = base_solutions[(K, idx)]
                agrees.append(100.0 if ev["kpi_pass"] == b_ev["kpi_pass"] else 0.0)
                overlaps.append(_pose_overlap(cache.cands, b_sel, sel))
                d_id.append(ev["phys_choke_id_pct"] - b_ev["phys_choke_id_pct"])
                d_sh.append(ev["phys_shelf_rec_pct"] - b_ev["phys_shelf_rec_pct"])
                d_area.append(ev["area_cov_pct"] - b_ev["area_cov_pct"])
            pert_rows.append({
                "K": K,
                "perturbation": pname,
                "kpi_agree_pct": round(float(np.mean(agrees)), 1),
                "pose_overlap_pct": round(float(np.mean(overlaps)), 1),
                "delta_choke_id_pp": round(float(np.mean(d_id)), 2),
                "delta_shelf_rec_pp": round(float(np.mean(d_sh)), 2),
                "delta_area_cov_pp": round(float(np.mean(d_area)), 2),
            })

    # Saltelli / Sobol 5D endogenous optimizer sensitivity on representative presets (store_60m2, circle_k_75m2, ministop_50m2)
    sobol_dims = ["w_pos", "w_shelf", "r0", "R_pos", "f_rec"]
    bounds_lo = np.array([3.5, 2.0, 0.7, 1.8, 0.50])
    bounds_hi = np.array([6.5, 4.0, 1.3, 3.2, 0.85])
    n_pow2 = 64  # Saltelli total = N * (2D + 2) for D=5 -> 768 evaluations across 3 layouts
    engine = qmc.Sobol(d=len(sobol_dims) * 2, scramble=True, seed=2026)
    u = engine.random(n_pow2)
    A = bounds_lo + u[:, :5] * (bounds_hi - bounds_lo)
    B = bounds_lo + u[:, 5:] * (bounds_hi - bounds_lo)

    # Analytical sensitivity on weighted score (N=512) + Endogenous optimization Sobol (N=64, 3 presets K=3)
    rep_caches = [c for c in dev_caches if any(k in c.name for k in ("store_60m2", "circle_k_75m2", "ministop_50m2"))]

    def eval_opt_vec(param_mat: np.ndarray) -> np.ndarray:
        # Outputs per row: [phys_choke_id_pct, phys_shelf_rec_pct, area_cov_pct, red_pct]
        outs = np.zeros((param_mat.shape[0], 4), dtype=np.float64)
        for row_i, (wp, wsh, r0v, rpos, frec) in enumerate(param_mat):
            m_vals = np.zeros(4)
            f_obs = min(0.55, float(frec) * 0.533)
            f_det = min(0.30, float(frec) * 0.267)
            for c in rep_caches:
                ws = compute_weights(c, w_pos=float(wp), w_shelf=float(wsh), r0_pos=float(r0v), r0_shelf=float(r0v), R_pos=float(rpos), respect_custom=False)
                sel, _ = solve_opticam_cached(c, ws=ws, budget_k=3, algorithm="hybrid", f_rec=float(frec), f_obs=f_obs, f_det=f_det)
                best_ppm = c.ppm_mat[sel].max(axis=0) if sel else np.zeros(len(c.xs))
                ev = evaluate_from_ppm(best_ppm, c.ws_prod, cache=c)
                m_vals += np.array([ev["phys_choke_id_pct"], ev["phys_shelf_rec_pct"], ev["area_cov_pct"], ev["red_pct"]])
            outs[row_i] = m_vals / len(rep_caches)
        return outs

    fA = eval_opt_vec(A)
    fB = eval_opt_vec(B)
    var_y = np.var(np.vstack([fA, fB]), axis=0) + 1e-12
    sobol_results = []
    metric_names = ["phys_choke_id_pct", "phys_shelf_rec_pct", "area_cov_pct", "red_pct"]
    for d_i, d_name in enumerate(sobol_dims):
        AB_i = A.copy()
        AB_i[:, d_i] = B[:, d_i]
        fAB_i = eval_opt_vec(AB_i)
        # Saltelli 2010 estimators: S_i = mean(fB * (fAB_i - fA)) / V; S_Ti = 0.5 * mean((fA - fAB_i)^2) / V
        Si = np.mean(fB * (fAB_i - fA), axis=0) / var_y
        STi = 0.5 * np.mean((fA - fAB_i) ** 2, axis=0) / var_y
        row = {"param": d_name, "range": f"[{bounds_lo[d_i]:.2f}, {bounds_hi[d_i]:.2f}]"}
        for m_i, m_name in enumerate(metric_names):
            row[f"S1_{m_name}"] = round(max(0.0, float(Si[m_i])), 3)
            row[f"ST_{m_name}"] = round(max(0.0, float(STi[m_i])), 3)
        sobol_results.append(row)

    return {"local_perturbations": pert_rows, "sobol_endogenous_k3": sobol_results}


def run_tkpi_sweep(dev_caches: list[LayoutCache], test_caches: list[LayoutCache]) -> dict[str, Any]:
    """Evaluate Blind-Pocket Risk vs Last-Cell Capex Explosion across (tau_Red, tau_Yellow)."""
    all_groups = [("dev_7", dev_caches), ("heldout_50", test_caches)]
    tau_reds = [85.0, 90.0, 95.0, 98.0, 100.0]
    tau_yels = [70.0, 75.0, 80.0, 85.0, 90.0]
    out_rows = []

    for split_name, caches in all_groups:
        # Precompute K=1..7 best_ppm profiles once per layout
        precomp: list[list[dict[str, Any]]] = []
        for cache in caches:
            per_k = []
            for K in range(1, 8):
                sel, ev = solve_opticam_cached(cache, ws=cache.ws_prod, budget_k=K, algorithm="hybrid")
                per_k.append(ev)
            precomp.append(per_k)

        # Anchor baseline min-K at (95%, 80%)
        base_min_k = []
        for per_k in precomp:
            mk = next((idx + 1 for idx, e in enumerate(per_k) if e["red_pct"] >= 95.0 and e["yellow_pct"] >= 80.0), 8)
            base_min_k.append(mk)

        for tr in tau_reds:
            for ty in tau_yels:
                min_ks, uncov_areas, min_ppms, capex_jumps, infeas = [], [], [], [], []
                for l_i, per_k in enumerate(precomp):
                    hit_idx = next((idx for idx, e in enumerate(per_k) if e["red_pct"] >= tr and e["yellow_pct"] >= ty), None)
                    if hit_idx is None:
                        mk = 8
                        infeas.append(1.0)
                        ev_pick = per_k[-1]
                    else:
                        mk = hit_idx + 1
                        infeas.append(0.0)
                        ev_pick = per_k[hit_idx]
                    min_ks.append(mk)
                    uncov_areas.append(ev_pick["uncov_red_m2"])
                    min_ppms.append(ev_pick["red_min_ppm"])
                    capex_jumps.append(100.0 if mk > base_min_k[l_i] else 0.0)

                out_rows.append({
                    "split": split_name,
                    "tau_red": tr,
                    "tau_yellow": ty,
                    "mean_min_k": round(float(np.mean(min_ks)), 2),
                    "pct_capex_jump_vs_95_80": round(float(np.mean(capex_jumps)), 1),
                    "pct_infeasible_k7": round(float(np.mean(infeas) * 100.0), 1),
                    "mean_uncov_red_m2": round(float(np.mean(uncov_areas)), 3),
                    "max_uncov_red_m2": round(float(np.max(uncov_areas)), 3),
                    "mean_red_min_ppm": round(float(np.mean(min_ppms)), 1),
                    "p10_red_min_ppm": round(float(np.percentile(min_ppms, 10)), 1),
                })

    return {"grid": out_rows}


def main() -> None:
    t0 = time.perf_counter()
    print("[Phase 1] Loading Dev (7) + Held-Out (50) caches...", flush=True)
    dev_caches = [build_layout_cache(b) for b in get_dev_bundles(deduplicate=True)]
    test_caches = [build_layout_cache(b) for b in get_heldout_bundles(n_stores=50, seed0=2026)]
    print(f"  Caches ready in {time.perf_counter() - t0:.1f}s", flush=True)

    print("[W1] Running Risk Weight Contrast & Pareto-Knee sweep...", flush=True)
    w1 = run_w1_pareto(dev_caches, test_caches)

    print("[W2] Running Local Perturbation Stability & Sobol Sensitivity...", flush=True)
    w2 = run_w2_stability_and_sobol(dev_caches, test_caches)

    print("[T-KPI] Running (95%, 80%) Blind-Pocket vs Last-Cell Capex sweep...", flush=True)
    tkpi = run_tkpi_sweep(dev_caches, test_caches)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {"w1_pareto": w1, "w2_stability": w2, "tkpi_sweep": tkpi, "runtime_s": round(time.perf_counter() - t0, 1)}
    (DATA_DIR / "phase1_weights_thresholds.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    # Export clean CSV summaries
    with open(DATA_DIR / "phase1_w1_pareto.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(w1["summary_csv"][0].keys()))
        w.writeheader()
        w.writerows(w1["summary_csv"])

    with open(DATA_DIR / "phase1_tkpi_grid.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(tkpi["grid"][0].keys()))
        w.writeheader()
        w.writerows(tkpi["grid"])

    print(f"\nDONE Phase 1 in {time.perf_counter() - t0:.1f}s -> {DATA_DIR / 'phase1_weights_thresholds.json'}", flush=True)
    for r in [x for x in w1["summary_csv"] if x["split"] == "heldout_50" and x["K"] == 3]:
        print(f"  [W1 HeldOut K=3] {r['label']:16s} | ChokeID={r['phys_choke_id_pct']:5.1f}% | ShelfRec={r['phys_shelf_rec_pct']:5.1f}% | Area={r['area_cov_pct']:5.1f}% | Utopia={r['utopia_dist']:5.2f} | Pareto={r['pareto_optimal']}")


if __name__ == "__main__":
    main()
