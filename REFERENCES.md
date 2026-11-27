# OptiCam-Retail: References, Standards & Citations

> **Plain-English Guide:** This file lists every external standard, academic paper, mathematical theorem, and retail guideline used in OptiCam, along with **one-line explanations of what role each plays**. For definitions of technical acronyms (`DORI`, `BIP`, `SOCP`, `SemGA`, `Kneedle`, `TOST`, `Sobol`, `AHP`, `CRAVED`), see [GLOSSARY.md](GLOSSARY.md).

---

## 1. Surveillance Optical & Video Standards

1. **IEC 62676-4:2014** — *Video surveillance systems for use in security applications — Part 4: Application guidelines*. International Electrotechnical Commission (2014).  
   - **Role in OptiCam:** Defines the **DORI** (Detection `>= 25 PPM`, Observation `>= 62.5 PPM`, Recognition `>= 125 PPM`, Identification `>= 250 PPM`) pixel-density tiers, the `1.6 m` primary face target plane, and the `1.0 m` secondary hand/shelf-reach tier (`DUAL_HEIGHT_SCORING`, `handCoverage >= 62.5 PPM`) used in [`optics.ts`](frontend/src/core/optics.ts) and [`greedy_optimizer.py`](backend/greedy_optimizer.py).

---

## 2. Camera Placement & Visual Sensor Network Literature

