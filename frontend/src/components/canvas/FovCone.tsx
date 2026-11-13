import { memo } from 'react';
import { Group, Line, Wedge } from 'react-konva';
import { rayFloorDistance } from '../../core/footprint';
import { traceOutline } from './planDrawing';

/** Geometric FOV stops at the first room wall, including concave corners. */
export const FovCone = memo(function FovCone({ x, y, pan, fov, radiusPx, roomWidthPx, roomHeightPx, selected, floorPolygon }: {
  floorPolygon?: [number, number][];
  x: number; y: number; pan: number; fov: number; radiusPx: number; roomWidthPx: number; roomHeightPx: number; selected: boolean;
}) {
  const fill = selected ? 'rgba(118,93,66,.075)' : 'rgba(86,108,64,.018)';
  const stroke = selected ? '#8e7758' : 'rgba(82,106,58,.13)';
  const points = [x, y];
  if (floorPolygon) {
    const steps = Math.ceil(fov / 2);
    for (let i = 0; i <= steps; i++) {
      const angle = (pan - fov / 2 + fov * i / steps) * Math.PI / 180;
      const length = rayFloorDistance([x,y], angle, radiusPx, floorPolygon);
      points.push(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    }
  }
  return <Group clipFunc={ctx => traceOutline(ctx, floorPolygon ?? [[0,0],[roomWidthPx,0],[roomWidthPx,roomHeightPx],[0,roomHeightPx]])} listening={false}>
    {floorPolygon
      ? <Line points={points} closed fill={fill} stroke={stroke} strokeWidth={selected ? 1 : .6} dash={selected ? [5,4] : undefined}/>
      : <Wedge x={x} y={y} radius={radiusPx} angle={fov} rotation={pan-fov/2} fill={fill} stroke={stroke} strokeWidth={selected ? 1 : .6} dash={selected ? [5,4] : undefined}/>}
  </Group>;
});
