import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Layer, Line, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Camera, Cell, Layout, Obstacle, Person, RiskStroke, Weight } from '../../types';
import { distToObs, round2, wallAnchors } from '../../core/geometry';
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

export interface CanvasProps {
  layout: Layout; cells: Cell[]; view: ViewMode; tool: Tool; brush: Weight | null; selected: Selection;
  riskFilter: PriorityBand | null; focusCell: { r: number; c: number } | null;
  onRiskFilter: (filter: PriorityBand | null) => void;
  showGrid: boolean; showAnchors: boolean; measure: Segment; stageRef: React.RefObject<Konva.Stage>; drawMsRef: { current: number };
  onCamera: (c: Camera) => void; onObstacle: (o: Obstacle) => void; onPaint: (strokes: RiskStroke[]) => void;
  people: Person[]; onAddPerson: (x: number, y: number) => void; onPerson: (person: Person) => void; onInvalidPerson: () => void;
  onSelect: (s: Selection) => void; onRotate: (dir: 1 | -1) => void; onMeasure: (s: Segment) => void;
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
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const anchors = useMemo(() => wallAnchors(L.widthM, L.heightM, L.gridM), [L.widthM, L.heightM, L.gridM]);
  const numberMasks = useMemo(() => L.cameras.flatMap((camera) => {
    const cx = camera.x * ppm, cy = camera.y * ppm, label = `${camera.id} (${camera.pan}°)`;
    const width = Math.min(Math.max(112, label.length * 7.5 + 20), Math.max(60, L.widthM * ppm - 8)), height = 24;
    const x = cx + width + 12 <= L.widthM * ppm ? cx + 12 : cx - width - 12;
    let y = cy < L.heightM * ppm * 0.25 ? cy + 34 : cy - height - 14;
    if (y + height > L.heightM * ppm - 4) y = cy - HANDLE - height - 10;
    const masks = [{ x, y, width, height }, { x: cx - 12, y: cy - 12, width: 24, height: 24 }];
    if (p.selected?.kind === 'cam' && p.selected.id === camera.id) {
      const angle = (camera.pan * Math.PI) / 180, handleX = cx + HANDLE * Math.cos(angle), handleY = cy + HANDLE * Math.sin(angle);
      masks.push({ x: handleX - 8, y: handleY - 8, width: 16, height: 16 });
    }
    return masks;
  }), [L.cameras, L.widthM, L.heightM, ppm, p.selected]);
  const lock = p.tool === 'measure' || p.brush !== null; // khoá kéo thả khi đang cọ/đo

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [L.widthM, L.heightM, ppm]);

  useEffect(() => {
    if (!p.focusCell || !p.stageRef.current) return;
    const stage = p.stageRef.current, nextZoom = Math.max(zoom, 1.35);
    const targetX = PAD + (p.focusCell.c + 0.5) * cellPx, targetY = PAD + (p.focusCell.r + 0.5) * cellPx;
    setZoom(nextZoom);
    setPan({ x: stage.width() / 2 - targetX * nextZoom, y: stage.height() / 2 - targetY * nextZoom });
  }, [p.focusCell?.r, p.focusCell?.c, cellPx]);

  const zoomAt = (factor: number, anchor?: { x: number; y: number }) => {
    const stage = p.stageRef.current;
    if (!stage) return;
    const position = anchor ?? { x: stage.width() / 2, y: stage.height() / 2 };
    const currentZoom = stage.scaleX(), nextZoom = Math.max(0.25, Math.min(2.5, currentZoom * factor));
    const worldX = (position.x - stage.x()) / currentZoom, worldY = (position.y - stage.y()) / currentZoom;
    setZoom(nextZoom);
    setPan({ x: position.x - worldX * nextZoom, y: position.y - worldY * nextZoom });
  };

  const fitView = () => {
    const stage = p.stageRef.current, viewport = viewportRef.current;
    if (!stage || !viewport) return;
    const fitScale = Math.min(1, (viewport.clientWidth - 8) / stage.width(), (viewport.clientHeight - 8) / stage.height());
    setZoom(Math.max(0.25, fitScale));
    setPan({ x: 0, y: 0 });
  };

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const stagePosition = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage(), pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return { x: (pointer.x - stage.x()) / stage.scaleX(), y: (pointer.y - stage.y()) / stage.scaleY() };
  };

  const meters = (e: Konva.KonvaEventObject<MouseEvent>): [number, number] | null => {
    const pos = stagePosition(e);
    return pos ? [round2((pos.x - PAD) / ppm), round2((pos.y - PAD) / ppm)] : null;
  };
  const cellAt = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const m = meters(e), world = stagePosition(e), rect = viewportRef.current?.getBoundingClientRect();
    if (!m || !world || !rect) return null;
    const c = Math.floor(m[0] / L.gridM), r = Math.floor(m[1] / L.gridM);
    return c < 0 || r < 0 || c >= cols || r * cols + c >= p.cells.length ? null : {
      r, c, world, x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top, cell: p.cells[r * cols + c]
    };
  };
  const paintAt = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!p.brush) return;
    const point = meters(e);
    if (!point || point[0] < 0 || point[1] < 0 || point[0] > L.widthM || point[1] > L.heightM) return;
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
  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
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
  const onClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (p.tool !== 'person' || e.target.findAncestor('.person-node', true)) return;
    const point = meters(e);
    if (!point || point[0] < 0 || point[1] < 0 || point[0] > L.widthM || point[1] > L.heightM) return;
    if (canPlacePerson(point[0], point[1], L.widthM, L.heightM, L.obstacles)) p.onAddPerson(point[0], point[1]);
    else p.onInvalidPerson();
  };
  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
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
    <div ref={viewportRef} className="stage-wrap" aria-label="Sơ đồ bố trí camera và mặt bằng cửa hàng" style={{ cursor: isPanning ? 'grabbing' : p.tool === 'measure' || p.tool === 'person' || p.brush !== null ? 'crosshair' : 'grab' }}>
      <Stage ref={p.stageRef} width={L.widthM * ppm + PAD * 2} height={L.heightM * ppm + PAD * 2}
        x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom}
        onMouseDown={onDown} onMouseMove={onMove} onClick={onClick}
        onMouseUp={() => { painting.current = false; measuring.current = false; panStart.current = null; setIsPanning(false); lastPaintPoint.current = null; }}
        onMouseLeave={() => { painting.current = false; measuring.current = false; panStart.current = null; setIsPanning(false); lastPaintPoint.current = null; setHover(null); }}
        onWheel={(e) => {
          e.evt.preventDefault();
          if (e.evt.altKey) p.onRotate(e.evt.deltaY < 0 ? 1 : -1);
          else {
            const pointer = e.target.getStage()?.getPointerPosition();
            zoomAt(e.evt.deltaY < 0 ? 1.1 : 0.9, pointer ?? undefined);
          }
        }}>
        <BaseGridLayer layout={L} showGrid={p.showGrid && p.view !== 'risk'} showAnchors={p.showAnchors} anchors={anchors} />
        <HeatmapLayer layout={L} cells={p.cells} cellPx={cellPx} view={p.view} drawMsRef={p.drawMsRef}
          riskFilter={p.riskFilter}
          hoveredCell={hover ? { r: hover.cell.r, c: hover.cell.c } : null} focusCell={p.focusCell} showBoundaries={p.showGrid} zoom={zoom} numberMasks={numberMasks} />
        <Layer x={PAD} y={PAD} listening={!lock && p.tool === 'select'}>
          {L.obstacles.map((o) => (
            <ObstacleNode key={o.id} obs={o} all={L.obstacles} ppm={ppm} roomW={L.widthM} roomH={L.heightM} grid={L.gridM}
              selected={p.selected?.kind === 'obs' && p.selected.id === o.id} onSelect={p.onSelect} onObstacle={p.onObstacle} />
          ))}
        </Layer>
        <Layer x={PAD} y={PAD} listening={!lock && p.tool === 'select'}>
          {p.brush !== null && hover && (
            <Circle x={hover.worldX - PAD} y={hover.worldY - PAD} radius={Math.max(4, cellPx / Math.SQRT2)}
              stroke={priorityColor(p.brush)} strokeWidth={2} fill={riskColor(p.brush)} listening={false} />
          )}
          {L.cameras.map((c) => (
            <CameraNode key={c.id} cam={c} ppm={ppm} roomW={L.widthM} roomH={L.heightM} grid={L.gridM}
              selected={p.selected?.kind === 'cam' && p.selected.id === c.id} onSelect={p.onSelect} onCamera={p.onCamera} />
          ))}
          {m && <>
            <Line points={[m.a[0] * ppm, m.a[1] * ppm, m.b[0] * ppm, m.b[1] * ppm]} stroke="#9333ea" strokeWidth={2} dash={[6, 4]} listening={false} />
            <Text x={((m.a[0] + m.b[0]) / 2) * ppm + 6} y={((m.a[1] + m.b[1]) / 2) * ppm - 16} text={`${mLen.toFixed(2)} m`} fontSize={15} fontStyle="bold" fill="#9333ea" listening={false} />
          </>}
        </Layer>
        <Layer x={PAD} y={PAD} listening={!lock}>
          {p.people.map((person) => (
            <PersonNode key={person.id} person={person} ppm={ppm} roomW={L.widthM} roomH={L.heightM} obstacles={L.obstacles}
              selected={p.selected?.kind === 'person' && p.selected.id === person.id}
              onSelect={p.onSelect} onMove={p.onPerson} />
          ))}
        </Layer>
      </Stage>
      {hover && p.tool === 'select' && p.brush === null && (
        <div className="tip" role="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
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
        const stageW = L.widthM * ppm + PAD * 2, stageH = L.heightM * ppm + PAD * 2;
        const popupWidth = 258, gap = 20, personX = person.x * ppm + PAD;
        const right = personX + 19 + gap, left = personX - 19 - gap - popupWidth;
        const leftFits = left >= 8, rightFits = right + popupWidth <= stageW - 8;
        const roomOnLeft = left - 8, roomOnRight = stageW - right - popupWidth;
        const popupLeft = rightFits ? right : leftFits ? left : roomOnRight >= roomOnLeft ? right : left;
        const top = Math.max(8, Math.min(person.y * ppm + PAD - 145, stageH - 290));
        return <PersonInfo person={person} readings={assessPersonAt(L, person.x, person.y)} left={popupLeft} top={top} onClose={() => p.onSelect(null)} />;
      })()}
    </div>
    {p.view === 'risk' && <RiskLegend cells={p.cells} filter={p.riskFilter} onFilter={p.onRiskFilter} />}
    </div>
  );
}
