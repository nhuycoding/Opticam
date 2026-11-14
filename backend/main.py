from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import time
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, Field, root_validator, validator, conint

if __package__:
    from .footprint import validate_polygon, boundary_anchors, point_in_floor
    from .greedy_optimizer import OptiCamGreedy, camera_ppm
else:
    from footprint import validate_polygon, boundary_anchors, point_in_floor
    from greedy_optimizer import OptiCamGreedy, camera_ppm

app = FastAPI(title="OptiCam Backend API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

DATA_DIR = Path(os.environ.get("OPTICAM_DATA_DIR", Path(__file__).parent / "storage" / "layouts"))
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_GRID_CELLS = 12_000
MAX_CANDIDATE_CELL_EVALUATIONS = 1_000_000


class FiniteModel(BaseModel):
    @root_validator(pre=True)
    def reject_non_finite_json(cls, values):
        pending = [values]
        while pending:
            value = pending.pop()
            if isinstance(value, float) and not math.isfinite(value):
                raise ValueError("numeric values must be finite")
            if isinstance(value, dict):
                pending.extend(value.values())
            elif isinstance(value, (list, tuple)):
                pending.extend(value)
        return values

    class Config:
        allow_inf_nan = False


class CameraProfile(FiniteModel):
    fov: float = Field(default=85, ge=30, le=140)
    res: float = Field(default=2560, ge=640, le=7680)
    range: float = Field(default=10, ge=1, le=30)
    height: float = Field(default=2.4, ge=1.8, le=4)
    tilt: float | None = Field(default=None, ge=0, le=85)
    vfov: float | None = Field(default=None, ge=10, le=120)
    model: str | None = "Dome IP 4MP (2560px, ống kính 2.8mm)"


class CameraData(CameraProfile):
    id: str = ""
    x: float = 0
    y: float = 0
    pan: float = 0
    target: str | None = None

    class Config:
        extra = "allow"

    @root_validator(pre=True)
    def normalize_pan(cls, values):
        values = dict(values)
        values["pan"] = values.get("pan", values.get("pan_angle", values.get("angle", 0)))
        return values

    @validator("pan")
    def wrap_pan(cls, value):
        return value % 360


class Obstacle(FiniteModel):
    id: str = ""
    type: Literal["shelf", "pos", "entrance"] = "shelf"
    x: float
    y: float
    w: float = Field(default=1, gt=0)
    h: float = Field(default=1, gt=0)
    elev: float = Field(default=1.8, ge=0, le=20)
    angle: float = 0
    riskCategory: Literal["high", "standard", "bulky", "custom"] | None = None
    riskWmax: float | None = Field(default=None, ge=1, le=5)
    riskR0: float | None = Field(default=None, ge=0)
    riskR: float | None = Field(default=None, gt=0)

    class Config:
        extra = "allow"

    @root_validator
    def validate_risk_profile(cls, values: dict[str, Any]) -> dict[str, Any]:
        obstacle_type = values.get("type", "shelf")
        default_radius = 2.0 if obstacle_type == "shelf" else 2.5
        r0 = values.get("riskR0")
        radius = values.get("riskR")
        if (radius if radius is not None else default_radius) <= (r0 if r0 is not None else 1.0):
            raise ValueError("riskR must be greater than riskR0")
        return values


class RiskStroke(FiniteModel):
    x: float
    y: float
    radius: float = Field(gt=0)
    weight: float = Field(ge=1, le=5)


class LayoutData(FiniteModel):
    version: str = "1.0"
    name: str = "Layout"
    widthM: float = Field(gt=0, le=40)
    heightM: float = Field(gt=0, le=40)
    gridM: float = Field(default=0.5, ge=0.1, le=2)
    floorPolygon: list[tuple[float, float]] | None = Field(default=None, min_items=3, max_items=32)
    targetHeight: float = Field(default=1.6, ge=0.5, le=2)
    obstacles: list[Obstacle] = Field(default_factory=list, max_items=500)
    risk: dict[str, float] = Field(default_factory=dict)
    riskStrokes: list[RiskStroke] = Field(default_factory=list, max_items=50000)
    cameras: list[dict[str, Any]] = Field(default_factory=list, max_items=20)

    class Config:
        extra = "allow"

    @validator("cameras", each_item=True)
    def validate_camera(cls, camera):
        return CameraData.parse_obj(camera).dict(exclude_none=True)

    @validator("risk")
    def validate_risk(cls, risk):
        if any(not math.isfinite(value) or not 1 <= value <= 5 for value in risk.values()):
            raise ValueError("risk weights must be finite and between 1 and 5")
        return risk

    @root_validator
    def validate_grid_size(cls, values: dict[str, Any]) -> dict[str, Any]:
        width, height, grid = values.get("widthM"), values.get("heightM"), values.get("gridM")
        if width is None or height is None or grid is None:
            return values
        if width < 3 or height < 3:
            raise ValueError("room dimensions must be at least 3 meters")
        if math.ceil(width / grid) * math.ceil(height / grid) > MAX_GRID_CELLS:
            raise ValueError(f"layout cannot exceed {MAX_GRID_CELLS} grid cells")
        polygon = values.get("floorPolygon")
        validate_polygon(polygon, width, height)
        for index, camera in enumerate(values.get("cameras", [])):
            camera["id"] = camera["id"] or f"CAM-{index + 1:02}"
            if not 0 <= camera["x"] <= width or not 0 <= camera["y"] <= height or (polygon and not point_in_floor((camera["x"], camera["y"]), polygon)):
                raise ValueError("camera coordinates must be inside the room")
        ids = [camera["id"] for camera in values.get("cameras", []) if camera["id"]]
        if len(ids) != len(set(ids)):
            raise ValueError("camera IDs must be unique")
        return values


class GridData(FiniteModel):
    rows: conint(strict=True, gt=0)
    cols: conint(strict=True, gt=0)
    cellSizeM: float = Field(gt=0)


class OptimizeRequest(FiniteModel):
    cameraBudgetK: conint(strict=True, ge=1, le=20) = 3
    cameraProfiles: list[CameraProfile] = Field(default_factory=list)
    layout: LayoutData
    grid: GridData
    riskMatrix: list[list[float]]
    blockedMatrix: list[list[conint(strict=True, ge=0, le=1)]]

    @root_validator
    def validate_matrices(cls, values: dict[str, Any]) -> dict[str, Any]:
        grid, layout = values.get("grid"), values.get("layout")
        risk_matrix, blocked_matrix = values.get("riskMatrix"), values.get("blockedMatrix")
        if grid is None or layout is None or risk_matrix is None or blocked_matrix is None:
            return values
        rows, cols = grid.rows, grid.cols
        if rows * cols > MAX_GRID_CELLS:
            raise ValueError(f"grid cannot exceed {MAX_GRID_CELLS} cells")
        if abs(grid.cellSizeM - layout.gridM) > 1e-6:
            raise ValueError("grid cellSizeM must match layout gridM")
        if rows != math.floor(layout.heightM / grid.cellSizeM + 0.5) or cols != math.floor(layout.widthM / grid.cellSizeM + 0.5):
            raise ValueError("grid dimensions must match layout dimensions")
        if len(risk_matrix) != rows or any(len(row) != cols for row in risk_matrix):
            raise ValueError("riskMatrix dimensions must match grid")
        if len(blocked_matrix) != rows or any(len(row) != cols for row in blocked_matrix):
            raise ValueError("blockedMatrix dimensions must match grid")
        if any(not 1 <= value <= 5 for row in risk_matrix for value in row):
            raise ValueError("riskMatrix values must be between 1 and 5")
        if any(value not in (0, 1) for row in blocked_matrix for value in row):
            raise ValueError("blockedMatrix values must be 0 or 1")
        return values


class ProjectExportRequest(FiniteModel):
    layout: LayoutData
    score: dict[str, Any] = Field(default_factory=dict)


def _wall_anchors(width: float, height: float, step: float, floor_polygon=None) -> list[tuple[float, float]]:
    if floor_polygon:
        return boundary_anchors(floor_polygon, step)
    points: set[tuple[float, float]] = set()
    x_steps = max(1, math.ceil(width / step))
    y_steps = max(1, math.ceil(height / step))
    for i in range(x_steps + 1):
        x = width * i / x_steps
        points.add((round(x, 6), 0.0))
        points.add((round(x, 6), round(height, 6)))
    for i in range(y_steps + 1):
        y = height * i / y_steps
        points.add((0.0, round(y, 6)))
        points.add((round(width, 6), round(y, 6)))
    return sorted(points)


def optimize_layout(request: OptimizeRequest) -> dict[str, Any]:
    started = time.perf_counter()
    layout = request.layout
    grid = request.grid.cellSizeM
    profiles = [
        (request.cameraProfiles[index] if index < len(request.cameraProfiles) else CameraProfile())
        .dict(exclude_none=True)
        for index in range(request.cameraBudgetK)
    ]
    optimizer = OptiCamGreedy(
        layout.widthM, layout.heightM, layout.obstacles, layout.targetHeight,
        layout.riskStrokes, layout.risk, layout.floorPolygon
    )
    cells = optimizer.generate_grid(grid, request.riskMatrix, request.blockedMatrix)

    anchor_step = max(grid, 0.5)
    anchors = _wall_anchors(layout.widthM, layout.heightM, anchor_step, layout.floorPolygon)
    while cells and anchor_step < max(layout.widthM, layout.heightM) and len(anchors) * 24 * len(cells) > MAX_CANDIDATE_CELL_EVALUATIONS:
        anchor_step *= 2
        anchors = _wall_anchors(layout.widthM, layout.heightM, anchor_step, layout.floorPolygon)

    candidate_groups: list[list[dict[str, Any]]] = []
    candidate_group_cache: dict[str, list[dict[str, Any]]] = {}
    for spec in profiles:
        profile_key = json.dumps(spec, sort_keys=True)
        if profile_key not in candidate_group_cache:
            candidates: list[dict[str, Any]] = []
            for x, y in anchors:
                for pan in range(0, 360, 15):
                    candidates.append({**spec, "x": x, "y": y, "pan": float(pan)})
            candidate_group_cache[profile_key] = candidates
        candidates = candidate_group_cache[profile_key]
        candidate_groups.append(candidates)

    selected, coverage = optimizer.run_greedy(
        candidate_groups[0] if candidate_groups else [],
        cells,
        request.cameraBudgetK,
        camera_candidate_groups=candidate_groups,
    )
    cameras = [
        {
            "id": f"CAM-{index + 1:02}",
            **camera,
        }
        for index, camera in enumerate(selected)
    ]
    return {
        "cameras": cameras,
        "metrics": {
            "weighted_coverage_pct": coverage["weighted_coverage_pct"],
            "area_coverage_pct": coverage["area_coverage_pct"],
            "target_coverage_reached": coverage["target_coverage_reached"],
            "target_coverage_pct": 95.0,
            "cameras_used": len(cameras),
            "runtime_ms": round((time.perf_counter() - started) * 1000, 2),
            "anchor_step_m": anchor_step,
        },
    }


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/optimize")
def optimize_camera_layout(payload: OptimizeRequest) -> dict[str, Any]:
    return optimize_layout(payload)


def _safe_filename(filename: str) -> str:
    if not filename.endswith(".json"):
        filename += ".json"
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\.json", filename):
        raise HTTPException(status_code=400, detail="Tên file chỉ được chứa chữ, số, dấu chấm, gạch dưới và gạch nối.")
    if filename in {".json", "..json"}:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ.")
    return filename


@app.post("/api/v1/layouts/save")
def save_layout(
    payload: LayoutData,
    filename: str = Query(default="layout_v1.json", max_length=110),
) -> dict[str, str]:
    safe_name = _safe_filename(filename)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=DATA_DIR, suffix=".tmp", delete=False) as output:
            temporary_path = Path(output.name)
            json.dump(payload.dict(), output, ensure_ascii=False, indent=2)
        os.replace(temporary_path, DATA_DIR / safe_name)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return {"status": "success", "saved_file": safe_name}


