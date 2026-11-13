import json
import io
import pytest
from openpyxl import load_workbook

from fastapi.testclient import TestClient

from backend import main
from backend.greedy_optimizer import OptiCamGreedy, obstacle_risk_weight, risk_weight_at

client = TestClient(main.app)


def sample_layout() -> dict:
    return {
        "version": "1.0",
        "name": "Test room",
        "widthM": 4,
        "heightM": 3,
        "gridM": 1,
        "obstacles": [],
        "risk": {},
        "cameras": [
            {"id": "CAM-01", "x": 0, "y": 0, "pan": 45, "fov": 85, "res": 2560,
             "range": 10, "height": 2.4}
        ],
    }


def optimize_payload() -> dict:
    return {
        "cameraBudgetK": 2,
        "layout": sample_layout(),
        "grid": {"rows": 3, "cols": 4, "cellSizeM": 1},
        "riskMatrix": [[1] * 4 for _ in range(3)],
        "blockedMatrix": [[0] * 4 for _ in range(3)],
    }


def test_health_and_optimize_match_frontend_response() -> None:
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    response = client.post("/api/v1/optimize", json=optimize_payload())
    assert response.status_code == 200
    result = response.json()
    assert 0 < len(result["cameras"]) <= 2
    assert {"id", "x", "y", "pan", "fov", "res", "range", "height"} <= result["cameras"][0].keys()
    assert 0 <= result["metrics"]["area_coverage_pct"] <= 100
    assert result["metrics"]["target_coverage_pct"] == 95.0
    assert result["metrics"]["cameras_used"] == len(result["cameras"])


def test_optimize_rejects_mismatched_matrices() -> None:
    payload = optimize_payload()
    payload["riskMatrix"] = [[1]]
    assert client.post("/api/v1/optimize", json=payload).status_code == 422


def test_continuous_risk_weights_are_validated_and_used_by_api() -> None:
    assert risk_weight_at(1.75, 5, 1, 2.5) == 3
    pos = {"type": "pos", "x": 1, "y": 1, "w": 1, "h": 1, "elev": 1.1}
    assert obstacle_risk_weight((3.5, 1.5), [pos]) == 3.666666666666667

    payload = optimize_payload()
    payload["riskMatrix"][1][1] = 4.25
    response = client.post("/api/v1/optimize", json=payload)
    assert response.status_code == 200

    payload["riskMatrix"][1][1] = 5.1
    assert client.post("/api/v1/optimize", json=payload).status_code == 422


def test_shelf_craved_categories_set_configurable_default_weights() -> None:
    shelf = {"type": "shelf", "x": 2, "y": 1, "w": 0.5, "h": 0.5, "elev": 1.8}
    point = (2.75, 1.25)
    weights = {
        category: obstacle_risk_weight(point, [{**shelf, "riskCategory": category}])
        for category in ("high", "standard", "bulky")
    }
    assert weights == {"high": 4.5, "standard": 3.0, "bulky": 1.8}
    assert obstacle_risk_weight(point, [{**shelf, "riskCategory": "high", "riskWmax": 4.8}]) == 4.8
    parsed = main.Obstacle(type="shelf", x=2, y=1, w=0.5, h=0.5, riskCategory="bulky")
    assert parsed.riskCategory == "bulky"
    assert obstacle_risk_weight(point, [parsed]) == 1.8
    try:
        main.Obstacle(type="shelf", x=2, y=1, riskCategory="unknown")
    except ValueError:
        pass
    else:
        raise AssertionError("Invalid shelf risk category should be rejected")


def test_backend_grid_computes_continuous_obstacle_weights_and_last_brush_stroke() -> None:
    pos = {"type": "pos", "x": 1, "y": 1, "w": 1, "h": 1, "elev": 1.1}
    strokes = [
        {"x": 2.5, "y": 1.5, "radius": 0.4, "weight": 1},
        {"x": 2.5, "y": 1.5, "radius": 0.4, "weight": 4.25},
    ]
    optimizer = OptiCamGreedy(4, 3, [pos], risk_strokes=strokes)
    grid = optimizer.generate_grid(1)
    assert (2.5, 1.5, 4.25) in grid
    assert any(x == 3.5 and y == 1.5 and abs(weight - 3.666666666666667) < 1e-12 for x, y, weight in grid)


