import { memo, useRef, useState } from 'react';
import { Circle, Group, Line, Rect, Shape, Text } from 'react-konva';
import type { Obstacle } from '../../types';
import { obsPoly, placeObstacle, satCollide } from '../../core/geometry';
import { OBS_FILL, type Selection } from './shared';

interface Props {
  obs: Obstacle; all: Obstacle[]; ppm: number; roomW: number; roomH: number; grid: number; selected: boolean;
  onSelect: (s: Selection) => void; onObstacle: (o: Obstacle) => void;
}

/** Vật cản kéo thả: snap lưới 0.5 m, SAT chống chồng lấn (tự hoàn tác), cửa tự khoá vào tường. */
export const ObstacleNode = memo(function ObstacleNode({ obs: o, all, ppm, roomW, roomH, grid, selected, onSelect, onObstacle }: Props) {
  const [conflict, setConflict] = useState(false);
  const origin = useRef({ x: 0, y: 0 });
  const test = (cx: number, cy: number) => {
    const n = placeObstacle(o, cx, cy, roomW, roomH, grid);
    return { n, hit: all.some((q) => q.id !== o.id && satCollide(obsPoly(n), obsPoly(q))) };
  };
  const wPx = o.w * ppm, hPx = o.h * ppm;
  const isShelf = o.type === 'shelf', isPos = o.type === 'pos', isEntrance = o.type === 'entrance';
  const border = conflict ? '#c74747' : selected ? '#087e83' : '#71817a';
  const shelfAlongY = hPx >= wPx;
  const shelfLength = shelfAlongY ? hPx : wPx;
  const shelfSections = Math.max(1, Math.min(8, Math.floor(shelfLength / Math.max(1, ppm * 0.7))));
  const entranceInside = o.angle % 180 === 0
    ? (o.y < roomH / 2 ? 1 : -1)
    : (o.x < roomW / 2 ? -1 : 1);
  const doorHingeX = Math.min(5, wPx / 3), doorHingeY = hPx / 2;
  const doorLeafLength = Math.min(wPx * 0.72, 56);
  const labelY = isPos ? 2 : 0;
  const labelHeight = isPos ? hPx * 0.66 - 4 : hPx;
  const labelFontSize = Math.min(12, Math.max(9, Math.min(wPx / 5.4, labelHeight / 2.4)));
  const showLabel = !isEntrance && wPx >= 54 && labelHeight >= 22;
  return (
    <Group x={(o.x + o.w / 2) * ppm} y={(o.y + o.h / 2) * ppm} offsetX={wPx / 2} offsetY={hPx / 2} rotation={o.angle} draggable
      onMouseDown={() => onSelect({ kind: 'obs', id: o.id })}
      onDragStart={(e) => { origin.current = { x: e.target.x(), y: e.target.y() }; }}
      onDragMove={(e) => setConflict(test(e.target.x() / ppm, e.target.y() / ppm).hit)}
      onDragEnd={(e) => {
        const { n, hit } = test(e.target.x() / ppm, e.target.y() / ppm);
        setConflict(false);
        if (hit) { e.target.position(origin.current); return; }
        onObstacle(n); e.target.position({ x: (n.x + n.w / 2) * ppm, y: (n.y + n.h / 2) * ppm }); e.target.rotation(n.angle);
      }}>
      <Rect width={wPx} height={hPx} fill={OBS_FILL[o.type]} cornerRadius={4} stroke={border} strokeWidth={selected ? 2 : 1} />
      {isShelf && wPx > 12 && hPx > 12 && <>
        <Rect x={4} y={4} width={wPx - 8} height={hPx - 8} fill="rgba(174,199,192,.22)" cornerRadius={2} stroke="rgba(191,211,205,.58)" strokeWidth={0.7} />
        {shelfAlongY
          ? <>
            <Rect x={5} y={5} width={wPx - 10} height={4} fill="rgba(191,211,205,.5)" cornerRadius={2} listening={false} />
            <Rect x={5} y={hPx - 9} width={wPx - 10} height={4} fill="rgba(191,211,205,.5)" cornerRadius={2} listening={false} />
          </>
          : <>
            <Rect x={5} y={5} width={4} height={hPx - 10} fill="rgba(191,211,205,.5)" cornerRadius={2} listening={false} />
            <Rect x={wPx - 9} y={5} width={4} height={hPx - 10} fill="rgba(191,211,205,.5)" cornerRadius={2} listening={false} />
          </>}
        {Array.from({ length: shelfSections - 1 }, (_, index) => {
          const position = ((index + 1) * shelfLength) / shelfSections;
          return <Line key={index} points={shelfAlongY ? [5, position, wPx - 5, position] : [position, 5, position, hPx - 5]}
            stroke="#a5b1a9" strokeWidth={1} listening={false} />;
        })}
        {shelfAlongY
          ? <>
            <Line points={[wPx * 0.28, 5, wPx * 0.28, hPx - 5]} stroke="rgba(100,116,107,.2)" strokeWidth={0.7} listening={false} />
            <Line points={[wPx * 0.72, 5, wPx * 0.72, hPx - 5]} stroke="rgba(100,116,107,.2)" strokeWidth={0.7} listening={false} />
          </>
          : <>
            <Line points={[5, hPx * 0.28, wPx - 5, hPx * 0.28]} stroke="rgba(100,116,107,.2)" strokeWidth={0.7} listening={false} />
            <Line points={[5, hPx * 0.72, wPx - 5, hPx * 0.72]} stroke="rgba(100,116,107,.2)" strokeWidth={0.7} listening={false} />
          </>}
      </>}
      {isPos && <>
        <Rect x={4} y={hPx * 0.7} width={Math.max(0, wPx - 8)} height={Math.max(0, hPx * 0.25 - 4)} fill="rgba(201,163,110,.48)" cornerRadius={2} listening={false} />
        <Line points={[4, hPx * 0.7, wPx - 4, hPx * 0.7]} stroke="#a9814d" strokeWidth={1} listening={false} />
        {wPx >= 70 && hPx >= 35 && <>
          <Rect x={wPx - 26} y={5} width={18} height={13} fill="#40595b" cornerRadius={2} listening={false} />
          <Circle x={wPx - 17} y={11.5} radius={2} fill="#a5ddd4" listening={false} />
        </>}
      </>}
      {isEntrance && <>
        <Rect x={2} y={2} width={Math.max(0, wPx - 4)} height={Math.max(0, hPx - 4)} fill="rgba(180,204,199,.3)" stroke="#9eb5b0" strokeWidth={1} listening={false} />
        <Line points={[2, doorHingeY, wPx - 2, doorHingeY]} stroke="#fff" strokeWidth={2} listening={false} />
        <Line points={[doorHingeX, doorHingeY, doorHingeX, doorHingeY + entranceInside * doorLeafLength]}
          stroke="#087e83" strokeWidth={2} listening={false} />
        <Circle x={doorHingeX} y={doorHingeY} radius={2} fill="#087e83" listening={false} />
        <Shape listening={false} sceneFunc={(ctx) => {
          ctx.beginPath();
          ctx.arc(doorHingeX, doorHingeY, doorLeafLength, 0, entranceInside * Math.PI / 2, entranceInside < 0);
          ctx.setAttr('strokeStyle', 'rgba(8,126,131,.5)');
          ctx.setAttr('lineWidth', 1);
          ctx.stroke();
        }} />
      </>}
      {showLabel && <Text x={isPos ? 2 : 0} y={labelY} width={wPx - (isPos ? 4 : 0)} height={labelHeight}
        text={`${o.label}\n${o.elev}m`} align="center" verticalAlign="middle" fill="#18363b" fontSize={labelFontSize} fontStyle="bold" listening={false} />}
    </Group>
  );
});
