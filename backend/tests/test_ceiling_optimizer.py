import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from backend.main import app, LayoutData, OptimizeRequest, optimize_layout, _camera_configurations, CameraProfile
from backend.greedy_optimizer import camera_ppm, OptiCamGreedy

client = TestClient(app)

def payload(mode="mixed", algorithm="hybrid"):
    return {"cameraBudgetK": 3, "layout": {"widthM":4,"heightM":3,"gridM":1,"ceilingHeight":3.6,
            "optimization":{"mounts":mode,"algorithm":algorithm},"obstacles":[],"cameras":[]},
            "grid":{"rows":3,"cols":4,"cellSizeM":1},"riskMatrix":[[1]*4 for _ in range(3)],"blockedMatrix":[[0]*4 for _ in range(3)]}

@pytest.mark.parametrize("mode", ["wall","ceiling","mixed"])
def test_installation_modes_and_monotone_local_search(mode):
    r=optimize_layout(OptimizeRequest.parse_obj(payload(mode)))
    assert len(r["cameras"])==3
    assert r["diagnostics"]["finalScore"] >= r["diagnostics"]["greedyScore"]-1e-9
    assert len({(c["mount"],c["x"],c["y"],c["pan"],c["tilt"]) for c in r["cameras"]})==3
    if mode!="mixed":
        assert all(c["mount"]==mode for c in r["cameras"])
    for c in r["cameras"]:
        if c["mount"]=="ceiling":
            assert c["height"]==pytest.approx(3.45)

def test_ceiling_projection_is_three_dimensional_and_obstructed_by_tall_fixture():
    c={"x":2,"y":2,"height":3.45,"mount":"ceiling","pan":0,"tilt":90,"fov":90,"res":1920,"range":10}
    assert camera_ppm(c,(2,2),[])==pytest.approx(1920/(2*1.85))
    assert camera_ppm({**c,"tilt":0},(2,2),[])==0
    assert camera_ppm({**c,"range":1},(2,2),[])==0
    assert camera_ppm(c,(2,2),[{"type":"shelf","x":1.5,"y":1.5,"w":1,"h":1,"elev":2}])==0

def test_low_ceiling_normalizes_camera_elevation_and_rejects_invalid_settings():
    p=payload();p["layout"].update(ceilingHeight=2.4,cameras=[{"mount":"ceiling","x":2,"y":1,"height":99,"ceilingDrop":.15}])
    # Invalid numeric camera data must be rejected, not silently accepted.
    assert client.post('/api/v1/optimize',json=p).status_code==422
    p["layout"]["cameras"][0]["height"]=3
    parsed=LayoutData.parse_obj(p["layout"])
    assert parsed.cameras[0]["height"]==pytest.approx(2.25)
    p["layout"]["optimization"]["algorithm"]="unsupported"
    assert client.post('/api/v1/optimize',json=p).status_code==422

def test_downward_camera_retains_both_rectangular_sensor_orientations():
    l=LayoutData.parse_obj(payload('ceiling')['layout'])
    c=_camera_configurations(l,CameraProfile().dict(exclude_none=True),1)
    assert {camera['pan'] for camera in c if camera['tilt']==90}==set(range(0,360,30))

def test_real_store_hybrid_improvement_and_frontend_golden_parity():
    l=json.loads((Path(__file__).parents[2]/'data_samples/ministop_50m2.json').read_text())
    l['optimization']={'algorithm':'hybrid','mounts':'mixed'}
    grid=l['gridM'];rows=round(l['heightM']/grid);cols=round(l['widthM']/grid)
    optimizer=OptiCamGreedy(l['widthM'],l['heightM'],l['obstacles'],l.get('targetHeight',1.6),l.get('riskStrokes',()),l.get('risk',{}),l.get('floorPolygon'))
    zones=optimizer.generate_grid(grid)
    lookup={(round(x,6),round(y,6)):w for x,y,w in zones}
    risk=[[lookup.get((round((c+.5)*grid,6),round((r+.5)*grid,6)),1) for c in range(cols)] for r in range(rows)]
    blocked=[[int((round((c+.5)*grid,6),round((r+.5)*grid,6)) not in lookup) for c in range(cols)] for r in range(rows)]
    p={'cameraBudgetK':3,'layout':l,'grid':{'rows':rows,'cols':cols,'cellSizeM':grid},'riskMatrix':risk,'blockedMatrix':blocked}
    r=optimize_layout(OptimizeRequest.parse_obj(p))
    assert r['diagnostics']['iterations']==4
    assert r['diagnostics']['finalScore']==pytest.approx(508.17339711675044)
    assert r['diagnostics']['finalScore']>r['diagnostics']['greedyScore']
    assert [(c['mount'],c['x'],c['y'],c['pan'],c['tilt']) for c in r['cameras']]==[
        ('wall',7.5,0,120,35),('ceiling',1.4166666666666667,5.5,330,35),('wall',4.5,0,150,20)]


