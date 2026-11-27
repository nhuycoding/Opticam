# OptiCam-Retail: Comprehensive Scientific Validation, Parameter Justification & Tuning Overview

**Date:** 2026-11-26  
**Evaluation Folder:** `./paper_evaluation_2026-11-26/`  
**Technical Glossary:** [Plain-English Glossary of All Terms](../GLOSSARY.md)  
**Datasets Evaluated:**
- **Development / Architectural Templates (`dev_7`):** All 8 store files in [`../data_samples/`](../data_samples) representing 7 distinct geometries (`50–78 m²`; [`vn_co_nguoi_78m2.json`](../data_samples/vn_co_nguoi_78m2.json) shares identical architectural walls, fixtures, and static risk weights with [`vn_goc_pho_78m2.json`](../data_samples/vn_goc_pho_78m2.json)).
- **Held-Out Generalization Cohort (`heldout_50`):** `N = 50` unseen randomized convenience-store layouts (`50–80 m²`, seeds `2026–2075`) generated deterministically with [`scripts/synthetic_layouts.py`](./scripts/synthetic_layouts.py) mirroring [`../frontend/experiments/run.ts`](../frontend/experiments/run.ts).
- **Controlled Camera Model:** 4 MP Dome IP camera (`2560 px` horizontal resolution, `85°` H-FOV, `16:9` V-FOV `~54.4°`, `10.0 m` effective range, face target height `1.6 m`). Cross-stack Python–JS parity verified to `0.00e+00` diff on all 8 layouts ([`scripts/fast_cache.py`](./scripts/fast_cache.py)).

```mermaid
flowchart LR
    P1["Phase 1: Pareto Knee (W1), Sobol (W2), Threshold Knee (T-KPI)"] --> P1B["Phase 1B: Continuous Inverse Calibration (W3/W4) + 1% Kneedle & TOST"]
    P1B --> P2["Phase 2: Tuning (T1 DORI, T2 Two-Stage KPI, T3 Dedicated Min-K)"]
    P2 --> P3["Phase 3: Exact HiGHS MILP, Ablation 2, Roache GCI & N=50 Wilcoxon"]
    P3 --> R["Validated Baseline + Recommended T2+T3 Production Upgrade"]
```

---

## 1. Executive Summary of Verified Proof & Tuning Outcomes

1. **Risk Weights `(5, 3, 1)` & Shelf Profile `[4.5, 3.0, 1.8]` (`Phase 1 + 1B`):**
   - While simulation alone cannot prove real-world retail dollar crime ratios ([`../docs/FORMULAS.md`](../docs/FORMULAS.md)), `(1, 3, 5)` maps directly onto **Saaty's AHP odd-integer scale** (`CR = 0.0066 < 0.10`, eigenvector weights `[5.11, 5.11, 4.65, 2.79, 1.81, 1.0]`).
   - **Pareto & Contrast Proof (`W1`):** Uniform `(1, 1, 1)` weighting fails critical POS/entrance ID coverage (`31.29–70.25%` choke-point ID at `K=3`, passing KPI on only `0.0%` of Dev and `4.0%` of Held-Out stores). At `K=4`, `(5, 3, 1)` doubles KPI pass rate (`40.0% -> 80.0%` on Held-Out `50`) and lifts choke-point ID to `96.79%` (Held-Out) / `97.96%` (Dev).
   - **Out-of-Sample Calibration & `TOST` Non-Inferiority (`W3`):** Unconstrained Nelder–Mead inverse optimization on Dev against a weight-agnostic Physical Security Meta-Objective (`(6.784, 3.456, r0=1.207, R_pos=3.019)`) fails to beat `(5, 3, 1)` out-of-sample at `K=4` (`meta_comb = 94.203` vs. `(5,3,1)` `94.246`) and achieves **formal `TOST` statistical equivalence** across all 6 metrics within `±1.0 pp` (`p_tost = 0.0007` on `phys_meta`, `0.0056` on `Red%`). Shelf high-risk profile `w_high = 4.5` ranked #1 across all top-5 grid candidates.
   - **Dominant Bottleneck Discovery (`W2` Sobol + `W4` 2D Matrix):** Endogenous `K=3` Saltelli sensitivity reveals `F_recog` dominates output variance (`ST_ChokeID = 0.788`, `ST_Red = 0.768`), far exceeding decay radii `r0` (`ST = 0.037`) and `R_pos` (`ST = 0.046`). Under `F_recog = 0.75`, pairing `(8, 3, 1)` with `F_recog = 0.50–0.65` lifts `K=3` KPI pass rates to `59.4%–81.2%`, or alternatively **algorithmic Phase 2 tuning (`T2`) fixes `K=3` without altering `(5, 3, 1)` or DORI constants**.

