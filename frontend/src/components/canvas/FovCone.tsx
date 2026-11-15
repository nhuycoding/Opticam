import { memo } from 'react';
import { Group, Line } from 'react-konva';
import type { Camera } from '../../types';
import { cameraFootprint } from '../../core/cameraFootprint';
import { traceOutline } from './planDrawing';

/** Perspective footprint at the same person height used by the DORI map. */
export const FovCone = memo(function FovCone({ camera, ppm, targetHeight = 1.6, roomWidthPx, roomHeightPx, selected, floorPolygon }: {
  camera: Camera; ppm: number; targetHeight?: number;
  floorPolygon?: [number, number][];
  roomWidthPx: number; roomHeightPx: number; selected: boolean;
}) {
  const fill = selected ? 'rgba(118,93,66,.075)' : 'rgba(86,108,64,.018)';
  const stroke = selected ? '#8e7758' : 'rgba(82,106,58,.13)';
  const points = cameraFootprint(camera, targetHeight, floorPolygon?.map(([x, y]) => [x / ppm, y / ppm]))
    .flatMap(([x, y]) => [x * ppm, y * ppm]);
  if (points.length < 6) return null;
  return <Group clipFunc={ctx => traceOutline(ctx, floorPolygon ?? [[0,0],[roomWidthPx,0],[roomWidthPx,roomHeightPx],[0,roomHeightPx]])} listening={false}>
    <Line points={points} closed fill={fill} stroke={stroke} strokeWidth={selected ? 1 : .6} dash={selected ? [5,4] : undefined}/>
  </Group>;
});
