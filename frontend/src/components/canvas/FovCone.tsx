import { memo } from 'react';
import { Group, Wedge } from 'react-konva';

/** Hình nón góc mở FOV của camera. */
export const FovCone = memo(function FovCone({ x, y, pan, fov, radiusPx, roomWidthPx, roomHeightPx, selected }: {
  x: number; y: number; pan: number; fov: number; radiusPx: number; roomWidthPx: number; roomHeightPx: number; selected: boolean;
}) {
  return (
    <Group clipX={0} clipY={0} clipWidth={roomWidthPx} clipHeight={roomHeightPx} listening={false}>
      <Wedge x={x} y={y} radius={radiusPx} angle={fov} rotation={pan - fov / 2}
        fill={selected ? 'rgba(118,93,66,.075)' : 'rgba(86,108,64,.018)'}
        stroke={selected ? '#8e7758' : 'rgba(82,106,58,.13)'} strokeWidth={selected ? 1 : 0.6} dash={selected ? [5, 4] : undefined} listening={false} />
    </Group>
  );
});
