import { memo, useRef } from 'react';
import { Circle, Ellipse, Group, Line, Rect } from 'react-konva';
import type { Obstacle, Person } from '../../types';
import { round2 } from '../../core/geometry';
import { canPlacePerson } from '../../core/person';
import { PAD, type Selection } from './shared';

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
  const shirt = selected ? '#f97316' : '#147d82';
  const pants = selected ? '#263c50' : '#344c63';
  const skin = '#efc19f';
  const lastValid = useRef({ x, y });
  return (
    <Group
      name="person-node"
      x={x}
      y={y}
      draggable
      onMouseDown={() => onSelect({ kind: 'person', id: person.id })}
      onDragStart={() => { lastValid.current = { x: x + PAD, y: y + PAD }; }}
      dragBoundFunc={(pos) => {
        const nextX = (pos.x - PAD) / ppm, nextY = (pos.y - PAD) / ppm;
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
      <Circle radius={25} fill="rgba(255,255,255,0.01)" />
      <Ellipse y={25} radiusX={selected ? 15 : 11} radiusY={selected ? 5 : 3.5}
        fill={selected ? 'rgba(249,115,22,.12)' : 'rgba(5,15,20,.24)'}
        stroke={selected ? 'rgba(249,115,22,.82)' : 'transparent'} strokeWidth={1} listening={false} />
      <Line points={[-6, 8, -8, 17, -9, 23]} stroke={pants} strokeWidth={5} lineCap="round" lineJoin="round" />
      <Line points={[6, 8, 8, 17, 9, 23]} stroke={pants} strokeWidth={5} lineCap="round" lineJoin="round" />
      <Line points={[-9, 23, -12, 24]} stroke="#202d37" strokeWidth={4} lineCap="round" />
      <Line points={[9, 23, 12, 24]} stroke="#202d37" strokeWidth={4} lineCap="round" />
      <Line points={[-7, -9, -11, -3, -12, 4]} stroke={shirt} strokeWidth={5.5} lineCap="round" lineJoin="round" />
      <Line points={[7, -9, 11, -3, 12, 4]} stroke={shirt} strokeWidth={5.5} lineCap="round" lineJoin="round" />
      <Line points={[-12, 4, -11, 9]} stroke={skin} strokeWidth={3.5} lineCap="round" />
      <Line points={[12, 4, 11, 9]} stroke={skin} strokeWidth={3.5} lineCap="round" />
      <Circle x={-11} y={9} radius={2.2} fill={skin} />
      <Circle x={11} y={9} radius={2.2} fill={skin} />
      <Rect x={-7} y={-11} width={14} height={21} cornerRadius={5} fill={shirt} />
      <Line points={[0, -11, 0, 8]} stroke="rgba(255,255,255,.24)" strokeWidth={1} listening={false} />
      <Rect x={-2.5} y={-15} width={5} height={6} cornerRadius={2} fill={skin} />
      <Circle y={-21} radius={6.5} fill={skin} />
      <Ellipse y={-24} radiusX={6.8} radiusY={3.6} fill="#263544" />
    </Group>
  );
});
