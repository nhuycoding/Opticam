import json

from fastapi.testclient import TestClient

from backend import main
from backend.greedy_optimizer import OptiCamGreedy

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


def test_greedy_optimizer_uses_fov_obstacles_and_stops_at_target() -> None:
    optimizer = OptiCamGreedy(4, 3, [])
    grid = [(2.5, 1.5, 1)]
    candidates = [
        {"x": 0, "y": 1.5, "pan": 0, "fov": 90, "res": 2560, "range": 10, "height": 2.4},
        {"x": 4, "y": 1.5, "pan": 180, "fov": 90, "res": 2560, "range": 10, "height": 2.4},
    ]

    selected, metrics = optimizer.run_greedy(candidates, grid, camera_budget=2, target_coverage=1.0)

    assert len(selected) == 1
    assert metrics["target_coverage_reached"] is True
    assert metrics["area_coverage_pct"] == 100
    assert metrics["weighted_coverage_pct"] <= 100


def test_greedy_optimizer_line_of_sight_blocks_tall_shelves_but_not_pos() -> None:
    grid = [(3.5, 1.5, 1)]
    camera = {"x": 0, "y": 1.5, "pan": 0, "fov": 90, "res": 2560, "range": 10, "height": 2.4}
    shelf_optimizer = OptiCamGreedy(4, 3, [
        {"type": "shelf", "x": 1.5, "y": 1, "w": 0.5, "h": 1, "elev": 1.8}
    ])
    pos_optimizer = OptiCamGreedy(4, 3, [
        {"type": "pos", "x": 1.5, "y": 1, "w": 0.5, "h": 1, "elev": 1.1}
    ])

    assert shelf_optimizer.get_covered_points(0, 1.5, 10, grid, 0, 90) == set()
    assert pos_optimizer.get_covered_points(0, 1.5, 10, grid, 0, 90) == {0}


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


def test_bom_reports_camera_power_and_recommended_poe_budget() -> None:
    layout = sample_layout()
    layout["obstacles"] = [
        {"id": "pos", "type": "pos", "x": 1, "y": 1, "w": 2, "h": 1, "elev": 1.1}
    ]
    layout["cameras"] = [
        {"id": "CAM-01", "x": 0, "y": 0, "height": 3, "powerW": 14.5},
        {"id": "CAM-02", "x": 4, "y": 1.5, "height": 2.4},
    ]

    response = client.post("/api/v1/bom/export", json=layout)

    assert response.status_code == 200
    bom = response.json()
    assert [row["cableM"] for row in bom["rows"]] == [11, 9]
    assert [row["powerW"] for row in bom["rows"]] == [14.5, 12.0]
    assert bom["totalCableM"] == 20
    assert bom["totalCameraPowerW"] == 26.5
    assert bom["recommendedPoeBudgetW"] == 32
    assert bom["poePorts"] == 2


def test_bom_rejects_non_positive_camera_power() -> None:
    layout = sample_layout()
    layout["cameras"][0]["powerW"] = 0

    assert client.post("/api/v1/bom/export", json=layout).status_code == 422


def test_bom_csv_includes_camera_power_column() -> None:
    response = client.post("/api/v1/bom/export?format=csv", json=sample_layout())

    assert response.status_code == 200
    assert "Công suất PoE (W)" in response.text
    assert "12.0" in response.text