2. **KPI Acceptance Thresholds `(95% Red, 80% Yellow)` (`T-KPI` + `T-KPI-Fine`):**
   - On `N = 50` unseen stores at `1%` resolution, **Kneedle curvature elbow detection selects `τ_Red = 94%`** and the **normalized Capex + Blind-Pocket cost minimum selects `τ_Red = 96%`** (exact plateau `92–96%` with Kneedle `96%` on `Dev 7`). **`95%` sits dead center (`(94 + 96)/2`)** and passes `TOST` Capex equivalence (`mean_diff = -0.12` cams, `p = 1e-5` within `±0.25` cams).
   - Tightening above `95%` (`98–100%`) triggers the **"Last-Cell Curse"**, forcing `+1/+2` extra cameras on **`42.9%–57.1%` (`Dev`)** and **`24.0%–40.0%` (`Held-Out`)** of stores just to eliminate `0.14–0.18 m²` of grazing corner cells (`14.3%` of Dev layouts become infeasible even at `K=7`). Relaxing to `85%–90%` leaves blind till/door pockets up to `1.06–2.00 m²` (`p10_red_min_ppm = 0.0 PPM` on Dev).

3. **Algorithm Tuning Breakthrough (`Phase 2: T1–T3`):**
   - Keeping **all existing weights `(5, 3, 1)` and DORI factors `[1.00, 0.75, 0.40, 0.20]` intact**, **Two-Stage KPI-Aware Greedy + Hinge Local Polish (`T2_TwoStage_L1.5`)** raises **`K=3` KPI pass rate from `14.3% -> 100.0%` (`Dev 7/7`) and `38.0% -> 98.0%` (`Held-Out 49/50`)**, and **`K=4` KPI pass rate from `80.0% -> 100.0%` (`50/50`)** with **statistically zero loss in total `W%`** (`K=3: -0.06 pp, p_holm = 0.877`; `K=4: +0.05 pp, W% = 98.13% > 98.08%`).
   - Fixing `minimumCamerasForTargets`'s prefix-slice bug via **Dedicated Per-`K` Search (`T3`)** saves `1+` camera on **`28.6%` (`Dev`) and `54.0%` (`Held-Out`)** of stores under baseline (`4.52 -> 3.72` cams), and **combining `T2 + T3` cuts mean required Capex to `2.48–2.57` cameras/store**.

4. **Formal Proof Benchmarks (`Phase 3`):**
   - **Exact MILP Gap (`51/51` instances):** To quantify how close our fast heuristic (`15–148 ms`) gets to the theoretical global optimum, we benchmarked against **HiGHS** (*High Performance Software for Linear Optimization*, Univ. of Edinburgh)—an open-source C++ MILP/LP/QP solver rivaling Gurobi/CPLEX (`4.5–40.3 s` runtime). `OptiCam-Hybrid` reaches **`99.19%` (Dev, min `96.68%`)** and **`98.82%` (Held-Out, min `95.51%`)** of exact global MILP / LP-dual upper bounds—far above the theoretical `63.21%` `(1 - 1/e)` guarantee—while running **`399–672x` faster**.
   - **Out-of-Sample Statistical Dominance (`N = 50`):** At `K=4`, `OptiCam-Hybrid` and `OptiCam-Tuned` achieve a **50–0–0 win-tie-loss sweep** (`rank_biserial r = 1.000`, `p_holm < 1e-6`, `McNemar p < 1e-6`) over **every** paper baseline (`Erdem-06`, `Aziz-24`, `Kim-19`, `Wang-13`).

---

## 2. Phase 1 & Phase 1B: Proving Risk Weights `(5, 3, 1)` and Thresholds `(95%, 80%)`

### 2.1 Normative Anchors & Analytical Hierarchy Consistency ([`ahp_survey_kit.py`](./scripts/ahp_survey_kit.py))
- Because real crime logs are external to geometric optics, OptiCam grounds `(5, 3, 1)` on **Saaty's AHP odd-integer scale** (`1 = Baseline floor`, `3 = Moderate merchandise shelf`, `5 = Strong POS/entrance choke point`). Quantizing pairwise ratios `[5, 5, 4.5, 3, 1.8, 1]` onto Saaty's `{1..9}` grid produces Consistency Ratio **`CR = 0.0066`** (`<< 0.10` threshold) and eigenvector weights **`[5.11, 5.11, 4.65, 2.79, 1.81, 1.0]`**.
- A ready-to-collect questionnaire [`data/ahp_survey_template.csv`](./data/ahp_survey_template.csv) and `CR < 0.10` scorer are included for field retail surveys (no synthetic human data generated).

### 2.2 `W1`: Pareto-Knee Proof Across Weight Triples ([`phase1_w1_pareto.csv`](./data/phase1_w1_pareto.csv))
Evaluated on **model-free spatial masks** (`<= 0.65 m` around POS/entrance for `ChokeID`, `<= 0.65 m` around shelves for `ShelfRec`, and total `AreaCov >= 25 PPM`) so scores do not circularly depend on `(5, 3, 1)`:

