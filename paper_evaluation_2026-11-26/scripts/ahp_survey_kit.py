"""Saaty AHP (1-9 scale) Expert Survey Generator & Consistency Ratio (CR < 0.10) Scorer.

Validates empirical store-manager / retail-security risk priority weights against
OptiCam defaults: POS/Entrance = 5, Standard Shelf = 3, High-CRAVED Shelf = 4.5,
Bulky Shelf = 1.8, Open Floor = 1.0 (anchored to floor = 1.0).
"""
from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable

import numpy as np

CRITERIA = [
    "POS_Till",
    "Entrance_Exit",
    "High_CRAVED_Shelf",
    "Standard_Shelf",
    "Bulky_Shelf",
    "Open_Floor",
]

# Saaty Random Consistency Index RI for n = 1..10
SAATY_RI = {1: 0.00, 2: 0.00, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49}

# Reference OptiCam weight vector mapped onto 6 criteria (floor = 1.0)
OPTICAM_REF = np.array([5.0, 5.0, 4.5, 3.0, 1.8, 1.0], dtype=np.float64)


def export_blank_template(out_csv: Path) -> None:
    """Create blank pairwise questionnaire CSV using Saaty's 1..9 fundamental scale."""
    pairs = []
    for i in range(len(CRITERIA)):
        for j in range(i + 1, len(CRITERIA)):
            pairs.append((CRITERIA[i], CRITERIA[j]))

    header = ["respondent_id", "role", "years_exp"] + [f"{a}_vs_{b}" for a, b in pairs]
    guide = [
        "SCALE GUIDE -> 1=Equal, 3=Moderate, 5=Strong, 7=VeryStrong, 9=Extreme; reciprocals 1/3..1/9 allowed (e.g. 0.333 or '1/3')",
        "retail_security",
        "5+",
    ] + ["" for _ in pairs]

    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerow(guide)


def _parse_ratio(val: str | float) -> float:
    s = str(val).strip()
    if "/" in s:
        num, den = s.split("/", 1)
        return float(num) / float(den)
    return float(s)


def solve_ahp_matrix(A: np.ndarray) -> dict[str, object]:
    """Principal eigenvector priority vector and Saaty Consistency Ratio CR."""
    n = A.shape[0]
    vals, vecs = np.linalg.eig(A)
    idx = int(np.argmax(np.real(vals)))
    lambda_max = float(np.real(vals[idx]))
    w = np.abs(np.real(vecs[:, idx]))
    w = w / np.sum(w)
    ci = (lambda_max - n) / max(1, n - 1)
    ri = SAATY_RI.get(n, 1.24)
    cr = ci / ri if ri > 0 else 0.0
    # Rescale relative to Open_Floor = 1.0 (last criterion)
    floor_rel = w / max(1e-9, float(w[-1]))
    return {
        "weights_norm": w,
        "weights_floor1": floor_rel,
        "lambda_max": lambda_max,
        "CI": ci,
        "CR": cr,
        "consistent": cr < 0.10,
    }


def score_survey_csv(in_csv: Path, seed: int = 2026) -> dict[str, object]:
    """Score real collected survey CSV (ignoring guide/blank rows), compute CR & bootstrap 95% CI."""
    pairs = [(i, j, f"{CRITERIA[i]}_vs_{CRITERIA[j]}") for i in range(len(CRITERIA)) for j in range(i + 1, len(CRITERIA))]
    n = len(CRITERIA)
    accepted: list[np.ndarray] = []
    rejected = 0

    with open(in_csv, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rid = str(row.get("respondent_id", "")).strip()
            if not rid or rid.startswith("SCALE GUIDE"):
                continue
            A = np.ones((n, n), dtype=np.float64)
            try:
                for i, j, col in pairs:
                    val = _parse_ratio(row[col])
                    A[i, j] = val
                    A[j, i] = 1.0 / val
            except (ValueError, KeyError, ZeroDivisionError):
                rejected += 1
                continue
            res = solve_ahp_matrix(A)
            if res["consistent"]:
                accepted.append(res["weights_floor1"])
            else:
                rejected += 1

    if not accepted:
        return {"n_consistent": 0, "n_rejected": rejected, "status": "NO_RESPONSES_YET"}

    mat = np.stack(accepted, axis=0)
    geom_mean = np.exp(np.mean(np.log(np.maximum(mat, 1e-6)), axis=0))
    rng = np.random.default_rng(seed)
    boots = []
    for _ in range(5000):
        idx = rng.integers(0, len(mat), size=len(mat))
        boots.append(np.exp(np.mean(np.log(np.maximum(mat[idx], 1e-6)), axis=0)))
    boot_arr = np.stack(boots, axis=0)
    ci_lo = np.percentile(boot_arr, 2.5, axis=0)
    ci_hi = np.percentile(boot_arr, 97.5, axis=0)

    return {
        "n_consistent": len(mat),
        "n_rejected": rejected,
        "criteria": CRITERIA,
        "geom_mean_floor1": np.round(geom_mean, 3).tolist(),
        "ci95_lo": np.round(ci_lo, 3).tolist(),
        "ci95_hi": np.round(ci_hi, 3).tolist(),
        "opticam_ref": OPTICAM_REF.tolist(),
        "ref_inside_ci95": [bool(lo <= ref <= hi) for lo, ref, hi in zip(ci_lo, OPTICAM_REF, ci_hi)],
    }


def theoretical_saaty_check() -> dict[str, object]:
    """Verify mathematical consistency of Saaty odd-integer mapping (1, 3, 5) + [4.5, 1.8]."""
    # Pairwise matrix constructed strictly from Saaty odd-integer scale ratios w_i / w_j quantized to nearest Saaty step
    raw_ratios = np.outer(OPTICAM_REF, 1.0 / OPTICAM_REF)
    # Quantize off-diagonal entries >=1 to nearest integer in {1..9}
    A = np.ones_like(raw_ratios)
    for i in range(len(CRITERIA)):
        for j in range(i + 1, len(CRITERIA)):
            r = raw_ratios[i, j]
            q = float(min(9, max(1, round(r)))) if r >= 1.0 else 1.0 / float(min(9, max(1, round(1.0 / r))))
            A[i, j] = q
            A[j, i] = 1.0 / q
    return solve_ahp_matrix(A)


if __name__ == "__main__":
    tpl = Path(__file__).resolve().parent.parent / "data" / "ahp_survey_template.csv"
    export_blank_template(tpl)
    chk = theoretical_saaty_check()
    print(f"Exported template -> {tpl}")
    print(f"Theoretical Saaty-quantized matrix CR = {chk['CR']:.4f} (consistent={chk['consistent']})")
    print(f"Weights (floor=1): {np.round(chk['weights_floor1'], 2).tolist()} vs OptiCam ref {OPTICAM_REF.tolist()}")
