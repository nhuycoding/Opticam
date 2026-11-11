import { memo } from 'react';
import { Group, Wedge } from 'react-konva';

/** Hình nón góc mở FOV của camera. */
export const FovCone = memo(function FovCone({ x, y, pan, fov, radiusPx, roomWidthPx, roomHeightPx, selected }: {
  x: number; y: number; pan: number; fov: number; radiusPx: number; roomWidthPx: number; roomHeightPx: number; selected: boolean;
}) {
  return (
    <Group clipX={0} clipY={0} clipWidth={roomWidthPx} clipHeight={roomHeightPx} listening={false}>
      <Wedge x={x} y={y} radius={radiusPx} angle={fov} rotation={pan - fov / 2}
        fill={selected ? 'rgba(8,126,131,.2)' : 'rgba(8,126,131,.045)'}
        stroke={selected ? '#087e83' : 'rgba(23,42,58,.12)'} strokeWidth={selected ? 1.5 : 0.75} listening={false} />
    </Group>
  );
});