| Split & Budget | Weight Profile `(POS, Shelf, Floor)` | Choke ID `>=250 PPM` | Shelf Rec `>=125 PPM` | Floor Cov `>=25 PPM` | Prod `Red%` | Prod `KPI Pass` | Utopia Dist ↓ | Pareto? |
|---|---|---:|---:|---:|---:|---:|---:|:---:|
| **`dev_7` (`K=3`)** | `(1, 1, 1)` Uniform | 67.15% | 97.27% | 98.06% | 71.60% | 0.0% | 19.06 | False |
| `dev_7` (`K=3`) | `(4, 2, 1)` LinMid | 83.81% | 97.82% | 98.47% | 82.70% | 14.3% | 9.47 | **True** |
| **`dev_7` (`K=3`)** | **`(5, 3, 1)` OptiCam** | 76.93% | **98.22%** | **98.71%** | 79.80% | 14.3% | 13.38 | **True** |
| `dev_7` (`K=3`) | `(8, 3, 1)` HighPOS | 92.78% | 96.74% | 98.14% | 88.94% | 42.9% | 4.70 | **True** |
| `dev_7` (`K=3`) | `(12, 3, 1)` Tunnel | 98.33% | 96.23% | 97.69% | 92.00% | 57.1% | 2.73 | **True** |
| **`heldout_50` (`K=3`)** | `(1, 1, 1)` Uniform | 70.25% | 93.52% | 98.18% | 76.83% | 4.0% | 17.61 | False |
| `heldout_50` (`K=3`) | `(4, 2, 1)` LinMid | 89.02% | 94.21% | 98.15% | 90.73% | 48.0% | 7.24 | **True** |
| **`heldout_50` (`K=3`)** | **`(5, 3, 1)` OptiCam** | 87.70% | **94.52%** | 97.88% | 89.21% | 38.0% | 7.87 | **True** |
| `heldout_50` (`K=3`) | `(8, 3, 1)` HighPOS | 94.23% | 94.08% | 97.58% | 94.28% | 58.0% | 4.97 | **True** |
| **`heldout_50` (`K=4`)** | `(1, 1, 1)` Uniform | 87.61% | 97.13% | 99.20% | 91.90% | 40.0% | 7.35 | False |
| **`heldout_50` (`K=4`)** | **`(5, 3, 1)` OptiCam** | **96.79%** | **97.71%** | 99.10% | **97.41%** | **80.0%** | 2.34 | **True** |
| `heldout_50` (`K=4`) | `(8, 3, 1)` HighPOS | 98.94% | 97.41% | 98.92% | 99.08% | 98.0% | 1.73 | **True** |

- **Interpretation:** `(1, 1, 1)` is Pareto-dominated across **every** split and budget (`KPI = 0–4%` at `K=3`, `40–42.9%` at `K=4`), proving non-uniform risk weighting is mandatory. `(5, 3, 1)` is Pareto-optimal across all `heldout_50` tiers (`K=3, 4`) and maximizes `ShelfRec` (`94.52%` / `98.22%`) at `K=3`, while `(8, 3, 1)` pushes critical choke-point ID higher (`98.0%` KPI at `K=4`) at slight `-0.3` to `-0.44 pp` shelf trade-off.

### 2.3 `W2`: Perturbation Stability & Endogenous Saltelli/Sobol Sensitivity ([`phase1_weights_thresholds.json`](./data/phase1_weights_thresholds.json))
- **Local Plateau Stability (`±15–20%` perturbations, `32` layouts):** Decay radii `r0 ∈ [0.80, 1.20]` and `R_pos ∈ [2.00, 3.00]` show **`76%–83.6%` exact pose overlap** and **`81.2%–93.8%` KPI decision agreement** with minimal drift in shelf/area coverage (`|ΔShelfRec| <= 0.54 pp`, `|ΔArea| <= 0.33 pp`).
- **Endogenous `K=3` Saltelli/Sobol Variance Decomposition (`N_base = 64` across 3 presets):**
  - `f_recog ∈ [0.50, 0.85]`: **`ST_ChokeID = 0.788` (`S1 = 0.539`), `ST_Red = 0.768`, `ST_Shelf = 0.660`, `ST_Area = 0.803`** — dominant algorithmic sensitivity lever.
  - `w_shelf ∈ [2.0, 4.0]`: `ST_ChokeID = 0.302`, `ST_Red = 0.342`.
  - `w_pos ∈ [3.5, 6.5]`: `ST_ChokeID = 0.212`, `ST_Red = 0.202`.
  - `R_pos ∈ [1.8, 3.2]`: `ST_ChokeID = 0.046`, `ST_Red = 0.068`.
  - `r0 ∈ [0.7, 1.3]`: **`ST_ChokeID = 0.037`, `ST_Red = 0.044`** (structurally flat).

### 2.4 `W3` & `W4`: Continuous Inverse Calibration, Shelf/Cutoff Sweeps & Out-of-Sample `TOST` ([`phase1b_fine_tuning.json`](./data/phase1b_fine_tuning.json))
- **Derivative-Free Inverse Optimization (`Dev 7` → `Held-Out 50`):**
  Multi-start Nelder–Mead on `dev_7` found `(w_pos = 6.784, w_shelf = 3.456, r0 = 1.207, R_pos = 3.019)`. Evaluated out-of-sample on `N = 50` unseen stores:
  - At **`K=4`**: Default `(5, 3, 1)` achieves `phys_meta = 97.417` (`meta_comb = 94.246`) vs. tuned `97.075` (`meta_comb = 94.203`). **All 6 metrics pass formal `TOST` equivalence (`margin = ±1.0 pp`)**: `phys_meta` (`diff = +0.342 pp, p = 0.0007`), `Red%` (`+0.202 pp, p = 0.0056`), `Yellow%` (`-0.216 pp, p = 0.0`), `ChokeID` (`+0.731 pp, p = 0.0244`), `ShelfRec` (`-0.300 pp, p = 0.00005`), `Area` (`+0.070 pp, p = 0.0`).
  - At **`K=3`**: `phys_meta` mean difference is only **`-0.257 pp`** (`91.075` vs. `91.332`); `ShelfRec`, `Area`, and `Yellow%` pass `TOST` (`p <= 0.00058`), though per-store variance (`std = 8.46`) leaves `ChokeID` TOST undecided (`p = 0.274`).
