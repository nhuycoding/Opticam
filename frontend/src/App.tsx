import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { OptiCamCanvas } from './components/canvas/OptiCamCanvas';
import { DORI_COLOR, priorityBand, type PriorityBand, type Segment, type Selection, type Tool, type ViewMode } from './components/canvas/shared';
import { Inspector } from './components/Inspector';
import { BomModal } from './components/BomModal';
import { Scorecard, type RiskMetrics } from './components/Scorecard';
import { PRESETS, withManualCams } from './data/presets';
import { buildZones, evaluate, RISK_DEFAULTS, SHELF_RISK_PROFILES } from './core/optics';
import { greedyPlace, makeCamera, manualFourCorners, minimumCamerasForTargets } from './core/optimizer';
import { requestOptimize } from './core/api';
import { addObstacle, removeObstacle, resizeObstacle, resizeRoom } from './core/editor';
import { exportBundle, download, parseBundle } from './core/io';
import { placeObstacle, satCollide, obsPoly, snapAngle, wallAnchors } from './core/geometry';
import { canPlacePerson } from './core/person';
import type { Camera, Layout, Obstacle, ObsType, Person, RiskStroke, Score, ShelfRiskCategory, Weight } from './types';

const MAX_CAMS = 20;
type EditorSnapshot = { layout: Layout; people: Person[] };

