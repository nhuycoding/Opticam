import { memo, useRef } from 'react';
import { Circle, Ellipse, Group, Line, Rect, Text } from 'react-konva';
import type { Obstacle, Person } from '../../types';
import { round2 } from '../../core/geometry';
import { canPlacePerson } from '../../core/person';
import { type Selection } from './shared';

const TOP_SHIRTS = ['#567a6b', '#6d7792', '#a87f58', '#587e8d', '#8c6662'];
const TOP_SKINS = ['#d6b697', '#cfa884', '#ddbda0'];
const TOP_HAIRS = ['#3b362f', '#4e4237', '#2b2926'];

interface Props {
  person: Person;
  ppm: number;
  selected: boolean;
  onSelect: (selection: Selection) => void;
  roomW: number;
  roomH: number;
  obstacles: Obstacle[];
  floorPolygon?: [number, number][];
  onMove: (person: Person) => void;
}

export const PersonNode = memo(function PersonNode({ person, ppm, selected, roomW, roomH, obstacles, floorPolygon, onSelect, onMove }: Props) {
  const x = person.x * ppm, y = person.y * ppm;
  const lastValid = useRef({ x, y });
  const variation = Array.from(person.id).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const shirt = selected ? '#b68552' : TOP_SHIRTS[variation % TOP_SHIRTS.length];
  const skin = TOP_SKINS[variation % TOP_SKINS.length];
  const hair = TOP_HAIRS[variation % TOP_HAIRS.length];
  const pose = variation % 3;
  const facingDeg = (variation % 4 - 1.5) * 16;

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
        if (canPlacePerson(nextX, nextY, roomW, roomH, obstacles, floorPolygon)) {
          lastValid.current = pos;
          return pos;
        }
        return lastValid.current;
      }}
      onDragEnd={(event) => {
        const next = {
          ...person,
          x: floorPolygon ? event.target.x() / ppm : round2(Math.max(0, Math.min(event.target.x() / ppm, roomW))),
          y: floorPolygon ? event.target.y() / ppm : round2(Math.max(0, Math.min(event.target.y() / ppm, roomH)))
        };
        onMove(next);
      }}
    >
      <Circle radius={19} fill="rgba(255,255,255,.01)" />
      <Circle radius={18} fill={selected ? 'rgba(182,133,82,.10)' : 'transparent'} stroke={selected ? '#92704b' : '#8d9c7c'} strokeWidth={selected ? 1.4 : 0.65} dash={[3, 3]} listening={false} />
      <Group rotation={facingDeg} listening={false}>
        {/* Arms with gentle elbow curve / browsing posture */}
        <Line points={pose === 1 ? [-12, 1, -14, 7, -11, 11] : [-12, 1, -13, 6, -11, 10]} stroke={shirt} strokeWidth={3.6} lineCap="round" lineJoin="round" />
        <Line points={pose === 0 ? [12, 1, 14, 7, 10, 12] : [12, 1, 13, 6, 11, 10]} stroke={shirt} strokeWidth={3.6} lineCap="round" lineJoin="round" />
        <Circle x={pose === 1 ? -11 : -11} y={pose === 1 ? 11 : 10} radius={2.2} fill={skin} />
        <Circle x={pose === 0 ? 10 : 11} y={pose === 0 ? 12 : 10} radius={2.2} fill={skin} />
        {pose === 1 && (
          <Rect x={-17} y={9} width={8} height={10} cornerRadius={2} fill="#6e867c" stroke="#455850" strokeWidth={0.8} />
        )}
        {/* Shoulders & Torso */}
        <Ellipse y={1.5} radiusX={13} radiusY={7.5} fill={shirt} stroke="#fffef4" strokeWidth={1.3} />
        {/* Head & directional hair */}
        <Circle y={-1.5} radius={6.8} fill={skin} stroke="#fffef4" strokeWidth={1.1} />
        <Ellipse y={-3.4} radiusX={6.4} radiusY={4.6} fill={hair} />
        {pose === 1 && <Circle y={-7.5} radius={2.6} fill={hair} stroke="#fffef4" strokeWidth={0.6} />}
      </Group>
      {selected && (
        <Group y={21} listening={false}>
          <Rect x={-22} y={0} width={44} height={14} fill="#fffef8" stroke="#92704b" strokeWidth={0.8} cornerRadius={3} />
          <Text x={-22} y={1} width={44} height={12} text={person.id.replace('PERSON-', 'P')} fontSize={8.5} fontStyle="bold" fill="#765d42" align="center" verticalAlign="middle" />
        </Group>
      )}
    </Group>
  );
});
