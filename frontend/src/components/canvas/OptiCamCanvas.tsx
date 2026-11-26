import { floorOutline, pointInFloor } from '../../core/footprint';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Camera, Cell, Layout, Obstacle, Person, RiskStroke, Weight } from '../../types';
import { buildObstacleFromDraft, buildWallObstacle, type PlacementDraft } from '../../core/editor';
import { clamp, distToObs, round2, wallAnchors, type Pt } from '../../core/geometry';
import { assessPersonAt, obstacleRiskWmax, riskWeightAt, RISK_DEFAULTS } from '../../core/optics';
import { canPlacePerson } from '../../core/person';
import { BaseGridLayer } from './BaseGridLayer';
import { CameraNode } from './CameraNode';
import { HeatmapLayer } from './HeatmapLayer';
import { ObstacleNode } from './ObstacleNode';
import { PersonNode } from './PersonNode';
import { PersonInfo } from './PersonInfo';
import { HANDLE, PAD, priorityColor, riskColor, type PriorityBand, type Segment, type Selection, type Tool, type ViewMode } from './shared';
import { RiskLegend } from './RiskLegend';
import { cameraNumber, ceilingHeightFor } from '../../core/camera';

export interface CanvasProps {
  readOnly?: boolean;
  layout: Layout; cells: Cell[]; view: ViewMode; tool: Tool; brush: Weight | null; selected: Selection;
  riskFilter: PriorityBand | null; focusCell: { r: number; c: number } | null;
  onRiskFilter: (filter: PriorityBand | null) => void;
  showGrid: boolean; showAnchors: boolean; measure: Segment; stageRef: React.RefObject<Konva.Stage>; drawMsRef: { current: number };
  onCamera: (c: Camera) => void; onObstacle: (o: Obstacle) => void; onPaint: (strokes: RiskStroke[]) => void;
  people: Person[]; onAddPerson: (x: number, y: number) => void; onPerson: (person: Person) => void; onInvalidPerson: () => void;
  onSelect: (s: Selection) => void; onRotate: (dir: 1 | -1) => void; onMeasure: (s: Segment) => void;
  placing?: PlacementDraft | null;
  onPlaceObstacle?: (obstacle: Obstacle) => void;
  onCancelPlacing?: () => void;
  onAutoPlace?: () => void;
  onRotatePlacing?: (dir: 1 | -1) => void;
  onBuildWall?: (obstacle: Obstacle) => void;
  onCompletePolygon?: (points: Pt[]) => void;
  onExitTool?: () => void;
}

