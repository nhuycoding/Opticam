import { Group, Line, Text } from 'react-konva';
import type { Layout } from '../../types';
import { PAD } from './shared';

function meterMarks(length: number) {
  const marks = Array.from({ length: Math.floor(length) + 1 }, (_, index) => index);
  if (length - marks[marks.length - 1] > 0.05) marks.push(length);
  return marks;
}

export function PlanAnnotationsLayer({ layout }: { layout: Layout }) {
  const { widthM, heightM, pixelsPerMeter: ppm } = layout;
  const widthPx = widthM * ppm, heightPx = heightM * ppm;
  const xMarks = meterMarks(widthM), yMarks = meterMarks(heightM);
  const verticalShelves = layout.obstacles.filter((obstacle) =>
    obstacle.type === 'shelf' && Math.abs(Math.sin((obstacle.angle * Math.PI) / 180)) < 0.015 && obstacle.h >= obstacle.w
  );
  const aisles: { x: number; y: number; length: number }[] = [];

  for (let i = 0; i < verticalShelves.length; i++) {
    for (let j = i + 1; j < verticalShelves.length; j++) {
      const first = verticalShelves[i], second = verticalShelves[j];
      const left = first.x <= second.x ? first : second;
      const right = left === first ? second : first;
      const gapStart = left.x + left.w, gapEnd = right.x;
      const yStart = Math.max(left.y, right.y), yEnd = Math.min(left.y + left.h, right.y + right.h);
      if (gapEnd - gapStart < 0.75 || yEnd - yStart < 1.2) continue;

      const blocked = layout.obstacles.some((obstacle) =>
        obstacle.id !== left.id && obstacle.id !== right.id && obstacle.type !== 'entrance' &&
        obstacle.x < gapEnd && obstacle.x + obstacle.w > gapStart &&
        obstacle.y < yEnd && obstacle.y + obstacle.h > yStart
      );
      if (!blocked) aisles.push({ x: (gapStart + gapEnd) / 2, y: yStart + 0.35, length: yEnd - yStart - 0.7 });
    }
  }

  return (
    <>
      <Line points={[0, -8, widthPx, -8]} stroke="rgba(197,218,208,.42)" strokeWidth={0.8} />
      {xMarks.map((meter) => {
        const x = meter * ppm;
        return (
          <GroupMark key={`x-${meter}`} x={x} y={-8} label={meter === 0 ? '0' : `${meter} m`} horizontal />
        );
      })}
      <Line points={[-8, 0, -8, heightPx]} stroke="rgba(197,218,208,.42)" strokeWidth={0.8} />
      {yMarks.map((meter) => (
        <GroupMark key={`y-${meter}`} x={-8} y={meter * ppm} label={meter === 0 ? '0' : `${meter} m`} />
      ))}
      {aisles.map((aisle, index) => (
        <Group key={`aisle-${index}`}>
          <Line points={[aisle.x * ppm, aisle.y * ppm, aisle.x * ppm, (aisle.y + aisle.length) * ppm]}
            stroke="rgba(175,205,192,.42)" strokeWidth={1} dash={[3, 6]} />
          <Text x={(aisle.x - 0.34) * ppm} y={(aisle.y + aisle.length / 2) * ppm - 5} width={0.68 * ppm} height={10}
            text="LỐI ĐI" align="center" fontSize={10} fontStyle="bold" letterSpacing={0.7} fill="#e1ece7" opacity={0.96} />
        </Group>
      ))}
    </>
  );
}

function GroupMark({ x, y, label, horizontal = false }: { x: number; y: number; label: string; horizontal?: boolean }) {
  return (
    <>
      {horizontal
        ? <Line points={[x, y, x, y + 5]} stroke="rgba(197,218,208,.6)" strokeWidth={0.8} />
        : <Line points={[x, y, x + 5, y]} stroke="rgba(197,218,208,.6)" strokeWidth={0.8} />}
      <Text
        x={horizontal ? x - 16 : x - 23}
        y={horizontal ? y - 14 : y - 5}
        width={horizontal ? 32 : 20}
        height={13}
        text={label}
        align={horizontal ? 'center' : 'right'}
        fontSize={10}
        fill="#e0ebe6"
      />
    </>
  );
}