def test_optimize_uses_camera_profiles_and_defaults_missing_profiles() -> None:
    payload = optimize_payload()
    payload["cameraBudgetK"] = 3
    payload["cameraProfiles"] = [
        {"fov": 70, "res": 3840, "range": 8, "height": 3, "model": "Custom camera"},
        {"fov": 60, "res": 1920, "range": 14, "height": 2, "model": "Long-range camera"},
    ]

    response = client.post("/api/v1/optimize", json=payload)

    assert response.status_code == 200
    cameras = response.json()["cameras"]
    assert len(cameras) == 3
    assert {key: cameras[0][key] for key in payload["cameraProfiles"][0]} == payload["cameraProfiles"][0]
    assert {key: cameras[1][key] for key in payload["cameraProfiles"][1]} == payload["cameraProfiles"][1]
    assert {key: cameras[2][key] for key in ("fov", "res", "range", "height")} == {
        "fov": 85, "res": 2560, "range": 10, "height": 2.4
    }


def test_optimize_returns_requested_camera_budget_after_reaching_target() -> None:
    payload = optimize_payload()
    payload["cameraBudgetK"] = 3

    response = client.post("/api/v1/optimize", json=payload)

    assert response.status_code == 200
    assert len(response.json()["cameras"]) == 3


def test_optimize_returns_cameras_even_when_all_points_are_below_detection_threshold() -> None:
    payload = optimize_payload()
    payload["cameraBudgetK"] = 3
    payload["layout"].update(widthM=40, heightM=40, gridM=1)
    payload["grid"].update(rows=40, cols=40, cellSizeM=1)
    payload["cameraProfiles"] = [{"fov": 140, "res": 640, "range": 30}] * 3
    payload["riskMatrix"] = [[1] * 40 for _ in range(40)]
    payload["blockedMatrix"] = [[1] * 40 for _ in range(40)]
    payload["blockedMatrix"][20][20] = 0

    response = client.post("/api/v1/optimize", json=payload)

    assert response.status_code == 200
    result = response.json()
    assert len(result["cameras"]) == 3
    assert result["metrics"]["area_coverage_pct"] == 0


def test_optimizer_limits_candidate_work_for_large_layouts() -> None:
    payload = optimize_payload()
    payload["layout"].update(widthM=40, heightM=40, gridM=0.5)
    payload["grid"].update(rows=80, cols=80, cellSizeM=0.5)
    payload["riskMatrix"] = [[1] * 80 for _ in range(80)]
    payload["blockedMatrix"] = [[0] * 80 for _ in range(80)]

    response = client.post("/api/v1/optimize", json=payload)

    assert response.status_code == 200
    result = response.json()
    assert result["metrics"]["anchor_step_m"] > 0.5
    assert len(result["cameras"]) == 2


def test_greedy_optimizer_uses_fov_obstacles_and_fills_budget_after_target() -> None:
    optimizer = OptiCamGreedy(4, 3, [])
    grid = [(2.5, 1.5, 1)]
    candidates = [
        {"x": 0, "y": 1.5, "pan": 0, "fov": 90, "res": 2560, "range": 10, "height": 2.4},
        {"x": 4, "y": 1.5, "pan": 180, "fov": 90, "res": 2560, "range": 10, "height": 2.4},
    ]

    selected, metrics = optimizer.run_greedy(candidates, grid, camera_budget=2, target_coverage=1.0)

    assert len(selected) == 2
    assert metrics["target_coverage_reached"] is True
    assert metrics["area_coverage_pct"] == 100
    assert metrics["weighted_coverage_pct"] <= 100


def test_greedy_optimizer_line_of_sight_blocks_tall_shelves_but_not_pos() -> None:
    grid = [(3.5, 1.5, 1)]
    camera = {"x": 0, "y": 1.5, "pan": 0, "fov": 90, "res": 2560, "range": 10, "height": 2.4}
    shelf_optimizer = OptiCamGreedy(4, 3, [
        {"type": "shelf", "x": 1.5, "y": 1, "w": 0.5, "h": 1, "elev": 2.1}
    ])
    pos_optimizer = OptiCamGreedy(4, 3, [
        {"type": "pos", "x": 1.5, "y": 1, "w": 0.5, "h": 1, "elev": 1.1}
    ])

    assert shelf_optimizer.get_covered_points(0, 1.5, 10, grid, 0, 90) == set()
    assert pos_optimizer.get_covered_points(0, 1.5, 10, grid, 0, 90) == {0}


