import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Plane, Vector3 } from 'three';
import type { Selection } from '../canvas/shared';

type CaptureTarget = {
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
  hasPointerCapture: (id: number) => boolean;
};

/** Preview locally while dragging, then submit one validated editor change on drop. */
export function DraggableObject3D({ children, center, selection, enabled, onSelect, onMove, onInteraction, planeHeight = 0 }: {
  planeHeight?: number; children: ReactNode; center: [number, number]; selection: Selection; enabled: boolean;
  onSelect: (selection: Selection) => void;
  onMove: (x: number, y: number) => void;
  onInteraction: (active: boolean) => void;
}) {
  const plane = new Plane(new Vector3(0, 1, 0), -planeHeight);
  const drag = useRef<{
    offsetX: number; offsetY: number; centerX: number; centerY: number;
    nextX: number; nextY: number; moved: boolean; pointer: number; target: CaptureTarget;
  } | null>(null);
  const point = useRef(new Vector3());
  const [preview, setPreview] = useState<[number, number, number]>([0, 0, 0]);
  const finish = (cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer);
    setPreview([0, 0, 0]);
    onInteraction(false);
    if (!cancel && current.moved) onMove(current.nextX, current.nextY);
  };
  useEffect(() => {
    const up = () => finish();
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      cancel();
    };
  }, [enabled, onInteraction, planeHeight]);
  useEffect(() => {
    const current = drag.current;
    if (current && (center[0] !== current.centerX || center[1] !== current.centerY)) finish(true);
  }, [center[0], center[1]]);

  const start = (event: ThreeEvent<PointerEvent>) => {
    if (!enabled || event.button !== 0 || !event.ray.intersectPlane(plane, point.current)) return;
    event.stopPropagation();
    const target = event.target as unknown as CaptureTarget;
    drag.current = {
      offsetX: center[0] - point.current.x, offsetY: center[1] - point.current.z,
      centerX: center[0], centerY: center[1], nextX: center[0], nextY: center[1], moved: false,
      pointer: event.pointerId, target
    };
    onSelect(selection);
    onInteraction(true);
    target.setPointerCapture(event.pointerId);
  };
  const move = (event: ThreeEvent<PointerEvent>) => {
    const current = drag.current;
    if (!current || !enabled || !event.ray.intersectPlane(plane, point.current)) return;
    event.stopPropagation();
    current.nextX = point.current.x + current.offsetX;
    current.nextY = point.current.z + current.offsetY;
    current.moved = Math.hypot(current.nextX - current.centerX, current.nextY - current.centerY) > 0.001;
    setPreview([current.nextX - current.centerX, 0, current.nextY - current.centerY]);
  };
  return <group position={preview} onPointerDown={start} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)}>{children}</group>;
}
