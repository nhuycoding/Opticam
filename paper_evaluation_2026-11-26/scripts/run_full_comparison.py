"""Comprehensive cross-evaluation benchmark comparing OptiCam against the 4 reference papers
on all 8 current layouts in data_samples/.

Outputs:
  - comparison_results.json (full detailed results per layout, K, and method)
  - comparison_summary.csv  (flat table for easy inspection)
"""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
DATA_OUT_DIR = SCRIPTS_DIR.parent / "data"
sys.path.insert(0, str(SCRIPTS_DIR))

from opticam_fast import (
    SAMPLES,
    compute_wang_q_matrix,
    evaluate_opticam,
    load_layout_bundle,
    run_opticam_hybrid,
)
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

SEEDS = [2026, 2027, 2028]


def _mean_metrics(evs: list[dict[str, Any]]) -> dict[str, Any]:
    keys = [
        "cams", "weighted", "weighted_pct", "red_pct", "yellow_pct",
        "red_min_ppm", "area_cov_pct", "obs_pct", "rec_pct", "id_pct",
        "overlap_pct", "wvcr_pct", "runtime_ms",
    ]
    out: dict[str, Any] = {}
    for k in keys:
        vals = [float(e[k]) for e in evs]
        out[k] = round(float(np.mean(vals)), 2)
        out[f"{k}_std"] = round(float(np.std(vals)), 2)
    out["kpi_pass_rate"] = f"{sum(1 for e in evs if e['kpi_pass'])}/{len(evs)}"
    out["kpi_pass"] = all(e["kpi_pass"] for e in evs)
    # Also retain best-seed metrics by native fitness / weighted score
    best_e = max(evs, key=lambda e: e.get("native_fitness", e.get("native_wvcr_pct", e["weighted"])))
    out["best_seed_weighted"] = best_e["weighted"]
    out["best_seed_red_pct"] = best_e["red_pct"]
    out["best_seed_yellow_pct"] = best_e["yellow_pct"]
    out["best_seed_area_cov_pct"] = best_e["area_cov_pct"]
    out["best_seed_kpi_pass"] = best_e["kpi_pass"]
    return out


def solve_wang_cached(bundle: dict[str, Any], mounts: str, weighted: bool, Q0: float = 0.1, E0: float = 1.8):
    t0 = time.perf_counter()
    cands = _erdem_candidate_pool(bundle, mounts=mounts)
    if len(cands) > 900:
        cands = [cands[int(i * len(cands) / 900)] for i in range(900)]
    xs, ys, ws = bundle["xs"], bundle["ys"], bundle["ws"]
    layout = bundle["layout"]
    B_full = compute_wang_q_matrix(cands, xs, ys, bundle["obstacles"], layout.floorPolygon, occlusion_mode="2d", target_height=layout.targetHeight)
    keep = np.any(B_full >= Q0, axis=1)
    cands = [c for c, k in zip(cands, keep) if k]
    B = B_full[keep].T
    w_vec = ws if weighted else np.ones_like(ws)
    z_star = _solve_wang_socp(B, w_vec, Q0=Q0, E0=E0)
    solve_ms = (time.perf_counter() - t0) * 1000.0
    ranked = np.argsort(-z_star)
    return cands, B, w_vec, z_star, ranked, solve_ms


def eval_wang_fixed_k(cands, B, w_vec, ranked, solve_ms, bundle, budget_k: int, Q0: float = 0.1):
    sel_idx = [int(i) for i in ranked[:budget_k]]
    sel_cams = [{**cands[i], "id": f"WANG-{k+1:02d}"} for k, i in enumerate(sel_idx)]
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(solve_ms, 1)
    if sel_idx:
        q_sum = B[:, sel_idx].sum(axis=1)
        ev["native_wang_cov_pct"] = round(float(np.mean(q_sum >= Q0) * 100.0), 1)
    return sel_cams, ev


