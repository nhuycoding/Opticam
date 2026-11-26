import { floorArea } from './core/footprint';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type Konva from 'konva';
import { ArrowLeft, ChevronDown, ChevronRight, Camera as CameraIcon, MousePointer2, Columns3, Monitor, DoorOpen, UserRound, Ruler, Undo2, Redo2, RotateCw, Trash2, Download, ScanLine, Grid2X2, Crosshair, Layers, ShieldCheck, Eraser, Map, HelpCircle } from 'lucide-react';
import { TutorialModal } from './components/TutorialModal';

const TUTORIAL_STORAGE_KEY = 'opticam.tutorial.dismissed';

function shouldAutoOpenTutorial(): boolean {
  return typeof window !== 'undefined'
    && typeof window.localStorage?.getItem === 'function'
    && window.localStorage.getItem(TUTORIAL_STORAGE_KEY) !== '1';
}
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
import { addObstacle, moveObstacle, removeObstacle, resizeObstacle, resizeRoom, rotateObstacle } from './core/editor';
import { exportBundle, download, parseBundle } from './core/io';
import { snapAngle, wallAnchors } from './core/geometry';
import { canPlacePerson, MAX_PEOPLE } from './core/person';
import { SceneInspector } from './components/three/SceneInspector';
import { SceneBoundary } from './components/three/SceneBoundary';
import { CameraSchedule } from './components/CameraSchedule';
import { cameraNumber, cameraMount, normalizeCameraPlacement } from './core/camera';
import { canPlaceCeilingCamera, ceilingInsertionPoint, placeEditedCamera } from './core/cameraEditing';
import { PlanningSettings } from './components/PlanningSettings';
import { CAMERA_OPTIMIZATION_FORM, CameraCountOptimizer } from './components/CameraCountOptimizer';
import type { Camera, Fixture, Layout, Obstacle, ObsType, Person, RiskStroke, Score, ShelfRiskCategory, Weight } from './types';

const MAX_CAMS = 20;
const Store3D = lazy(() => import('./components/three/Store3D'));
const STEPS = [
  { id: 'plan', title: 'Mặt bằng', icon: Map },
  { id: 'results', title: 'Kết quả', icon: ScanLine },
] as const;
type Step = typeof STEPS[number]['id'];
type PlanGroup = 'room' | 'priority' | 'camera';

function PlanSection({ id, title, icon: Icon, expanded, onToggle, children }: {
  id: PlanGroup; title: string; icon: typeof Map; expanded: boolean; onToggle: () => void; children: ReactNode;
}) {
  return <section className="sidebar-group">
    <h3 className="sidebar-group-heading">
      <button type="button" id={`group-${id}`} className="sidebar-group-toggle" aria-expanded={expanded} aria-controls={`section-${id}`} onClick={onToggle}>
        <span className="sidebar-group-icon"><Icon size={17} aria-hidden="true" /></span>
        <span>{title}</span>
        <ChevronRight className="sidebar-chevron" size={16} aria-hidden="true" />
      </button>
    </h3>
    <div id={`section-${id}`} className="sidebar-group-content" aria-labelledby={`group-${id}`} hidden={!expanded}>{children}</div>
  </section>;
}

type EditorSnapshot = { layout: Layout; people: Person[] };