- **Shelf Profiles (`4.5, 1.8`) & Cutoffs (`4.0, 2.0`):**
  - Across `5 × 5` grid (`w_high × w_bulky`), **`w_high = 4.5`** won all Top-5 scores (`meta_comb = 94.261–94.361`), while `w_bulky` stayed flat across `1.25–2.10` (`94.261`), directly confirming `[4.5, 1.8]`.
  - Cutoff **`RISK_RED_THRESHOLD = 4.0`** preserves **`100.0%` physical choke-point recall** (`choke_f1 = 65.9`), whereas tightening to `4.5` raises precision (`49.1% -> 58.2%`, `F1 = 73.3`) at slight `99.3%` recall cost.
- **2D Interaction Heatmap (`W_pos, W_shelf × F_recog`, `32` stores):**
  - Fixing `(5, 3, 1)` and adjusting `F_recog` alone (`0.75 -> 0.55`) lifts `K=3` `Red%` from `87.48% -> 92.00%` (`ChokeID: 86.36% -> 93.69%`, `meta_comb: 94.188 -> 95.946`).
  - Pairing **`(8, 3, 1) + F_recog = 0.65`** attains the top combined quality (`meta_comb = 96.92`, `K=3 KPI = 59.4%`, `K=4 KPI = 100.0%`), while **`(8, 3, 1) + F_recog = 0.50`** pushes `K=3 KPI` to `81.2%` (`Red = 97.8%`, `K=4 KPI = 96.9%`).

### 2.5 `T-KPI` & `T-KPI-Fine`: Blind-Pocket vs. Last-Cell-Curse Capex Elbow ([`phase1b_tkpi_1pct.csv`](./data/phase1b_tkpi_1pct.csv))

| `τ_Red` (`τ_Yel=80%`) | `Held-Out 50` Min-`K` | ΔMin-`K` / `1%` | Mean Uncov Red (m²) | Max Blind Pocket (m²) | Red Min PPM | Kneedle Curvature | Joint Cost-Risk ↓ |
|---:|---:|---:|---:|---:|---:|---:|---:|
| `90%` | 3.320 | — | 0.480 | 1.500 | 210.4 | 0.0000 | 0.5000 |
| `92%` | 3.460 | +0.060 | 0.345 | 1.250 | 220.7 | +0.0444 | 0.4280 |
| **`94%`** | **3.580** | +0.040 | 0.250 | 0.750 | 229.5 | **+0.1026 (Peak)** | 0.3879 |
| **`95%` (Claimed)** | **3.720** | +0.140 | **0.175** | **0.750** | **240.2** | +0.0763 | **0.3784** |
| **`96%`** | **3.840** | +0.120 | 0.115 | 0.500 | 243.4 | +0.0638 | **0.3747 (Min)** |
| `98%` | 4.080 | +0.060 | 0.060 | 0.250 | 253.9 | +0.0388 | 0.4350 |
| `100%` | 4.340 | +0.260 *(at 99%)* | 0.000 | 0.000 | 260.8 | 0.0000 | 0.5000 |

- On `Dev 7`, `Min-K` remains flat at **`4.000`** (`0.143 m²` uncov) across `92–96%` (Kneedle peak at **`96%`**) before exploding to `5.143` at `98%` (`42.9%` Capex jump) and `5.714` at `100%` (`57.1%` Capex jump, `14.3%` infeasible at `K <= 7`).
- On `Held-Out 50`, `τ_Red = 95%` sits dead between Kneedle (`94%`) and Joint Cost-Risk minimum (`96%`) and is **statistically `TOST`-equivalent in Min-`K` to `96%`** (`mean_diff = -0.12` cams, `p_tost = 0.00001` within `±0.25` cams), whereas `98–100%` forces extra cameras on **`24.0%–40.0%`** of stores. Moving `τ_Yellow` from `70%` to `80%` incurs **`0.0%` Capex penalty** (`Min-K = 3.72 -> 3.72`), while `85%` begins adding extra cameras (`+2.0%` Capex jump).

---

## 3. Phase 2: Algorithm Tuning (`T1–T3`) ([`phase2_tuning_summary.csv`](./data/phase2_tuning_summary.csv))