@app.get("/api/v1/layouts/load")
def load_layout(filename: str = Query(default="layout_v1.json", max_length=110)) -> dict[str, Any]:
    safe_name = _safe_filename(filename)
    path = DATA_DIR / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Không tìm thấy file cấu hình phòng.")
    try:
        return LayoutData.parse_raw(path.read_text(encoding="utf-8-sig")).dict()
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="File cấu hình không hợp lệ.") from exc


def generate_bom_data(layout: LayoutData) -> dict[str, Any]:
    cameras = layout.cameras
    rows: list[dict[str, Any]] = []
    pos = next((o for o in layout.obstacles if o.type == "pos"), None)
    nx = pos.x + pos.w / 2 if pos else 0
    ny = pos.y + pos.h / 2 if pos else 0

    for camera in cameras:
        cable_m = math.ceil((abs(float(camera.get("x", 0)) - nx)
                             + abs(float(camera.get("y", 0)) - ny)
                             + float(camera.get("height", 2.4)) + 3) * 1.1)
        rows.append(
            {
                "id": str(camera.get("id", f"CAM-{len(rows) + 1:02}")),
                "x": float(camera.get("x", 0)),
                "y": float(camera.get("y", 0)),
                "height": float(camera.get("height", 2.4)),
                "pan": float(camera.get("pan", camera.get("pan_angle", 0))),
                "fov": float(camera.get("fov", 85)),
                "target": str(camera.get("target", "Giám sát bổ sung")),
                "model": str(camera.get("model", "Dome IP 4MP")),
                "cableM": cable_m,
            }
        )

    total_cable = sum(row["cableM"] for row in rows)
    return {
        "rows": rows,
        "totalCameras": len(rows),
        "totalCableM": total_cable,
        "totalCostVnd": len(rows) * 1_250_000 + (1_500_000 if rows else 0),
        "poePorts": len(rows),
    }