2. **Erdem, U. M., & Sclaroff, S. (2006).** *Automated camera layout to satisfy task-specific and floor plan-specific coverage requirements.* Computer Vision and Image Understanding, 103(3), 156–169. [PDF](https://cs-web.bu.edu/groups/ivc/pubs/ErdemSclaroffCVIU2006.pdf)  
   - **Role in OptiCam:** Benchmarked in both fixed-$K$ Max-Coverage and unconstrained 0–1 BIP Set-Cover modes (`25 PPM`, `250 PPM`, Hot-Spot Prob. 4).

3. **Yao, Y., Chen, C.-H., Abidi, B., Page, D., Koschan, A., & Abidi, M. (2010).** *Can You See Me Now? Sensor Positioning for Automated and Persistent Surveillance.* IEEE Transactions on Systems, Man, and Cybernetics—Part B (Cybernetics), 40(1), 101–115.  
   - **Role in OptiCam:** Verified primary authorship record (correcting misattribution to "Liu et al., ICDSC 2010" in external notes); builds upon Erdem & Sclaroff's formulation.

4. **Wang, Z., Wang, S., & Xu, M. (2013).** *A Sparse Representation-Based Deployment Method for Optimizing the Observation Quality of Camera Networks.* Sensors, 13(9), 11453–11473. [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3821344/)  
   - **Role in OptiCam:** Implemented via $\ell_1$-relaxed SOCP (`clarabel`) in Uniform and Wall+Critical modes (`Wang-13-Unif`, `Wang-13-Crit`) for cross-paper comparison.

5. **Kim, J., Ham, Y., Chung, Y., & Chi, S. (2019).** *Systematic Camera Placement Framework for Operation-Level Visual Monitoring on Construction Jobsites.* Journal of Construction Engineering and Management (ASCE), 145(4), 04019019.  
   - **Role in OptiCam:** Implemented Semantic-Cost Genetic Algorithm (`Kim-19 SemGA`) optimizing spatial Weighted Visual Coverage Rate (WVCR) without multi-tier DORI utility (`Ablation 1`).

6. **Aziz, A., et al. (2024).** *BIM-Based Framework for Optimization of CCTV Surveillance in Buildings.* Journal of Information Technology in Construction (ITcon), Vol. 29, 894–913. [PDF](https://www.itcon.org/papers/2024_39-ITcon-Aziz.pdf)  
   - **Role in OptiCam:** Implemented continuous ceiling GA #3 (`Aziz-24 GA#3`) with 2D ceiling visibility and binary ROI fitness.

---

## 3. Submodular Optimization, Numerical Convergence & Statistical Methods

7. **Nemhauser, G. L., Wolsey, L. A., & Fisher, M. L. (1978).** *An analysis of approximations for maximizing submodular set functions—I.* Mathematical Programming, 14(1), 265–294.  
   - **Role in OptiCam:** Establishes the $(1 - 1/e) \approx 63.21\%$ worst-case approximation bound for monotone submodular greedy maximization.

8. **Filmus, Y., & Ward, J. (2014).** *Monotone Submodular Maximization over a Matroid via Non-Oblivious Local Search.* SIAM Journal on Computing, 43(2), 514–542.  
   - **Role in OptiCam:** Motivates bounded 1-swap local search refinement (`hybrid` / `kpi_hybrid`) beyond myopic greedy selection.

9. **Satopaa, V., Albrecht, J., Irwin, D., & Raghavan, B. (2011).** *Finding a "Kneedle" in a Haystack: Detecting Knee Points in System Behavior.* 31st International Conference on Distributed Computing Systems Workshops (ICDCSW), IEEE, 166–171.  
   - **Role in OptiCam:** Used to detect the empirical threshold curvature elbow (`τ_Red = 94%`) balancing Capex against uncovered Red blind area.

10. **Roache, P. J. (1994 / 1997).** *Perspective: A Method for Uniform Reporting of Grid Refinement Studies.* Journal of Fluids Engineering, 116(3), 405–413; and *Quantification of Uncertainty in Computational Fluid Dynamics*, Annual Review of Fluid Mechanics, 29, 123–160.  
    - **Role in OptiCam:** Used to bound spatial discretization convergence (`0.50 m → 0.25 m → 0.10 m`) in `Phase 3`.

11. **Lakens, D. (2017).** *Equivalence Tests: A Practical Primer for t Tests, Correlations, and Meta-Analyses.* Social Psychological and Personality Science, 8(4), 355–362.  
    - **Role in OptiCam:** Used for formal **TOST** (Two One-Sided Tests) statistical equivalence between `(5, 3, 1)` vs Nelder–Mead continuous weights (`±1.0 pp`) and `95%` vs `96%` threshold Min-$K$ (`±0.25` cameras).

12. **Saltelli, A., et al. (2010).** *Variance based sensitivity analysis of model output. Design and estimator for the total sensitivity index.* Computer Physics Communications, 181(2), 259–270.  
    - **Role in OptiCam:** Variance attribution (`W2` Sobol) isolating `F_recog` as the dominant $K=3$ bottleneck (`ST = 0.788`) relative to decay radii (`ST = 0.037–0.046`).

---

## 4. Retail Security Risk & Store Space Planning

13. **Clarke, R. V. (1999).** *Hot Products: Understanding, Anticipating and Reducing Demand for Stolen Goods.* Police Research Series Paper 112, Home Office, London.  
    - **Role in OptiCam:** Conceptual basis for both the shelf risk presets (`high = 4.5`, `standard = 3.0`, `bulky = 1.8`) and the expanded **16-category 6-axis CRAVED (`GOODS_CATALOG`)** stacked shelf-tier classification in [`craved.ts`](frontend/src/core/craved.ts).

14. **Saaty, T. L. (1980 / 2008).** *The Analytic Hierarchy Process.* McGraw-Hill (1980); *Decision making with the analytic hierarchy process*, Int. J. Services Sciences, 1(1), 83–98 (2008).  
    - **Role in OptiCam:** Grounds the `{1, 3, 5}` priority hierarchy (`CR = 0.0066 < 0.10`) in [`ahp_survey_kit.py`](paper_evaluation_2026-11-26/scripts/ahp_survey_kit.py).

15. **Vietnamese Convenience Store & Mini-Mart Spatial Conventions (`VN 01`–`VN 15`):**  
    - Store zoning, front-entrance L/I-POS + F&B integration, right-hand traffic loop, `1.2–1.5 m` main aisles (`0.8–1.0 m` secondary aisles), `1.45 m` eye-level center gondolas, `<= 0.45 m` wall shelves, and rear/side vertical coolers (`>= 1.0 m` front clearance) synthesized from retail setup practices across Circle K, GS25, WinMart+, Long Châu/Pharmacity, and `5×12 m` / `5×15 m` Vietnamese *nhà ống* mini-marts ([ksetup.vn](https://ksetup.vn), [onetechgroup.com.vn](https://onetechgroup.com.vn), [giakeonetech.vn](https://giakeonetech.vn), [sapo.vn](https://sapo.vn)).
