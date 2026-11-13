import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { ArrowRight, ArrowLeft, ChevronDown, Camera as CameraIcon, MousePointer2, Columns3, Monitor, DoorOpen, UserRound, Ruler, Undo2, Redo2, RotateCw, Trash2, Download, FileUp, ScanLine, Grid2X2, Crosshair, Layers, ShieldCheck, Eraser, Map, SlidersHorizontal } from 'lucide-react';
import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/lora/latin-400.css';
import '@fontsource/lora/vietnamese-400.css';
import { OptiCamCanvas } from './components/canvas/OptiCamCanvas';
import { DORI_COLOR, PAD, priorityBand, type PriorityBand, type Segment, type Selection, type Tool, type ViewMode } from './components/canvas/shared';
import { Inspector } from './components/Inspector';
import { BomModal } from './components/BomModal';
import { Scorecard, type RiskMetrics } from './components/Scorecard';
import { PRESETS, withManualCams } from './data/presets';
import { buildZones, evaluate, RISK_DEFAULTS, SHELF_RISK_PROFILES } from './core/optics';
import { makeCamera, manualFourCorners } from './core/optimizer';
import { solveLocally } from './core/localSolver';
import { requestOptimize } from './core/api';
import { addObstacle, removeObstacle, resizeObstacle, resizeRoom } from './core/editor';
import { exportBundle, download, parseBundle } from './core/io';
import { obstacleFitsRoom, placeObstacle, satCollide, obsPoly, snapAngle, wallAnchors } from './core/geometry';
import { canPlacePerson } from './core/person';
import type { Camera, Layout, Obstacle, ObsType, Person, RiskStroke, Score, ShelfRiskCategory, Weight } from './types';

const MAX_CAMS = 20;
const STEPS = [
  { title: 'Mặt bằng', note: 'Dựng không gian', icon: Map },
  { title: 'Ưu tiên', note: 'Xác định trọng điểm', icon: ShieldCheck },
  { title: 'Camera', note: 'Thiết kế góc nhìn', icon: CameraIcon },
  { title: 'Kết quả', note: 'Đánh giá phương án', icon: ScanLine }
];
type EditorSnapshot = { layout: Layout; people: Person[] };

