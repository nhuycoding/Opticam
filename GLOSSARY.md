# OptiCam-Retail: Plain-English Glossary of Technical Terms

> **How to Use This File**  
> Every technical, mathematical, statistical, and software term used across OptiCam's documentation and thesis reports is explained here in **plain English** so you never have to guess or re-read a term.

---

## 1. Camera Optics & 3D Visibility

| Term | Plain-English Meaning | Concrete Example in OptiCam |
|---|---|---|
| **PPM (Pixels Per Meter)** | How many horizontal camera pixels land on `1 meter` of a person or shelf. Higher PPM = sharper video. | At `5 m`, a 4 MP (`2560 px`, `85°`) camera gives `279.4 PPM` (sharp enough to ID a face). |
| **DORI (IEC 62676-4)** | International CCTV clarity standard dividing PPM into 4 levels: **D**etection (`>= 25`), **O**bservation (`>= 62.5`), **R**ecognition (`>= 125`), **I**dentification (`>= 250`). | Cashiers require **Identification** (`>= 250 PPM`); shelves require **Recognition** (`>= 125 PPM`). |
| **FOV / H-FOV / V-FOV** | **Field of View** — how wide the camera lens sees horizontally (**H-FOV**, default `85°`) and vertically (**V-FOV**, `~54.4°` on a `16:9` sensor). | Wider FOV covers more floor area per camera, but lowers PPM at the same distance. |
| **Pan (Azimuth) & Tilt (Pitch)** | **Pan** (`0°–360°`) is which direction the camera points left/right on the floor plan (`0°` = right `+X`). **Tilt** (`0°–90°`) is how steeply it points downward (`20°` wall, `45°` ceiling). | Tilting a wall camera down `20°` lets it look *over* a `1.1 m` desk at `1.6 m` faces. |
| **3D Pinhole Projection & Frustum** | A geometric pyramid (cone with rectangular cross-section) extending from the camera lens out to `range` (`10 m`). Any point outside this pyramid cannot be seen. | A point right beneath a wall camera falls below the bottom edge of its `54.4°` vertical frustum. |
| **3D Ray-AABB Occlusion** | **AABB** = *Axis-Aligned Bounding Box* (a 3D rectangular block like a `1.8 m` shelf). A 3D line-of-sight ray from camera to target is **occluded** (blocked) if it hits the box below its top height. | A `2.4 m` camera sees *over* a `1.1 m` cashier desk to `1.6 m` faces, because the ray stays above `1.1 m`. |
| **Shared-XY Raycast (`dualPpmAt`)** | Checking both face height (`1.6 m`) and hand height (`1.0 m`) using the **same 2D floor path** in one loop instead of running two separate searches. | Cuts dual-height raycasting overhead from `+100%` down to `< 5%`. |
| **Depth Atlas / POV / HDR Buffer** | **POV** = *Point of View* (looking through a specific camera in 3D). A **Depth Atlas** is a GPU distance map (`HDR` = high-precision texture) used in 3D mode to black out areas hidden behind shelves or people. | Turning on *Vùng quan sát* in 3D shades blind areas black using this depth map. |

---

## 2. Store Risk, Fixtures & KPIs