export default function App() {
  const [layout, setLayout] = useState<Layout>(() => withManualCams(PRESETS[0]));
  const [view, setView] = useState<ViewMode>('off');
  const [dimension, setDimension] = useState<'plan' | '3d'>('plan');
  const [cameraViewId, setCameraViewId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('plan');
  const [group, setGroup] = useState<PlanGroup | null>('room');
  const isPlanning = step === 'plan';
  const [comparison, setComparison] = useState<{ before: Layout; after: Layout; score: Score } | null>(null);
  const [showBefore, setShowBefore] = useState(false);
  const [brush, setBrush] = useState<Weight | null>(null);
  const [riskFilter, setRiskFilter] = useState<PriorityBand | null>(null);
  const [focusCell, setFocusCell] = useState<{ r: number; c: number } | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [people, setPeople] = useState<Person[]>(() => structuredClone(PRESETS[0].people ?? []));
  const [grid, setGrid] = useState(true), [anchors, setAnchors] = useState(false), [bom, setBom] = useState(false);
  const [showTutorial, setShowTutorial] = useState<boolean>(shouldAutoOpenTutorial);
  const closeTutorial = useCallback((dontShowAgain: boolean) => {
    if (dontShowAgain) {
      try {
        window.localStorage?.setItem(TUTORIAL_STORAGE_KEY, '1');
      } catch {
        // Ignore storage errors in private or sandboxed environments.
      }
    }
    setShowTutorial(false);
  }, []);
  const [pendingLayout, setPendingLayout] = useState<{ layout: Layout; goPlan: boolean } | null>(null);
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

  const zones = useMemo(() => buildZones(layout), [layout.obstacles, layout.risk, layout.riskStrokes, layout.widthM, layout.heightM, layout.gridM, layout.floorPolygon]);
  const { cells, score } = useMemo(() => evaluate(layout, zones), [layout.cameras, zones, layout.obstacles, layout.targetHeight, layout.floorPolygon]);
  const manual = useMemo(() => evaluate({ ...layout, cameras: manualFourCorners(layout) }, zones).score, [zones, layout.obstacles, layout.targetHeight, layout.floorPolygon]);
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
  const applyLayout = (l: Layout, goPlan = false) => {
    optimizationController.current?.abort();
    setBrush(null); setTool('select'); setMeasure(null); setRiskFilter(null); setFocusCell(null);
    setCameraViewId(null);
    const nextPeople = structuredClone(l.people ?? []);
    resetHistory(l, nextPeople); setLayout(l); setPeople(nextPeople); setSel(null); setUnweighted(null); setSolveMs(0); setCameraBudget(l.cameras.length || 3);
    if (goPlan) goStep('plan');
  };
  const loadLayout = (l: Layout, goPlan = false) => {
    setPendingLayout({ layout: l, goPlan });
    return false;
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
  const updateCamera = useCallback((c: Camera) => setLayout(l => {
    const previous = l.cameras.find(camera => camera.id === c.id);
    const moved = !previous || previous.x !== c.x || previous.y !== c.y || cameraMount(previous) !== cameraMount(c);
    const placed = moved ? placeEditedCamera(c, l) : normalizeCameraPlacement(c, l);
    return placed && (cameraMount(placed) !== 'ceiling' || canPlaceCeilingCamera(placed, l)) ? { ...l, cameras: l.cameras.map(x => x.id === c.id ? placed : x) } : l;
  }), []);
  const moveCamera3D = useCallback((id: string, x: number, y: number) => setLayout(l => {
    const camera = l.cameras.find(c => c.id === id);
    const placed = camera && placeEditedCamera({ ...camera, x, y }, l);
    return placed ? { ...l, cameras: l.cameras.map(c => c.id === id ? placed : c) } : l;
  }), []);
  const updateObstacle = useCallback((o: Obstacle) => setLayout((l) => ({ ...l, walkways: undefined, obstacles: l.obstacles.map((x) => (x.id === o.id ? o : x)) })), []);
  const moveObstacle3D = useCallback((id: string, centerX: number, centerY: number) => setLayout(current => moveObstacle(current, id, centerX, centerY)), []);
  const updatePerson = useCallback((person: Person) => {
    const currentLayout = layoutRef.current;
    if (!canPlacePerson(person.x, person.y, currentLayout.widthM, currentLayout.heightM, currentLayout.obstacles, currentLayout.floorPolygon)) return;
    setPeople(current => current.map(item => item.id === person.id ? person : item));
  }, []);
  const paint = useCallback((strokes: RiskStroke[]) => setLayout((l) => ({ ...l, riskStrokes: [...l.riskStrokes, ...strokes.slice(0, Math.max(0, 50000 - l.riskStrokes.length))] })), []);
  const select = useCallback((selection: Selection) => {
    setSel(selection);
    if (selection?.kind === 'cam' || selection?.kind === 'person') {
      setGroup('camera');
      setBrush(null);
    }
    if (selection?.kind === 'obs') setGroup(current => current === 'priority' ? 'priority' : 'room');
  }, []);

  const addObs = (t: ObsType, fixture?: Fixture) => {
    if (layout.obstacles.length >= 500) return flash('Mặt bằng đã đạt giới hạn 500 vật cản.', 'error');
    const r = addObstacle(layout, t, fixture);
    if (!r) return flash('Không còn chỗ trống cho khối này');
    setLayout(r); setGroup('room'); setBrush(null); setSel({ kind: 'obs', id: r.obstacles[r.obstacles.length - 1].id }); setTool('select');
  };
  const editObstacle = (id: string, pt: Partial<Pick<Obstacle, 'label' | 'elev' | 'w' | 'h' | 'riskCategory' | 'riskWmax' | 'riskR0' | 'riskR' | 'fixture'>>) =>
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
  const editCamera = (id: string, pt: Partial<Camera>) => {
    const l = layoutRef.current, camera = l.cameras.find(c => c.id === id);
    if (!camera) return;
    let updated = {
      ...camera, ...pt, id: camera.id,
      ...(pt.pan !== undefined ? { pan: snapAngle(pt.pan) } : {}),
      ...(pt.fov !== undefined ? { fov: Math.max(30, Math.min(140, pt.fov)) } : {}),
      ...(pt.res !== undefined ? { res: Math.max(640, Math.min(7680, pt.res)) } : {}),
      ...(pt.range !== undefined ? { range: Math.max(1, Math.min(30, pt.range)) } : {}),
      ...(pt.tilt !== undefined ? { tilt: Math.max(0, Math.min(90, pt.tilt)) } : {}),
      ...(pt.vfov !== undefined ? { vfov: Math.max(10, Math.min(120, pt.vfov)) } : {})
    };
    if (pt.mount && pt.mount !== cameraMount(camera)) {
      updated.tilt = pt.mount === 'ceiling' ? 45 : 20;
      if (pt.mount === 'ceiling' && !canPlaceCeilingCamera(normalizeCameraPlacement(updated, l), l)) {
        const point = ceilingInsertionPoint(l);
        if (!point) return flash('Không có vị trí trần hợp lệ cho camera.', 'error');
        [updated.x, updated.y] = point;
      }
    }
    const moved = cameraMount(updated) !== cameraMount(camera) || updated.x !== camera.x || updated.y !== camera.y;
    const placed = moved ? placeEditedCamera(updated, l) : normalizeCameraPlacement(updated, l);
    if (!placed || (cameraMount(placed) === 'ceiling' && !canPlaceCeilingCamera(placed, l))) return flash('Vị trí camera vướng tường hoặc vật thể cao. Hãy đổi vị trí hoặc bộ gá.', 'error');
    updateCamera(placed);
  };
  const setCeilingHeight = (ceilingHeight: number) => {
    const current = layoutRef.current;
    if (current.obstacles.some(o => o.elev > ceilingHeight)) return flash('Trần thấp hơn một vật thể hiện có. Hãy giảm chiều cao vật thể trước.', 'error');
    const next = { ...current, ceilingHeight };
    next.cameras = next.cameras.map(camera => normalizeCameraPlacement(camera, next));
    if (next.cameras.some(camera => cameraMount(camera) === 'ceiling' && !canPlaceCeilingCamera(camera, next))) return flash('Chiều cao mới làm camera vướng vật thể. Hãy đổi vị trí camera trước.', 'error');
    setLayout(next);
  };
  const setRoom = (w: number, h: number) => {
    const next = resizeRoom(layout, w, h);
    if (next === layout) return flash('Không thể đổi kích thước. Vật cản sẽ chồng lấn, vượt tường hoặc lưới quá dày.', 'error');
    setLayout(next);
    setPeople((current) => current.filter((person) => canPlacePerson(person.x, person.y, next.widthM, next.heightM, next.obstacles, next.floorPolygon)));
  };
  const setGridSize = (gridM: number) => {
    if (Math.ceil(layout.widthM / gridM) * Math.ceil(layout.heightM / gridM) > 12000) return flash('Lưới vượt giới hạn 12.000 ô. Hãy chọn ô lớn hơn.', 'error');
    patch({ gridM, risk: {} });
  };
  const rotate = (dir: 1 | -1) => {
    if (sel?.kind === 'cam') setLayout((l) => ({ ...l, cameras: l.cameras.map((c) => (c.id === sel.id ? { ...c, pan: snapAngle(c.pan + dir * 15) } : c)) }));
    if (sel?.kind === 'obs') setLayout(current => rotateObstacle(current, sel.id, dir));
  };
  const addCamera = () => setLayout((l) => {
    if (l.cameras.length >= MAX_CAMS) return l;
    const used = new Set(l.cameras.map((c) => `${c.x}_${c.y}`));
    const [x, y] = wallAnchors(l.widthM, l.heightM, l.gridM, l.floorPolygon).find(([ax, ay]) => !used.has(`${ax}_${ay}`)) ?? [0, 0];
    const pan = (Math.atan2(l.heightM / 2 - y, l.widthM / 2 - x) * 180) / Math.PI;
    let index = 1;
    while (l.cameras.some((camera) => camera.id === `CAM-${String(index).padStart(2, '0')}`)) index++;
    return { ...l, cameras: [...l.cameras, normalizeCameraPlacement({ ...makeCamera(`CAM-${String(index).padStart(2, '0')}`, x, y, pan), target: 'Giám sát bổ sung' }, l)] };
  });
  const addCameraAt = (x: number, y: number, mount: 'wall' | 'ceiling') => {
    const l = layoutRef.current;
    if (l.cameras.length >= MAX_CAMS) return flash('Mặt bằng đã đạt giới hạn 20 camera.', 'error');
    let index = 1;
    while (l.cameras.some(c => c.id === `CAM-${String(index).padStart(2, '0')}`)) index++;
    const camera = placeEditedCamera({ ...makeCamera(`CAM-${String(index).padStart(2, '0')}`, x, y, 90), mount, tilt: mount === 'ceiling' ? 45 : 20, target: mount === 'ceiling' ? 'Giám sát từ trần' : 'Giám sát bổ sung' }, l);
    if (!camera || l.cameras.some(c => cameraMount(c) === mount && Math.hypot(c.x - camera.x, c.y - camera.y) < .2)) return flash('Vị trí lắp camera vướng vật thể hoặc trùng camera hiện có.', 'error');
    setLayout({ ...l, cameras: [...l.cameras, camera] }); select({ kind: 'cam', id: camera.id });
  };
  const addCeilingCamera = () => {
    const point = ceilingInsertionPoint(layoutRef.current);
    if (point) addCameraAt(...point, 'ceiling');
    else flash('Không còn vị trí trần hợp lệ.', 'error');
  };
  const addPerson = (x: number, y: number) => {
    if (people.length >= MAX_PEOPLE) return flash(`Mặt bằng đã có ${MAX_PEOPLE} người.`, 'error');
    if (!canPlacePerson(x, y, layout.widthM, layout.heightM, layout.obstacles, layout.floorPolygon)) return flash('Không thể đặt người sát tường hoặc chồng lên vật cản');
    const used = new Set(people.map((person) => person.id));
    let index = 1;
    while (used.has(`PERSON-${String(index).padStart(2, '0')}`)) index++;
    const person = { id: `PERSON-${String(index).padStart(2, '0')}`, x, y };
    setPeople((current) => [...current, person]);
    select({ kind: 'person', id: person.id });
    setTool('select');
  };
  const addPersonInFreeSpace = () => {
    const points: [number, number][] = [];
    const spacing = Math.max(0.5, layout.gridM);
    for (let y = spacing; y < layout.heightM; y += spacing) for (let x = spacing; x < layout.widthM; x += spacing) points.push([x, y]);
    points.sort((a, b) => Math.hypot(a[0] - layout.widthM / 2, a[1] - layout.heightM / 2) - Math.hypot(b[0] - layout.widthM / 2, b[1] - layout.heightM / 2));
    const spot = points.find(([x, y]) => canPlacePerson(x, y, layout.widthM, layout.heightM, layout.obstacles, layout.floorPolygon) && people.every(person => Math.hypot(x - person.x, y - person.y) >= 0.6));
    if (spot) addPerson(...spot);
    else flash('Không còn vị trí trống để thêm người.', 'error');
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
    if (!Number.isInteger(count) || count < 1 || count > MAX_CAMS) return flash('Nhập số camera nguyên từ 1 đến 20.', 'error');
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
      const { cameras } = await requestOptimize(layout, zones, count, cameraProfiles, controller.signal);
      if (controller.signal.aborted) return flash('Đã hủy tối ưu.');
      if (layoutRef.current !== inputLayout) return flash('Mặt bằng đã thay đổi. Hãy tối ưu lại với cấu hình mới.', 'error');
      const t1 = performance.now();
      setSel(null);
      const after = { ...inputLayout, cameras };
      setLayout(after);
      setComparison({ before: inputLayout, after, score }); goStep('results'); setSolveMs(t1 - t0);
      flash(`Đã tối ưu ${cameras.length}/${count} camera.`);
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
    setMsg('Đang tìm số camera theo KPI Đỏ ≥95% và Vàng ≥80%…');
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
      setComparison({ before: inputLayout, after, score }); goStep('results');
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
    setMsg('Đang tính phương án không trọng số…');
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
  const stress = () => setLayout((l) => ({ ...l, cameras: Array.from({ length: MAX_CAMS }, (_, i) => { const a = wallAnchors(l.widthM, l.heightM, l.gridM, l.floorPolygon); const [x, y] = a[Math.floor((i * a.length) / MAX_CAMS)]; return normalizeCameraPlacement(makeCamera(`CAM-${String(i + 1).padStart(2, '0')}`, x, y, (Math.atan2(l.heightM / 2 - y, l.widthM / 2 - x) * 180) / Math.PI), l); }) }));

  const savePng = async () => {
    if (!stageRef.current) return;
    const { default: Konva } = await import('konva');
    const worldWidth = displayedLayout.widthM * displayedLayout.pixelsPerMeter + PAD * 2;
    const worldHeight = displayedLayout.heightM * displayedLayout.pixelsPerMeter + PAD * 2;
    const imageWidth = worldWidth + 220, imageHeight = Math.max(worldHeight, 74 + displayedLayout.cameras.length * 56);
    const exportScale = Math.min(1, 1024 / Math.max(imageWidth, imageHeight));
    const imageStage = stageRef.current.clone({
      container: document.createElement('div'),
      width: Math.ceil(imageWidth * exportScale),
      height: Math.ceil(imageHeight * exportScale),
      x: 0, y: 0, scaleX: exportScale, scaleY: exportScale
    });
    try {
      const background = new Konva.Layer({ listening: false });
      background.add(new Konva.Rect({ width: imageWidth, height: imageHeight, fill: '#fafbf6' }));
      imageStage.add(background); background.moveToBottom();
      const schedule = new Konva.Layer({ listening: false });
      schedule.add(new Konva.Rect({ x: worldWidth, width: 220, height: imageHeight, fill: '#f7f7ef', stroke: '#dedfd3', strokeWidth: 1 }));
      schedule.add(new Konva.Text({ x: worldWidth + 18, y: 24, text: 'CAMERA', fontSize: 13, fontStyle: 'bold', fill: '#3f4d34' }));
      displayedLayout.cameras.forEach((camera, index) => {
        const y = 58 + index * 56;
        schedule.add(new Konva.Text({ x: worldWidth + 18, y, width: 188, text: `${cameraNumber(index)} · ${camera.id} · ${camera.pan}°`, fontSize: 11, fontStyle: 'bold', fill: '#3f4d34', wrap: 'none', ellipsis: true }));
        schedule.add(new Konva.Text({ x: worldWidth + 18, y: y + 18, text: `${cameraMount(camera) === 'ceiling' ? 'Trần' : 'Tường'} · FOV ${camera.fov}° · H ${camera.height} m`, fontSize: 10, fill: '#737c65' }));
        if (camera.target) schedule.add(new Konva.Text({ x: worldWidth + 18, y: y + 33, width: 188, text: camera.target, fontSize: 9, fill: '#848778', wrap: 'none', ellipsis: true }));
      });
      imageStage.add(schedule);
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
  const openProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return flash('Tệp vượt giới hạn 5 MB.', 'error');
    const reader = new FileReader();
    reader.onerror = () => flash('Không đọc được tệp đã chọn.', 'error');
    reader.onload = () => {
      try {
        if (loadLayout(parseBundle(String(reader.result)))) { goStep('plan'); flash('Đã nạp dự án'); }
      } catch (error) {
        flash(`Lỗi — ${(error as Error).message}`, 'error');
      }
    };
    reader.readAsText(file);
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
      if (dimension === '3d' && cameraViewId && ['c', 'r', 'delete', 'backspace'].includes(k)) return;
      if (k === 'escape') { if (pendingLayout) { setPendingLayout(null); return; } setBrush(null); setTool('select'); setSel(null); setMeasure(null); setCameraViewId(null); } else if (k === 'b') setBom((v) => !v); else if (k === 'o' && isPlanning) (document.getElementById(CAMERA_OPTIMIZATION_FORM) as HTMLFormElement | null)?.requestSubmit();
      else if (k === 'g') setGrid((v) => !v); else if (k === 'a') setAnchors((v) => !v); else if (k === 'c' && isPlanning) addCamera();
      else if (k === 'r') rotate(1); else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (/^[1-9]$/.test(k) && Number(k) <= PRESETS.length) loadLayout(withManualCams(PRESETS[+k - 1]), true);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    setUnweighted(null);
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
  const displayedCells = showBefore && beforeEvaluation ? beforeEvaluation.cells : cells;
  const cameraView = displayedLayout.cameras.find(camera => camera.id === cameraViewId) ?? null;
  useEffect(() => {
    if (sel?.kind === 'cam' && !displayedLayout.cameras.some(camera => camera.id === sel.id)) setSel(null);
    if (sel?.kind === 'obs' && !displayedLayout.obstacles.some(obstacle => obstacle.id === sel.id)) setSel(null);
    if (sel?.kind === 'person' && !people.some(person => person.id === sel.id)) setSel(null);
    if (cameraViewId && !displayedLayout.cameras.some(camera => camera.id === cameraViewId)) setCameraViewId(null);
  }, [people, displayedLayout.cameras, displayedLayout.obstacles, sel, cameraViewId]);
  const goStep = (next: Step) => {
    setStep(next); setShowBefore(false); setBrush(null); setTool('select'); setSel(null); setMeasure(null);
    setView(next === 'results' ? 'dori' : 'off');
  };
  const openCameraView = (id: string) => { setCameraViewId(id); select({ kind: 'cam', id }); };
  const openPlanEditor = () => {
    setDimension('plan');
    if (!isPlanning) {
      goStep('plan');
      if (!showBefore) select(sel);
    }
  };
  const toggleGroup = (next: PlanGroup) => {
    setGroup(group === next ? null : next);
    if (brush !== null) setBrush(null);
  };
  const selectedPreset = PRESETS.findIndex((preset) => preset.name === layout.name);
  return (
    <div className="app">
      <header className="app-header">
        <a className="brand-lockup" href="#" onClick={(event) => { event.preventDefault(); goStep('plan'); }} aria-label="OptiCam Studio, về mặt bằng">
          <span className="brand-mark"><ScanLine size={21} strokeWidth={1.5} /></span>
          <span className="wordmark">OptiCam<span>STUDIO</span></span>
        </a>
        <span className="header-divider" />
        <label className="project-picker"><span className="eyebrow">DỰ ÁN HIỆN TẠI</span>
          <select aria-label="Chọn mặt bằng cửa hàng" value={selectedPreset < 0 ? '' : selectedPreset} onChange={(event) => {
            const preset = PRESETS[Number(event.target.value)];
            if (preset) loadLayout(withManualCams(preset), true);
          }}>
            {selectedPreset < 0 && <option value="">Mặt bằng tùy chỉnh</option>}
            {PRESETS.map((preset, index) => <option key={preset.name} value={index}>{preset.name}</option>)}
          </select>
        </label>
        <nav className="workflow" aria-label="Quy trình thiết kế">
          {STEPS.map(({ id, title, icon: Icon }) => <button key={id} className={`workflow-step${step === id ? ' current' : ''}`} aria-current={step === id ? 'step' : undefined} onClick={() => { if (step !== id) goStep(id); }}>
            <Icon size={16} aria-hidden="true" /><strong>{title}</strong>
          </button>)}
        </nav>
        <div className="history-actions">
          <button onClick={undo} disabled={!undoReady} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác"><Undo2 size={17} /></button>
          <button onClick={redo} disabled={!redoReady} title="Làm lại (Ctrl+Y)" aria-label="Làm lại"><Redo2 size={17} /></button>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => setShowTutorial(true)} title="Hướng dẫn nhanh" aria-label="Hướng dẫn nhanh"><HelpCircle size={17} /></button>
          <details className="export-menu"><summary aria-label="Xuất dự án"><Download size={15} /><span>Xuất dự án</span><ChevronDown size={13} /></summary>
            <div className="menu-popover">
              <button onClick={() => download('opticam_layout.json', exportBundle({ ...layout, people }, score))}>Lưu dự án JSON</button>
              <button onClick={() => savePng().catch(() => flash('Không thể xuất ảnh PNG.', 'error'))}>Xuất bản vẽ PNG</button>
              <label className="btn">Mở dự án JSON<input type="file" accept=".json" hidden onChange={openProject} /></label>
            </div>
          </details>
          {optimizing && <button onClick={() => optimizationController.current?.abort()}>Hủy</button>}
        </div>
      </header>
      <main className={`planner${dimension === '3d' ? ' planner-3d' : ''}`}>
        <section className="workspace" aria-label="Không gian thiết kế">
          <div className="workspace-heading">
            <h1>{dimension === '3d' ? 'Không gian cửa hàng' : 'Mặt bằng cửa hàng'}</h1>
            <span className="drawing-id">{displayedLayout.widthM} × {displayedLayout.heightM} m · {floorArea(displayedLayout)} m²</span>
          </div>
          <div className="workspace-controls">
            <div className="layer-switch" role="group" aria-label="Lớp phân tích">
              {(['off', 'dori', 'risk'] as ViewMode[]).map((mode) => <button key={mode} className={view === mode ? 'on' : ''} aria-pressed={view === mode} onClick={() => setView(mode)}>
                {mode === 'off' ? <Map size={14} /> : mode === 'dori' ? <Layers size={14} /> : <ShieldCheck size={14} />}
                {{ off: 'Mặt bằng', dori: 'Chất lượng DORI', risk: 'Vùng ưu tiên' }[mode]}
              </button>)}
            </div>
            <div className="canvas-options">
              <div className="dimension-switch" role="group" aria-label="Chế độ hiển thị">
                <button className={dimension === 'plan' ? 'on' : ''} aria-pressed={dimension === 'plan'} onClick={() => setDimension('plan')}>2.5D</button>
                <button className={dimension === '3d' ? 'on' : ''} aria-pressed={dimension === '3d'} onClick={() => { setDimension('3d'); setBrush(null); setTool('select'); setMeasure(null); }}>3D</button>
              </div>
              <button className={grid ? 'on' : ''} onClick={() => setGrid(!grid)} aria-pressed={grid} title={view === 'risk' ? 'Ranh giới mức ưu tiên' : 'Bật / tắt lưới'} aria-label="Bật tắt lưới"><Grid2X2 size={16} /></button>
              <button className={anchors ? 'on' : ''} onClick={() => setAnchors(!anchors)} aria-pressed={anchors} title="Điểm gắn camera trên tường" aria-label="Bật tắt điểm neo"><Crosshair size={16} /></button>
            </div>
          </div>
          <div className="drawing-area">
            {dimension === 'plan' && isPlanning && <nav className="tool-rail" aria-label="Công cụ mặt bằng">
              <button className={`rail-button${tool === 'select' && brush === null ? ' active' : ''}`} aria-pressed={tool === 'select' && brush === null} title="Chọn và kéo đối tượng" onClick={() => { setBrush(null); setTool('select'); }}><MousePointer2 size={19} /><small>Chọn</small></button>
              <button className="rail-button" disabled={showBefore} title="Thêm kệ hàng" onClick={() => addObs('shelf')}><Columns3 size={19} /><small>Kệ</small></button>
              <button className="rail-button" disabled={showBefore} title="Thêm quầy POS" onClick={() => addObs('pos')}><Monitor size={19} /><small>POS</small></button>
              <button className="rail-button" disabled={showBefore} title="Thêm cửa ra vào" onClick={() => addObs('entrance')}><DoorOpen size={19} /><small>Cửa</small></button>
              <button className={`rail-button${tool === 'measure' ? ' active' : ''}`} aria-pressed={tool === 'measure'} title="Đo khoảng cách" onClick={() => { setTool(tool === 'measure' ? 'select' : 'measure'); setBrush(null); setMeasure(null); }}><Ruler size={19} /><small>Đo</small></button>
              <button className="rail-button" disabled={layout.cameras.length >= MAX_CAMS} title="Thêm camera (C)" aria-label="Thêm camera trên tường" onClick={addCamera}><CameraIcon size={19} /><small>Tường</small></button>
              <button className="rail-button" disabled={layout.cameras.length >= MAX_CAMS} title="Thêm camera trên trần" onClick={addCeilingCamera}><CameraIcon size={19} /><small>Trần</small></button>
              <button className={`rail-button${tool === 'person' ? ' active' : ''}`} disabled={showBefore} aria-pressed={tool === 'person'} title="Đặt người kiểm tra DORI" onClick={() => { setTool(tool === 'person' ? 'select' : 'person'); setBrush(null); }}><UserRound size={19} /><small>Kiểm tra</small></button>
            </nav>}
            <div className="plan-viewport" hidden={dimension !== 'plan'}>
              <OptiCamCanvas layout={displayedLayout} cells={displayedCells} view={view} tool={tool} brush={brush} selected={sel} people={people} riskFilter={riskFilter} focusCell={focusCell} readOnly={showBefore}
                onRiskFilter={setRiskFilter} onAddPerson={addPerson} onPerson={updatePerson} onInvalidPerson={() => flash('Không thể đặt người sát tường hoặc chồng lên vật cản')} showGrid={grid} showAnchors={anchors} measure={measure} stageRef={stageRef} drawMsRef={drawMsRef}
                onCamera={updateCamera} onObstacle={updateObstacle} onPaint={paint} onSelect={select} onRotate={rotate} onMeasure={setMeasure} />
              {isPlanning && <CameraSchedule cameras={displayedLayout.cameras} selected={sel} onSelect={select} />}
            </div>
            {dimension === '3d' && <SceneBoundary onEditPlan={openPlanEditor}><Suspense fallback={<div className="three-loading" role="status"><span className="spinner" /> Đang dựng không gian 3D…</div>}>
              <Store3D layout={displayedLayout} cells={displayedCells} view={view} selected={sel} people={people}
                showGrid={grid} showAnchors={anchors} riskFilter={riskFilter} focusCell={focusCell} cameraView={cameraView}
                readOnly={showBefore} onMoveObstacle={moveObstacle3D} onMovePerson={updatePerson} onAddObstacle={isPlanning ? addObs : undefined} onAddPerson={isPlanning ? addPersonInFreeSpace : undefined} onAddCamera={isPlanning ? addCameraAt : undefined} onMoveCamera={moveCamera3D}
                onRotateSelected={() => rotate(1)} onDeleteSelected={deleteSelected}
                onSelect={select} onCameraView={openCameraView} onOverview={() => setCameraViewId(null)} onEditPlan={openPlanEditor} />
            </Suspense></SceneBoundary>}
            {comparison && !isPlanning && <div className="comparison-switch" role="group" aria-label="So sánh trước và sau tối ưu">
              <button className={showBefore ? 'on' : ''} aria-pressed={showBefore} onClick={() => { setShowBefore(true); setSel(null); setTool('select'); setBrush(null); }}>Trước tối ưu</button>
              <button className={!showBefore ? 'on' : ''} aria-pressed={!showBefore} onClick={() => setShowBefore(false)}>Sau tối ưu</button>
            </div>}
          </div>
          <div className="drawing-caption">
            <div className="legend">{view === 'dori' ? (['identification', 'recognition', 'observation', 'detection', 'blind'] as const).map((key) => <span key={key}><i style={{ background: DORI_COLOR[key] }} />{{ identification: 'Nhận dạng ≥250', recognition: 'Nhận biết ≥125', observation: 'Quan sát ≥62,5', detection: 'Phát hiện ≥25', blind: 'Dưới 25 PPM' }[key]}</span>) : null}</div>
            <span className="drawing-scale">1 ô = {displayedLayout.gridM} m</span>
          </div>
          <div className="canvas-footer"><span>{dimension === 'plan' ? 'Kéo nền để di chuyển · Cuộn để thu phóng' : 'Xoay để quan sát · Chọn Di chuyển để bố trí vật thể'}</span>{sel && <span>Đang chọn {sel.id}</span>}</div>
        </section>
        <aside className="inspector-column" aria-labelledby="sidebar-title">
          <div className="context-heading"><h2 id="sidebar-title">{isPlanning ? 'Thiết lập mặt bằng' : 'Kết quả'}</h2></div>
          <div className="sidebar-body">
            {isPlanning ? <>
              <PlanSection id="room" title="Kích thước và nội thất" icon={Ruler} expanded={group === 'room'} onToggle={() => toggleGroup('room')}>
                <PlanningSettings layout={layout} disabled={optimizing || (dimension === '3d' && Boolean(cameraView))}
                  onRoom={setRoom} onGrid={setGridSize} onScale={pixelsPerMeter => patch({ pixelsPerMeter })} onCeilingHeight={setCeilingHeight} />
                {group === 'room' && (dimension === 'plan'
                  ? <Inspector mode="room" layout={layout} sel={sel} onSelect={select} onObs={editObstacle} onCam={editCamera} />
                  : <SceneInspector mode="room" layout={layout} selected={sel} people={people} onSelect={select} onEdit={openPlanEditor}
                      readOnly={Boolean(cameraView)} onRotateSelected={() => rotate(1)} onDeleteSelected={deleteSelected} />)}
                {dimension === 'plan' && <button className="wall-shelf-add" onClick={() => addObs('shelf', 'wall-shelf')}>Thêm kệ một mặt sát tường</button>}
              </PlanSection>
              <PlanSection id="priority" title="Vùng ưu tiên" icon={ShieldCheck} expanded={group === 'priority'} onToggle={() => toggleGroup('priority')}>
                <section className="panel priority-editor">
                  <h3>Cọ vùng ưu tiên</h3>
                  <div className="brush-options">
                    {([5, 3, 1] as Weight[]).map(weight => <button key={weight} disabled={layout.riskStrokes.length >= 50000}
                      className={brush === weight ? 'on' : ''} aria-pressed={brush === weight}
                      onClick={() => { setDimension('plan'); setBrush(brush === weight ? null : weight); setTool('select'); setView('risk'); }}>
                      <i className={`risk-dot risk-${weight}`} />{weight === 5 ? 'Cao' : weight === 3 ? 'Vừa' : 'Thấp'}
                    </button>)}
                  </div>
                  <button className="text-button" disabled={!layout.riskStrokes.length && !Object.keys(layout.risk).length}
                    onClick={() => { if (window.confirm('Xóa toàn bộ vùng ưu tiên đã tô?')) patch({ risk: {}, riskStrokes: [] }); setBrush(null); }}>
                    <Eraser size={14} /> Xóa vùng đã tô
                  </button>
                </section>
                {group === 'priority' && <Inspector mode="risk" layout={layout} sel={sel} onSelect={select} onObs={editObstacle} onCam={editCamera} />}
              </PlanSection>
              <PlanSection id="camera" title="Camera và tối ưu" icon={CameraIcon} expanded={group === 'camera'} onToggle={() => toggleGroup('camera')}>
                <CameraCountOptimizer key={layout.name} count={cameraBudget} mounts={layout.optimization?.mounts ?? 'mixed'} dualHeight={Boolean(layout.optimization?.dualHeight)}
                  onCountChange={setCameraBudget} onOptimize={autoOptimize} onInvalid={() => { setGroup('camera'); setBrush(null); }} disabled={optimizing}
                  onMounts={mounts => patch({ optimization: { algorithm: layout.optimization?.algorithm ?? 'kpi_hybrid', mounts, ...(layout.optimization?.dualHeight ? { dualHeight: true } : {}) } })}
                  onDualHeight={dualHeight => patch({ optimization: { algorithm: layout.optimization?.algorithm ?? 'kpi_hybrid', mounts: layout.optimization?.mounts ?? 'mixed', ...(dualHeight ? { dualHeight: true } : {}) } })} />
                {group === 'camera' && (dimension === 'plan'
                  ? <Inspector mode="camera" layout={layout} sel={sel} onSelect={select} onObs={editObstacle} onCam={editCamera} />
                  : <SceneInspector mode="camera" layout={layout} selected={sel} people={people} onSelect={select} onEdit={openPlanEditor}
                      readOnly={Boolean(cameraView)} onRotateSelected={() => rotate(1)} onDeleteSelected={deleteSelected} onCameraPatch={editCamera} />)}
                {dimension === 'plan' && <details className="panel advanced-panel">
                  <summary>Tùy chọn tối ưu</summary>
                  <div className="project-actions">
                    <button onClick={() => autoOptimize(layout.cameras.length)} disabled={optimizing}>Tối ưu {layout.cameras.length} camera hiện có</button>
                    <button onClick={minimizeCameras} disabled={optimizing}>Giảm số camera theo KPI</button>
                    <button onClick={() => setLayout((current) => ({ ...current, cameras: manualFourCorners(current) }))}>Đặt 4 camera ở góc tường</button>
                    <button onClick={benchmark} disabled={optimizing}>Đo hiệu năng · 20 camera</button>
                  </div>
                </details>}
              </PlanSection>
              {dimension === 'plan' && sel && group !== 'priority' && <div className="selection-actions">
                <button onClick={() => rotate(1)} disabled={sel.kind === 'person'}><RotateCw size={14} /> Xoay 15°</button>
                <button onClick={deleteSelected}><Trash2 size={14} /> Xóa</button>
              </div>}
            </> : <>
              <Scorecard d={{ manual, live: score, unweighted, solveMs, renderMs, heatMs: drawMsRef.current, before: comparison?.score }} preview={showBefore ? comparison?.score : undefined} view="dori" riskMetrics={riskMetrics} onFocusHighUncovered={() => { if (riskMetrics.firstUncovered) { setShowBefore(false); setView('risk'); setRiskFilter('high'); setCameraViewId(null); setFocusCell({ ...riskMetrics.firstUncovered }); } }} />
              <section className="panel result-actions">
                <h3>Độ phủ vùng ưu tiên cao</h3>
                <p>{riskMetrics.uncoveredHigh
                  ? `${riskMetrics.uncoveredHigh} ô chưa có camera quan sát.`
                  : riskMetrics.highTotal ? 'Camera đã phủ toàn bộ vùng ưu tiên cao.' : 'Chưa có vùng ưu tiên cao trên mặt bằng.'}</p>
                {riskMetrics.firstUncovered && <button onClick={() => {
                  setShowBefore(false); setView('risk'); setRiskFilter('high'); setCameraViewId(null);
                  setFocusCell(riskMetrics.firstUncovered ? { ...riskMetrics.firstUncovered } : null);
                }}><Crosshair size={15} /> Xem vùng chưa phủ</button>}
                <button onClick={runUnweighted} disabled={optimizing}>So sánh không trọng số</button>
                <button onClick={() => setBom(true)}><Download size={15} /> Vật tư & chi phí</button>
              </section>
            </>}
          </div>
          <div className="sidebar-footer">
            {isPlanning
              ? <button type="submit" form={CAMERA_OPTIMIZATION_FORM} className="primary" disabled={optimizing}>
                  {optimizing ? <span className="spinner" /> : <ScanLine size={16} />} {optimizing ? 'Đang tối ưu…' : 'Tối ưu phương án'}
                </button>
              : <button onClick={() => goStep('plan')}><ArrowLeft size={16} /> Chỉnh sửa mặt bằng</button>}
          </div>
        </aside>
      </main>
      <footer className="studio-status">
        <span><i className="status-dot" /> {showBefore ? 'Trước tối ưu' : 'Phân tích trực tiếp'}</span>
        <span className="status-shortcuts">{isPlanning && <><kbd>O</kbd> tối ưu </>}<kbd>G</kbd> lưới <kbd>Esc</kbd> bỏ chọn</span>
      </footer>
      {bom && <BomModal layout={layout} onClose={closeBom} />}
      {showTutorial && <TutorialModal onClose={closeTutorial} />}
      {pendingLayout && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="layout-confirm-title" onClick={(event) => { if (event.target === event.currentTarget) setPendingLayout(null); }}>
          <div className="modal-box confirm-modal">
            <h2 id="layout-confirm-title">Thay đổi mặt bằng cửa hàng?</h2>
            <p className="confirm-body">Các thay đổi chưa xuất trên mặt bằng <strong>{layout.name}</strong> sẽ bị mất khi chuyển sang <strong>{pendingLayout.layout.name}</strong>.</p>
            <div className="confirm-actions">
              <button type="button" onClick={() => setPendingLayout(null)}>Hủy</button>
              <button type="button" className="primary" onClick={() => { const next = pendingLayout; setPendingLayout(null); applyLayout(next.layout, next.goPlan); }}>Đổi mặt bằng</button>
            </div>
          </div>
        </div>
      )}
      {msg && <div className={`toast${optimizing ? ' toast-busy' : messageTone === 'error' ? ' toast-error' : ''}`} role="status" aria-live="polite">{optimizing && <span className="spinner" />} {msg}</div>}
    </div>
  );
}