export default function App() {
  const [layout, setLayout] = useState<Layout>(() => withManualCams(PRESETS[0]));
  const [view, setView] = useState<ViewMode>('off');
  const [step, setStep] = useState(0);
  const [comparison, setComparison] = useState<{ before: Layout; after: Layout; score: Score } | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [brush, setBrush] = useState<Weight | null>(null);
  const [riskFilter, setRiskFilter] = useState<PriorityBand | null>(null);
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [grid, setGrid] = useState(true), [anchors, setAnchors] = useState(false), [bom, setBom] = useState(false);
  const [solveMs, setSolveMs] = useState(0), [renderMs, setRenderMs] = useState(0), [unweighted, setUnweighted] = useState<Score | null>(null);
  const [msg, setMsg] = useState('');
  const [cameraBudget, setCameraBudget] = useState(3);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const optimizationController = useRef<AbortController | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [optimizing, setOptimizing] = useState(false);
  const [undoReady, setUndoReady] = useState(false), [redoReady, setRedoReady] = useState(false);
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
    setUndoReady(true);
    setRedoReady(false);
    h.future = [];
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
    optimizationController.current?.abort();
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

  const flash = (t: string, tone: 'success' | 'error' = 'success') => {
    setMessageTone(tone);
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
    optimizationController.current?.abort();
    setBrush(null); setTool('select'); setMeasure(null); setRiskFilter(null); setFocusCell(null);
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
  const paint = useCallback((strokes: RiskStroke[]) => setLayout((l) => ({ ...l, riskStrokes: [...l.riskStrokes, ...strokes.slice(0, Math.max(0, 50000 - l.riskStrokes.length))] })), []);
  const select = useCallback((s: Selection) => setSel(s), []);

  const addObs = (t: ObsType) => {
    if (layout.obstacles.length >= 500) return flash('Mặt bằng đã đạt giới hạn 500 vật cản.', 'error');
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
  const setRoom = (w: number, h: number) => {
    const next = resizeRoom(layout, w, h);
    if (next === layout) return flash('Không thể đổi kích thước. Vật cản sẽ chồng lấn, vượt tường hoặc lưới quá dày.', 'error');
    setLayout(next);
    setPeople((current) => current.filter((person) => canPlacePerson(person.x, person.y, next.widthM, next.heightM, next.obstacles)));
  };
  const setGridSize = (gridM: number) => {
    if (Math.ceil(layout.widthM / gridM) * Math.ceil(layout.heightM / gridM) > 12000) return flash('Lưới vượt giới hạn 12.000 ô. Hãy chọn ô lớn hơn.', 'error');
    patch({ gridM, risk: {} });
  };
  const calibrate = (real: number) => {
    if (!measure || !layout.background) return;
    const len = Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]);
    const widthM = Math.round(((layout.background.widthM * real) / len) * 100) / 100;
    if (!Number.isFinite(widthM) || widthM < 0.1 || widthM > 400) return flash('Tỷ lệ ảnh sau hiệu chuẩn phải trong khoảng 0,1–400 m.', 'error');
    patch({ background: { ...layout.background, widthM } });
    setMeasure(null); flash('Đã hiệu chuẩn tỷ lệ ảnh nền');
  };

  const rotate = (dir: 1 | -1) => {
    if (sel?.kind === 'cam') setLayout((l) => ({ ...l, cameras: l.cameras.map((c) => (c.id === sel.id ? { ...c, pan: snapAngle(c.pan + dir * 15) } : c)) }));
    if (sel?.kind === 'obs') setLayout((l) => {
      const o = l.obstacles.find((x) => x.id === sel.id); if (!o || o.type === 'entrance') return l;
      const n = placeObstacle({ ...o, angle: snapAngle(o.angle + dir * 15) }, o.x + o.w / 2, o.y + o.h / 2, l.widthM, l.heightM, l.gridM);
      return !obstacleFitsRoom(n, l.widthM, l.heightM) || l.obstacles.some((q) => q.id !== o.id && satCollide(obsPoly(n), obsPoly(q))) ? l : { ...l, obstacles: l.obstacles.map((x) => (x.id === o.id ? n : x)) };
    });
  };
  const addCamera = () => setLayout((l) => {
    if (l.cameras.length >= MAX_CAMS) return l;
    const used = new Set(l.cameras.map((c) => `${c.x}_${c.y}`));
    const [x, y] = wallAnchors(l.widthM, l.heightM, l.gridM).find(([ax, ay]) => !used.has(`${ax}_${ay}`)) ?? [0, 0];
    const pan = (Math.atan2(l.heightM / 2 - y, l.widthM / 2 - x) * 180) / Math.PI;
    let index = 1;
    while (l.cameras.some((camera) => camera.id === `CAM-${String(index).padStart(2, '0')}`)) index++;
    return { ...l, cameras: [...l.cameras, { ...makeCamera(`CAM-${String(index).padStart(2, '0')}`, x, y, pan), target: 'Giám sát bổ sung' }] };
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
  const autoOptimize = async (count = cameraBudget) => {
    if (optimizationController.current) return;
    if (!zones.some((zone) => !zone.solid)) return flash('Mặt bằng không có ô sàn trống để đánh giá.', 'error');
    const controller = new AbortController();
    optimizationController.current = controller;
    const inputLayout = layout;
    if (messageTimer.current !== null) { clearTimeout(messageTimer.current); messageTimer.current = null; }
    setOptimizing(true);
    setMsg(`Đang tối ưu vị trí cho tối đa ${count} camera…`);
    const t0 = performance.now();
    const cameraProfiles = cameraProfilesFor(count);
    try {
      const { cameras, source } = await requestOptimize(layout, zones, count, cameraProfiles, controller.signal);
      if (controller.signal.aborted) return flash('Đã hủy tối ưu.');
      if (layoutRef.current !== inputLayout) return flash('Mặt bằng đã thay đổi. Hãy tối ưu lại với cấu hình mới.', 'error');
      const t1 = performance.now();
      setSel(null);
      const after = { ...inputLayout, cameras };
      setLayout(after);
      setComparison({ before: inputLayout, after, score }); setShowBefore(false); setStep(3); setView('dori'); setSolveMs(t1 - t0);
      flash(`Đã tối ưu ${cameras.length}/${count} camera · ${source === 'api' ? 'Backend' : 'dự phòng trên trình duyệt'}`);
      requestAnimationFrame(() => requestAnimationFrame(() => setRenderMs(performance.now() - t1)));
    } catch (error) {
      flash((error as Error).name === 'AbortError' ? 'Đã hủy tối ưu.' : `Tối ưu thất bại — ${(error as Error).message}`, (error as Error).name === 'AbortError' ? 'success' : 'error');
    } finally {
      optimizationController.current = null;
      setOptimizing(false);
    }
  };
  const minimizeCameras = async () => {
    if (optimizationController.current) return;
    if (!zones.some((zone) => !zone.solid)) return flash('Mặt bằng không có ô sàn trống để đánh giá.', 'error');
    const controller = new AbortController();
    optimizationController.current = controller;
    const inputLayout = layout;
    if (messageTimer.current !== null) { clearTimeout(messageTimer.current); messageTimer.current = null; }
    setOptimizing(true);
    setMsg('Đang giảm số camera bằng Greedy theo KPI Đỏ ≥95% và Vàng ≥80%…');
    const t0 = performance.now();
    const cameraProfiles = cameraProfilesFor(layout.cameras.length);
    try {
      const result = await solveLocally({ layout, zones, count: cameraProfiles.length, profiles: cameraProfiles, mode: 'minimum' }, controller.signal);
      if (controller.signal.aborted) return flash('Đã hủy tối ưu.');
      if (layoutRef.current !== inputLayout) return flash('Mặt bằng đã thay đổi. Hãy tối ưu lại với cấu hình mới.', 'error');
      setSel(null);
      const t1 = performance.now();
      const after = { ...inputLayout, cameras: result.cameras };
      setLayout(after);
      setComparison({ before: inputLayout, after, score }); setShowBefore(false); setStep(3); setView('dori');
      setSolveMs(t1 - t0);
      const status = result.metTargets ? 'Đạt KPI' : 'Chưa đạt đủ KPI';
      flash(`${status} · giữ ${result.cameras.length}/${cameraProfiles.length} camera · Đỏ ${result.red}% · Vàng ${result.yellow}%`);
      requestAnimationFrame(() => requestAnimationFrame(() => setRenderMs(performance.now() - t1)));
    } catch (error) {
      flash((error as Error).name === 'AbortError' ? 'Đã hủy tối ưu.' : `Tìm số camera thất bại — ${(error as Error).message}`, (error as Error).name === 'AbortError' ? 'success' : 'error');
    } finally {
      optimizationController.current = null;
      setOptimizing(false);
    }
  };
  const runUnweighted = async () => {
    if (optimizationController.current) return;
    if (!zones.some((zone) => !zone.solid)) return flash('Mặt bằng không có ô sàn trống để đánh giá.', 'error');
    const controller = new AbortController();
    optimizationController.current = controller;
    setOptimizing(true);
    setMsg('Đang tính phương án Greedy không trọng số…');
    const inputLayout = layout;
    try {
      const result = await solveLocally({ layout, zones, count: layout.cameras.length, profiles: layout.cameras, mode: 'unweighted' }, controller.signal);
      if (layoutRef.current !== inputLayout) return flash('Mặt bằng đã thay đổi. Hãy chạy lại phép so sánh.', 'error');
      setUnweighted(evaluate({ ...layout, cameras: result.cameras }, zones).score);
      flash('Đã cập nhật bảng so sánh phương án.');
    } catch (error) {
      flash((error as Error).name === 'AbortError' ? 'Đã hủy phép so sánh.' : (error as Error).message, 'error');
    } finally {
      optimizationController.current = null;
      setOptimizing(false);
    }
  };
  const stress = () => setLayout((l) => ({ ...l, cameras: Array.from({ length: MAX_CAMS }, (_, i) => { const a = wallAnchors(l.widthM, l.heightM, l.gridM); const [x, y] = a[Math.floor((i * a.length) / MAX_CAMS)]; return makeCamera(`CAM-${String(i + 1).padStart(2, '0')}`, x, y, (Math.atan2(l.heightM / 2 - y, l.widthM / 2 - x) * 180) / Math.PI); }) }));

  const savePng = async () => {
    if (!stageRef.current) return;
    const worldWidth = layout.widthM * layout.pixelsPerMeter + PAD * 2;
    const worldHeight = layout.heightM * layout.pixelsPerMeter + PAD * 2;
    const exportScale = Math.min(1, 1024 / Math.max(worldWidth, worldHeight));
    const imageStage = stageRef.current.clone({
      container: document.createElement('div'),
      width: Math.ceil(worldWidth * exportScale),
      height: Math.ceil(worldHeight * exportScale),
      x: 0, y: 0, scaleX: exportScale, scaleY: exportScale
    });
    try {
      const response = await fetch(imageStage.toDataURL({ pixelRatio: 2 }));
      download('opticam_canvas.png', await response.blob());
    } finally {
      imageStage.destroy();
    }
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
    if (f.size > 5 * 1024 * 1024) return flash('File vượt giới hạn 5 MB.', 'error');
    if (kind === 'bg' && !f.type.startsWith('image/')) return flash('Hãy chọn tệp ảnh hợp lệ.', 'error');
    const rd = new FileReader();
    rd.onerror = () => flash('Không đọc được file đã chọn.', 'error');
    rd.onload = () => {
      try {
        if (kind === 'json') {
          if (loadLayout(parseBundle(String(rd.result)))) flash('Đã nạp layout');
        }
        else {
          const image = new Image();
          image.onload = () => patch({ background: { dataUrl: String(rd.result), widthM: layoutRef.current.widthM, opacity: 0.5, visible: true } });
          image.onerror = () => flash('Ảnh bị hỏng hoặc không đọc được.', 'error');
          image.src = String(rd.result);
        }
      } catch (err) { flash(`Lỗi — ${(err as Error).message}`, 'error'); }
    };
    kind === 'json' ? rd.readAsText(f) : rd.readAsDataURL(f);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const k = e.key.toLowerCase();
      if (showBefore && ['c', 'r', 'delete', 'backspace'].includes(k)) return;
      if (bom) { if (k === 'escape') setBom(false); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'escape') { setBrush(null); setTool('select'); setSel(null); setMeasure(null); } else if (k === 'b') setBom((v) => !v); else if (k === 'o') autoOptimize();
      else if (k === 'g') setGrid((v) => !v); else if (k === 'a') setAnchors((v) => !v); else if (k === 'c') addCamera();
      else if (k === 'r') rotate(1); else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (['1', '2', '3'].includes(k)) loadLayout(withManualCams(PRESETS[+k - 1]));
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    setUnweighted(null);
    if (sel?.kind === 'cam' && !layout.cameras.some((camera) => camera.id === sel.id)) setSel(null);
    if (sel?.kind === 'obs' && !layout.obstacles.some((obstacle) => obstacle.id === sel.id)) setSel(null);
  }, [layout]);
  useEffect(() => {
    if (layout.riskStrokes.length >= 50000) {
      setBrush(null);
      flash('Đã đạt giới hạn 50.000 nét cọ. Bạn có thể xóa cọ để tô lại.', 'error');
    }
  }, [layout.riskStrokes.length]);
  useEffect(() => {
    if (comparison && layout !== comparison.after) { setComparison(null); setShowBefore(false); }
  }, [layout, comparison]);
  const beforeEvaluation = useMemo(() => comparison ? evaluate(comparison.before, buildZones(comparison.before)) : null, [comparison]);
  const displayedLayout = showBefore && comparison ? comparison.before : layout;
  const displayedScore = showBefore && comparison ? comparison.score : score;
  const displayedCells = showBefore && beforeEvaluation ? beforeEvaluation.cells : cells;
  const goStep = (next: number) => {
    setStep(next); setShowBefore(false); setBrush(null); setTool('select'); setSel(null);
    setView(next === 1 ? 'risk' : next >= 2 ? 'dori' : 'off');
  };
  const bg = layout.background;
  const selectedPreset = PRESETS.findIndex((preset) => preset.name === layout.name);
  return (
    <div className="app">
      <header className="app-header">
        <a className="brand-lockup" href="#" onClick={(event) => { event.preventDefault(); goStep(0); }} aria-label="OptiCam Studio, về mặt bằng">
          <span className="brand-mark"><ScanLine size={21} strokeWidth={1.5} /></span>
          <span className="wordmark">OptiCam<span>STUDIO</span></span>
        </a>
        <span className="header-divider" />
        <label className="project-picker"><span className="eyebrow">DỰ ÁN HIỆN TẠI</span>
          <select aria-label="Chọn mặt bằng cửa hàng" value={selectedPreset < 0 ? '' : selectedPreset} onChange={(event) => {
            const preset = PRESETS[Number(event.target.value)];
            if (preset && loadLayout(withManualCams(preset))) goStep(0);
          }}>
            {selectedPreset < 0 && <option value="">Mặt bằng tùy chỉnh</option>}
            {PRESETS.map((preset, index) => <option key={preset.name} value={index}>{preset.name}</option>)}
          </select>
        </label>
        <div className="history-actions">
          <button onClick={undo} disabled={!undoReady} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác"><Undo2 size={17} /></button>
          <button onClick={redo} disabled={!redoReady} title="Làm lại (Ctrl+Y)" aria-label="Làm lại"><Redo2 size={17} /></button>
        </div>
        <div className="header-actions">
          <details className="export-menu"><summary><Download size={15} /> Xuất dự án <ChevronDown size={13} /></summary>
            <div className="menu-popover">
              <button onClick={() => download('opticam_layout.json', exportBundle(layout, score))}>Lưu dự án JSON</button>
              <button onClick={() => savePng().catch(() => flash('Không thể xuất ảnh PNG.', 'error'))}>Xuất bản vẽ PNG</button>
              <button onClick={() => setBom(true)}>Vật tư & chi phí (BOM)</button>
              <label className="btn">Mở dự án JSON<input type="file" accept=".json" hidden onChange={(e) => onFile(e, 'json')} /></label>
            </div>
          </details>
          <button className="primary" onClick={() => autoOptimize()} disabled={optimizing}>
            {optimizing ? <span className="spinner" /> : <ScanLine size={16} />} {optimizing ? 'Đang tối ưu…' : 'Tối ưu phương án'}
          </button>
          {optimizing && <button onClick={() => optimizationController.current?.abort()}>Hủy</button>}
        </div>
      </header>
      <nav className="workflow" aria-label="Quy trình thiết kế">
        {STEPS.map(({ title, note, icon: Icon }, index) => <button key={title} className={`workflow-step${step === index ? ' current' : ''}`} aria-current={step === index ? 'step' : undefined} onClick={() => goStep(index)}>
          <span className="step-index">0{index + 1}</span><Icon size={18} strokeWidth={1.5} /><span><strong>{title}</strong><small>{note}</small></span>
          {index < 3 && <ArrowRight className="step-arrow" size={15} />}
        </button>)}
      </nav>
      <main className="planner">
        <section className="workspace" aria-label="Không gian thiết kế">
          <div className="workspace-heading">
            <div><span className="eyebrow">BẢN VẼ BỐ TRÍ · {showBefore ? 'TRƯỚC TỐI ƯU' : 'PHƯƠNG ÁN HIỆN TẠI'}</span><h1>Mặt bằng cửa hàng.</h1></div>
            <span className="drawing-id">PLAN / 0{Math.max(0, selectedPreset) + 1}<small>{layout.widthM} × {layout.heightM} m · {layout.widthM * layout.heightM} m²</small></span>
          </div>
          <div className="workspace-controls">
            <div className="layer-switch" role="group" aria-label="Lớp phân tích">
              {(['off', 'dori', 'risk'] as ViewMode[]).map((mode) => <button key={mode} className={view === mode ? 'on' : ''} aria-pressed={view === mode} onClick={() => setView(mode)}>
                {mode === 'off' ? <Map size={14} /> : mode === 'dori' ? <Layers size={14} /> : <ShieldCheck size={14} />}
                {{ off: 'Mặt bằng', dori: 'Chất lượng DORI', risk: 'Vùng ưu tiên' }[mode]}
              </button>)}
            </div>
            <div className="canvas-options">
              <button className={grid ? 'on' : ''} onClick={() => setGrid(!grid)} aria-pressed={grid} title={view === 'risk' ? 'Ranh giới mức ưu tiên' : 'Bật / tắt lưới'} aria-label="Bật tắt lưới"><Grid2X2 size={16} /></button>
              <button className={anchors ? 'on' : ''} onClick={() => setAnchors(!anchors)} aria-pressed={anchors} title="Điểm gắn camera trên tường" aria-label="Bật tắt điểm neo"><Crosshair size={16} /></button>
            </div>
          </div>
          <div className="drawing-area">
            <nav className="tool-rail" aria-label="Công cụ mặt bằng">
              <button className={`rail-button${tool === 'select' && brush === null ? ' active' : ''}`} aria-pressed={tool === 'select' && brush === null} title="Chọn và kéo đối tượng" onClick={() => { setBrush(null); setTool('select'); }}><MousePointer2 size={19} /><small>Chọn</small></button>
              <span className="rail-divider" />
              <button className="rail-button" disabled={showBefore || layout.cameras.length >= MAX_CAMS} title="Thêm camera (C)" onClick={addCamera}><CameraIcon size={19} /><small>Camera</small></button>
              <button className="rail-button" disabled={showBefore} title="Thêm kệ hàng" onClick={() => addObs('shelf')}><Columns3 size={19} /><small>Kệ</small></button>
              <button className="rail-button" disabled={showBefore} title="Thêm quầy POS" onClick={() => addObs('pos')}><Monitor size={19} /><small>POS</small></button>
              <button className="rail-button" disabled={showBefore} title="Thêm cửa ra vào" onClick={() => addObs('entrance')}><DoorOpen size={19} /><small>Cửa</small></button>
              <span className="rail-divider" />
              <button className={`rail-button${tool === 'person' ? ' active' : ''}`} disabled={showBefore} aria-pressed={tool === 'person'} title="Đặt người kiểm tra DORI" onClick={() => { setTool(tool === 'person' ? 'select' : 'person'); setBrush(null); }}><UserRound size={19} /><small>Kiểm tra</small></button>
              <button className={`rail-button${tool === 'measure' ? ' active' : ''}`} aria-pressed={tool === 'measure'} title="Đo khoảng cách" onClick={() => { setTool(tool === 'measure' ? 'select' : 'measure'); setBrush(null); setMeasure(null); }}><Ruler size={19} /><small>Đo</small></button>
            </nav>
            <OptiCamCanvas layout={displayedLayout} cells={displayedCells} view={view} tool={tool} brush={brush} selected={showBefore ? null : sel} people={people} riskFilter={riskFilter} focusCell={focusCell} readOnly={showBefore}
              onRiskFilter={setRiskFilter} onAddPerson={addPerson} onPerson={updatePerson} onInvalidPerson={() => flash('Không thể đặt người sát tường hoặc chồng lên vật cản')} showGrid={grid} showAnchors={anchors} measure={measure} stageRef={stageRef} drawMsRef={drawMsRef}
              onCamera={updateCamera} onObstacle={updateObstacle} onPaint={paint} onSelect={select} onRotate={rotate} onMeasure={setMeasure} />
            {comparison && step === 3 && <div className="comparison-switch" role="group" aria-label="So sánh trước và sau tối ưu">
              <button className={showBefore ? 'on' : ''} aria-pressed={showBefore} onClick={() => { setShowBefore(true); setSel(null); setTool('select'); setBrush(null); }}>Trước tối ưu</button>
              <button className={!showBefore ? 'on' : ''} aria-pressed={!showBefore} onClick={() => setShowBefore(false)}>Sau tối ưu</button>
            </div>}
          </div>
          <div className="drawing-caption">
            <div className="legend">{view === 'dori' ? (['identification', 'recognition', 'observation', 'detection', 'blind'] as const).map((key) => <span key={key}><i style={{ background: DORI_COLOR[key] }} />{{ identification: 'Nhận dạng ≥250', recognition: 'Nhận biết ≥125', observation: 'Quan sát ≥62', detection: 'Phát hiện ≥25', blind: 'Dưới 25 PPM' }[key]}</span>) : <span>{view === 'risk' ? 'Mức ưu tiên W · tô vùng trực tiếp trên sơ đồ' : 'Mặt bằng nhìn từ trên xuống · Kích thước theo mét'}</span>}</div>
            <span className="drawing-scale">1 ô = {layout.gridM} m</span>
          </div>
          <div className="canvas-footer"><span>Kéo nền để di chuyển · Cuộn để thu phóng</span><span>{sel ? `Đang chọn ${sel.id}` : 'Chọn một đối tượng để chỉnh sửa'}</span></div>
        </section>
        <aside className="inspector-column" aria-label={`Thiết lập ${STEPS[step].title}`}>
          <div className="context-heading"><span className="eyebrow">BƯỚC 0{step + 1} / 04</span><h2>{STEPS[step].title}</h2><p>{['Dựng mặt bằng đúng kích thước, bố trí kệ và quầy theo không gian thực.', 'Đánh dấu khu vực cần quan sát kỹ hơn để ưu tiên khi tối ưu.', 'Chọn số lượng và thông số camera, sau đó tìm vị trí phù hợp.', 'Đánh giá chất lượng quan sát và hoàn thiện phương án lắp đặt.'][step]}</p></div>
          {step === 1 && <section className="panel priority-editor"><h3>Cọ vùng ưu tiên</h3><div className="brush-options">{([5, 3, 1] as Weight[]).map((weight) => <button key={weight} disabled={layout.riskStrokes.length >= 50000} className={brush === weight ? 'on' : ''} aria-pressed={brush === weight} onClick={() => { setBrush(brush === weight ? null : weight); setTool('select'); setView('risk'); }}><i className={`risk-dot risk-${weight}`} />{weight === 5 ? 'Cao' : weight === 3 ? 'Vừa' : 'Thấp'}<small>W {weight}</small></button>)}</div>
            <p className="muted">Kéo cọ trên sàn. Chọn kệ hoặc quầy để chỉnh vùng ưu tiên xung quanh vật thể.</p>
            <button className="text-button" disabled={!layout.riskStrokes.length && !Object.keys(layout.risk).length} onClick={() => { if (window.confirm('Xóa toàn bộ vùng ưu tiên đã tô?')) patch({ risk: {}, riskStrokes: [] }); setBrush(null); }}><Eraser size={14} /> Xóa vùng đã tô</button></section>}
          {step === 2 && <section className="panel camera-setup"><label className="field">Số camera tối đa cho phương án<select aria-label="Ngân sách camera" value={cameraBudget} onChange={(event) => setCameraBudget(Number(event.target.value))} disabled={optimizing}>{Array.from({ length: MAX_CAMS }, (_, i) => <option key={i} value={i + 1}>{i + 1} camera</option>)}</select></label><p className="muted">Camera bắt dính tường. Kéo tay cầm để xoay hướng nhìn theo bước 15°.</p><button className="text-button" onClick={addCamera} disabled={layout.cameras.length >= MAX_CAMS}><CameraIcon size={15} /> Thêm camera thủ công</button></section>}
          {step === 3 && <>
            <Scorecard d={{ manual, live: score, unweighted, solveMs, renderMs, heatMs: drawMsRef.current, before: comparison?.score }} preview={showBefore ? comparison?.score : undefined} view="dori" riskMetrics={riskMetrics} onFocusHighUncovered={() => { if (riskMetrics.firstUncovered) { setShowBefore(false); setView('risk'); setRiskFilter('high'); setFocusCell({ ...riskMetrics.firstUncovered }); } }} />
            <section className="panel result-actions"><h3>Vùng ưu tiên của phương án hiện tại</h3><p>{riskMetrics.uncoveredHigh ? `${riskMetrics.uncoveredHigh} ô ưu tiên cao chưa có camera quan sát.` : riskMetrics.highTotal ? 'Toàn bộ ô ưu tiên cao đã có camera quan sát. Kiểm tra thêm mức PPM để đạt KPI.' : 'Chưa có vùng ưu tiên cao trong mặt bằng.'}</p><button disabled={!riskMetrics.firstUncovered} onClick={() => { setShowBefore(false); setView('risk'); setRiskFilter('high'); setFocusCell(riskMetrics.firstUncovered ? { ...riskMetrics.firstUncovered } : null); }}><Crosshair size={15} /> Kiểm tra vùng chưa phủ</button><button onClick={() => setBom(true)}><Download size={15} /> Vật tư & chi phí</button></section>
          </>}
          {step !== 3 && <Inspector mode={step === 0 ? 'room' : step === 1 ? 'risk' : 'camera'} onSelect={select} layout={layout} sel={sel} measure={measure} onTargetHeight={(targetHeight) => patch({ targetHeight })} onGrid={setGridSize} onObs={editObstacle} onCam={editCamera} onRoom={setRoom} onScale={(v) => patch({ pixelsPerMeter: v })} onCalibrate={calibrate} />}
          {sel && !showBefore && <div className="selection-actions"><button onClick={() => rotate(1)} disabled={sel.kind === 'person'}><RotateCw size={14} /> Xoay 15°</button><button onClick={deleteSelected}><Trash2 size={14} /> Xóa</button>{step === 3 && <button onClick={() => { setStep(sel.kind === 'cam' ? 2 : 0); }}>Thuộc tính</button>}</div>}
          {step === 0 && <details className="panel reference-panel" open={Boolean(bg)}><summary>Ảnh mặt bằng tham chiếu</summary><div className="reference-actions"><label className="btn"><FileUp size={15} /> Nạp ảnh mặt bằng<input type="file" accept="image/*" hidden onChange={(e) => onFile(e, 'bg')} /></label>{bg && <><label className="field">Bề ngang ảnh · {bg.widthM.toFixed(1)} m<input type="range" min={2} max={40} step={0.5} value={bg.widthM} onChange={(e) => patch({ background: { ...bg, widthM: +e.target.value } })} /></label><label className="field">Độ mờ · {Math.round(bg.opacity * 100)}%<input type="range" min={0.1} max={1} step={0.1} value={bg.opacity} onChange={(e) => patch({ background: { ...bg, opacity: +e.target.value } })} /></label><div className="row"><button onClick={() => patch({ background: { ...bg, visible: !bg.visible } })}>{bg.visible ? 'Ẩn ảnh' : 'Hiện ảnh'}</button><button onClick={() => patch({ background: undefined })}>Gỡ ảnh</button></div></>}</div></details>}
          {step >= 2 && <details className="panel advanced-panel"><summary>Tùy chọn tối ưu</summary><div className="project-actions"><label className="field">Ngân sách camera<select aria-label="Số camera tối ưu" value={cameraBudget} disabled={optimizing} onChange={(e) => setCameraBudget(+e.target.value)}>{Array.from({ length: MAX_CAMS }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label><button onClick={() => autoOptimize(layout.cameras.length)} disabled={optimizing}>Tối ưu {layout.cameras.length} camera hiện có</button><button onClick={minimizeCameras} disabled={optimizing}>Giảm số camera theo KPI (Greedy)</button><button onClick={runUnweighted} disabled={optimizing}>So sánh Greedy không trọng số</button><button onClick={() => setLayout((current) => ({ ...current, cameras: manualFourCorners(current) }))}>Đặt 4 camera ở góc tường</button><button onClick={benchmark} disabled={optimizing}>Đo hiệu năng · 20 camera</button></div></details>}
          <div className="step-navigation">{step > 0 && <button onClick={() => goStep(step - 1)} aria-label="Bước trước"><ArrowLeft size={16} /></button>}{step < 3 ? <button className="primary" onClick={() => goStep(step + 1)}>Tiếp tục · {STEPS[step + 1].title}<ArrowRight size={16} /></button> : <button onClick={() => goStep(2)}><SlidersHorizontal size={15} /> Điều chỉnh phương án</button>}</div>
        </aside>
      </main>
      <footer className="studio-status"><span><i className="status-dot" /> {showBefore ? 'Trước tối ưu' : 'Phân tích trực tiếp'}</span><span><strong>{displayedLayout.cameras.length}</strong> camera</span><span>Vùng đỏ <strong className={displayedScore.red >= 95 ? 'pass' : 'fail'}>{displayedScore.redCells === 0 ? '—' : `${displayedScore.red}%`}</strong><small> / ≥95%</small></span><span>Vùng vàng <strong className={displayedScore.yellow >= 80 ? 'pass' : 'fail'}>{displayedScore.yellowCells === 0 ? '—' : `${displayedScore.yellow}%`}</strong><small> / ≥80%</small></span><span className="status-shortcuts"><kbd>O</kbd> tối ưu <kbd>G</kbd> lưới <kbd>Esc</kbd> bỏ chọn</span></footer>
      {bom && <BomModal layout={layout} onClose={closeBom} />}
      {msg && <div className={`toast${optimizing ? ' toast-busy' : messageTone === 'error' ? ' toast-error' : ''}`} role="status" aria-live="polite">{optimizing && <span className="spinner" />} {msg}</div>}
    </div>
  );
}