/** Ghép 4 Konva Layer + công cụ cọ rủi ro, đo khoảng cách, tooltip PPM. */
export function OptiCamCanvas(p: CanvasProps) {
  const { layout: L } = p, ppm = L.pixelsPerMeter, cellPx = L.gridM * ppm, cols = Math.round(L.widthM / L.gridM);
  const [hover, setHover] = useState<{
    cell: Cell; x: number; y: number; worldX: number; worldY: number;
    source: string; distance: number | null;
  } | null>(null);
  const painting = useRef(false), measuring = useRef(false);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const lastPaintPoint = useRef<[number, number] | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 640, height: 440 });
  const worldWidth = L.widthM * ppm + PAD * 2, worldHeight = L.heightM * ppm + PAD * 2;
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [placeCursor, setPlaceCursor] = useState<[number, number] | null>(null);
  const [wallStart, setWallStart] = useState<Pt | null>(null);
  const [wallCursor, setWallCursor] = useState<Pt | null>(null);
  const [wallHeight, setWallHeight] = useState<number>(() => ceilingHeightFor(L));
  const [wallOrtho, setWallOrtho] = useState(true);
  const [wallChain, setWallChain] = useState(true);
  const [polyPts, setPolyPts] = useState<Pt[]>([]);
  const [polyCursor, setPolyCursor] = useState<Pt | null>(null);
  const ceilingH = ceilingHeightFor(L);

  useEffect(() => { if (!p.placing) setPlaceCursor(null); }, [p.placing]);
  useEffect(() => {
    setWallHeight((prev) => Math.min(ceilingH, Math.max(0.4, prev)));
  }, [ceilingH]);
  useEffect(() => {
    if (p.tool !== 'wall') { setWallStart(null); setWallCursor(null); }
    if (p.tool !== 'polygon') { setPolyPts([]); setPolyCursor(null); }
  }, [p.tool]);

  const snapEndpoints = useMemo(() => {
    const pts: Pt[] = [...floorOutline(L)];
    for (const obs of L.obstacles) {
      if (obs.fixture !== 'partition') continue;
      const radAngle = (obs.angle * Math.PI) / 180;
      const cx = obs.x + obs.w / 2;
      const cy = obs.y + obs.h / 2;
      const half = obs.w / 2;
      pts.push([cx - half * Math.cos(radAngle), cy - half * Math.sin(radAngle)]);
      pts.push([cx + half * Math.cos(radAngle), cy + half * Math.sin(radAngle)]);
    }
    return pts;
  }, [L]);

  const snapWallPoint = useCallback((raw: Pt, anchor: Pt | null): Pt => {
    let x = round2(clamp(Math.round(raw[0] * 10) / 10, 0, L.widthM));
    let y = round2(clamp(Math.round(raw[1] * 10) / 10, 0, L.heightM));
    if (anchor && wallOrtho) {
      const dx = x - anchor[0];
      const dy = y - anchor[1];
      const len = Math.hypot(dx, dy);
      if (len >= 0.15) {
        const snappedAngle = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 45) * 45 * Math.PI) / 180;
        x = round2(clamp(anchor[0] + len * Math.cos(snappedAngle), 0, L.widthM));
        y = round2(clamp(anchor[1] + len * Math.sin(snappedAngle), 0, L.heightM));
      }
    }
    let bestDist = 0.24;
    for (const pt of snapEndpoints) {
      const d = Math.hypot(x - pt[0], y - pt[1]);
      if (d < bestDist) {
        bestDist = d;
        x = round2(pt[0]);
        y = round2(pt[1]);
      }
    }
    return [x, y];
  }, [L.widthM, L.heightM, snapEndpoints, wallOrtho]);

  const snapPolyPoint = useCallback((raw: Pt): Pt => {
    const step = Math.max(0.25, Math.min(L.gridM, 0.5));
    return [
      round2(clamp(Math.round(raw[0] / step) * step, 0, L.widthM)),
      round2(clamp(Math.round(raw[1] / step) * step, 0, L.heightM)),
    ];
  }, [L.gridM, L.widthM, L.heightM]);

  const anchors = useMemo(() => wallAnchors(L.widthM, L.heightM, L.gridM, L.floorPolygon), [L.widthM, L.heightM, L.gridM, L.floorPolygon]);
  const labelScale = 1 / Math.max(.55, zoom);
  const ghost = useMemo(
    () => (p.placing && placeCursor ? buildObstacleFromDraft(L, p.placing, placeCursor[0], placeCursor[1]) : null),
    [p.placing, placeCursor, L]
  );
  const wallPreview = useMemo(
    () => (p.tool === 'wall' && wallStart && wallCursor ? buildWallObstacle(L, wallStart, wallCursor, { elev: wallHeight }) : null),
    [p.tool, wallStart, wallCursor, L, wallHeight]
  );
  const numberMasks = useMemo(() => {
    const masks = L.cameras.map(camera => ({ x: camera.x * ppm - 24 * labelScale, y: camera.y * ppm - 24 * labelScale, width: 48 * labelScale, height: 48 * labelScale }));
    const camera = p.selected?.kind === 'cam' ? L.cameras.find(camera => camera.id === p.selected?.id) : undefined;
    if (camera) {
      const angle = camera.pan * Math.PI / 180;
      masks.push({ x: camera.x * ppm + HANDLE * Math.cos(angle) - 9 * labelScale, y: camera.y * ppm + HANDLE * Math.sin(angle) - 9 * labelScale, width: 18 * labelScale, height: 18 * labelScale });
    }
    return masks;
  }, [L.cameras, ppm, p.selected, labelScale]);
  const lock = p.readOnly || p.tool === 'measure' || p.tool === 'wall' || p.tool === 'polygon' || p.brush !== null || Boolean(p.placing); // khoá kéo thả khi đang cọ/đo/đặt đồ/dựng tường

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      setViewport({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const fitScale = Math.min(1.35, (viewport.width - 84) / worldWidth, (viewport.height - 64) / worldHeight);
    setZoom(fitScale);
    setPan({ x: 32 + (viewport.width - worldWidth * fitScale) / 2, y: (viewport.height - worldHeight * fitScale) / 2 });
  }, [viewport.width, viewport.height, worldWidth, worldHeight]);

  useEffect(() => { fitView(); setHover(null); }, [fitView, L.name]);

  useEffect(() => {
    if (!p.focusCell || !p.stageRef.current) return;
    const stage = p.stageRef.current, nextZoom = Math.max(zoom, 1.35);
    const targetX = PAD + (p.focusCell.c + 0.5) * cellPx, targetY = PAD + (p.focusCell.r + 0.5) * cellPx;
    setZoom(nextZoom);
    setPan({ x: stage.width() / 2 - targetX * nextZoom, y: stage.height() / 2 - targetY * nextZoom });
  }, [p.focusCell, cellPx]);

  const zoomAt = (factor: number, anchor?: { x: number; y: number }) => {
    const stage = p.stageRef.current;
    if (!stage) return;
    const position = anchor ?? { x: stage.width() / 2, y: stage.height() / 2 };
    const currentZoom = stage.scaleX(), nextZoom = Math.max(0.05, Math.min(2.5, currentZoom * factor));
    const worldX = (position.x - stage.x()) / currentZoom, worldY = (position.y - stage.y()) / currentZoom;
    setZoom(nextZoom);
    setPan({ x: position.x - worldX * nextZoom, y: position.y - worldY * nextZoom });
  };

  const resetView = () => { setZoom(1); setPan({ x: (viewport.width - worldWidth) / 2, y: (viewport.height - worldHeight) / 2 }); };

  const stagePosition = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = e.target.getStage(), pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() };
  };

  const meters = (e: Konva.KonvaEventObject<PointerEvent>): [number, number] | null => {
    const pos = stagePosition(e);
    return pos ? [round2((pos.x - PAD) / ppm), round2((pos.y - PAD) / ppm)] : null;
  };
  const cellAt = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const m = meters(e), world = stagePosition(e), rect = viewportRef.current?.getBoundingClientRect();
    if (!m || !world || !rect || (L.floorPolygon && !pointInFloor(m, L.floorPolygon))) return null;
    const c = Math.floor(m[0] / L.gridM), r = Math.floor(m[1] / L.gridM);
    return c < 0 || r < 0 || c >= cols || r * cols + c >= p.cells.length ? null : {
      r, c, world, x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top, cell: p.cells[r * cols + c]
    };
  };
  const paintAt = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (p.readOnly || !p.brush) return;
    const point = meters(e);
    if (!point || (L.floorPolygon && !pointInFloor(point, L.floorPolygon)) || point[0] < 0 || point[1] < 0 || point[0] > L.widthM || point[1] > L.heightM) return;
    const radius = Math.max(0.05, L.gridM / Math.SQRT2);
    const previous = lastPaintPoint.current;
    const distance = previous ? Math.hypot(point[0] - previous[0], point[1] - previous[1]) : 0;
    const steps = previous ? Math.max(1, Math.ceil(distance / radius)) : 0;
    const strokes: RiskStroke[] = [];
    if (!previous) strokes.push({ x: point[0], y: point[1], radius, weight: p.brush });
    else for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = previous[0] + (point[0] - previous[0]) * t;
      const y = previous[1] + (point[1] - previous[1]) * t;
      if (x >= 0 && y >= 0 && x <= L.widthM && y <= L.heightM) strokes.push({ x, y, radius, weight: p.brush });
    }
    if (strokes.length) p.onPaint(strokes);
    lastPaintPoint.current = point;
  };
  const onDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (p.placing && !p.readOnly) return;
    if (e.target === e.target.getStage()) {
      p.onSelect(null);
      if (p.tool === 'select' && p.brush === null) {
        const pointer = e.target.getStage()?.getPointerPosition();
        if (pointer) {
          panStart.current = { x: pointer.x, y: pointer.y, panX: pan.x, panY: pan.y };
          setIsPanning(true);
        }
      }
    }
    if (p.tool === 'measure') { const m = meters(e); if (m) { measuring.current = true; p.onMeasure({ a: m, b: m }); } return; }
    if (p.brush) { painting.current = true; lastPaintPoint.current = null; paintAt(e); }
  };
  const onClick = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (p.placing && !p.readOnly) {
      const point = meters(e);
      if (!point) return;
      const preview = buildObstacleFromDraft(L, p.placing, point[0], point[1]);
      if (preview.valid) p.onPlaceObstacle?.(preview.obstacle);
      return;
    }
    if (p.tool === 'wall' && !p.readOnly) {
      const raw = meters(e);
      if (!raw) return;
      const snapped = snapWallPoint(raw, wallStart);
      if (!wallStart) {
        setWallStart(snapped);
        setWallCursor(snapped);
        return;
      }
      const preview = buildWallObstacle(L, wallStart, snapped, { elev: wallHeight });
      if (preview.valid) {
        p.onBuildWall?.(preview.obstacle);
        if (wallChain) {
          setWallStart(snapped);
          setWallCursor(snapped);
        } else {
          setWallStart(null);
          setWallCursor(null);
        }
      }
      return;
    }
    if (p.tool === 'polygon' && !p.readOnly) {
      const raw = meters(e);
      if (!raw) return;
      const pt = snapPolyPoint(raw);
      if (polyPts.length >= 3 && Math.hypot(pt[0] - polyPts[0][0], pt[1] - polyPts[0][1]) < 0.35) {
        p.onCompletePolygon?.(polyPts);
        return;
      }
      if (!polyPts.length || Math.hypot(pt[0] - polyPts[polyPts.length - 1][0], pt[1] - polyPts[polyPts.length - 1][1]) >= 0.2) {
        setPolyPts((cur) => [...cur, pt]);
      }
      return;
    }
    if (p.readOnly || p.tool !== 'person' || e.target.findAncestor('.person-node', true)) return;
    const point = meters(e);
    if (!point || (L.floorPolygon && !pointInFloor(point, L.floorPolygon)) || point[0] < 0 || point[1] < 0 || point[0] > L.widthM || point[1] > L.heightM) return;
    if (canPlacePerson(point[0], point[1], L.widthM, L.heightM, L.obstacles, L.floorPolygon)) p.onAddPerson(point[0], point[1]);
    else p.onInvalidPerson();
  };
  const onMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (p.placing && !p.readOnly) {
      const m = meters(e);
      if (m) setPlaceCursor(m);
      setHover(null);
      return;
    }
    if (p.tool === 'wall' && !p.readOnly) {
      const raw = meters(e);
      if (raw) setWallCursor(snapWallPoint(raw, wallStart));
      setHover(null);
      return;
    }
    if (p.tool === 'polygon' && !p.readOnly) {
      const raw = meters(e);
      if (raw) setPolyCursor(snapPolyPoint(raw));
      setHover(null);
      return;
    }
    if (panStart.current) {
      const pointer = e.target.getStage()?.getPointerPosition(), start = panStart.current;
      if (pointer) setPan({ x: start.panX + pointer.x - start.x, y: start.panY + pointer.y - start.y });
      setHover(null);
      return;
    }
    const h = cellAt(e);
    if (h) {
      const activeStroke = [...L.riskStrokes].reverse().find((stroke) =>
        Math.hypot(h.cell.cx - stroke.x, h.cell.cy - stroke.y) <= stroke.radius
      );
      let source = activeStroke ? 'Cọ thủ công' : 'Trọng số nền';
      let distance: number | null = null;
      if (!activeStroke) {
        let contribution = 1;
        for (const obstacle of L.obstacles) {
          const defaults = RISK_DEFAULTS[obstacle.type];
          const obstacleDistance = distToObs(h.cell.cx, h.cell.cy, obstacle);
          const weight = riskWeightAt(
            obstacleDistance,
            obstacleRiskWmax(obstacle),
            obstacle.riskR0 ?? defaults.r0,
            obstacle.riskR ?? defaults.radius
          );
          if (weight > contribution) {
            contribution = weight;
            source = obstacle.label;
            distance = obstacleDistance;
          }
        }
      }
      setHover({ cell: h.cell, x: h.x, y: h.y, worldX: h.world.x, worldY: h.world.y, source, distance });
    } else {
      setHover(null);
    }
    if (measuring.current && p.measure) { const m = meters(e); if (m) p.onMeasure({ a: p.measure.a, b: m }); }
    if (painting.current && p.brush) paintAt(e);
  };
  const m = p.measure, mLen = m ? Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) : 0;

  return (
    <div className="canvas-stack">
    <div className="canvas-view-controls" role="group" aria-label="Thu phóng sơ đồ">
      <button title="Thu nhỏ" aria-label="Thu nhỏ" onClick={() => zoomAt(0.85)}>−</button>
      <span>{Math.round(zoom * 100)}%</span>
      <button title="Phóng to" aria-label="Phóng to" onClick={() => zoomAt(1.18)}>+</button>
      <button onClick={fitView}>Vừa khung</button>
      <button onClick={resetView}>100%</button>
    </div>
    <div ref={viewportRef} className="stage-wrap" aria-label="Sơ đồ bố trí camera và mặt bằng cửa hàng" style={{ cursor: isPanning ? 'grabbing' : p.placing || p.tool === 'wall' || p.tool === 'polygon' || p.tool === 'measure' || p.tool === 'person' && !p.readOnly || p.brush !== null ? 'crosshair' : 'grab' }}>
      {p.placing && !p.readOnly && (
        <div className="placement-banner" role="status">
          <span>Đang đặt: <strong>{p.placing.label}</strong> ({p.placing.w}×{p.placing.h} m) · Di chuột &amp; bấm mặt bằng</span>
          <div className="placement-banner-actions">
            {p.placing.type !== 'entrance' && p.onRotatePlacing && (
              <button type="button" onClick={() => p.onRotatePlacing?.(1)} title="Xoay 15° (R)">↻ Xoay</button>
            )}
            {p.onAutoPlace && (
              <button type="button" className="primary" onClick={p.onAutoPlace}>Đặt tự động</button>
            )}
            {p.onCancelPlacing && (
              <button type="button" onClick={p.onCancelPlacing}>Hủy</button>
            )}
          </div>
        </div>
      )}
      {p.tool === 'wall' && !p.readOnly && (
        <div className="placement-banner wall-banner" role="status">
          <span>
            <strong>Dựng tường</strong> · {wallStart ? 'Chọn điểm cuối' : 'Chấm điểm đầu'}
          </span>
          <div className="placement-banner-actions">
            {([
              [ceilingH, `Kịch trần ${ceilingH}m`],
              [Math.min(1.5, ceilingH), 'Lửng 1.5m'],
              [Math.min(1.1, ceilingH), 'Quầy 1.1m'],
            ] as const).map(([hVal, lbl]) => (
              <button
                key={lbl}
                type="button"
                className={Math.abs(wallHeight - hVal) < 0.05 ? 'primary' : ''}
                onClick={() => setWallHeight(hVal)}
              >
                {lbl}
              </button>
            ))}
            <button type="button" className={wallOrtho ? 'on' : ''} onClick={() => setWallOrtho((v) => !v)} title="Khóa góc 45° / 90°">
              Thẳng 45°/90°
            </button>
            <button type="button" className={wallChain ? 'on' : ''} onClick={() => setWallChain((v) => !v)} title="Tự nối tiếp tường mới từ điểm cuối">
              Nối tiếp
            </button>
            {wallStart && (
              <button type="button" onClick={() => setWallStart(null)}>Ngắt đoạn</button>
            )}
            <button type="button" onClick={() => p.onExitTool?.()}>Xong</button>
          </div>
        </div>
      )}
      {p.tool === 'polygon' && !p.readOnly && (
        <div className="placement-banner wall-banner" role="status">
          <span>
            <strong>Vẽ tường bao</strong> · Đã chấm {polyPts.length} đỉnh {polyPts.length >= 3 ? '(chấm điểm đầu hoặc bấm Hoàn tất)' : '(cần ≥ 3 đỉnh)'}
          </span>
          <div className="placement-banner-actions">
            {polyPts.length > 0 && (
              <button type="button" onClick={() => setPolyPts((cur) => cur.slice(0, -1))}>Lùi 1 đỉnh</button>
            )}
            <button
              type="button"
              className="primary"
              disabled={polyPts.length < 3}
              onClick={() => p.onCompletePolygon?.(polyPts)}
            >
              Hoàn tất khung
            </button>
            <button type="button" onClick={() => p.onExitTool?.()}>Hủy</button>
          </div>
        </div>
      )}
      <Stage ref={p.stageRef} width={viewport.width} height={viewport.height}
        x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}
        onPointerDown={onDown} onPointerMove={onMove} onPointerClick={onClick}
        onPointerUp={() => { painting.current = false; measuring.current = false; panStart.current = null; setIsPanning(false); lastPaintPoint.current = null; }}
        onPointerLeave={() => { painting.current = false; measuring.current = false; panStart.current = null; setIsPanning(false); lastPaintPoint.current = null; setHover(null); }}
        onWheel={(e) => {
          e.evt.preventDefault();
          if (e.evt.altKey && !p.readOnly) p.onRotate(e.evt.deltaY < 0 ? 1 : -1);
          else {
            const pointer = e.target.getStage()?.getPointerPosition();
            zoomAt(e.evt.deltaY < 0 ? 1.1 : 0.9, pointer ?? undefined);
          }
        }}>
        <Layer listening={false}><Rect width={worldWidth} height={worldHeight} fill="#fafbf6" /></Layer>
        <BaseGridLayer layout={L} showGrid={p.showGrid && p.view !== 'risk'} showAnchors={p.showAnchors} anchors={anchors} />
        <HeatmapLayer layout={L} cells={p.cells} cellPx={cellPx} view={p.view} drawMsRef={p.drawMsRef}
          riskFilter={p.riskFilter}
          hoveredCell={hover ? { r: hover.cell.r, c: hover.cell.c } : null} focusCell={p.focusCell} showBoundaries={p.showGrid} zoom={zoom} numberMasks={numberMasks} />
        <Layer x={PAD} y={PAD} listening={!lock && p.tool === 'select'}>
          {L.obstacles.map((o) => (
            <ObstacleNode floorPolygon={L.floorPolygon} key={o.id} obs={o} all={L.obstacles} ppm={ppm} roomW={L.widthM} roomH={L.heightM} grid={L.gridM}
              labelScale={labelScale} onRotate={p.onRotate}
              selected={p.selected?.kind === 'obs' && p.selected.id === o.id} onSelect={p.onSelect} onObstacle={p.onObstacle} />
          ))}
        </Layer>
        <Layer x={PAD} y={PAD} listening={!lock && p.tool === 'select'}>
          {p.brush !== null && hover && (
            <Circle x={hover.worldX - PAD} y={hover.worldY - PAD} radius={Math.max(4, cellPx / Math.SQRT2)}
              stroke={priorityColor(p.brush)} strokeWidth={2} fill={riskColor(p.brush)} listening={false} />
          )}
          {L.cameras.map((c, index) => (
            <CameraNode floorPolygon={L.floorPolygon} targetHeight={L.targetHeight} ceilingHeight={L.ceilingHeight} obstacles={L.obstacles} key={c.id} labelScale={labelScale} number={cameraNumber(index)} cam={c} ppm={ppm} roomW={L.widthM} roomH={L.heightM} grid={L.gridM}
              selected={p.selected?.kind === 'cam' && p.selected.id === c.id} onSelect={p.onSelect} onCamera={p.onCamera} />
          ))}
          {m && <>
            <Line points={[m.a[0] * ppm, m.a[1] * ppm, m.b[0] * ppm, m.b[1] * ppm]} stroke="#9333ea" strokeWidth={2} dash={[6, 4]} listening={false} />
            <Text x={((m.a[0] + m.b[0]) / 2) * ppm + 6} y={((m.a[1] + m.b[1]) / 2) * ppm - 16} text={`${mLen.toFixed(2)} m`} fontSize={15} fontStyle="bold" fill="#9333ea" listening={false} />
          </>}
        </Layer>
        <Layer x={PAD} y={PAD} listening={false}>
          {ghost && p.placing && (
            <Group
              x={(ghost.obstacle.x + ghost.obstacle.w / 2) * ppm}
              y={(ghost.obstacle.y + ghost.obstacle.h / 2) * ppm}
              offsetX={(ghost.obstacle.w * ppm) / 2}
              offsetY={(ghost.obstacle.h * ppm) / 2}
              rotation={ghost.obstacle.angle}
            >
              <Rect
                width={ghost.obstacle.w * ppm}
                height={ghost.obstacle.h * ppm}
                fill={ghost.valid ? 'rgba(53,109,80,0.22)' : 'rgba(199,71,71,0.22)'}
                stroke={ghost.valid ? '#356d50' : '#c74747'}
                strokeWidth={2}
                dash={[6, 4]}
                cornerRadius={2}
              />
              <Text
                x={0}
                y={0}
                width={ghost.obstacle.w * ppm}
                height={ghost.obstacle.h * ppm}
                text={`${p.placing.label}\n${ghost.obstacle.w}×${ghost.obstacle.h}m`}
                align="center"
                verticalAlign="middle"
                fontSize={10}
                fontStyle="bold"
                fill={ghost.valid ? '#1f4d35' : '#992a20'}
              />
            </Group>
          )}
          {p.tool === 'wall' && wallCursor && !wallStart && (
            <Circle x={wallCursor[0] * ppm} y={wallCursor[1] * ppm} radius={5} fill="#765d42" stroke="#fffefb" strokeWidth={1.5} />
          )}
          {p.tool === 'wall' && wallStart && wallPreview && (
            <>
              <Group
                x={(wallPreview.obstacle.x + wallPreview.obstacle.w / 2) * ppm}
                y={(wallPreview.obstacle.y + wallPreview.obstacle.h / 2) * ppm}
                offsetX={(wallPreview.obstacle.w * ppm) / 2}
                offsetY={(wallPreview.obstacle.h * ppm) / 2}
                rotation={wallPreview.obstacle.angle}
              >
                <Rect
                  width={wallPreview.obstacle.w * ppm}
                  height={wallPreview.obstacle.h * ppm}
                  fill={wallPreview.valid ? 'rgba(53,109,80,0.28)' : 'rgba(199,71,71,0.28)'}
                  stroke={wallPreview.valid ? '#356d50' : '#c74747'}
                  strokeWidth={2}
                  dash={[5, 3]}
                />
              </Group>
              <Circle x={wallStart[0] * ppm} y={wallStart[1] * ppm} radius={4.5} fill="#356d50" stroke="#fffefb" strokeWidth={1.5} />
              {wallCursor && (
                <>
                  <Circle x={wallCursor[0] * ppm} y={wallCursor[1] * ppm} radius={4.5} fill={wallPreview.valid ? '#356d50' : '#c74747'} stroke="#fffefb" strokeWidth={1.5} />
                  <Text
                    x={((wallStart[0] + wallCursor[0]) / 2) * ppm + 8}
                    y={((wallStart[1] + wallCursor[1]) / 2) * ppm - 18}
                    text={`${wallPreview.length.toFixed(2)} m · ${wallPreview.angle}°`}
                    fontSize={11}
                    fontStyle="bold"
                    fill={wallPreview.valid ? '#1f4d35' : '#992a20'}
                  />
                </>
              )}
            </>
          )}
          {p.tool === 'polygon' && (
            <>
              {polyPts.length >= 2 && (
                <Line
                  points={polyPts.flatMap(([px, py]) => [px * ppm, py * ppm])}
                  stroke="#647156"
                  strokeWidth={4}
                  lineJoin="round"
                />
              )}
              {polyPts.length >= 1 && polyCursor && (
                <>
                  <Line
                    points={[
                      polyPts[polyPts.length - 1][0] * ppm,
                      polyPts[polyPts.length - 1][1] * ppm,
                      polyCursor[0] * ppm,
                      polyCursor[1] * ppm,
                    ]}
                    stroke="#765d42"
                    strokeWidth={2.5}
                    dash={[6, 4]}
                  />
                  <Text
                    x={((polyPts[polyPts.length - 1][0] + polyCursor[0]) / 2) * ppm + 8}
                    y={((polyPts[polyPts.length - 1][1] + polyCursor[1]) / 2) * ppm - 16}
                    text={`${Math.hypot(polyCursor[0] - polyPts[polyPts.length - 1][0], polyCursor[1] - polyPts[polyPts.length - 1][1]).toFixed(2)} m`}
                    fontSize={11}
                    fontStyle="bold"
                    fill="#765d42"
                  />
                </>
              )}
              {polyPts.map(([px, py], i) => (
                <Circle
                  key={`${px}_${py}_${i}`}
                  x={px * ppm}
                  y={py * ppm}
                  radius={i === 0 ? 6 : 4.5}
                  fill={i === 0 ? '#356d50' : '#765d42'}
                  stroke="#fffefb"
                  strokeWidth={1.5}
                />
              ))}
              {polyCursor && <Circle x={polyCursor[0] * ppm} y={polyCursor[1] * ppm} radius={4} fill="#765d42" opacity={0.7} />}
            </>
          )}
        </Layer>
        <Layer x={PAD} y={PAD} listening={!lock}>
          {p.people.map((person) => (
            <PersonNode key={person.id} person={person} ppm={ppm} roomW={L.widthM} roomH={L.heightM} obstacles={L.obstacles} floorPolygon={L.floorPolygon}
              selected={p.selected?.kind === 'person' && p.selected.id === person.id}
              onSelect={p.onSelect} onMove={p.onPerson} />
          ))}
        </Layer>
      </Stage>
      {hover && p.tool === 'select' && p.brush === null && (
        <div className="tip" role="tooltip" style={{ left: Math.max(8, Math.min(hover.x + 14, viewport.width - 236)), top: Math.max(8, Math.min(hover.y + 14, viewport.height - 134)) }}>
          <b>{hover.cell.cx.toFixed(2)} m, {hover.cell.cy.toFixed(2)} m</b><br />
          W {hover.cell.w.toFixed(1)} · {hover.cell.w >= 4 ? 'Cao' : hover.cell.w >= 2 ? 'Vừa' : 'Thấp'}{hover.cell.solid ? ' · ô bị vật cản' : ''}<br />
          {hover.cell.solid ? 'Không tính vùng phủ' : hover.cell.ppm > 0 ? 'Được camera phủ' : 'Chưa được camera phủ'} · {Math.round(hover.cell.ppm)} PPM<br />
          Ô ({hover.cell.r}, {hover.cell.c}) · {hover.source}
          {hover.distance !== null && <> · cách {hover.distance.toFixed(2)} m</>}
        </div>
      )}
      {p.selected?.kind === 'person' && (() => {
        const person = p.people.find((item) => item.id === p.selected?.id);
        if (!person) return null;
        const popupWidth = Math.min(258, viewport.width - 16);
        const personX = pan.x + (person.x * ppm + PAD) * zoom;
        const personY = pan.y + (person.y * ppm + PAD) * zoom;
        const preferredLeft = personX + 24 + popupWidth <= viewport.width ? personX + 24 : personX - popupWidth - 24;
        const popupLeft = Math.max(8, Math.min(preferredLeft, viewport.width - popupWidth - 8));
        const top = Math.max(8, Math.min(personY - 145, viewport.height - 290));
        return <PersonInfo person={person} readings={assessPersonAt(L, person.x, person.y)} left={popupLeft} top={top} onClose={() => p.onSelect(null)} />;
      })()}
    </div>
    {p.view === 'risk' && <RiskLegend cells={p.cells} filter={p.riskFilter} onFilter={p.onRiskFilter} />}
    </div>
  );
}