export default function App() {
  const [layout, setLayout] = useState<Layout>(() => withManualCams(PRESETS[0]));
  const [view, setView] = useState<ViewMode>('dori');
  const [brush, setBrush] = useState<Weight | null>(null);
  const [riskFilter, setRiskFilter] = useState<PriorityBand | null>(null);
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [grid, setGrid] = useState(true), [anchors, setAnchors] = useState(false), [bom, setBom] = useState(false);
  const [solveMs, setSolveMs] = useState(0), [renderMs, setRenderMs] = useState(0), [unweighted, setUnweighted] = useState<Score | null>(null);
  const [msg, setMsg] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [undoReady, setUndoReady] = useState(false), [redoReady, setRedoReady] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('select'), [measure, setMeasure] = useState<Segment>(null);
  const stageRef = useRef<Konva.Stage>(null), drawMsRef = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshot = useMemo(() => ({ layout, people }), [layout, people]);
  const history = useRef({
    past: [] as EditorSnapshot[],
    future: [] as EditorSnapshot[],
    last: null as EditorSnapshot | null,
    pendingBefore: null as EditorSnapshot | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    ignoreNext: false
  });

  useEffect(() => {
    const h = history.current;
    if (!h.last) {
      h.last = snapshot;
      return;
    }
    if (h.ignoreNext) {
      h.ignoreNext = false;
      h.last = snapshot;
      return;
    }
    if (h.last === snapshot) return;
    if (h.timer === null) h.pendingBefore = h.last;
    h.last = snapshot;
    if (h.timer !== null) clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      if (h.pendingBefore) h.past.push(h.pendingBefore);
      if (h.past.length > 50) h.past.shift();
      h.future = [];
      h.pendingBefore = null;
      h.timer = null;
      setUndoReady(h.past.length > 0);
      setRedoReady(false);
    }, 500);
  }, [snapshot]);
  useEffect(() => () => {
    if (history.current.timer !== null) clearTimeout(history.current.timer);
    if (messageTimer.current !== null) clearTimeout(messageTimer.current);
  }, []);

  const zones = useMemo(() => buildZones(layout), [layout.obstacles, layout.risk, layout.riskStrokes, layout.widthM, layout.heightM, layout.gridM]);
  const { cells, score } = useMemo(() => evaluate(layout, zones), [layout.cameras, zones, layout.obstacles, layout.targetHeight]);
  const manual = useMemo(() => evaluate({ ...layout, cameras: manualFourCorners(layout) }, zones).score, [zones, layout.obstacles, layout.targetHeight]);
  const riskMetrics = useMemo<RiskMetrics>(() => {
    const openCells = cells.filter((cell) => !cell.solid);
    const totals = { low: 0, medium: 0, high: 0 };
    const high = openCells.filter((cell) => priorityBand(cell.w) === 'high');
    const uncovered = high.filter((cell) => cell.ppm <= 0);
    for (const cell of openCells) totals[priorityBand(cell.w)]++;
    const percent = (count: number) => openCells.length ? Math.round((count / openCells.length) * 100) : 0;
    return {
      lowPercent: percent(totals.low), mediumPercent: percent(totals.medium), highPercent: percent(totals.high),
      highCoverage: high.length ? Math.round(((high.length - uncovered.length) / high.length) * 100) : null,
      highTotal: high.length, uncoveredHigh: uncovered.length,
      firstUncovered: uncovered.length ? { r: uncovered[0].r, c: uncovered[0].c } : null
    };
  }, [cells]);

  const flash = (t: string) => {
    if (messageTimer.current !== null) clearTimeout(messageTimer.current);
    setMsg(t);
    messageTimer.current = setTimeout(() => { setMsg(''); messageTimer.current = null; }, 4000);
  };
  const closeBom = useCallback(() => setBom(false), []);
  const patch = (p: Partial<Layout>) => setLayout((l) => ({ ...l, ...p }));
  const resetHistory = (nextLayout: Layout, nextPeople: Person[] = []) => {
    const h = history.current;
    if (h.timer !== null) clearTimeout(h.timer);
    h.past = []; h.future = []; h.pendingBefore = null; h.timer = null;
    h.last = { layout: nextLayout, people: nextPeople }; h.ignoreNext = true;
    setUndoReady(false); setRedoReady(false);
  };
  const loadLayout = (l: Layout) => {
    if (!window.confirm('Thay layout hiện tại? Các thay đổi chưa xuất sẽ bị mất.')) return false;
    resetHistory(l); setLayout(l); setPeople([]); setSel(null); setUnweighted(null); setSolveMs(0);
    return true;
  };
  const undo = () => {
    const h = history.current;
    if (h.timer !== null) {
      clearTimeout(h.timer); h.timer = null;
      if (h.pendingBefore) h.past.push(h.pendingBefore);
      if (h.past.length > 50) h.past.shift();
      h.pendingBefore = null;
    }
    const previous = h.past.pop();
    if (!previous) return;
    h.future.push(snapshot); h.last = previous; h.ignoreNext = true;
    setLayout(previous.layout); setPeople(previous.people);
    setUndoReady(h.past.length > 0); setRedoReady(true);
  };
  const redo = () => {
    const h = history.current, next = h.future.pop();
    if (!next) return;
    h.past.push(snapshot); h.last = next; h.ignoreNext = true;
    setLayout(next.layout); setPeople(next.people);
    setUndoReady(true); setRedoReady(h.future.length > 0);
  };

  // useCallback([]) để React.memo của CameraNode/ObstacleNode không render lại thừa
  const updateCamera = useCallback((c: Camera) => setLayout((l) => ({ ...l, cameras: l.cameras.map((x) => (x.id === c.id ? c : x)) })), []);
  const updateObstacle = useCallback((o: Obstacle) => setLayout((l) => ({ ...l, obstacles: l.obstacles.map((x) => (x.id === o.id ? o : x)) })), []);
  const updatePerson = useCallback((person: Person) => setPeople((current) => current.map((item) => item.id === person.id ? person : item)), []);
  const paint = useCallback((strokes: RiskStroke[]) => setLayout((l) => ({ ...l, riskStrokes: [...l.riskStrokes, ...strokes] })), []);
  const select = useCallback((s: Selection) => setSel(s), []);

  const addObs = (t: ObsType) => {
    const r = addObstacle(layout, t);
    if (!r) return flash('Không còn chỗ trống cho khối này');
    setLayout(r); setSel({ kind: 'obs', id: r.obstacles[r.obstacles.length - 1].id }); setTool('select');
  };
  const editObstacle = (id: string, pt: Partial<Pick<Obstacle, 'label' | 'elev' | 'w' | 'h' | 'riskCategory' | 'riskWmax' | 'riskR0' | 'riskR'>>) =>
    setLayout((l) => {
      const o = l.obstacles.find((x) => x.id === id); if (!o) return l;
      const { w, h, ...rest } = pt;
      if (pt.riskCategory !== undefined) {
        rest.riskCategory = pt.riskCategory;
        if (pt.riskCategory !== 'custom' && pt.riskWmax === undefined) {
          rest.riskWmax = SHELF_RISK_PROFILES[pt.riskCategory].wmax;
        }
      }
      if (pt.riskWmax !== undefined) {
        rest.riskWmax = Math.max(1, Math.min(5, pt.riskWmax));
        if (o.type === 'shelf' && pt.riskCategory === undefined) rest.riskCategory = 'custom';
      }
      if (pt.riskR0 !== undefined) {
        rest.riskR0 = Math.max(0, pt.riskR0);
        if ((pt.riskR ?? o.riskR ?? RISK_DEFAULTS[o.type].radius) <= rest.riskR0) rest.riskR = rest.riskR0 + 0.1;
      }
      if (pt.riskR !== undefined) rest.riskR = Math.max((pt.riskR0 ?? o.riskR0 ?? RISK_DEFAULTS[o.type].r0) + 0.1, pt.riskR);
      const l2 = { ...l, obstacles: l.obstacles.map((x) => (x.id === id ? { ...x, ...rest } : x)) };
      return w !== undefined || h !== undefined ? resizeObstacle(l2, id, w ?? o.w, h ?? o.h) : l2;
    });
  const editCamera = (id: string, pt: Partial<Pick<Camera, 'fov' | 'res' | 'height' | 'pan' | 'range' | 'model'>>) =>
    setLayout((l) => ({
      ...l,
      cameras: l.cameras.map((c) => (c.id === id
        ? {
          ...c,
          ...pt,
          ...(pt.pan !== undefined ? { pan: snapAngle(pt.pan) } : {}),
          ...(pt.fov !== undefined ? { fov: Math.max(30, Math.min(140, pt.fov)) } : {}),
          ...(pt.res !== undefined ? { res: Math.max(640, Math.min(7680, pt.res)) } : {}),
          ...(pt.range !== undefined ? { range: Math.max(1, Math.min(30, pt.range)) } : {}),
          ...(pt.height !== undefined ? { height: Math.max(1.8, Math.min(4, pt.height)) } : {})
        }
        : c))
    }));
  const setRoom = (w: number, h: number) => { setLayout((l) => resizeRoom(l, w, h)); setUnweighted(null); };
  const calibrate = (real: number) => {
    if (!measure || !layout.background) return;
    const len = Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]);
    patch({ background: { ...layout.background, widthM: Math.round(((layout.background.widthM * real) / len) * 100) / 100 } });
    setMeasure(null); flash('Đã hiệu chuẩn tỷ lệ ảnh nền');
  };

  const rotate = (dir: 1 | -1) => {
    if (sel?.kind === 'cam') setLayout((l) => ({ ...l, cameras: l.cameras.map((c) => (c.id === sel.id ? { ...c, pan: snapAngle(c.pan + dir * 15) } : c)) }));
    if (sel?.kind === 'obs') setLayout((l) => {
      const o = l.obstacles.find((x) => x.id === sel.id); if (!o || o.type === 'entrance') return l;
      const n = placeObstacle({ ...o, angle: snapAngle(o.angle + dir * 15) }, o.x + o.w / 2, o.y + o.h / 2, l.widthM, l.heightM, l.gridM);
      return l.obstacles.some((q) => q.id !== o.id && satCollide(obsPoly(n), obsPoly(q))) ? l : { ...l, obstacles: l.obstacles.map((x) => (x.id === o.id ? n : x)) };
    });
  };
  const addCamera = () => setLayout((l) => {
    if (l.cameras.length >= MAX_CAMS) return l;
    const used = new Set(l.cameras.map((c) => `${c.x}_${c.y}`));
    const [x, y] = wallAnchors(l.widthM, l.heightM, l.gridM).find(([ax, ay]) => !used.has(`${ax}_${ay}`)) ?? [0, 0];
    const pan = (Math.atan2(l.heightM / 2 - y, l.widthM / 2 - x) * 180) / Math.PI;
    return { ...l, cameras: [...l.cameras, { ...makeCamera(`CAM-${String(l.cameras.length + 1).padStart(2, '0')}`, x, y, pan), target: 'Giám sát bổ sung' }] };
  });
  const addPerson = (x: number, y: number) => {
    if (!canPlacePerson(x, y, layout.widthM, layout.heightM, layout.obstacles)) return flash('Không thể đặt người sát tường hoặc chồng lên vật cản');
    const used = new Set(people.map((person) => person.id));
    let index = 1;
    while (used.has(`PERSON-${String(index).padStart(2, '0')}`)) index++;
    const person = { id: `PERSON-${String(index).padStart(2, '0')}`, x, y };
    setPeople((current) => [...current, person]);
    setSel({ kind: 'person', id: person.id });
    setTool('select');
  };
  const deleteSelected = () => {
    if (!sel) return;
    if (sel.kind === 'cam' && layout.cameras.length === 1) {
      flash('Phải giữ ít nhất một camera');
      return;
    }
    if (!window.confirm(`Xóa ${sel.kind === 'cam' ? 'camera' : sel.kind === 'obs' ? 'vật thể' : 'người'} đã chọn?`)) return;
    if (sel.kind === 'cam') setLayout((l) => ({ ...l, cameras: l.cameras.filter((c) => c.id !== sel.id) }));
    if (sel?.kind === 'obs') setLayout((l) => removeObstacle(l, sel.id));
    if (sel?.kind === 'person') setPeople((current) => current.filter((person) => person.id !== sel.id));
    setSel(null);
  };

  const cameraProfilesFor = (count: number) => Array.from({ length: count }, (_, index) =>
    layout.cameras[index] ?? makeCamera(`CAM-0${index + 1}`, 0, 0, 0)
  );
  const autoOptimize = async (count = 3) => {
    if (optimizing) return;
    if (messageTimer.current !== null) { clearTimeout(messageTimer.current); messageTimer.current = null; }
    setOptimizing(true);
    setMsg(`Đang tối ưu vị trí cho tối đa ${count} camera…`);
    const t0 = performance.now();
    const cameraProfiles = cameraProfilesFor(count);
    try {
      const { cameras, source } = await requestOptimize(layout, zones, count, cameraProfiles);
      const t1 = performance.now();
      setLayout((l) => ({ ...l, cameras })); setSolveMs(t1 - t0);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setRenderMs(performance.now() - t1);
        flash(`Đã tối ưu: ${cameras.length}/${count} camera · ${source === 'api' ? 'Backend' : 'chạy dự phòng trên trình duyệt'}`);
      }));
    } catch (error) {
      flash(`Tối ưu thất bại: ${(error as Error).message}`);
    } finally {
      setOptimizing(false);
    }
  };
  const minimizeCameras = async () => {
    if (optimizing) return;
    if (messageTimer.current !== null) { clearTimeout(messageTimer.current); messageTimer.current = null; }
    setOptimizing(true);
    setMsg('Đang tìm số camera ít nhất đạt KPI Đỏ ≥95% và Vàng ≥80%…');
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const t0 = performance.now();
    const cameraProfiles = cameraProfilesFor(layout.cameras.length);
    try {
      const result = minimumCamerasForTargets(layout, zones, cameraProfiles);
      const t1 = performance.now();
      setLayout((current) => ({ ...current, cameras: result.cameras }));
      setSolveMs(t1 - t0);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setRenderMs(performance.now() - t1);
        const status = result.metTargets ? 'Đạt KPI' : 'Chưa đạt đủ KPI';
        flash(`${status}: giữ ${result.cameras.length}/${cameraProfiles.length} camera · Đỏ ${result.red}% · Vàng ${result.yellow}%`);
      }));
    } catch (error) {
      flash(`Tìm số camera thất bại: ${(error as Error).message}`);
    } finally {
      setOptimizing(false);
    }
  };
  const runUnweighted = () => {
    const count = layout.cameras.length;
    const cameraProfiles = cameraProfilesFor(count).map(({ fov, res, range, height, model }) => ({ fov, res, range, height, model }));
    setUnweighted(evaluate({ ...layout, cameras: greedyPlace(layout, zones, count, false, { cameraProfiles }) }, zones).score);
  };
  const stress = () => setLayout((l) => ({ ...l, cameras: Array.from({ length: MAX_CAMS }, (_, i) => { const a = wallAnchors(l.widthM, l.heightM, l.gridM); const [x, y] = a[Math.floor((i * a.length) / MAX_CAMS)]; return makeCamera(`CAM-${String(i + 1).padStart(2, '0')}`, x, y, (Math.atan2(l.heightM / 2 - y, l.widthM / 2 - x) * 180) / Math.PI); }) }));

  const savePng = async () => {
    if (!stageRef.current) return;
    download('opticam_canvas.png', await (await fetch(stageRef.current.toDataURL({ pixelRatio: 2 }))).blob());
  };
  const benchmark = async () => {
    stress(); setBrush(null); setTool('select');
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
    await frame(); await frame();
    const dts: number[] = []; let last = await frame();
    for (let f = 0; f < 120; f++) {
      const now = await frame(); dts.push(now - last); last = now;
      setLayout((l) => ({ ...l, cameras: l.cameras.map((c, i) => ({ ...c, pan: snapAngle(c.pan + (f % 3 === i % 3 ? 15 : 0)) })) }));
    }
    const mean = dts.reduce((a, b) => a + b, 0) / dts.length, p95 = [...dts].sort((a, b) => a - b)[Math.floor(dts.length * 0.95)];
    flash(`20 camera × 120 khung: ${(1000 / mean).toFixed(0)} FPS TB · p95 ${p95.toFixed(1)} ms · vẽ heatmap ${drawMsRef.current.toFixed(1)} ms`);
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>, kind: 'json' | 'bg') => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        if (kind === 'json') {
          if (loadLayout(parseBundle(String(rd.result)))) flash('Đã nạp layout');
        }
        else patch({ background: { dataUrl: String(rd.result), widthM: layout.widthM, opacity: 0.5, visible: true } });
      } catch (err) { flash(`Lỗi: ${(err as Error).message}`); }
    };
    kind === 'json' ? rd.readAsText(f) : rd.readAsDataURL(f);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 'escape') setBom(false); else if (k === 'b') setBom((v) => !v); else if (k === 'o') autoOptimize();
      else if (k === 'g') setGrid((v) => !v); else if (k === 'a') setAnchors((v) => !v); else if (k === 'c') addCamera();
      else if (k === 'r') rotate(1); else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (['1', '2', '3'].includes(k)) loadLayout(withManualCams(PRESETS[+k - 1]));
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const bg = layout.background;
  const selectedPreset = PRESETS.findIndex((preset) => preset.name === layout.name);
  return (
    <div className="app">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></div>
          <div>
            <span className="eyebrow">THIẾT KẾ GIÁM SÁT BÁN LẺ</span>
            <h1>OptiCam <span>Studio</span></h1>
          </div>
        </div>
        <div className="project-controls">
          <label className="project-picker">
            <span className="eyebrow">MẶT BẰNG ĐANG MỞ</span>
            <select
              aria-label="Chọn mặt bằng cửa hàng"
              value={selectedPreset < 0 ? '' : selectedPreset}
              onChange={(event) => {
                const preset = PRESETS[Number(event.target.value)];
                if (preset) loadLayout(withManualCams(preset));
              }}
            >
              {selectedPreset < 0 && <option value="">Layout tùy chỉnh</option>}
              {PRESETS.map((preset, index) => <option key={preset.name} value={index}>{preset.name}</option>)}
            </select>
          </label>
          <div className="project-meta">
            <strong>{layout.widthM} × {layout.heightM} m</strong>
            <span>{layout.widthM * layout.heightM} m² <i /> Lưới {layout.gridM} m</span>
          </div>
          <div className="history-actions" aria-label="Lịch sử chỉnh sửa">
            <button onClick={undo} disabled={!undoReady} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác">↶</button>
            <button onClick={redo} disabled={!redoReady} title="Làm lại (Ctrl+Y)" aria-label="Làm lại">↷</button>
          </div>
        </div>
        <div className="header-actions">
          <button className="primary optimize-button" onClick={() => autoOptimize()} disabled={optimizing}>
            {optimizing ? <><span className="spinner" aria-hidden="true" /> Đang tối ưu…</> : <>Tối ưu vị trí <span>· 3 camera</span></>}
          </button>
          <details className="optimize-menu">
            <summary aria-label="Tùy chọn tối ưu camera" title="Tùy chọn tối ưu">⌄</summary>
            <div className="menu-popover">
              <span className="eyebrow">MỤC TIÊU ĐỀ XUẤT</span>
              <p>Đỏ ≥95% <i /> Vàng ≥80%</p>
              <button onClick={() => autoOptimize(layout.cameras.length)} disabled={optimizing || layout.cameras.length < 1 || layout.cameras.length > MAX_CAMS}>
                Tối ưu {layout.cameras.length} camera hiện có
              </button>
              <button onClick={minimizeCameras} disabled={optimizing || layout.cameras.length < 1 || layout.cameras.length > MAX_CAMS}>
                Tìm số camera ít nhất đạt KPI
              </button>
            </div>
          </details>
          <span className="header-divider" />
          <button onClick={() => setBom(true)}>BOM</button>
          <button onClick={() => download('opticam_layout.json', exportBundle(layout, score))}>Xuất JSON</button>
        </div>
      </header>

      <main className="planner">
        <nav className={`tool-rail${toolsOpen ? ' is-open' : ''}`} aria-label="Công cụ mặt bằng">
          <span className="rail-label">CÔNG CỤ</span>
          <button className={`rail-button${tool === 'select' && brush === null ? ' active' : ''}`} aria-pressed={tool === 'select' && brush === null} title="Chọn và kéo đối tượng" onClick={() => { setBrush(null); setTool('select'); }}>
            <span aria-hidden="true">↖</span><small>Chọn</small>
          </button>
          <button className="rail-button" title="Thêm camera" onClick={addCamera}><span aria-hidden="true">◉</span><small>Camera</small></button>
          <button className="rail-button" title="Thêm kệ hàng" onClick={() => addObs('shelf')}><span aria-hidden="true">▤</span><small>Kệ hàng</small></button>
          <button className="rail-button" title="Thêm quầy POS" onClick={() => addObs('pos')}><span aria-hidden="true">▰</span><small>Quầy POS</small></button>
          <button className="rail-button" title="Thêm cửa ra vào" onClick={() => addObs('entrance')}><span aria-hidden="true">⇥</span><small>Cửa</small></button>
          <button className={`rail-button${tool === 'person' ? ' active' : ''}`} aria-pressed={tool === 'person'} title="Đặt người để đánh giá DORI" onClick={() => { setTool(tool === 'person' ? 'select' : 'person'); setBrush(null); }}>
            <span aria-hidden="true">♙</span><small>Đánh giá</small>
          </button>
          <button className={`rail-button${tool === 'measure' ? ' active' : ''}`} aria-pressed={tool === 'measure'} title="Đo khoảng cách" onClick={() => { setTool(tool === 'measure' ? 'select' : 'measure'); setBrush(null); setMeasure(null); }}>
            <span aria-hidden="true">↔</span><small>Đo</small>
          </button>
          <span className="rail-divider" />
          <span className="rail-label">ƯU TIÊN</span>
          {([5, 3, 1] as Weight[]).map((weight) => (
            <button key={weight} className={`rail-button risk-tool${brush === weight ? ' active' : ''}`} aria-pressed={brush === weight} title={`Tô vùng ưu tiên W = ${weight}`} onClick={() => { setBrush(brush === weight ? null : weight); setTool('select'); setView('risk'); }}>
              <span className={`risk-dot risk-${weight}`} aria-hidden="true" /><small>W {weight}</small>
            </button>
          ))}
          <button className="rail-button rail-clear" title="Xóa vùng rủi ro đã tô" disabled={!layout.riskStrokes.length && !Object.keys(layout.risk).length} onClick={() => {
            if ((layout.riskStrokes.length || Object.keys(layout.risk).length) && window.confirm('Xóa toàn bộ vùng rủi ro đã tô bằng cọ?')) patch({ risk: {}, riskStrokes: [] });
          }}><span aria-hidden="true">⌫</span><small>Xóa cọ</small></button>
        </nav>

        <section className="workspace" aria-label="Không gian thiết kế">
          <div className="workspace-heading">
            <div>
              <span className="eyebrow">KHÔNG GIAN THIẾT KẾ</span>
              <h2>{layout.name}</h2>
            </div>
            <div className="workspace-summary">
              <span>{layout.cameras.length} camera</span>
              <span>{layout.widthM * layout.heightM} m²</span>
              <span className="live-indicator"><i /> Trực tiếp</span>
            </div>
          </div>
          <div className="workspace-controls">
            <div className="layer-switch" role="group" aria-label="Lớp phân tích">
              <span className="toolbar-heading">LỚP PHÂN TÍCH</span>
              {(['dori', 'risk', 'off'] as ViewMode[]).map((mode) => (
                <button key={mode} className={view === mode ? 'on' : ''} aria-pressed={view === mode} onClick={() => setView(mode)}>
                  <i aria-hidden="true">{{ dori: '◉', risk: '◈', off: '○' }[mode]}</i>
                  {{ dori: 'DORI', risk: 'Rủi ro', off: 'Tắt lớp phủ' }[mode]}
                </button>
              ))}
            </div>
            <div className="canvas-options">
              <button className={grid ? 'on' : ''} onClick={() => setGrid(!grid)} aria-pressed={grid}>{view === 'risk' ? 'Ranh giới W' : 'Lưới'}</button>
              <button className={anchors ? 'on' : ''} onClick={() => setAnchors(!anchors)} aria-pressed={anchors}>Điểm neo</button>
            </div>
          </div>
          <OptiCamCanvas layout={layout} cells={cells} view={view} tool={tool} brush={brush} selected={sel} people={people} riskFilter={riskFilter} focusCell={focusCell}
            onRiskFilter={setRiskFilter} onAddPerson={addPerson} onPerson={updatePerson} onInvalidPerson={() => flash('Không thể đặt người sát tường hoặc chồng lên vật cản')} showGrid={grid} showAnchors={anchors} measure={measure} stageRef={stageRef} drawMsRef={drawMsRef}
            onCamera={updateCamera} onObstacle={updateObstacle} onPaint={paint} onSelect={select} onRotate={rotate} onMeasure={setMeasure} />
          <button className="mobile-tools-toggle" aria-expanded={toolsOpen} onClick={() => setToolsOpen((open) => !open)}>
            {toolsOpen ? 'Ẩn công cụ' : 'Mở công cụ mặt bằng'}
          </button>
          <div className="legend">
            {view === 'dori' && (['identification', 'recognition', 'observation', 'detection', 'blind'] as const).map((key) => <span key={key}><i style={{ background: DORI_COLOR[key] }} />{{ identification: '≥250 PPM', recognition: '≥125', observation: '≥62', detection: '≥25', blind: 'Mù / <25' }[key]}</span>)}
            {view === 'risk' && <span className="canvas-note">Số W ẩn khi lưới &lt; 0,5 m; ở 0,5 m hiện tất cả; lưới lớn hơn chỉ hiện W ≥ 2.</span>}
          </div>
          <div className="canvas-footer">
            <span>{layout.pixelsPerMeter} px / m <i /> Lưới {layout.gridM} m</span>
            <span>{sel ? `Đang chọn ${sel.kind === 'cam' ? 'camera' : sel.kind === 'obs' ? 'vật thể' : 'người'}` : 'Chưa chọn đối tượng'}</span>
          </div>
        </section>

        <aside className="inspector-column">
          <Scorecard d={{ manual, live: score, unweighted, solveMs, renderMs, heatMs: drawMsRef.current }}
            view={view} riskMetrics={riskMetrics}
            onFocusHighUncovered={() => {
              if (!riskMetrics.firstUncovered) return;
              setView('risk'); setRiskFilter('high'); setFocusCell(riskMetrics.firstUncovered);
            }} />
          <Inspector layout={layout} sel={sel} measure={measure} onTargetHeight={(targetHeight) => patch({ targetHeight })} onGrid={(gridM) => patch({ gridM: Math.max(0.1, Math.min(2, gridM)), risk: {} })} onObs={editObstacle} onCam={editCamera} onRoom={setRoom} onScale={(v) => patch({ pixelsPerMeter: v })} onCalibrate={calibrate} />
          <details className="panel project-panel">
            <summary>Xuất và dự án</summary>
            <div className="project-actions">
              <button onClick={() => setBom(true)}>Mở bảng BOM</button>
              <button onClick={() => download('opticam_layout.json', exportBundle(layout, score))}>Xuất layout JSON</button>
              <label className="btn">Nhập layout JSON<input type="file" accept=".json" hidden onChange={(e) => onFile(e, 'json')} /></label>
              <button onClick={savePng}>Lưu ảnh PNG</button>
              <button onClick={runUnweighted}>So sánh Greedy không trọng số</button>
            </div>
          </details>
          <details className="panel reference-panel" open={Boolean(bg)}>
            <summary>Ảnh nền tham chiếu</summary>
            <div className="reference-actions">
              <label className="btn">Nạp ảnh mặt bằng<input type="file" accept="image/*" hidden onChange={(e) => onFile(e, 'bg')} /></label>
              {bg && <>
                <label className="field">Bề ngang ảnh · {bg.widthM.toFixed(1)} m<input type="range" min={2} max={40} step={0.5} value={bg.widthM} onChange={(e) => patch({ background: { ...bg, widthM: +e.target.value } })} /></label>
                <label className="field">Độ mờ · {Math.round(bg.opacity * 100)}%<input type="range" min={0.1} max={1} step={0.1} value={bg.opacity} onChange={(e) => patch({ background: { ...bg, opacity: +e.target.value } })} /></label>
                <div className="row"><button onClick={() => patch({ background: { ...bg, visible: !bg.visible } })}>{bg.visible ? 'Ẩn ảnh nền' : 'Hiện ảnh nền'}</button><button onClick={() => patch({ background: undefined })}>Gỡ ảnh</button></div>
              </>}
            </div>
          </details>
          <details className="panel advanced-panel">
            <summary>Công cụ nâng cao</summary>
            <div className="project-actions">
              <button onClick={() => setLayout((current) => ({ ...current, cameras: manualFourCorners(current) }))}>Đặt 4 camera góc tường</button>
              <button onClick={() => rotate(1)} disabled={!sel || sel.kind === 'person'}>Xoay đối tượng +15°</button>
              <button onClick={deleteSelected} disabled={!sel}>Xóa đối tượng đã chọn</button>
              <button onClick={benchmark}>Đo hiệu năng · 20 camera</button>
            </div>
          </details>
          <p className="keyboard-hint">Phím tắt: <kbd>Ctrl Z</kbd> hoàn tác <i /> <kbd>O</kbd> tối ưu <i /> <kbd>B</kbd> BOM <i /> <kbd>G</kbd> lưới <i /> <kbd>Del</kbd> xóa</p>
        </aside>
      </main>
      {bom && <BomModal layout={layout} onClose={closeBom} />}
      {msg && <div className={`toast${optimizing ? ' toast-busy' : ''}`} role="status" aria-live="polite">{optimizing && <span className="spinner" aria-hidden="true" />} {msg}</div>}
    </div>
  );
}