@app.post("/api/v1/bom/export")
def export_bom(
    payload: LayoutData,
    format: Literal["json", "csv", "xlsx"] = Query(default="json"),
) -> Any:
    bom = generate_bom_data(payload)
    if format == "json":
        return bom

    headers = ["Mã camera", "X (m)", "Y (m)", "Cao độ (m)", "Góc xoay (độ)",
               "FOV (độ)", "Mục tiêu", "Model", "Cáp dự kiến (m)"]
    def spreadsheet_value(value):
        if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
            return "'" + value
        return value

    rows = [[spreadsheet_value(row[key]) for key in ("id", "x", "y", "height", "pan", "fov", "target", "model", "cableM")]
            for row in bom["rows"]]
    if format == "csv":
        stream = io.StringIO()
        stream.write("\ufeff")
        writer = csv.writer(stream)
        writer.writerow(headers)
        writer.writerows(rows)
        writer.writerow(["TỔNG", "", "", "", "", "", "", f'{bom["totalCameras"]} camera', bom["totalCableM"]])
        stream.seek(0)
        return StreamingResponse(
            iter([stream.getvalue()]),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="OptiCam_BOM_Report.csv"'},
        )

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Bao_Cao_BOM"
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    sheet.append(["TỔNG", "", "", "", "", "", "", f'{bom["totalCameras"]} camera', bom["totalCableM"]])
    output = io.BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="OptiCam_BOM_Report.xlsx"'},
    )