### 3.1 `T1` (DORI Curve) & `T2` (KPI-Aware Two-Stage + Hinge Polish)
| Variant | Split | `K=3` W% | `K=3` Red% | `K=3` Yel% | **`K=3` KPI%** | `K=4` W% | `K=4` Red% | **`K=4` KPI%** | **Mean `Min-K`** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Baseline (`F_rec=0.75`, `none`) | `dev_7` | 93.17% | 79.80% | 98.54% | 14.3% | 97.74% | 97.09% | 85.7% | 4.000 |
| `T1_Prop (0.65, 0.35, 0.15)` | `dev_7` | **93.32%** | 81.53% | 96.99% | 14.3% | **97.87%** | 96.24% | 71.4% | 4.143 |
| `T1_Prop (0.55, 0.30, 0.15)` | `dev_7` | 93.55% | 88.13% | 96.11% | 42.9% | 97.44% | 95.13% | 57.1% | 3.857 |
| `T2_Hinge_L1.5` (`F=0.75`) | `dev_7` | 93.21% | 97.71% | 96.77% | 85.7% | 97.50% | 98.46% | **100.0%** | 2.714 |
| **`T2_TwoStage_L1.5` (`F=0.75`)** | **`dev_7`** | 92.46% | **98.43%** | 96.30% | **100.0% (7/7)** | 97.73% | **99.50%** | **100.0% (7/7)** | **2.571** |
| Baseline (`F_rec=0.75`, `none`) | `heldout_50` | 94.46% | 89.21% | **97.17%** | 38.0% | 98.08% | 97.41% | 80.0% | 3.720 |
| `T1_Prop (0.65, 0.35, 0.15)` | `heldout_50` | **94.93%** | 93.81% | 96.73% | 52.0% | **98.23%** | 98.58% | 90.0% | 3.420 |
| `T2_Hinge_L1.5` (`F=0.75`) | `heldout_50` | 93.79% | 97.63% | 95.39% | 94.0% | 97.97% | 99.14% | **100.0%** | 2.600 |
| **`T2_TwoStage_L1.5` (`F=0.75`)** | **`heldout_50`** | 94.40% | **98.04%** | 95.98% | **98.0% (49/50)** | **98.13%** | **99.60%** | **100.0% (50/50)** | **2.480** |