def test_target_height_changes_3d_obstruction_and_optimizer_api() -> None:
    grid = [(3.5, 1.5, 1)]
    shelf = {"type": "shelf", "x": 1.5, "y": 1, "w": 0.5, "h": 1, "elev": 1.8}
    low_camera = OptiCamGreedy(4, 3, [shelf], target_height=1.6)
    high_camera = OptiCamGreedy(4, 3, [shelf], target_height=1.6)
    assert low_camera.get_covered_points(0, 1.5, 10, grid, 0, 90, camera_height=1.8) == set()
    assert high_camera.get_covered_points(0, 1.5, 10, grid, 0, 90, camera_height=3.5) == {0}

    pos = {"type": "pos", "x": 4, "y": 1, "w": 1, "h": 1, "elev": 1.1}
    face = OptiCamGreedy(6, 3, [pos], target_height=1.6)
    waist = OptiCamGreedy(6, 3, [pos], target_height=0.9)
    assert face.get_covered_points(0, 1.5, 10, grid, 0, 90) == {0}
    assert waist.get_covered_points(0, 1.5, 10, [(5.5, 1.5, 1)], 0, 90) == set()

    payload = optimize_payload()
    payload["layout"]["targetHeight"] = 1.2
    response = client.post("/api/v1/optimize", json=payload)
    assert response.status_code == 200


def test_greedy_grid_skips_obstacle_cells_when_no_blocked_matrix_is_given() -> None:
    optimizer = OptiCamGreedy(2, 2, [
        {"type": "shelf", "start_x": 0, "start_y": 0, "end_x": 1, "end_y": 1}
    ])

    assert len(optimizer.generate_grid(1)) == 3


