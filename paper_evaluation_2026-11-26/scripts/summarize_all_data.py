"""Print exact summary tables across Phase 1, Phase 1B, Phase 2, and Phase 3 JSON artifacts."""
from __future__ import annotations

import json
from pathlib import Path
import numpy as np

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

p1 = json.loads((DATA_DIR / "phase1_weights_thresholds.json").read_text(encoding="utf-8"))
p1b = json.loads((DATA_DIR / "phase1b_fine_tuning.json").read_text(encoding="utf-8"))
p2 = json.loads((DATA_DIR / "phase2_tuning_results.json").read_text(encoding="utf-8"))
milp = json.loads((DATA_DIR / "phase3_milp_gaps.json").read_text(encoding="utf-8"))
p3 = json.loads((DATA_DIR / "phase3_proof_results.json").read_text(encoding="utf-8"))

print("=== 1. T3 Min-K Summary ===")
for r in p2["t3_mink"]:
    print(r)

print("\n=== 2. MILP Aggregate Statistics (51/51 rows) ===")
for split in ("dev_7", "heldout_15"):
    sub = [r for r in milp["milp_rows"] if r["split"] == split]
    hyb = np.array([r["hybrid_over_milp_pct"] for r in sub])
    grd = np.array([r["greedy_over_milp_pct"] for r in sub])
    gaps = np.array([r["milp_gap_pct"] for r in sub])
    tms_h = np.array([r["hybrid_ms"] for r in sub])
    tms_m = np.array([r["milp_ms"] for r in sub])
    exact_n = sum(1 for r in sub if r["milp_gap_pct"] == 0.0)
    print(f"  {split}: n={len(sub)}, exact_0pct={exact_n}, Gr/Ref mean={grd.mean():.2f}% (min={grd.min():.2f}%), Hyb/Ref mean={hyb.mean():.2f}% (min={hyb.min():.2f}%, max={hyb.max():.2f}%), max_gap={gaps.max():.2f}%, speedup mean={np.mean(tms_m/tms_h):.1f}x")

print("\n=== 3. Proof 3: Roache GCI & Cross-Grid Drift ===")
for r in p3["gci_scaling"]["cross_grid_summary"]:
    print(" ", r)
print("\n=== Proof 3: GCI Multi-Resolution Means ===")
for h in (1.0, 0.5, 0.25, 0.1):
    sub = [r for r in p3["gci_scaling"]["gci_eval_rows"] if r["h_m"] == h]
    print(f"  h={h:.2f}m: mean_cells={np.mean([x['cells'] for x in sub]):.1f}, W%={np.mean([x['weighted_pct'] for x in sub]):.2f}%, Red%={np.mean([x['red_pct'] for x in sub]):.2f}%, Yel%={np.mean([x['yellow_pct'] for x in sub]):.2f}%, Area%={np.mean([x['area_cov_pct'] for x in sub]):.2f}%")

print("\n=== Proof 3: K Stress & Area Scale ===")
for r in p3["gci_scaling"]["k_stress"]:
    print("  K_stress:", r)
for r in p3["gci_scaling"]["area_scale"]:
    print("  Area_scale:", r)
