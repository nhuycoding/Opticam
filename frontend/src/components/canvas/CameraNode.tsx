import { memo } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { Camera } from '../../types';
import { deg, round2, snapAngle, snapToWall } from '../../core/geometry';
import { FovCone } from './FovCone';
import { HANDLE, scheduleFrame, type Selection } from './shared';

interface Props {
  labelScale?: number;
  labelBox?: { x: number; y: number; width: number; height: number };
  cam: Camera; ppm: number; roomW: number; roomH: number; grid: number; selected: boolean;
  onSelect: (s: Selection) => void; onCamera: (c: Camera) => void;
}

/** Camera: thân kéo thả bắt dính tường (Snap-to-Wall) + tay cầm xoay Δθ = 15° + hình nón FOV. */
export const CameraNode = memo(function CameraNode({ labelScale = 1, labelBox, cam, ppm, roomW, roomH, grid, selected, onSelect, onCamera }: Props) {
  const cx = cam.x * ppm, cy = cam.y * ppm, a = (cam.pan * Math.PI) / 180;
  const hx = cx + HANDLE * Math.cos(a), hy = cy + HANDLE * Math.sin(a);
  const label = `${cam.id}  ·  ${cam.pan}°`, labelWidth = labelBox?.width ?? 116, labelHeight = labelBox?.height ?? 36;
  const labelX = labelBox?.x ?? Math.max(8, Math.min(cx + 18, roomW * ppm - labelWidth - 8));
  const labelY = labelBox?.y ?? (cy < roomH * ppm / 2 ? cy + 26 : cy - labelHeight - 20);
  const labelAnchorX = labelX > cx ? labelX : labelX + labelWidth;
  const labelAnchorY = Math.max(labelY + 3, Math.min(labelY + labelHeight - 3, cy));
  return (
    <Group>
      <FovCone x={cx} y={cy} pan={cam.pan} fov={cam.fov} radiusPx={cam.range * ppm} roomWidthPx={roomW * ppm} roomHeightPx={roomH * ppm} selected={selected} />
      <Line points={[cx, cy, labelAnchorX, labelAnchorY]} stroke="#8a9580" strokeWidth={1} listening={false} />
      <Circle x={cx} y={cy} radius={10 * labelScale} hitStrokeWidth={12 * labelScale} fill={selected ? '#765d42' : '#fffef8'} stroke={selected ? '#60492f' : '#627054'} strokeWidth={2} draggable
        dragBoundFunc={function (pos) {
          const transform = this.getParent()!.getAbsoluteTransform();
          const local = transform.copy().invert().point(pos);
          const [x, y] = snapToWall(local.x / ppm, local.y / ppm, roomW, roomH, grid);
          return transform.point({ x: x * ppm, y: y * ppm });
        }}
        onPointerDown={() => onSelect({ kind: 'cam', id: cam.id })}
        onDragMove={(e) => { const x = round2(e.target.x() / ppm), y = round2(e.target.y() / ppm); scheduleFrame(() => onCamera({ ...cam, x, y })); }} />
      <Group x={cx} y={cy} scaleX={labelScale} scaleY={labelScale} rotation={cam.pan} listening={false}>
        <Rect x={5} y={-5} width={16} height={10} cornerRadius={3} fill="#45513f" stroke="#fff" strokeWidth={1} />
        <Circle x={19} y={0} radius={2.2} fill="#d6dcbf" />
      </Group>
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
      <Group x={labelX} y={labelY} onPointerDown={() => onSelect({ kind: 'cam', id: cam.id })}>
        <Rect width={labelWidth} height={labelHeight} cornerRadius={3} fill={selected ? '#f1e9db' : '#fffef8'} stroke={selected ? '#92704b' : '#d5dacb'} strokeWidth={0.8} shadowColor="#35402a" shadowOpacity={.07} shadowBlur={3} shadowOffsetY={2} />
        <Text x={8 * labelScale} y={6 * labelScale} width={labelWidth - 16 * labelScale} text={label} fontSize={10 * labelScale} fontStyle="bold" fill="#3f4d34" />
        <Text x={8 * labelScale} y={21 * labelScale} width={labelWidth - 16 * labelScale} text={`FOV ${cam.fov}° · H ${cam.height} m`} fontSize={8 * labelScale} fill="#7b836f" />
      </Group>
    </Group>
  );
});
