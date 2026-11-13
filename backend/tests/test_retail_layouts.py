import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.footprint import point_in_floor, segment_in_floor, segment_distance
from backend.greedy_optimizer import OptiCamGreedy, camera_ppm

SAMPLES = Path(__file__).resolve().parents[2] / 'data_samples'
RETAIL = sorted(SAMPLES.glob('vn_*.json'))


@pytest.mark.parametrize('path', RETAIL, ids=lambda path: path.stem)
def test_retail_layout_preserves_fixture_and_boundary_metadata(path):
    raw = json.loads(path.read_text())
    layout = main.LayoutData.parse_obj(raw)
    assert len(layout.cameras) >= 4
    assert layout.dict()['obstacles'][0]['id'] == raw['obstacles'][0]['id']
    assert any(obstacle.dict().get('fixture') == 'wall-shelf' for obstacle in layout.obstacles)
    cells = OptiCamGreedy(layout.widthM, layout.heightM, layout.obstacles,
                         floor_polygon=layout.floorPolygon).generate_grid(layout.gridM)
    if layout.floorPolygon:
        assert all(point_in_floor((x,y),layout.floorPolygon) for x,y,_ in cells)
        assert len(cells) < round(layout.widthM / layout.gridM) * round(layout.heightM / layout.gridM)


def test_l_shape_blocks_view_across_the_missing_corner():
    polygon = [(0,0),(10,0),(10,4),(6,4),(6,9),(0,9)]
    camera = dict(x=9,y=3,height=2.8,range=18,pan=135,fov=100,res=2560)
    assert not segment_in_floor((9,3),(5,8),polygon)
    assert camera_ppm(camera,(5,8),[],1.6,polygon) == 0
    assert (6,6) in main._wall_anchors(10,9,.5,polygon)


def test_polygon_export_excludes_the_exterior_and_keeps_roles():
    raw = json.loads((SAMPLES / 'vn_chu_l_70m2.json').read_text())
    client = TestClient(main.app)
    response = client.post('/api/v1/project/export',json={'layout':raw})
    assert response.status_code == 200
    bundle = response.json()
    assert bundle['layout']['floorPolygon'] == raw['floorPolygon']
    cells = bundle['heatmap']['cells']
    assert all(cell['solid'] and cell['ppm'] == 0 for cell in cells if cell['x'] > 6 and cell['y'] > 4)


@pytest.mark.parametrize('polygon', [ [[0,0],[10,9],[10,0],[0,9]], [[0,0],[11,0],[0,9]], [[0,0],[0,0],[10,9]] ])
def test_reject_invalid_polygon(polygon):
    raw=json.loads((SAMPLES / 'vn_chu_l_70m2.json').read_text())
    raw['floorPolygon']=polygon
    with pytest.raises(ValueError):
        main.LayoutData.parse_obj(raw)


def test_polygon_optimizer_respects_real_walls_even_with_forged_open_matrix():
    raw=json.loads((SAMPLES / 'vn_chu_l_70m2.json').read_text())
    # Small sampling grid keeps this integration regression fast.
    raw['gridM']=1
    rows,cols=9,10
    request=main.OptimizeRequest.parse_obj(dict(layout=raw,cameraBudgetK=1,
        grid=dict(rows=rows,cols=cols,cellSizeM=1),riskMatrix=[[1]*cols for _ in range(rows)],blockedMatrix=[[0]*cols for _ in range(rows)]))
    result=main.optimize_layout(request)
    assert len(result['cameras'])==1
    camera=result['cameras'][0]
    polygon=raw['floorPolygon']
    assert point_in_floor((camera['x'],camera['y']),polygon)
    assert min(segment_distance((camera['x'],camera['y']),a,polygon[(i+1)%len(polygon)]) for i,a in enumerate(polygon)) < 1e-6
