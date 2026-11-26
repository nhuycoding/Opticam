"""Deterministic synthetic store generator mirroring frontend/experiments/run.ts (Mulberry32, 50-80 m2)."""
from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parent
ROOT = SCRIPTS_DIR.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from opticam_fast import ROOT, SAMPLES, load_layout_bundle
from backend.greedy_optimizer import OptiCamGreedy
from backend.main import LayoutData

# Match frontend/experiments/run.ts seed namespace strictly; disjoint from data_samples/
DEFAULT_SEED0 = 2026


def mulberry32(seed: int):
    """Exact 32-bit JS Mulberry32 PRNG match of frontend/experiments/run.ts."""
    state = seed & 0xFFFFFFFF
    if state >= 0x80000000:
        state -= 0x100000000

    def next_float() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        # Math.imul(t ^ (t >>> 15), 1 | t)
        a = (t ^ (t >> 15)) & 0xFFFFFFFF
        b = (1 | t) & 0xFFFFFFFF
        t = (a * b) & 0xFFFFFFFF
        a2 = (t ^ (t >> 7)) & 0xFFFFFFFF
        b2 = (61 | t) & 0xFFFFFFFF
        prod = (a2 * b2) & 0xFFFFFFFF
        t = (t + prod) ^ t
        t &= 0xFFFFFFFF
        res = (t ^ (t >> 14)) & 0xFFFFFFFF
        return res / 4294967296.0

    return next_float


def _clamp(v: float, a: float, b: float) -> float:
    return max(a, min(b, v))


def _snap(v: float, s: float) -> float:
    # JS Math.round rounds half toward +inf; for non-negative values in layout gen round(v/s + 1e-12) matches closely
    return math.floor(v / s + 0.5) * s


def _round2(v: float) -> float:
    return round(v * 100.0) / 100.0


def _obs_poly(o: dict[str, Any]) -> list[tuple[float, float]]:
    cx = o["x"] + o["w"] / 2.0
    cy = o["y"] + o["h"] / 2.0
    ang = math.radians(o.get("angle", 0.0))
    c, s = math.cos(ang), math.sin(ang)
    hw, hh = o["w"] / 2.0, o["h"] / 2.0
    return [
        (cx + dx * c - dy * s, cy + dx * s + dy * c)
        for dx, dy in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))
    ]


