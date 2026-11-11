import { memo } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type { Camera } from '../../types';
import { deg, round2, snapAngle, snapToWall } from '../../core/geometry';
import { FovCone } from './FovCone';
import { HANDLE, PAD, scheduleFrame, type Selection } from './shared';

interface Props {
  cam: Camera; ppm: number; roomW: number; roomH: number; grid: number; selected: boolean;
  onSelect: (s: Selection) => void; onCamera: (c: Camera) => void;
}

/** Camera: thân kéo thả bắt dính tường (Snap-to-Wall) + tay cầm xoay Δθ = 15° + hình nón FOV. */
export const CameraNode = memo(function CameraNode({ cam, ppm, roomW, roomH, grid, selected, onSelect, onCamera }: Props) {
  const cx = cam.x * ppm, cy = cam.y * ppm, a = (cam.pan * Math.PI) / 180;
  const hx = cx + HANDLE * Math.cos(a), hy = cy + HANDLE * Math.sin(a);
  const label = `${cam.id} (${cam.pan}°)`, labelWidth = Math.min(Math.max(112, label.length * 7.5 + 20), Math.max(60, roomW * ppm - 8)), labelHeight = 24;
  const labelX = cx + labelWidth + 12 <= roomW * ppm ? cx + 12 : cx - labelWidth - 12;
  let labelY = cy < roomH * ppm * 0.25 ? cy + 34 : cy - labelHeight - 14;
  if (labelY + labelHeight > roomH * ppm - 4) labelY = cy - HANDLE - labelHeight - 10;
  const labelAnchorX = labelX > cx ? labelX : labelX + labelWidth;
  const labelAnchorY = Math.max(labelY + 3, Math.min(labelY + labelHeight - 3, cy));
  return (
    <Group>
      <FovCone x={cx} y={cy} pan={cam.pan} fov={cam.fov} radiusPx={cam.range * ppm} roomWidthPx={roomW * ppm} roomHeightPx={roomH * ppm} selected={selected} />
      <Line points={[cx, cy, labelAnchorX, labelAnchorY]} stroke="rgba(226,239,231,.42)" strokeWidth={1} listening={false} />
      <Circle x={cx} y={cy} radius={10} fill={selected ? '#087e83' : '#e5f0eb'} stroke={selected ? '#055c60' : '#52656c'} strokeWidth={2} draggable
        dragBoundFunc={(pos) => { const [x, y] = snapToWall((pos.x - PAD) / ppm, (pos.y - PAD) / ppm, roomW, roomH, grid); return { x: PAD + x * ppm, y: PAD + y * ppm }; }}
        onMouseDown={() => onSelect({ kind: 'cam', id: cam.id })}
        onDragMove={(e) => { const x = round2(e.target.x() / ppm), y = round2(e.target.y() / ppm); scheduleFrame(() => onCamera({ ...cam, x, y })); }} />
      <Group x={cx} y={cy} rotation={cam.pan} listening={false}>
        <Rect x={5} y={-5} width={16} height={10} cornerRadius={3} fill="#233d48" stroke="#fff" strokeWidth={1} />
        <Circle x={19} y={0} radius={2.2} fill="#77d8cf" />
      </Group>
      {selected && <>
        <Line points={[cx + 10 * Math.cos(a), cy + 10 * Math.sin(a), hx, hy]} stroke="#087e83" strokeWidth={2} listening={false} />
        <Circle x={hx} y={hy} radius={6} fill="#f59e0b" stroke="#fff" strokeWidth={1.5} draggable
        dragBoundFunc={(pos) => { const t = (snapAngle(deg(Math.atan2(pos.y - PAD - cy, pos.x - PAD - cx)), 15) * Math.PI) / 180; return { x: PAD + cx + HANDLE * Math.cos(t), y: PAD + cy + HANDLE * Math.sin(t) }; }}
        onMouseDown={() => onSelect({ kind: 'cam', id: cam.id })}
        onDragMove={(e) => { const pan = snapAngle(deg(Math.atan2(e.target.y() - cy, e.target.x() - cx)), 15); scheduleFrame(() => onCamera({ ...cam, pan })); }} />
      </>}
      <Group x={labelX} y={labelY} listening={false}>
        <Rect width={labelWidth} height={labelHeight} cornerRadius={5} fill="#172a3a" opacity={0.92} />
        <Text x={8} y={3} width={labelWidth - 16} height={labelHeight - 6} text={label} fontSize={13} fontStyle="bold" fill="#fff" verticalAlign="middle" />
      </Group>
    </Group>
  );
});
