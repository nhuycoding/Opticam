import { FixtureArt } from './FixtureArt';
import { footprintFits, floorOutline, placeWallFixture } from '../../core/footprint';
import { memo, useRef, useState } from 'react';
import { Circle, Group, Line, Rect, Shape, Text } from 'react-konva';
import type { Obstacle } from '../../types';
import { obstacleFitsRoom, obsPoly, placeObstacle, satCollide } from '../../core/geometry';
import { OBS_FILL, type Selection } from './shared';

interface Props {
  floorPolygon?: [number, number][];
  obs: Obstacle; all: Obstacle[]; ppm: number; roomW: number; roomH: number; grid: number; selected: boolean;
  onSelect: (s: Selection) => void; onObstacle: (o: Obstacle) => void;
}

/** Vật cản kéo thả: snap lưới 0.5 m, SAT chống chồng lấn (tự hoàn tác), cửa tự khoá vào tường. */
export const ObstacleNode = memo(function ObstacleNode({ floorPolygon, obs: o, all, ppm, roomW, roomH, grid, selected, onSelect, onObstacle }: Props) {
  const [conflict, setConflict] = useState(false);
  const origin = useRef({ x: 0, y: 0 });
  const test = (cx: number, cy: number) => {
    const n = o.fixture === 'wall-shelf' || (o.type === 'entrance' && floorPolygon) ? placeWallFixture(o, [cx, cy], floorPolygon ?? floorOutline({ widthM: roomW, heightM: roomH })) ?? o : placeObstacle(o, cx, cy, roomW, roomH, grid);
    return { n, hit: !obstacleFitsRoom(n, roomW, roomH) || !footprintFits(n, floorPolygon) || all.some((q) => q.id !== o.id && satCollide(obsPoly(n), obsPoly(q))) };
  };
  const wPx = o.w * ppm, hPx = o.h * ppm;
  const isShelf = o.type === 'shelf' && (!o.fixture || o.fixture === 'gondola'), isPos = o.type === 'pos', isEntrance = o.type === 'entrance';
  const border = conflict ? '#c74747' : selected ? '#92704b' : '#8b937d';
  const shelfAlongY = hPx >= wPx;
  const shelfLength = shelfAlongY ? hPx : wPx;
  const shelfSections = Math.max(1, Math.min(8, Math.floor(shelfLength / Math.max(1, ppm * 0.7))));
  const entranceInside = o.angle % 180 === 0
    ? (o.y < roomH / 2 ? 1 : -1)
    : (o.x < roomW / 2 ? -1 : 1);
  const doorHingeX = Math.min(5, wPx / 3), doorHingeY = hPx / 2;
  const doorLeafLength = Math.max(0, wPx - doorHingeX - 4);
  const labelY = isPos ? hPx * .55 : Math.max(0, hPx / 2 - 15);
  const labelHeight = isPos ? Math.max(12, hPx * .42) : Math.min(30, hPx);
  const labelFontSize = Math.min(10, Math.max(7, Math.min(wPx / 5.4, labelHeight / 2.4)));
  const verticalLabel = hPx > wPx * 1.7 && wPx >= 18 && hPx >= 64;
  const showLabel = !isEntrance && !verticalLabel && wPx >= 54 && labelHeight >= (isPos ? 16 : 22);
  return (
    <Group x={(o.x + o.w / 2) * ppm} y={(o.y + o.h / 2) * ppm} offsetX={wPx / 2} offsetY={hPx / 2} rotation={o.angle} draggable
      onPointerDown={() => onSelect({ kind: 'obs', id: o.id })}
      onDragStart={(e) => { origin.current = { x: e.target.x(), y: e.target.y() }; }}
      onDragMove={(e) => setConflict(test(e.target.x() / ppm, e.target.y() / ppm).hit)}
      onDragEnd={(e) => {
        const { n, hit } = test(e.target.x() / ppm, e.target.y() / ppm);
        setConflict(false);
        if (hit) { e.target.position(origin.current); return; }
        onObstacle(n); e.target.position({ x: (n.x + n.w / 2) * ppm, y: (n.y + n.h / 2) * ppm }); e.target.rotation(n.angle);
      }}>
      {isEntrance && <Rect x={0} y={-11} width={wPx} height={hPx+22} fill="#fafbf6" listening={false} />}
      <Rect width={wPx} height={hPx} fill={OBS_FILL[o.type]} cornerRadius={2} shadowColor="#38412c" shadowBlur={3} shadowOffsetX={2} shadowOffsetY={3} shadowOpacity={.09} stroke={border} strokeWidth={selected ? 2 : 1} />
      {o.fixture && o.fixture !== 'gondola' && o.type !== 'pos' && <FixtureArt obstacle={o} width={wPx} height={hPx} ppm={ppm} roomW={roomW} roomH={roomH} />}
      {isShelf && wPx > 12 && hPx > 12 && <>
        <Rect x={4} y={4} width={wPx - 8} height={hPx - 8} fill="#f3f2e9" cornerRadius={2} stroke="#bec4ad" strokeWidth={0.7} />
        {Array.from({ length: shelfSections }, (_, i) => {
          const start = i * shelfLength / shelfSections + 8;
          const span = Math.max(0, shelfLength / shelfSections - 16);
          const across = Math.max(0, (shelfAlongY ? wPx : hPx) / 2 - 11);
          return <Group key={`stock-${i}`} listening={false}>
            {[0,1].map(side => <Group key={side}>
              {[0,1,2].map(slot => <Rect key={slot}
                x={shelfAlongY ? 7 + side * (wPx/2-1) : start + slot * span/3}
                y={shelfAlongY ? start + slot * span/3 : 7 + side * (hPx/2-1)}
                width={shelfAlongY ? across : Math.max(0, span/3-3)}
                height={shelfAlongY ? Math.max(0, span/3-3) : across}
                cornerRadius={1} fill={['#c6cdb8','#d5cbb4','#b9c2a5'][(i+side+slot)%3]} stroke="#a9b298" strokeWidth={.4} />)}
            </Group>)}
          </Group>;
        })}
        {shelfAlongY
          ? <>
            <Rect x={5} y={5} width={wPx - 10} height={4} fill="#aab49a" cornerRadius={2} listening={false} />
            <Rect x={5} y={hPx - 9} width={wPx - 10} height={4} fill="#aab49a" cornerRadius={2} listening={false} />
          </>
          : <>
            <Rect x={5} y={5} width={4} height={hPx - 10} fill="#aab49a" cornerRadius={2} listening={false} />
            <Rect x={wPx - 9} y={5} width={4} height={hPx - 10} fill="#aab49a" cornerRadius={2} listening={false} />
          </>}
        {Array.from({ length: shelfSections - 1 }, (_, index) => {
          const position = ((index + 1) * shelfLength) / shelfSections;
          return <Line key={index} points={shelfAlongY ? [5, position, wPx - 5, position] : [position, 5, position, hPx - 5]}
            stroke="#9ca78c" strokeWidth={1} listening={false} />;
        })}
        {shelfAlongY
          ? <>
            <Line points={[wPx * 0.28, 5, wPx * 0.28, hPx - 5]} stroke="#bdc4ad" strokeWidth={0.7} listening={false} />
            <Line points={[wPx * 0.72, 5, wPx * 0.72, hPx - 5]} stroke="#bdc4ad" strokeWidth={0.7} listening={false} />
          </>
          : <>
            <Line points={[5, hPx * 0.28, wPx - 5, hPx * 0.28]} stroke="#bdc4ad" strokeWidth={0.7} listening={false} />
            <Line points={[5, hPx * 0.72, wPx - 5, hPx * 0.72]} stroke="#bdc4ad" strokeWidth={0.7} listening={false} />
          </>}
      </>}
      {isPos && <>
        <Rect x={4} y={hPx * 0.7} width={Math.max(0, wPx - 8)} height={Math.max(0, hPx * 0.25 - 4)} fill="#b99b70" cornerRadius={2} listening={false} />
        <Line points={[4, hPx * 0.7, wPx - 4, hPx * 0.7]} stroke="#987b56" strokeWidth={1} listening={false} />
        {wPx >= 70 && hPx >= 35 && <>
          <Rect x={wPx - 30} y={6} width={21} height={16} fill="#53604b" cornerRadius={2} listening={false} />
          <Rect x={wPx - 27} y={9} width={15} height={9} fill="#b7c8ae" cornerRadius={1} listening={false} />
          <Line points={[wPx-19.5,22,wPx-19.5,28,wPx-27,28,wPx-12,28]} stroke="#6c725b" strokeWidth={2} listening={false} />
          <Rect x={7} y={7} width={20} height={13} fill="#e5dcc9" stroke="#ab946f" strokeWidth={.7} cornerRadius={1} listening={false} />
          <Line points={[11,11,23,11,11,15,23,15]} stroke="#bdac8c" strokeWidth={1} listening={false} />
        </>}
      </>}
      {isEntrance && <>
        <Rect x={2} y={2} width={Math.max(0, wPx - 4)} height={Math.max(0, hPx - 4)} fill="#e1e7d7" stroke="#9aa78a" strokeWidth={1} listening={false} />
        <Line points={[2, doorHingeY, wPx - 2, doorHingeY]} stroke="#fff" strokeWidth={2} listening={false} />
        <Line points={[doorHingeX, doorHingeY, doorHingeX, doorHingeY + entranceInside * doorLeafLength]}
          stroke="#748b61" strokeWidth={2} listening={false} />
        <Circle x={doorHingeX} y={doorHingeY} radius={2} fill="#748b61" listening={false} />
        <Shape listening={false} sceneFunc={(ctx) => {
          ctx.beginPath();
          ctx.arc(doorHingeX, doorHingeY, doorLeafLength, 0, entranceInside * Math.PI / 2, entranceInside < 0);
          ctx.setAttr('strokeStyle', 'rgba(107,129,85,.5)');
          ctx.setAttr('lineWidth', 1);
          ctx.stroke();
        }} />
      </>}
      {selected && <>
        <Rect x={-5} y={-5} width={wPx+10} height={hPx+10} stroke="#92704b" strokeWidth={.7} dash={[3,3]} listening={false} />
        {[[0,0],[wPx,0],[0,hPx],[wPx,hPx]].map(([x,y],i) => <Rect key={i} x={x-2} y={y-2} width={4} height={4} fill="#fffef8" stroke="#92704b" strokeWidth={.8} listening={false} />)}
        <Text x={0} y={-19} width={wPx} text={`${o.w.toFixed(2)} m`} align="center" fontSize={9} fill="#765d42" listening={false} />
      </>}
      {verticalLabel && !isEntrance && <Group x={wPx/2} y={hPx/2} rotation={-90} listening={false}>
        <Rect x={-Math.min(150,hPx-8)/2} y={-11} width={Math.min(150,hPx-8)} height={22} fill="#f7f6ee" opacity={.94} cornerRadius={2}/>
        <Text x={-Math.min(150,hPx-8)/2} y={-8} width={Math.min(150,hPx-8)} height={18} text={`${o.label} · ${o.elev} m`} fontSize={9} fill="#536047" align="center" verticalAlign="middle"/>
      </Group>}
      {showLabel && <Rect x={Math.max(1,wPx*.08)} y={labelY} width={wPx*.84} height={labelHeight} fill={isPos ? '#d6c4a5' : '#f7f6ed'} opacity={.96} cornerRadius={2} listening={false} />}
      {showLabel && <Text x={isPos ? 2 : 0} y={labelY} width={wPx - (isPos ? 4 : 0)} height={labelHeight}
        text={`${o.label}\nH ${o.elev} m`} align="center" verticalAlign="middle" fill="#536047" fontSize={labelFontSize} fontStyle="bold" listening={false} />}
    </Group>
  );
});