### 3.2 `T3`: `minimumCamerasForTargets` Prefix-Slice vs. Dedicated Per-`K` Search
- Because joint 6-camera local refinement distributes cameras differently than a tight 3- or 4-camera solution, slicing `cameras.slice(0, count)` from [`../frontend/src/core/optimizer.ts`](../frontend/src/core/optimizer.ts#L174-L180) wastes hardware:
  - **`Dev (7)` Baseline:** Prefix `4.571` vs. Dedicated `4.000` (`-0.571` cams avg; saves `2` cams on `vn_goc_pho_78m2` & `vn_chu_l_70m2`, **`28.6%`** of templates, `0%` worse).
  - **`Held-Out (50)` Baseline:** Prefix `4.520` vs. Dedicated `3.720` (`-0.800` cams avg; saves `1–3` cams on **`54.0%` (`27/50`)** of stores, only `2.0%` heuristic ties/worse; runtime `97.7 ms -> 167.6 ms`).
  - **Combined (`F_rec=0.55 + TwoStage`):** Dedicated drops `Min-K` to **`2.714`** (`Dev`, **`71.4%`** saving cams!) and **`2.560`** (`Held-Out`, **`54.0%`** saving cams, `144.3 ms`). Note `T2_TwoStage_L1.5` alone with `F_rec=0.75` reached `2.480` on `Held-Out 50`.

---

## 4. Phase 3: Mathematical & Statistical Proofs

### 4.1 Proof 1 — Component Ablation Study (`Ablation 2`, [`phase3_ablation2.csv`](./data/phase3_ablation2.csv))
Every architectural module contributes distinct, measurable gain across `Held-Out 50` (`Dev 7` shows the identical hierarchy):

| Ablation Variant (`Held-Out N=50`) | `K=3` W% | `K=3` Red% | `K=3` KPI% | `K=4` W% | `K=4` Red% | `K=4` KPI% | Mean LS Swaps (`K=4`) | Runtime (`K=4`) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `A0` Random `K` Candidates | 37.28% | 31.29% | 0.4% | 46.83% | 41.69% | 0.0% | — | — |
| `A1` Manual 4-Corners (`K=4`) | — | — | — | 94.65% | 91.71% | 36.0% | — | — |
| `A2` Uniform Weight `(1,1,1)` | 93.62% | 76.83% | 4.0% | 97.54% | 91.90% | 40.0% | — | — |
| `A3` Wall + `8` Azimuth Only | 90.91% | 80.29% | 8.0% | 95.32% | 90.74% | 42.0% | 1.98 | 63.1 ms |
| `A4` Wall-Only Full Hybrid | 92.72% | 84.28% | 22.0% | 96.93% | 95.36% | 66.0% | 2.64 (+1.38%) | 68.4 ms |
| `A5` Mixed Greedy (No Local Search) | 92.92% | 83.37% | 22.0% | 96.60% | 93.37% | 52.0% | 0.00 | 27.1 ms |
| `A6` Full **OptiCam-Hybrid** (Prod) | **94.46%** | 89.21% | 38.0% | 98.08% | 97.41% | 80.0% | 3.08 (+1.55%) | 70.9 ms |
| `A7` **OptiCam-Tuned** (`T2_TwoStage`) | 94.40% | **98.04%** | **98.0%** | **98.13%** | **99.60%** | **100.0%** | 3.14 | 114.0 ms |

- **Local Search Pass Survival (`A6`, `Held-Out K=4`):** Pass 1 improves `92.0%` of stores, Pass 2 `42.0%`, Pass 3 `16.0%`, boosting `KPI` pass rate from **`52.0%` (Greedy) → `80.0%` (`+28 pp`)** at only `+43.8 ms` cost. Adding ceiling mounts (`A4 -> A6`) adds `+14.0 pp` KPI pass rate (`66% -> 80%`).

### 4.2 Proof 2 — Exact Global MILP Optimality Gaps ([`phase3_milp_gaps.csv`](./data/phase3_milp_gaps.csv))
Formulated as an exact 0–1 MILP over discrete candidate pool $C$ using totally unimodular continuous tier variables $y_{j,m} \in [0, 1]$ with $\Delta F = [0.20, 0.20, 0.35, 0.25]$, verified to `0.00e+00` diff against exhaustive brute force on 3 reduced `K=2` store instances:
- **`Dev (7)` (`21/21` cases across `K=2, 3, 4`):** `12/21` solved to exact `0.00%` MIP gap (`max_gap = 0.82%`).
  - `Greedy / MILP`: **`98.33%`** mean (`min 96.68%` — far above `(1 - 1/e) = 63.21%`).
  - **`OptiCam-Hybrid / MILP`: `99.19%` mean** (`min 96.68%`, `max 100.00%` exact global hits on `store_60m2 K=2`, `circle_k_75m2 K=4`, `vn_nha_ong K=2`, `vn_chu_l K=2`).
  - **Mean Runtime Speedup:** **`671.7x`** faster (`15–136 ms` vs. `4.5–40.3 s`).
- **`Held-Out (15)` (`30/30` cases across `K=3, 4`):** `9/30` exact `0.00%` MILP, remainder bounded via tight MILP/LP dual upper ceilings (`max_gap = 3.07%`).
  - `Greedy / Ref`: **`97.00%`** mean (`min 92.91%`).
  - **`OptiCam-Hybrid / Ref`: `98.82%` mean** (`min 95.51%`, `max 100.00%`), **`398.9x`** faster.

### 4.3 Proof 3 — Spatial Grid Convergence, Cross-Grid Audit & Scalability ([`phase3_proof_results.json`](./data/phase3_proof_results.json))
- **Multi-Resolution Evaluation (mean across `store_60m2`, `circle_k_75m2`, `ministop_50m2`, `K=3, 4`):**
  - `h = 1.00 m` (`42.0` cells): `W% = 93.03%`, `Red = 80.00%`
  - `h = 0.50 m` (`195.3` cells): `W% = 95.32%`, `Red = 82.27%`
  - `h = 0.25 m` (`787.3` cells): `W% = 91.77%`, `Red = 81.10%`
  - `h = 0.10 m` (`4,913.3` cells): `W% = 92.30%`, `Red = 81.18%` *(0.25 m and 0.10 m agree within `0.53 pp` total / `0.08 pp` Red; `0.50 m` reads `+0.9` to `+4.9 pp` higher than `0.10 m` near flush shelf grazing edges, giving `h = 0.50 m` heuristic GCI bounds of `0.88%–8.17%`).*
- **Cross-Grid Optimization Fairness (`h=0.50 m` vs. `h=0.25 m` re-optimized, both judged on `h=0.10 m` continuous ground truth):** `h=0.50 m` matches `h=0.25 m` on `ministop_50m2 K=4` (`98.9%` vs. `98.9%`, `0.0 pp`), differs `-1.1 pp` on `store_60m2 K=4` (`96.2%` vs. `97.3%`), and outperforms coarsened `0.25 m` pools on `circle_k_75m2` by `+4.2 pp` (`K=3`) and `+3.0 pp` (`K=4`).
- **Latency Scaling:** Solver time scales sub-linearly (`K=1..8`: `22.9 ms` to `182.0 ms`), and the `n_cells × n_cands <= 1,500,000` memory cap bounds total build + `K=4` solve latency cleanly to **`62.2 ms` (`30 m²`)**, **`113.8 ms` (`50 m²`)**, **`358.9 ms` (`80 m²`)**, **`167.4 ms` (`120 m²`)**, and **`177.8 ms` (`200 m²`)**.

### 4.4 Proof 4 — Cross-Paper Benchmark on `Dev (7)` and `Held-Out (N = 50)` ([`phase3_heldout_n50_summary.csv`](./data/phase3_heldout_n50_summary.csv), [`phase3_stat_tests.csv`](./data/phase3_stat_tests.csv))
Full per-layout 8-file tables for `Dev (7)` appear in [`PAPER_COMPARISON_REPORT.md`](./PAPER_COMPARISON_REPORT.md) (`100%` win rate on `7/7` layouts, `OptiCam-Hybrid` `93.2% / 97.7%` vs. `46.4–89.9%`, `Min-K = 4.00` vs. `Erdem 8.29–10.00` vs. `Wang 22.14–43.00`). On the **`N = 50` unseen stores**:

| Method (`N=50`) | `K=3` W% (`95% CI`) | `K=3` Red% | `K=3` KPI | `K=4` W% (`95% CI`) | `K=4` Red% | `K=4` KPI | Avg `ms` (`K=4`) | `K=4` vs. Tuned (`ΔW%`, `r`, `p_holm`) |
|---|---|---:|---:|---|---:|---:|---:|---|
| **`OptiCam-Tuned` (`T2`)** | 94.40% `[93.60, 95.16]` | **98.04%** | **49/50 (98%)** | **98.13% `[97.66, 98.57]`** | **99.60%** | **50/50 (100%)** | 115.2 | Anchor |
| **`OptiCam-Hybrid` (Prod)** | **94.46% `[93.72, 95.16]`** | 89.21% | 19/50 (38%) | 98.08% `[97.61, 98.52]` | 97.41% | 40/50 (80%) | 74.0 | `+0.05 pp`, `r=0.087`, `p=0.609` *(Red `+2.19 pp, p=0.0006`)* |
| `OptiCam-Wall` | 92.72% `[91.76, 93.65]` | 84.28% | 11/50 (22%) | 96.93% `[96.32, 97.50]` | 95.36% | 33/50 (66%) | **66.8** | `+1.19 pp`, `r=0.933`, `p<1e-6` |
| `Erdem-06` MaxCov | 89.32% `[88.23, 90.38]` | 67.55% | 3/50 (6%) | 93.37% `[92.55, 94.17]` | 74.59% | 3/50 (6%) | 2369.6 | **`+4.76 pp`, `r=1.000`, `p<1e-6`** (`50/0/0`) |
| `Kim-19` SemGA | 90.71% `[89.84, 91.54]` | 64.71% | 1/50 (2%) | 92.89% `[92.21, 93.56]` | 68.64% | 0/50 (0%) | 95.7 | **`+5.24 pp`, `r=1.000`, `p<1e-6`** (`50/0/0`) |
| `Aziz-24` GA#3 | 88.83% `[87.87, 89.80]` | 69.08% | 2/50 (4%) | 91.79% `[90.87, 92.69]` | 79.69% | 12/50 (24%) | 1508.3 | **`+6.34 pp`, `r=1.000`, `p<1e-6`** (`50/0/0`) |
| `Wang-13-Crit` | 79.11% `[76.20, 81.83]` | 59.72% | 0/50 (0%) | 84.96% `[82.54, 87.23]` | 67.96% | 1/50 (2%) | 990.9 | **`+13.17 pp`, `r=1.000`, `p<1e-6`** (`50/0/0`) |
| `Wang-13-Unif` | 76.81% `[73.89, 79.67]` | 56.30% | 0/50 (0%) | 83.26% `[80.62, 85.85]` | 65.20% | 4/50 (8%) | 1118.9 | **`+14.87 pp`, `r=1.000`, `p<1e-6`** (`50/0/0`) |

- **McNemar Discordant KPI Tests (`K=3` & `K=4`):** `OptiCam-Tuned` beats `OptiCam-Hybrid` `30–0` (`p < 1e-6` at `K=3`) and `10–0` (`p = 0.00195` at `K=4`), and beats every reference paper `38–0` to `50–0` (`p < 1e-6` across all comparisons).

---

## 5. Production Recommendations & Artifact Inventory

1. **Keep `(5, 3, 1)` & `(95%, 80%)`:** Statistically `TOST`-validated and bracketed cleanly by empirical elbows (`94–96%`).
2. **Adopt `T2_TwoStage_L1.5` + `T3` Dedicated Per-`K` in Production *(upon user Phase 4 confirmation)*:** Leaves weights and DORI factors unchanged while solving `K=3` bottlenecks (`14.3% -> 100%` Dev, `38% -> 98%` Held-Out) and eliminating excess camera Capex in `minimumCamerasForTargets` (note: [`../frontend/src/core/optimizer.test.ts`](../frontend/src/core/optimizer.test.ts#L38-L41) and [`../backend/tests/test_ceiling_optimizer.py`](../backend/tests/test_ceiling_optimizer.py#L60-L64) assert baseline score `508.17339711675044` and would be re-baselined if Phase 4 runs).

### Complete Scripts & Data Index (`./paper_evaluation_2026-11-26/`)
- **Reports:** `COMPREHENSIVE_EVALUATION_OVERVIEW.md` (this report), `PRESENTATION_ABSTRACT.md`, `PAPER_COMPARISON_REPORT.md`
- **Scripts (`./scripts/`):** `opticam_fast.py`, `paper_algorithms.py`, `synthetic_layouts.py`, `fast_cache.py`, `ahp_survey_kit.py`, `prove_weights_and_thresholds.py`, `fine_tune_claimed_numbers.py`, `run_tuning_suite.py`, `milp_exact_solver.py`, `repair_milp_heldout.py`, `run_proof_suite.py`, `summarize_all_data.py`
- **Datasets (`./data/`):** `comparison_results.json`, `comparison_summary.csv`, `ahp_survey_template.csv`, `phase1_weights_thresholds.json`, `phase1_w1_pareto.csv`, `phase1_tkpi_grid.csv`, `phase1b_fine_tuning.json`, `phase1b_w3_heatmap.csv`, `phase1b_tkpi_1pct.csv`, `phase2_tuning_results.json`, `phase2_tuning_summary.csv`, `phase3_milp_gaps.json`, `phase3_milp_gaps.csv`, `phase3_proof_results.json`, `phase3_ablation2.csv`, `phase3_heldout_n50_summary.csv`, `phase3_stat_tests.csv`

---

## 6. Addendum (2026-11-27): Graded Dual-Height (`1.6 m + 1.0 m`) Fine-Tuning Across All 18 Store Layouts

Following Phase 4 production adoption of `kpi_hybrid` and `dualHeight`, testing exposed a defect in the initial **binary cliff** implementation of `1.0 m` hand-level checking (`handPpm >= 125` required for Red KPI, `min(face, hand)` applied to every aisle cell): forcing sharp `125 PPM` sightlines to floor height behind `1.1 m` POS counters caused `OptiCam` to pull cameras downward and sacrifice `1.6 m` Red Face-ID, dropping the **18-layout `PRESETS` KPI pass rate** from **`17/18` (`94.4%`, face-only baseline)** down to **`8/18` (`44.4%`)** and inflating `meanMinK` from `3.28` to `3.94`.

### 6.1 Graded Partial-Credit Formulation (`DUAL_HEIGHT_SCORING`)
To reward `1.0 m` merchandise/hand reachability on high-risk zones without creating a hard cutoff behind waist-high counters, both [`optics.ts`](../frontend/src/core/optics.ts) / [`optimizer.ts`](../frontend/src/core/optimizer.ts) and [`greedy_optimizer.py`](../backend/greedy_optimizer.py) now implement:
- **Hand Multiplier (`handVisibilityMultiplier`):** `>= 125 PPM -> 1.00`, `>= 62.5 PPM` (`DORI_MIN.observation`) `-> 0.85`, `>= 25 PPM -> 0.50`, `< 25 PPM -> 0.00`.
- **Priority-Gated Blending (`minWeightForHandCheck = 3.0`):** Walkways (`W < 3.0`) use pure face score `F(face)`. High-risk Red zones (`W >= 4.0`) blend `0.65 * F(face) + 0.35 * min(F(face), F(face) * M_hand)`; Yellow shelves (`3.0 <= W < 4.0`) blend `0.80 * F(face) + 0.20 * min(F(face), F(face) * M_hand)`.
- **Decoupled Hand KPI + Soft Hinge:** Headline Red (`>= 250 PPM`) and Yellow (`>= 125 PPM`) rates evaluate at `1.6 m`, while **`handCoverage`** independently tracks `%` of empty cells reaching `>= 62.5 PPM` at `1.0 m` with Stage-2/Local-Search hinge **`lambdaHand = 0.50`** toward **`handTargetPct = 80%`**.

### 6.2 Empirical Parameter Sweep Across All 18 Built-In Layouts (`PRESETS`)
All configurations below were evaluated identically under the preset camera counts and `minimumCamerasForTargets` (`1..8`) on all 18 store layouts (`store_60m2`, `circle_k_75m2`, `ministop_50m2`, and `VN 01`–`VN 15`):

| Configuration (`18 Stores`) | `kpiPass` | `meanRed` (`1.6 m`) | `meanYel` (`1.6 m`) | `meanHandRed` (`1.0 m >= 62.5`) | `meanHandPri` (`W>=3, 1.0 m`) | `meanHeadOnly` | `meanWeighted` | `meanMinK` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `01_baseline_face_only` (`dualHeight=false`) | `17/18` (`94.4%`) | 97.7% | **98.8%** | 93.8% | 86.5% | 11.8% | **1325.9** | **3.28** |
| `02_legacy_binary_cliff` (`min(face,hand)` + `<125` cliff) | `8/18` (`44.4%`) | 95.0% | 93.8% | 97.8% | **95.2%** | **3.5%** | 1262.2 | 3.94 |
| `05_minW35_65_80_lam50` (`minW=3.5, 0.65/0.80, λ=0.50`) | **18/18** (`100%`) | **98.1%** | **98.8%** | 98.2% | 88.1% | 10.4% | 1319.8 | 3.33 |
| **`10_minW3_65_80_lam50` (Selected Balanced Production)** | `17/18` (`94.4%`) | 97.6% | 98.5% | **98.7%** | 92.6% | 6.6% | 1308.0 | 3.33 |

- **Why `10_minW3_65_80_lam50` (`minW=3.0`) Was Selected:** Relative to `01_baseline_face_only`, it lifts `meanHandRed` (`93.8% -> 98.7%`) and `meanHandPri` (`86.5% -> 92.6%`) to their highest graded levels while cutting `meanHeadOnly` blind spots by **`44%`** (`11.8% -> 6.6%`), restoring KPI pass rate from **`8/18 -> 17/18`** and keeping `meanMinK` (`3.33`) within `+0.05` cameras of unconstrained face-only placement (saving `-0.61` cameras/store vs. the `3.94` binary cliff). Note that tightening `minWeightForHandCheck` to `3.5` remains available as a higher-KPI-throughput variant (`18/18` KPI, `98.2%` `meanHandRed`, `10.4%` `meanHeadOnly`).