def test_layout_save_load_and_rejects_path_traversal(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    saved = client.post("/api/v1/layouts/save?filename=test-room", json=sample_layout())
    assert saved.status_code == 200
    assert client.get("/api/v1/layouts/load?filename=test-room.json").json()["name"] == "Test room"
    assert client.post("/api/v1/layouts/save?filename=..%5Coutside", json=sample_layout()).status_code == 400


def test_bom_csv_and_project_bundle() -> None:
    layout = sample_layout()
    csv_response = client.post("/api/v1/bom/export?format=csv", json=layout)
    assert csv_response.status_code == 200
    assert "CAM-01" in csv_response.text
    xlsx_response = client.post("/api/v1/bom/export?format=xlsx", json=layout)
    assert xlsx_response.status_code == 200
    assert xlsx_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    bundle_response = client.post("/api/v1/project/export", json={"layout": layout})
    assert bundle_response.status_code == 200
    bundle = bundle_response.json()
    assert bundle["format"] == "opticam-bundle"
    assert bundle["heatmap"]["rows"] == 3
    imported = client.post(
        "/api/v1/project/import",
        files={"file": ("layout.json", json.dumps(bundle), "application/json")},
    )
    assert imported.status_code == 200
    assert imported.json()["project_bundle"]["layout"]["name"] == "Test room"


@pytest.mark.parametrize("field,value", [("fov", 0), ("res", "invalid"), ("height", -1), ("x", 99)])
def test_export_rejects_invalid_camera_settings(field, value):
    layout = sample_layout()
    layout["cameras"][0][field] = value
    assert client.post("/api/v1/bom/export", json=layout).status_code == 422


def test_non_finite_obstacle_data_is_rejected():
    layout = sample_layout()
    layout["obstacles"] = [{"type": "shelf", "x": "NaN", "y": 1}]
    assert client.post("/api/v1/bom/export", json=layout).status_code == 422


def test_fractional_grid_rounding_matches_javascript():
    payload = optimize_payload()
    payload["layout"]["widthM"] = 4.5
    payload["grid"]["cols"] = 5
    payload["riskMatrix"] = [[1] * 5 for _ in range(3)]
    payload["blockedMatrix"] = [[0] * 5 for _ in range(3)]
    response = client.post("/api/v1/optimize", json=payload)
    assert response.status_code == 200
    assert len(OptiCamGreedy(4.5, 3, []).generate_grid(1)) == 15


def test_blocked_matrix_does_not_silently_truncate_fractional_values():
    payload = optimize_payload()
    payload["blockedMatrix"][0][0] = 0.5
    assert client.post("/api/v1/optimize", json=payload).status_code == 422


def test_dense_grid_anchor_reduction_terminates(monkeypatch):
    payload = optimize_payload()
    payload["layout"].update(widthM=40, heightM=30, gridM=0.32)
    payload["grid"].update(rows=94, cols=125, cellSizeM=0.32)
    payload["riskMatrix"] = [[1] * 125 for _ in range(94)]
    payload["blockedMatrix"] = [[0] * 125 for _ in range(94)]
    original_anchors = main._wall_anchors
    anchor_calls = 0
    def bounded_anchors(*args):
        nonlocal anchor_calls
        anchor_calls += 1
        assert anchor_calls <= 20
        return original_anchors(*args)
    monkeypatch.setattr(main, "_wall_anchors", bounded_anchors)
    # Isolate anchor reduction so this regression never needs a huge PPM matrix.
    def empty_solution(self, candidates, cells, budget, **kwargs):
        assert len(candidates) == 4 * 24
        return [], {"weighted_coverage_pct": 0, "area_coverage_pct": 0, "target_coverage_reached": False}
    monkeypatch.setattr(OptiCamGreedy, "run_greedy", empty_solution)
    assert client.post("/api/v1/optimize", json=payload).status_code == 200


def test_bundle_heatmap_excludes_solid_cells():
    layout = sample_layout()
    layout["obstacles"] = [{"id": "s", "type": "shelf", "x": 1, "y": 1, "w": 1, "h": 1, "elev": 0.1}]
    response = client.post("/api/v1/project/export", json={"layout": layout})
    assert response.status_code == 200
    cell = next(cell for cell in response.json()["heatmap"]["cells"] if cell["row"] == 1 and cell["col"] == 1)
    assert cell["solid"] is True
    assert cell["ppm"] == 0


def test_bom_spreadsheet_strings_are_literal():
    layout = sample_layout()
    layout["cameras"][0]["model"] = '=SUM(1,2)'
    csv_response = client.post("/api/v1/bom/export?format=csv", json=layout)
    assert "'=SUM(1,2)" in csv_response.text
    response = client.post("/api/v1/bom/export?format=xlsx", json=layout)
    workbook = load_workbook(io.BytesIO(response.content))
    assert workbook.active["H2"].data_type == "s"


def test_concurrent_saves_leave_complete_json(tmp_path, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    monkeypatch.setattr(main, "DATA_DIR", tmp_path)
    def save(index):
        layout = main.LayoutData(**{**sample_layout(), "name": f"revision-{index}"})
        main.save_layout(layout, filename="shared.json")
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(save, range(20)))
    saved = json.loads((tmp_path / "shared.json").read_text())
    assert saved["name"].startswith("revision-")
    assert not list(tmp_path.glob("*.tmp"))


def test_non_finite_export_metadata_is_rejected():
    response = client.post("/api/v1/project/export", content=json.dumps({"layout": sample_layout(), "score": {"weighted": float("nan")}}), headers={"Content-Type": "application/json"})
    assert response.status_code == 422


@pytest.mark.parametrize("empty_first_group", [False, True])
def test_later_camera_profiles_can_cover_a_target_the_first_profile_cannot(empty_first_group):
    optimizer = OptiCamGreedy(4, 3, [])
    invisible = {"x": 0, "y": 0, "pan": 180, "fov": 30, "res": 2560, "range": 1, "height": 2.4}
    visible = {**invisible, "pan": 45, "fov": 90, "range": 10}
    first_group = [] if empty_first_group else [invisible]
    cameras, _ = optimizer.run_greedy(first_group, [(2.5, 1.5, 1)], 2, camera_candidate_groups=[first_group, [visible]])
    assert cameras == [visible]


def test_optimizer_converts_obstacle_models_once(monkeypatch):
    calls = 0
    original = main.Obstacle.dict
    def tracked(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        return original(self, *args, **kwargs)
    obstacle = main.Obstacle(type="shelf", x=1, y=1, w=0.5, h=1)
    monkeypatch.setattr(main.Obstacle, "dict", tracked)
    optimizer = OptiCamGreedy(4, 3, [obstacle])
    points = optimizer.generate_grid(0.5)
    candidates = [{"x": 0, "y": 0, "pan": 45, "fov": 85, "range": 10, "res": 2560, "height": 2.4}]
    optimizer.run_greedy(candidates, points, 1)
    assert calls == 1