def _sat_collide(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> bool:
    for poly in (a, b):
        for i in range(len(poly)):
            p = poly[i]
            q = poly[(i + 1) % len(poly)]
            length = math.hypot(q[1] - p[1], q[0] - p[0])
            if length == 0.0:
                continue
            ax = -(q[1] - p[1]) / length
            ay = (q[0] - p[0]) / length
            pa = [v[0] * ax + v[1] * ay for v in a]
            pb = [v[0] * ax + v[1] * ay for v in b]
            if max(pa) <= min(pb) + 1e-9 or max(pb) <= min(pa) + 1e-9:
                return False
    return True


def _place_obstacle(o: dict[str, Any], cx: float, cy: float, W: float, H: float, g: float) -> dict[str, Any]:
    if o["type"] == "entrance":
        length = max(o["w"], o["h"])
        th = min(o["w"], o["h"])
        dT, dB, dL, dR = cy, H - cy, cx, W - cx
        m = min(dT, dB, dL, dR)
        horiz = m == dT or m == dB

        def along(v: float, size: float, mx: float) -> float:
            return _clamp(_snap(_clamp(v, size / 2.0, mx - size / 2.0), g), size / 2.0, mx - size / 2.0)

        ncx = along(cx, length, W) if horiz else (th / 2.0 if m == dL else W - th / 2.0)
        ncy = (th / 2.0 if m == dT else H - th / 2.0) if horiz else along(cy, length, H)
        return {
            **o,
            "w": length,
            "h": th,
            "angle": 0.0 if horiz else 90.0,
            "x": _round2(ncx - length / 2.0),
            "y": _round2(ncy - th / 2.0),
        }

    ang = math.radians(o.get("angle", 0.0))
    ex = (o["w"] / 2.0) * abs(math.cos(ang)) + (o["h"] / 2.0) * abs(math.sin(ang))
    ey = (o["w"] / 2.0) * abs(math.sin(ang)) + (o["h"] / 2.0) * abs(math.cos(ang))
    ncx = _clamp(_snap(_clamp(cx, ex, W - ex), g), ex, W - ex)
    ncy = _clamp(_snap(_clamp(cy, ey, H - ey), g), ey, H - ey)
    return {**o, "x": _round2(ncx - o["w"] / 2.0), "y": _round2(ncy - o["h"] / 2.0)}


def random_layout_dict(seed: int, assign_risk_profiles: bool = False) -> dict[str, Any]:
    """Generate a synthetic convenience-store layout (50-80 m2) matching frontend/experiments/run.ts."""
    r = mulberry32(seed)

    def pick(arr):
        return arr[math.floor(r() * len(arr))]

    W, H = 8.0, 5.0
    for _ in range(100):
        W = pick([8.0, 8.5, 9.0, 10.0, 11.0, 12.0])
        H = pick([5.0, 5.5, 6.0, 6.5, 7.0])
        if 50.0 <= W * H <= 80.0:
            break

    obs: list[dict[str, Any]] = []

    def add(o: dict[str, Any], margin: float = 0.0) -> bool:
        n = _place_obstacle(o, o["x"] + o["w"] / 2.0, o["y"] + o["h"] / 2.0, W, H, 0.5)
        inflated = {**n, "w": n["w"] + margin * 2.0, "h": n["h"] + margin * 2.0, "x": n["x"] - margin, "y": n["y"] - margin}
        ipoly = _obs_poly(inflated)
        if any(_sat_collide(ipoly, _obs_poly(q)) for q in obs):
            return False
        obs.append(n)
        return True

    for _ in range(50):
        if obs:
            break
        add({"id": "pos", "type": "pos", "label": "Quầy POS", "x": _snap(r() * (W - 2.0), 0.5), "y": 0.5 if r() < 0.5 else H - 1.5, "w": 2.0, "h": 1.0, "elev": 1.1, "angle": 0.0})

    for _ in range(50):
        if len(obs) >= 2:
            break
        add({"id": "door", "type": "entrance", "label": "Cửa", "x": r() * W, "y": r() * H, "w": 1.5, "h": 0.2, "elev": 2.2, "angle": 0.0})

    n_shelf = 2 + math.floor(r() * 3)
    placed_shelves = 0
    for _ in range(200):
        if placed_shelves >= n_shelf:
            break
        length = pick([3.0, 4.0, 4.5])
        vert = r() < 0.4
        shelf_o: dict[str, Any] = {
            "id": f"shelf_{placed_shelves}",
            "type": "shelf",
            "label": f"Kệ {placed_shelves + 1}",
            "x": _snap(1.0 + r() * max(0.5, W - length - 2.0), 0.5),
            "y": _snap(1.0 + r() * max(0.5, H - 3.0), 0.5),
            "w": length,
            "h": 0.5,
            "elev": 1.8,
            "angle": 90.0 if vert else 0.0,
        }
        if assign_risk_profiles and placed_shelves == 0:
            shelf_o["riskCategory"] = "high"
        if add(shelf_o, 0.5):
            placed_shelves += 1

    return {
        "version": "1.0",
        "name": f"random_{seed}",
        "widthM": W,
        "heightM": H,
        "gridM": 0.5,
        "pixelsPerMeter": 68,
        "obstacles": obs,
        "risk": {},
        "riskStrokes": [],
        "targetHeight": 1.6,
        "cameras": [],
    }


def make_bundle_from_raw(raw: dict[str, Any], filename: str | None = None) -> dict[str, Any]:
    """Build an evaluation bundle matching opticam_fast.load_layout_bundle."""
    layout = LayoutData.parse_obj(raw)
    opt = OptiCamGreedy(
        layout.widthM,
        layout.heightM,
        layout.obstacles,
        layout.targetHeight,
        layout.riskStrokes,
        layout.risk,
        layout.floorPolygon,
    )
    zones = opt.generate_grid(layout.gridM)
    xs = np.array([z[0] for z in zones], dtype=np.float64)
    ys = np.array([z[1] for z in zones], dtype=np.float64)
    ws = np.array([z[2] for z in zones], dtype=np.float64)
    obstacles = [o.dict() for o in layout.obstacles]
    return {
        "filename": filename or f"{layout.name}.json",
        "raw": raw,
        "layout": layout,
        "opt": opt,
        "zones": zones,
        "xs": xs,
        "ys": ys,
        "ws": ws,
        "obstacles": obstacles,
    }


def get_dev_bundles(deduplicate: bool = True) -> list[dict[str, Any]]:
    """Return preset Dev bundles from data_samples/; deduplicate skips vn_co_nguoi geometry duplicate."""
    bundles = []
    seen = set()
    for fname in SAMPLES:
        b = load_layout_bundle(fname)
        if deduplicate and fname == "vn_co_nguoi_78m2.json" and "vn_goc_pho_78m2.json" in seen:
            continue
        seen.add(fname)
        bundles.append(b)
    return bundles


def get_heldout_bundles(n_stores: int = 50, seed0: int = DEFAULT_SEED0) -> list[dict[str, Any]]:
    """Generate N held-out synthetic stores with strict zero overlap against Dev presets."""
    out = []
    for i in range(n_stores):
        seed = seed0 + i
        raw = random_layout_dict(seed)
        out.append(make_bundle_from_raw(raw, filename=f"synthetic_{seed}.json"))
    return out