| Term | Plain-English Meaning | Concrete Example in OptiCam |
|---|---|---|
| **CRAVED** | Criminology framework scoring why items are stolen: **C**oncealable, **R**emovable, **A**vailable, **V**aluable, **E**njoyable, **D**isposable. | Cosmetics (`wmax = 4.7`) and alcohol/tobacco (`4.8`) score higher than bulky water cases (`1.8`). |
| **Risk Weight ($W_j$), $r_0$, $R$** | Priority score (`1.0` to `5.0`) of floor tile $j$. Stays at peak $W_{\max}$ inside core radius $r_0$ (`1.0 m`), then fades linearly to `1.0` at outer radius $R$ (`2.5 m` POS, `2.0 m` shelf). | A tile `1.75 m` from a POS counter (`Wmax=5`) gets weight `3.0`; empty floor gets `1.0`. |
| **Red / Yellow / Green Bands** | Visual grouping of weights: **Red** ($W \ge 4.0$, cashiers/doors/high-CRAVED), **Yellow** ($2.0 \le W < 4.0$, shelves), **Green** ($W < 2.0$, walkways). | Red tiles require `>= 250 PPM` (Face-ID); Yellow tiles require `>= 125 PPM` (Hand/Item view). |
| **KPI (Key Performance Indicator)** | Pass/fail security checklist for a store plan: **Red Zone `>= 95%`** at `>= 250 PPM` **AND** **Yellow Zone `>= 80%`** at `>= 125 PPM`. | A 3-camera plan with `96%` Red and `85%` Yellow **PASSES**; `94%` Red **FAILS**. |
| **Dual-Height Scoring (`1.6 m + 1.0 m`)** | Evaluating *both* face clarity (`1.6 m`) and hand/low-shelf clarity (`1.0 m`). Uses **graded partial credit** (`0.65` Red / `0.80` Yellow face share + hand multiplier) so low desks don't cause false failures. | Raises preset KPI pass rate from `8/18` (strict binary cutoff) to `17/18` (`94.4%`) while achieving `98.7%` Red hand coverage. |
| **Head-Only Blind Spot (`headOnly`)** | A floor tile where a camera sees a person's face (`1.6 m >= 25 PPM`) **but** shelves or counters completely block their hands (`1.0 m < 25 PPM`). | Shown as **amber diagonal stripes** on the 2.5D heatmap. |
| **Hand Coverage (`handCoverage`)** | Percentage of priority tiles ($W \ge 3.0$) reaching at least `62.5 PPM` (Observation) at `1.0 m` hand height (target: `80%`). | Ensures thieves' hands cannot hide behind `1.45 m` shelves. |
| **Floor Polygon & `gridM`** | **Floor Polygon** = the exact corner points of non-rectangular shops (L-shape, chamfered, trapezoid). **`gridM`** = size of each square evaluation tile (default `0.5 m`). | A `10 × 6 m` shop at `gridM = 0.5 m` has `20 × 12 = 240` tiles. |
| **BOM & Manhattan Cable Routing** | **BOM** = *Bill of Materials* (shopping list of cameras, cable meters, NVR, and cost). **Manhattan distance** sums `|Δx| + |Δy| + height` (cables run along walls/ceilings, not diagonally through air). | Adds `3 m` service slack and `× 1.1` margin to estimate real installation cable. |

---

## 3. Optimization & Algorithms

| Term | Plain-English Meaning | Concrete Example in OptiCam |
|---|---|---|
| **Greedy Algorithm** | Places cameras one by one, picking whichever single camera adds the most score at each step. | Fast (`~50 ms`), and for submodular coverage is mathematically guaranteed to reach at least `1 - 1/e ≈ 63.21%` of optimal. |
| **Monotone Submodular** | "Diminishing returns": adding a camera never lowers coverage, and adding it early helps more than adding it when the store is already mostly covered. | Justifies why Greedy works within `98.8%–99.2%` of exact math solvers here. |
| **Local Search / 1-Swap Polish** | After Greedy places $K$ cameras, tests replacing 1 camera at a time with a better pose (up to `3` passes) until no swap improves the score. | Fixes early greedy commitments that look suboptimal once later cameras are placed. |
| **Two-Stage `kpi_hybrid`** | OptiCam's live solver: **Stage 1** locks the first ~2/3 of cameras (`ceil(0.67 * K)`) onto Red POS/door Face-ID; **Stage 2 + 3 swaps** cover shelves and reduce any remaining KPI shortfall using a **Hinge Penalty ($\lambda$)**. | Boosts 3-camera KPI pass rate on `50` unseen stores from `38%` to **`98%` (`49/50`)**. |
| **Hinge Shortfall Penalty ($\lambda$)** | A soft penalty proportional to how many `%` are still missing below `95% Red` (`λ=1.5`), `80% Yellow` (`λ=0.75`), and `80% Hand` (`λ=0.50`). Drops to `0` once the target is met. | Nudges cameras over the `95%` finish line without over-sacrificing total store coverage. |
| **Dedicated Per-$K$ Sizing (`Min-K`)** | Finding the minimum cameras needed by solving `K = 1`, then `K = 2`, then `K = 3` **from scratch** on a shared raycast cache—instead of **prefix slicing** (chopping cameras off a 6-camera plan). | Cuts average required cameras from `4.52` (old prefix slicer) to **`2.48`**. |
| **Candidate Pool & Memory Cap** | Finite grid of valid wall/ceiling camera positions (`30°` pan steps), capped at `12,000` poses and `1,500,000` pose-tile pairs so large stores stay under `0.4 s`. | Automatically coarsens spacing on huge `200 m²` stores to stay fast and memory-safe. |
| **Lexicographic Tie-Breaking** | When two camera poses tie on DORI utility score, pick the one with higher raw PPM (capped at `250`). | Prefers sharper images even inside the same DORI band. |
| **HiGHS MILP & LP-Dual Bound** | **MILP** = *Mixed-Integer Linear Programming* (an exact global math solver, `HiGHS`), which guarantees the mathematically best possible grid solution (or its tightest **LP-Dual** upper ceiling) at the cost of `4–40 s` runtime. | Used offline to prove OptiCam's `0.1 s` greedy solver reaches `98.8%–99.2%` of theoretical perfection. |
| **Literature Baselines (`Erdem-06`, `Kim-19`, `Aziz-24`, `Wang-13`)** | Four published academic CCTV placement methods re-implemented in Python for fair head-to-head testing on identical 4 MP cameras. | `Erdem-06` & `Aziz-24` use flat 2D occlusion; `Kim-19` ignores PPM zoom; `Wang-13` deploys `22–43` redundant cameras. |

