"""Phase 2: Controlled Algorithm Tuning (T1 DORI F_recog, T2 KPI-aware Greedy, T3 Min-K search).

Benchmarks all candidates cleanly on Dev (7 distinct) and cross-validates on Held-Out (50) stores.
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
DATA_DIR = SCRIPTS_DIR.parent / "data"
sys.path.insert(0, str(SCRIPTS_DIR))

from fast_cache import LayoutCache, build_layout_cache, evaluate_from_ppm, solve_opticam_cached
from synthetic_layouts import get_dev_bundles, get_heldout_bundles


def _eval_variant(caches: list[LayoutCache], split: str, name: str, ks: tuple[int, ...] = (3, 4), **solve_kw) -> list[dict[str, Any]]:
    rows = []
    # Also compute Min-K across K=1..7 dedicated runs
    mink_vals, mink_reds, mink_yels, mink_times, infeas = [], [], [], [], []
    per_k_metrics: dict[int, list[dict[str, Any]]] = {K: [] for K in ks}

    for c in caches:
        found_k = None
        acc_ms = 0.0
        last_ev = None
        for K in range(1, 8):
            sel, ev_obj = solve_opticam_cached(c, ws=c.ws_prod, budget_k=K, algorithm="hybrid", **solve_kw)
            acc_ms += float(ev_obj["runtime_ms"])
            best_ppm = c.ppm_mat[sel].max(axis=0) if sel else np.zeros(len(c.xs))
            # Always evaluate under standardized production DORI so W% is strictly apples-to-apples
            ev_std = evaluate_from_ppm(best_ppm, c.ws_prod, cache=c, grid_m=float(c.bundle["layout"].gridM))
            ev_std["runtime_ms"] = ev_obj["runtime_ms"]
            last_ev = ev_std
            if K in per_k_metrics:
                per_k_metrics[K].append(ev_std)
            if found_k is None and ev_std["kpi_pass"]:
                found_k = K
                mink_vals.append(K)
                mink_reds.append(ev_std["red_pct"])
                mink_yels.append(ev_std["yellow_pct"])
                mink_times.append(acc_ms)
                infeas.append(0.0)
            if found_k is not None and K >= max(ks):
                break
        if found_k is None:
            mink_vals.append(8)
            mink_reds.append(last_ev["red_pct"])
            mink_yels.append(last_ev["yellow_pct"])
            mink_times.append(acc_ms)
            infeas.append(100.0)

    for K in ks:
        m = per_k_metrics[K]
        rows.append({
            "split": split, "experiment": solve_kw.get("_exp", "T"), "variant": name, "budget": f"K={K}",
            "cams": float(K),
            "weighted_pct": round(float(np.mean([r["weighted_pct"] for r in m])), 2),
            "red_pct": round(float(np.mean([r["red_pct"] for r in m])), 2),
            "yellow_pct": round(float(np.mean([r["yellow_pct"] for r in m])), 2),
            "area_cov_pct": round(float(np.mean([r["area_cov_pct"] for r in m])), 2),
            "red_min_ppm": round(float(np.mean([r["red_min_ppm"] for r in m])), 1),
            "kpi_pass_pct": round(float(np.mean([100.0 if r["kpi_pass"] else 0.0 for r in m])), 1),
            "runtime_ms": round(float(np.mean([r["runtime_ms"] for r in m])), 1),
        })

    rows.append({
        "split": split, "experiment": solve_kw.get("_exp", "T"), "variant": name, "budget": "Min-K",
        "cams": round(float(np.mean(mink_vals)), 3),
        "weighted_pct": round(float(np.mean([r["weighted_pct"] for r in per_k_metrics[4]])), 2),
        "red_pct": round(float(np.mean(mink_reds)), 2),
        "yellow_pct": round(float(np.mean(mink_yels)), 2),
        "area_cov_pct": round(float(np.mean([r["area_cov_pct"] for r in per_k_metrics[4]])), 2),
        "red_min_ppm": round(float(np.mean([r["red_min_ppm"] for r in per_k_metrics[4]])), 1),
        "kpi_pass_pct": round(100.0 - float(np.mean(infeas)), 1),
        "runtime_ms": round(float(np.mean(mink_times)), 1),
    })
    return rows


def run_t3_prefix_vs_dedicated(caches: list[LayoutCache], split: str, f_rec: float = 0.75, kpi_mode: str = "none") -> dict[str, Any]:
    """Compare Prefix-Slice (current TS minimumCamerasForTargets, M=6) vs Dedicated Per-K (K=1..6)."""
    f_obs = 0.40 if abs(f_rec - 0.75) < 1e-6 else round(f_rec * 0.533, 3)
    f_det = 0.20 if abs(f_rec - 0.75) < 1e-6 else round(f_rec * 0.267, 3)

    prefix_k, ded_k, prefix_ms, ded_ms, savings = [], [], [], [], []
    saved_stores = []
    for c in caches:
        # Prefix-slice M=6 matching frontend/src/core/optimizer.ts line 175-180
        sel6, ev6 = solve_opticam_cached(c, ws=c.ws_prod, budget_k=6, algorithm="hybrid", f_rec=f_rec, f_obs=f_obs, f_det=f_det, kpi_mode=kpi_mode, lambda_red=1.5, lambda_yel=0.75)
        pk = 7
        for count in range(1, 7):
            sub = sel6[:count]
            bp = c.ppm_mat[sub].max(axis=0)
            ev_sub = evaluate_from_ppm(bp, c.ws_prod, cache=c, grid_m=float(c.bundle["layout"].gridM))
            if ev_sub["kpi_pass"]:
                pk = count
                break
        prefix_k.append(pk)
        prefix_ms.append(float(ev6["runtime_ms"]))

        # Dedicated Per-K
        dk = 7
        acc_ms = 0.0
        for count in range(1, 7):
            sel_k, ev_k = solve_opticam_cached(c, ws=c.ws_prod, budget_k=count, algorithm="hybrid", f_rec=f_rec, f_obs=f_obs, f_det=f_det, kpi_mode=kpi_mode, lambda_red=1.5, lambda_yel=0.75)
            acc_ms += float(ev_k["runtime_ms"])
            if ev_k["kpi_pass"]:
                dk = count
                break
        ded_k.append(dk)
        ded_ms.append(acc_ms)
        diff = pk - dk
        savings.append(diff)
        if diff > 0:
            saved_stores.append({"layout": c.name, "prefix_k": pk, "dedicated_k": dk, "saved_cams": diff})

    return {
        "split": split,
        "config": f"f_rec={f_rec}, kpi_mode={kpi_mode}",
        "mean_prefix_k": round(float(np.mean(prefix_k)), 3),
        "mean_dedicated_k": round(float(np.mean(ded_k)), 3),
        "mean_cam_saved": round(float(np.mean(savings)), 3),
        "pct_stores_saving_cam": round(float(np.mean([100.0 if s > 0 else 0.0 for s in savings])), 1),
        "pct_stores_worse": round(float(np.mean([100.0 if s < 0 else 0.0 for s in savings])), 1),
        "mean_prefix_ms": round(float(np.mean(prefix_ms)), 1),
        "mean_dedicated_ms": round(float(np.mean(ded_ms)), 1),
        "examples_saved": saved_stores[:10],
    }


def main() -> None:
    t0 = time.perf_counter()
    print("[Phase 2] Loading Dev (7) + Held-Out (50) caches...", flush=True)
    dev_caches = [build_layout_cache(b) for b in get_dev_bundles(deduplicate=True)]
    test_caches = [build_layout_cache(b) for b in get_heldout_bundles(n_stores=50, seed0=2026)]

    # Strip custom helper key inside _eval_variant cleanly
    def run_variant(caches, split, exp, name, **kw):
        raw_rows = _eval_variant(caches, split, name, **kw)
        for r in raw_rows:
            r["experiment"] = exp
        return raw_rows

    all_rows: list[dict[str, Any]] = []

    # T1: Piecewise DORI Utility Curve Sweep
    t1_configs = [
        ("T1_Base_0.75_0.40_0.20", dict(f_rec=0.75, f_obs=0.40, f_det=0.20)),
        ("T1_Prop_0.65_0.35_0.15", dict(f_rec=0.65, f_obs=0.35, f_det=0.15)),
        ("T1_Prop_0.55_0.30_0.15", dict(f_rec=0.55, f_obs=0.30, f_det=0.15)),
        ("T1_Prop_0.50_0.25_0.10", dict(f_rec=0.50, f_obs=0.25, f_det=0.10)),
        ("T1_Prop_0.40_0.20_0.10", dict(f_rec=0.40, f_obs=0.20, f_det=0.10)),
        ("T1_Fix_0.55_0.40_0.20", dict(f_rec=0.55, f_obs=0.40, f_det=0.20)),
        ("T1_Fix_0.50_0.40_0.20", dict(f_rec=0.50, f_obs=0.40, f_det=0.20)),
    ]
    print("[T1] Sweeping DORI F_recog/F_obs/F_det curves...", flush=True)
    for split, caches in [("dev_7", dev_caches), ("heldout_50", test_caches)]:
        for vname, kw in t1_configs:
            all_rows.extend(run_variant(caches, split, "T1_DORI", vname, **kw))

    # T2: KPI-Aware Greedy & Two-Stage Polish
    t2_configs = [
        ("T2_Baseline_None", dict(kpi_mode="none")),
        ("T2_Hinge_L0.5", dict(kpi_mode="hinge", lambda_red=0.5, lambda_yel=0.25)),
        ("T2_Hinge_L1.5", dict(kpi_mode="hinge", lambda_red=1.5, lambda_yel=0.75)),
        ("T2_Hinge_L3.0", dict(kpi_mode="hinge", lambda_red=3.0, lambda_yel=1.50)),
        ("T2_TwoStage_L1.5", dict(kpi_mode="twostage", lambda_red=1.5, lambda_yel=0.75)),
        ("T2_TwoStage_F0.55_L1.5", dict(kpi_mode="twostage", f_rec=0.55, f_obs=0.30, f_det=0.15, lambda_red=1.5, lambda_yel=0.75)),
    ]
    print("[T2] Evaluating KPI-aware Hinge & Two-Stage Greedy...", flush=True)
    for split, caches in [("dev_7", dev_caches), ("heldout_50", test_caches)]:
        for vname, kw in t2_configs:
            all_rows.extend(run_variant(caches, split, "T2_KPI_Greedy", vname, **kw))

    # T3: Prefix-Slice vs Dedicated Per-K Min-Camera Search
    print("[T3] Comparing Prefix-Slice vs Dedicated Per-K Min-Camera...", flush=True)
    t3_results = []
    for split, caches in [("dev_7", dev_caches), ("heldout_50", test_caches)]:
        t3_results.append(run_t3_prefix_vs_dedicated(caches, split, f_rec=0.75, kpi_mode="none"))
        t3_results.append(run_t3_prefix_vs_dedicated(caches, split, f_rec=0.55, kpi_mode="twostage"))

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = {"t1_t2_rows": all_rows, "t3_mink": t3_results, "runtime_s": round(time.perf_counter() - t0, 1)}
    (DATA_DIR / "phase2_tuning_results.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    with open(DATA_DIR / "phase2_tuning_summary.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader()
        w.writerows(all_rows)

    print(f"\nDONE Phase 2 in {time.perf_counter() - t0:.1f}s -> {DATA_DIR / 'phase2_tuning_results.json'}", flush=True)
    for r in [x for x in all_rows if x["split"] == "heldout_50" and x["budget"] == "K=3"]:
        print(f"  [HeldOut K=3] {r['variant']:26s} | W%={r['weighted_pct']:5.1f}% | Red={r['red_pct']:5.1f}% | Yel={r['yellow_pct']:5.1f}% | KPI={r['kpi_pass_pct']:5.1f}%")
    for t3r in t3_results:
        print(f"  [T3 {t3r['split']}] {t3r['config']:28s} | Prefix={t3r['mean_prefix_k']:.2f} vs Ded={t3r['mean_dedicated_k']:.2f} | SavedOn={t3r['pct_stores_saving_cam']}%")


if __name__ == "__main__":
    main()