def test_kpi_hybrid_mode_and_frontend_golden_parity():
    l=json.loads((Path(__file__).parents[2]/'data_samples/circle_k_75m2.json').read_text())
    l['optimization']={'algorithm':'kpi_hybrid','mounts':'mixed'}
    grid=l['gridM'];rows=round(l['heightM']/grid);cols=round(l['widthM']/grid)
    optimizer=OptiCamGreedy(l['widthM'],l['heightM'],l['obstacles'],l.get('targetHeight',1.6),l.get('riskStrokes',()),l.get('risk',{}),l.get('floorPolygon'))
    zones=optimizer.generate_grid(grid)
    lookup={(round(x,6),round(y,6)):w for x,y,w in zones}
    risk=[[lookup.get((round((c+.5)*grid,6),round((r+.5)*grid,6)),1) for c in range(cols)] for r in range(rows)]
    blocked=[[int((round((c+.5)*grid,6),round((r+.5)*grid,6)) not in lookup) for c in range(cols)] for r in range(rows)]
    p={'cameraBudgetK':3,'layout':l,'grid':{'rows':rows,'cols':cols,'cellSizeM':grid},'riskMatrix':risk,'blockedMatrix':blocked}
    r=optimize_layout(OptimizeRequest.parse_obj(p))
    assert r['diagnostics']['algorithm']=='kpi_hybrid'
    assert r['diagnostics']['finalScore']==pytest.approx(655.8522728639972)
    assert [(c['mount'],round(c['x'],4),c['y'],c['pan'],c['tilt']) for c in r['cameras']]==[
        ('ceiling',5.2885,5.5,210,35),('ceiling',12.0192,5.5,240,35),('ceiling',4.3269,5.5,330,35)]
    resp = client.post('/api/v1/optimize', json=p)
    assert resp.status_code == 200
    assert resp.json()['diagnostics']['finalScore'] == pytest.approx(655.8522728639972)


def test_ceiling_installation_metadata_and_pitch_survive_bom_and_heatmap_export():
    import csv, io
    from openpyxl import load_workbook
    l=payload()["layout"]
    l["cameras"]=[{"id":"C-CEILING","x":1.5,"y":1.5,"mount":"ceiling","tilt":90,"vfov":20}]
    bundle=client.post('/api/v1/project/export',json={"layout":l}).json()
    assert bundle['bom']['rows'][0]['mount']=='ceiling'
    assert bundle['bom']['rows'][0]['tilt']==90
    center=next(c for c in bundle['heatmap']['cells'] if c['row']==1 and c['col']==1)
    assert center['ppm']>250
    l['cameras'][0]['tilt']=0
    other=client.post('/api/v1/project/export',json={"layout":l}).json()
    assert next(c for c in other['heatmap']['cells'] if c['row']==1 and c['col']==1)['ppm']==0
    rows=list(csv.reader(io.StringIO(client.post('/api/v1/bom/export?format=csv',json=l).text.lstrip('\ufeff'))))
    assert len(rows[0])==len(rows[1])==len(rows[2])==11
    assert rows[1][4:7]==['ceiling','0.0','0.0']
    workbook=load_workbook(io.BytesIO(client.post('/api/v1/bom/export?format=xlsx',json=l).content))
    assert workbook.active.cell(2,5).value=='ceiling'
    assert workbook.active.max_column==11
