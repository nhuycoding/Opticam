import { memo, useRef } from 'react';
import { Circle, Ellipse, Group, Line } from 'react-konva';
import type { Obstacle, Person } from '../../types';
import { round2 } from '../../core/geometry';
import { canPlacePerson } from '../../core/person';
import { type Selection } from './shared';

interface Props {
  person: Person;
  ppm: number;
  selected: boolean;
  onSelect: (selection: Selection) => void;
  roomW: number;
  roomH: number;
  obstacles: Obstacle[];
  onMove: (person: Person) => void;
}

export const PersonNode = memo(function PersonNode({ person, ppm, selected, roomW, roomH, obstacles, onSelect, onMove }: Props) {
  const x = person.x * ppm, y = person.y * ppm;
  const lastValid = useRef({ x, y });
  return (
    <Group
      name="person-node"
      x={x}
      y={y}
      draggable
      onPointerDown={() => onSelect({ kind: 'person', id: person.id })}
      onDragStart={(event) => { lastValid.current = event.target.getAbsolutePosition(); }}
      dragBoundFunc={function (pos) {
        const transform = this.getParent()!.getAbsoluteTransform();
        const local = transform.copy().invert().point(pos);
        const nextX = local.x / ppm, nextY = local.y / ppm;
        if (canPlacePerson(nextX, nextY, roomW, roomH, obstacles)) {
          lastValid.current = pos;
          return pos;
        }
        return lastValid.current;
      }}
      onDragEnd={(event) => {
        const next = {
          ...person,
          x: round2(Math.max(0, Math.min(event.target.x() / ppm, roomW))),
          y: round2(Math.max(0, Math.min(event.target.y() / ppm, roomH)))
        };
        onMove(next);
      }}
    >
      <Circle radius={19} fill="rgba(255,255,255,.01)" />
      <Circle radius={19} fill={selected ? 'rgba(118,93,66,.07)' : 'transparent'} stroke={selected ? '#92704b' : '#8d9c7c'} strokeWidth={selected ? 1.2 : .6} dash={[3,3]} listening={false} />
      <Ellipse y={3} radiusX={14} radiusY={9} fill="#536b55" stroke="#fffef4" strokeWidth={1.4} listening={false} />
      <Line points={[-11,3,-14,9]} stroke="#ac9478" strokeWidth={3} lineCap="round" listening={false} />
      <Line points={[11,3,14,9]} stroke="#ac9478" strokeWidth={3} lineCap="round" listening={false} />
      <Circle y={-3} radius={7} fill="#cfb99a" stroke="#fffef4" strokeWidth={1} listening={false} />
      <Ellipse y={-5} radiusX={6} radiusY={4} fill="#5c6351" listening={false} />

    </Group>
  );
});