---

## 4. Scientific Validation & Statistics

| Term | Plain-English Meaning | Concrete Example in OptiCam |
|---|---|---|
| **AHP & Consistency Ratio (`CR`)** | **Analytic Hierarchy Process**: a structured pairwise comparison method (Saaty's `1–3–5–7–9` scale) checking whether priority weights contradict each other. `CR < 0.10` means mathematically consistent. | OptiCam's `(5, 3, 1)` weights yield `CR = 0.0066` (15× better than the `0.10` threshold). |
| **Non-Circular Physical-Mask Proof** | Testing weights `(5, 3, 1)` using simple physical distance boxes (`0.65 m` around till/doors/shelves) instead of the `(5, 3, 1)` score itself, so the test doesn't "grade its own homework." | Proves `(5, 3, 1)` doubles pass rate over `(1, 1, 1)` (`40% → 80%`) on independent physical zones. |
| **Saltelli Sobol Sensitivity ($S_T$)** | Global variance test that wiggles all parameters simultaneously to measure which knob actually drives output swings (`ST` near `1.0` = dominant driver). | Showed `F_recog = 0.75` drove `78.8%` of $K=3$ variance (`ST = 0.788`), while radii `r0 / R` barely mattered (`ST = 0.037–0.046`). |
| **Nelder–Mead Calibration** | A black-box numerical optimizer that searches for arbitrary decimal weights (like `6.784, 3.456`) to see if decimals beat clean integers `(5, 3, 1)`. | Decimal weights did **no better** on 50 unseen stores (`94.20` vs `94.25`). |
| **Kneedle Elbow & "Last-Cell Curse"** | **Kneedle** finds the sharpest bend ("elbow") in a cost-vs-coverage curve (`94%` Red). Pushing to `98%–100%` triggers the **Last-Cell Curse**: buying `+1` or `+2` extra cameras just for one tiny `0.15 m²` corner triangle. | Justifies why `95%` Red is the practical sweet spot. |
| **TOST (Two One-Sided Tests)** | A statistical test proving two methods are **practically equivalent** within a tiny margin (e.g., `±1%` or `±0.25` cameras), rather than merely "not significantly different." | Proves `(5, 3, 1)` is statistically equivalent to Nelder–Mead decimals (`p = 0.0007`). |
| **Wilcoxon, Holm ($p_{\text{Holm}}$), $r$, McNemar** | Non-parametric paired statistical tests: **Wilcoxon** compares continuous scores across the same 50 stores; **Holm** adjusts $p$-values for multiple comparisons; **Rank-Biserial $r = 1.0$** means 100% win rate; **McNemar** compares paired Pass/Fail rates. | `kpi_hybrid` beats all 4 papers `50–0–0` ($p_{\text{Holm}} < 10^{-6}, r = 1.000$). |
| **Ablation Study & Grid Convergence** | **Ablation** turns features on one by one (`Random → 4 Corners → Greedy → Hybrid → kpi_hybrid`) to prove each piece helps. **Grid Convergence** tests `0.50 m` solutions on a `25×` finer `0.10 m` grid. | Confirms `0.50 m` optimization loses `0 pp` accuracy vs `0.10 m` truth. |

---

## 5. Software & UI Terms

| Term | Plain-English Meaning | Concrete Example in OptiCam |
|---|---|---|
| **Web Worker & `Float32Array` Parity** | A **Web Worker** runs optimization in a background browser thread so the UI stays smooth; **`Float32Array`** is a fast typed array matching Python's `float` precision (`0.00e+00` diff). | Guarantees offline browser results match the Python FastAPI server identically. |
| **`SpotlightOverlay` & `TutorialModal`** | Interactive onboarding layer that darkens the screen and cuts a bright window (`evenodd` CSS `clip-path`) around each real UI panel (`01`–`06`), tracking window resizes via `ResizeObserver`. | Reopenable anytime via `?`; also powers the 3-step guide inside `CustomLayoutModal`. |
| **Ghost Placement (`PlacementDraft`) & `StudioSelect`** | **Ghost Placement** shows a translucent preview of a shelf/fridge following your mouse cursor (`R` rotates `15°`, click places). **`StudioSelect`** is OptiCam's custom dropdown menu replacing plain OS `<select>` boxes. | Makes placing `13` fixture types and switching `18` store templates fast and consistent. |
