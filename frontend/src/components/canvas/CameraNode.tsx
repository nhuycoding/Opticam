import { memo, useRef } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { Camera, Layout, Obstacle, TargetHeight } from '../../types';
import { deg, snapAngle } from '../../core/geometry';
import { cameraMount } from '../../core/camera';
import { placeEditedCamera } from '../../core/cameraEditing';
import { FovCone } from './FovCone';
import { HANDLE, scheduleFrame, type Selection } from './shared';

interface Props {
  labelScale?: number;
  number: string;
  floorPolygon?: [number, number][];
  targetHeight?: TargetHeight; ceilingHeight?: number; obstacles?: Obstacle[];
  cam: Camera; ppm: number; roomW: number; roomH: number; grid: number; selected: boolean;
  onSelect: (s: Selection) => void; onCamera: (c: Camera) => void;
}

/** Shared mounting rules keep wall cameras on the boundary and ceiling cameras inside the shop. */
export const CameraNode = memo(function CameraNode({ floorPolygon, targetHeight = 1.6, ceilingHeight, obstacles = [], labelScale = 1, number, cam, ppm, roomW, roomH, grid, selected, onSelect, onCamera }: Props) {
  const lastValid = useRef(cam);
  const layout: Layout = { version: '1', name: '', widthM: roomW, heightM: roomH, gridM: grid, pixelsPerMeter: ppm,
    targetHeight, ceilingHeight, floorPolygon, obstacles, cameras: [cam], risk: {}, riskStrokes: [] };
  const cx = cam.x * ppm, cy = cam.y * ppm, a = (cam.pan * Math.PI) / 180;
  const hx = cx + HANDLE * Math.cos(a), hy = cy + HANDLE * Math.sin(a);
  return (
    <Group>
      <FovCone camera={cam} ppm={ppm} targetHeight={targetHeight} roomWidthPx={roomW * ppm} roomHeightPx={roomH * ppm} floorPolygon={floorPolygon?.map(([x, y]) => [x * ppm, y * ppm])} selected={selected} />
      <Group x={cx} y={cy} scaleX={labelScale} scaleY={labelScale} rotation={cam.pan} listening={false}>
        <Rect x={5} y={-5} width={18} height={10} cornerRadius={3} fill="#45513f" stroke="#fff" strokeWidth={1} />
        <Circle x={21} y={0} radius={2.2} fill="#d6dcbf" />
      </Group>
      <Circle x={cx} y={cy} radius={13 * labelScale} hitStrokeWidth={12 * labelScale} fill={selected ? '#765d42' : '#fffef8'} stroke={selected ? '#60492f' : '#627054'} strokeWidth={2} draggable
        dragBoundFunc={function (pos) {
          const transform = this.getParent()!.getAbsoluteTransform();
          const local = transform.copy().invert().point(pos);
          const placed = placeEditedCamera({ ...cam, x: local.x / ppm, y: local.y / ppm }, layout);
          if (placed) lastValid.current = placed;
          return transform.point({ x: lastValid.current.x * ppm, y: lastValid.current.y * ppm });
        }}
        onDragStart={() => { lastValid.current = cam; }}
        onPointerDown={() => onSelect({ kind: 'cam', id: cam.id })}
        onDragMove={(e) => {
          const placed = placeEditedCamera({ ...cam, x: e.target.x() / ppm, y: e.target.y() / ppm }, layout);
          if (placed) { lastValid.current = placed; scheduleFrame(() => onCamera(placed)); }
        }} />
      <Text x={cx - 13 * labelScale} y={cy - 13 * labelScale} width={26 * labelScale} height={26 * labelScale}
        text={number} fontSize={11 * labelScale} fontStyle="bold" align="center" verticalAlign="middle"
        fill={selected ? '#fffdf6' : '#3f4d34'} listening={false} />
      {cameraMount(cam) === 'ceiling' && <Text x={cx - 18 * labelScale} y={cy + 15 * labelScale} width={36 * labelScale}
        text="TRẦN" fontSize={7 * labelScale} fontStyle="bold" align="center" fill="#627054" listening={false} />}
      {selected && <>
        <Line points={[cx + 10 * Math.cos(a), cy + 10 * Math.sin(a), hx, hy]} stroke="#765d42" strokeWidth={2} listening={false} />
        <Circle x={hx} y={hy} radius={6 * labelScale} hitStrokeWidth={12 * labelScale} fill="#765d42" stroke="#fff" strokeWidth={1.5} draggable
        dragBoundFunc={function (pos) {
          const transform = this.getParent()!.getAbsoluteTransform();
          const local = transform.copy().invert().point(pos);
          const angle = snapAngle(deg(Math.atan2(local.y - cy, local.x - cx))) * Math.PI / 180;
          return transform.point({ x: cx + HANDLE * Math.cos(angle), y: cy + HANDLE * Math.sin(angle) });
        }}
        onPointerDown={() => onSelect({ kind: 'cam', id: cam.id })}
        onDragMove={(e) => { const pan = snapAngle(deg(Math.atan2(e.target.y() - cy, e.target.x() - cx)), 15); scheduleFrame(() => onCamera({ ...cam, pan })); }} />
      </>}
    </Group>
  );
});