def eval_wang_min_count(cands, B, w_vec, ranked, solve_ms, bundle, Q0: float = 0.1, E0: float = 1.8):
    xs = bundle["xs"]
    coverable = (B.sum(axis=1) / w_vec) >= Q0
    sel_idx = []
    acc_q = np.zeros(len(xs), dtype=np.float64)
    max_avg = float(np.mean(B.sum(axis=1) / w_vec)) * 0.99
    target_avg = min(E0, max_avg)
    for idx in ranked:
        sel_idx.append(int(idx))
        acc_q += B[:, idx]
        ok_pt = (not np.any(coverable)) or bool(np.all((acc_q[coverable] / w_vec[coverable]) >= Q0))
        ok_avg = float(np.mean(acc_q / w_vec)) >= target_avg
        if ok_pt and ok_avg:
            break
    sel_cams = [{**cands[i], "id": f"WANG-{k+1:02d}"} for k, i in enumerate(sel_idx)]
    ev = evaluate_opticam(sel_cams, bundle)
    ev["runtime_ms"] = round(solve_ms, 1)
    return sel_cams, ev


def main() -> None:
    t_start = time.perf_counter()
    results: dict[str, Any] = {"layouts": {}, "csv_rows": []}

    # Note: vn_co_nguoi_78m2.json has identical floor/obstacles/risk to vn_goc_pho_78m2.json
    # (only adds people, which are not used by any static layout optimizer).
    # We still record all 8 files, reusing vn_goc_pho_78m2 results for vn_co_nguoi_78m2 after verifying parity!
    cached_by_sig: dict[str, Any] = {}

    for fname in SAMPLES:
        bundle = load_layout_bundle(fname)
        layout = bundle["layout"]
        sig = json.dumps({
            "w": layout.widthM, "h": layout.heightM, "g": layout.gridM,
            "poly": layout.floorPolygon, "obs": [o.dict() for o in layout.obstacles],
            "risk": layout.risk, "strokes": [s.dict() for s in layout.riskStrokes],
        }, sort_keys=True)

        if sig in cached_by_sig:
            print(f"[CACHE] {fname} shares identical geometry/risk with {cached_by_sig[sig]['source_file']}", flush=True)
            copied = json.loads(json.dumps(cached_by_sig[sig]["data"]))
            copied["layout_file"] = fname
            copied["layout_name"] = layout.name
            results["layouts"][fname] = copied
            for row in copied["summary_rows"]:
                r_copy = dict(row)
                r_copy["layout_file"] = fname
                r_copy["layout_name"] = layout.name
                results["csv_rows"].append(r_copy)
            continue

        print(f"\n=== Running {fname} ({layout.name}, {len(bundle['xs'])} cells, gridM={layout.gridM}) ===", flush=True)
        layout_res: dict[str, Any] = {
            "layout_file": fname,
            "layout_name": layout.name,
            "cells": int(len(bundle["xs"])),
            "red_cells": int(np.sum(bundle["ws"] >= 4.0)),
            "yellow_cells": int(np.sum((bundle["ws"] >= 2.0) & (bundle["ws"] < 4.0))),
            "total_weight": round(float(np.sum(bundle["ws"])), 2),
            "fixed_k": {},
            "min_camera": {},
            "baselines": {},
            "summary_rows": [],
        }

        def record(section: str, k_label: str, method: str, ev: dict[str, Any]):
            row = {
                "layout_file": fname,
                "layout_name": layout.name,
                "section": section,
                "budget": k_label,
                "method": method,
                "cams": ev.get("cams", 0),
                "weighted": ev.get("weighted", 0),
                "weighted_pct": ev.get("weighted_pct", 0),
                "red_pct": ev.get("red_pct", 0),
                "yellow_pct": ev.get("yellow_pct", 0),
                "red_min_ppm": ev.get("red_min_ppm", 0),
                "area_cov_pct": ev.get("area_cov_pct", 0),
                "obs_pct": ev.get("obs_pct", 0),
                "rec_pct": ev.get("rec_pct", 0),
                "id_pct": ev.get("id_pct", 0),
                "overlap_pct": ev.get("overlap_pct", 0),
                "wvcr_pct": ev.get("wvcr_pct", 0),
                "kpi_pass": ev.get("kpi_pass", False),
                "runtime_ms": ev.get("runtime_ms", 0),
            }
            layout_res["summary_rows"].append(row)
            results["csv_rows"].append(row)
            print(
                f"  [{section:5s} {k_label:4s}] {method:24s} | C={row['cams']:4} | W={row['weighted']:6.1f} ({row['weighted_pct']:4.1f}%) "
                f"| Red={row['red_pct']:5.1f}% | Yel={row['yellow_pct']:5.1f}% | Area={row['area_cov_pct']:5.1f}% "
                f"| Ov={row['overlap_pct']:4.1f}% | {'PASS' if row['kpi_pass'] else 'FAIL'} | {row['runtime_ms']:6.1f}ms",
                flush=True,
            )

        # Baselines: Manual 4 Corners & Stored Preset Cameras (if any)
        _, ev_man = manual_four_corners(bundle)
        layout_res["baselines"]["manual_4c"] = ev_man
        record("base", "K=4", "Manual-4Corners", ev_man)

        if bundle["raw"].get("cameras"):
            raw_cams = [c.dict() if hasattr(c, "dict") else dict(c) for c in layout.cameras]
            ev_preset_native = evaluate_opticam(raw_cams, bundle)
            ev_preset_native["runtime_ms"] = 0.0
            layout_res["baselines"]["preset_native_hw"] = ev_preset_native
            record("base", f"K={len(raw_cams)}", "Preset-Cameras (NativeHW)", ev_preset_native)

            norm_cams = [{**c, **DEFAULT_CAM, "x": c["x"], "y": c["y"], "pan": c["pan"], "mount": c.get("mount", "wall")} for c in raw_cams]
            ev_preset_std = evaluate_opticam(norm_cams, bundle)
            ev_preset_std["runtime_ms"] = 0.0
            layout_res["baselines"]["preset_std_hw"] = ev_preset_std
            record("base", f"K={len(raw_cams)}", "Preset-Cameras (Std4MP)", ev_preset_std)

        # Solve Wang SOCP once per (weighted) mode
        wang_unif_cache = solve_wang_cached(bundle, mounts="mixed", weighted=False, Q0=0.1, E0=1.8)
        wang_crit_cache = solve_wang_cached(bundle, mounts="wall", weighted=True, Q0=0.1, E0=1.8)

        # Fixed-budget comparisons: K = 3 and K = 4
        for K in [3, 4]:
            k_key = f"K={K}"
            layout_res["fixed_k"][k_key] = {}

            _, ev_opt_mix = run_opticam_hybrid(bundle, K, "mixed", "hybrid")
            layout_res["fixed_k"][k_key]["OptiCam-Hybrid"] = ev_opt_mix
            record("fixed", k_key, "OptiCam-Hybrid", ev_opt_mix)

            _, ev_opt_wall = run_opticam_hybrid(bundle, K, "wall", "hybrid")
            layout_res["fixed_k"][k_key]["OptiCam-Wall"] = ev_opt_wall
            record("fixed", k_key, "OptiCam-Wall", ev_opt_wall)

            _, ev_erdem = run_erdem_max_coverage(bundle, K, "mixed", min_ppm=25.0)
            layout_res["fixed_k"][k_key]["Erdem-06 MaxCov"] = ev_erdem
            record("fixed", k_key, "Erdem-06 MaxCov", ev_erdem)

            aziz_runs = [run_aziz_ga(bundle, K, 0.5, seed=s, max_gens=100, patience=50)[1] for s in SEEDS]
            ev_aziz = _mean_metrics(aziz_runs)
            layout_res["fixed_k"][k_key]["Aziz-24 GA#3"] = {"mean": ev_aziz, "seeds": aziz_runs}
            record("fixed", k_key, "Aziz-24 GA#3 (3-seed)", ev_aziz)

            kim_runs = [run_kim_ga(bundle, K, seed=s, max_gens=100, patience=50)[1] for s in SEEDS]
            ev_kim = _mean_metrics(kim_runs)
            layout_res["fixed_k"][k_key]["Kim-19 SemGA"] = {"mean": ev_kim, "seeds": kim_runs}
            record("fixed", k_key, "Kim-19 SemGA (3-seed)", ev_kim)

            _, ev_wu = eval_wang_fixed_k(*wang_unif_cache[:2], wang_unif_cache[2], wang_unif_cache[4], wang_unif_cache[5], bundle, K)
            layout_res["fixed_k"][k_key]["Wang-13 Unif"] = ev_wu
            record("fixed", k_key, "Wang-13 Unif", ev_wu)

            _, ev_wc = eval_wang_fixed_k(*wang_crit_cache[:2], wang_crit_cache[2], wang_crit_cache[4], wang_crit_cache[5], bundle, K)
            layout_res["fixed_k"][k_key]["Wang-13 Crit"] = ev_wc
            record("fixed", k_key, "Wang-13 Crit", ev_wc)

        # Unconstrained Minimum-Camera / Set-Cover comparisons
        # OptiCam minimum K meeting Red >= 95 & Yellow >= 80
        opt_min_ev = None
        for k_try in range(1, 9):
            _, ev_try = run_opticam_hybrid(bundle, k_try, "mixed", "hybrid")
            opt_min_ev = ev_try
            if ev_try["kpi_pass"]:
                break
        layout_res["min_camera"]["OptiCam-MinKPI"] = opt_min_ev
        record("minK", "Auto", "OptiCam-Hybrid (MinKPI)", opt_min_ev)

        _, ev_e25 = run_erdem_set_cover(bundle, "mixed", min_ppm=25.0, hotspot_ppm=None)
        layout_res["min_camera"]["Erdem-06 SetCov(25)"] = ev_e25
        record("minK", "Auto", "Erdem-06 SetCov(25)", ev_e25)

        _, ev_e250 = run_erdem_set_cover(bundle, "mixed", min_ppm=250.0, hotspot_ppm=None)
        layout_res["min_camera"]["Erdem-06 SetCov(250)"] = ev_e250
        record("minK", "Auto", "Erdem-06 SetCov(250)", ev_e250)

        _, ev_ehot = run_erdem_set_cover(bundle, "mixed", min_ppm=25.0, hotspot_ppm=250.0)
        layout_res["min_camera"]["Erdem-06 HotSpot(P4)"] = ev_ehot
        record("minK", "Auto", "Erdem-06 HotSpot(P4)", ev_ehot)

        _, ev_wmin_u = eval_wang_min_count(*wang_unif_cache[:2], wang_unif_cache[2], wang_unif_cache[4], wang_unif_cache[5], bundle)
        layout_res["min_camera"]["Wang-13 Unif(Min)"] = ev_wmin_u
        record("minK", "Auto", "Wang-13 Unif (Min)", ev_wmin_u)

        _, ev_wmin_c = eval_wang_min_count(*wang_crit_cache[:2], wang_crit_cache[2], wang_crit_cache[4], wang_crit_cache[5], bundle)
        layout_res["min_camera"]["Wang-13 Crit(Min)"] = ev_wmin_c
        record("minK", "Auto", "Wang-13 Crit (Min)", ev_wmin_c)

        results["layouts"][fname] = layout_res
        cached_by_sig[sig] = {"source_file": fname, "data": layout_res}

    DATA_OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_json = DATA_OUT_DIR / "comparison_results.json"
    out_csv = DATA_OUT_DIR / "comparison_summary.csv"
    out_json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    fieldnames = list(results["csv_rows"][0].keys())
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(results["csv_rows"])
    print(f"\nDONE in {time.perf_counter() - t_start:.1f}s -> {out_csv}", flush=True)


if __name__ == "__main__":
    main()