def _heatmap(layout: LayoutData) -> dict[str, Any]:
    rows = math.floor(layout.heightM / layout.gridM + 0.5)
    cols = math.floor(layout.widthM / layout.gridM + 0.5)
    cameras = layout.cameras
    obstacles = [obstacle.dict() for obstacle in layout.obstacles]
    free_points = {(x, y) for x, y, _ in OptiCamGreedy(layout.widthM, layout.heightM, obstacles, floor_polygon=layout.floorPolygon).generate_grid(layout.gridM)}
    cells = []
    for row in range(rows):
        for col in range(cols):
            x, y = (col + 0.5) * layout.gridM, (row + 0.5) * layout.gridM
            ppm = 0.0
            solid = (x, y) not in free_points
            for source in ([] if solid else cameras):
                camera = {
                    "x": float(source.get("x", 0)),
                    "y": float(source.get("y", 0)),
                    "pan": float(source.get("pan", source.get("pan_angle", 0))),
                    "fov": float(source.get("fov", 85)),
                    "res": float(source.get("res", 2560)),
                    "height": float(source.get("height", 2.4)),
                    "range": float(source.get("range", 10)),
                }
                ppm = max(ppm, camera_ppm(camera, (x, y), obstacles, layout.targetHeight, layout.floorPolygon))
            tier = next(
                (name for threshold, name in ((250, "identification"), (125, "recognition"),
                                               (62, "observation"), (25, "detection"))
                 if ppm >= threshold),
                "blind",
            )
            cells.append({"row": row, "col": col, "x": x, "y": y, "ppm": round(ppm, 1), "dori": tier, "solid": solid})
    return {"rows": rows, "cols": cols, "cellSizeM": layout.gridM, "cells": cells}


@app.post("/api/v1/project/export")
def export_project(
    payload: ProjectExportRequest,
    download_file: bool = Query(default=False),
) -> Any:
    layout = payload.layout
    bom = generate_bom_data(layout)
    bundle = {
        "format": "opticam-bundle",
        "version": "1.0",
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "layout": layout.dict(),
        "score": payload.score,
        "bom": bom,
        "heatmap": _heatmap(layout),
    }
    if not download_file:
        return bundle
    content = json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="opticam_bundle.json"'},
    )


@app.post("/api/v1/project/import")
async def import_project(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or Path(file.filename).suffix.lower() != ".json":
        raise HTTPException(status_code=400, detail="File tải lên phải có định dạng .json.")
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File bundle vượt quá giới hạn 5 MB.")
    try:
        bundle = json.loads(raw.decode("utf-8-sig"))
        if not isinstance(bundle, dict) or bundle.get("format") != "opticam-bundle":
            raise ValueError("invalid bundle format")
        LayoutData.parse_obj(bundle.get("layout"))
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Cấu trúc file bundle không hợp lệ.") from exc
    return {
        "status": "success",
        "message": "Đã khôi phục layout OptiCam.",
        "project_bundle": bundle,
    }
