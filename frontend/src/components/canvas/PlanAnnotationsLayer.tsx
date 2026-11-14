import { Arrow, Group, Line, Rect, Text } from 'react-konva';
import type { Layout } from '../../types';
import { obsPoly } from '../../core/geometry';

const ink = '#777f6c';
function marks(length: number) {
  const values = Array.from({ length: Math.floor(length) + 1 }, (_, i) => i);
  if (length - values[values.length - 1] > .05) values.push(length);
  return values;
}
export function PlanAnnotationsLayer({ layout: L, showWalkways = false }: { layout: Layout; showWalkways?: boolean }) {
  const ppm = L.pixelsPerMeter, W = L.widthM * ppm, H = L.heightM * ppm;
  const blocks = L.obstacles.filter(o => o.type !== 'entrance').map(o => {
    const points = obsPoly(o);
    const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
    return { id: o.id, type: o.type, x, y, w: Math.max(...points.map(p => p[0])) - x, h: Math.max(...points.map(p => p[1])) - y };
  });
  const shelves = blocks.filter(o => o.type === 'shelf' && o.h >= o.w && L.obstacles.some(source => source.id === o.id && Math.abs(Math.sin(source.angle * Math.PI / 90)) < .001)).sort((a,b) => a.x-b.x);
  const aisles: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < shelves.length; i++) for (let j = i + 1; j < shelves.length; j++) {
    const a = shelves[i], b = shelves[j], x = a.x + a.w, w = b.x - x;
    if (w < .6 || w > 3) continue;
    const y = Math.max(a.y,b.y), h = Math.min(a.y+a.h,b.y+b.h)-y;
    if (h < 1.2 || aisles.length >= 24) continue;
    if (blocks.some(o => o.id !== a.id && o.id !== b.id && o.x < b.x-.01 && o.x+o.w > x+.01 && o.y < y+h && o.y+o.h > y)) continue;
    aisles.push({x,y,w,h});
  }
  return <>
    {showWalkways && L.walkways?.map((route, i) => <Group key={`route-${i}`} opacity={.65}>
      <Arrow points={route.points.flatMap(([x,y]) => [x*ppm,y*ppm])} stroke="#78916c" fill="#78916c" strokeWidth={1.4} dash={[5,6]} pointerLength={5} pointerWidth={5} tension={.08} />
      <Text x={route.points[1][0]*ppm+6} y={route.points[1][1]*ppm-13} text={route.label} fontSize={9} fill="#536c49" />
    </Group>)}
    <Line points={[0,-24,W,-24]} stroke={ink} strokeWidth={.7} />
    {marks(L.widthM).map(m => <Group key={`x${m}`}><Line points={[m*ppm,-28,m*ppm,-19]} stroke={ink} strokeWidth={.7} /><Text x={m*ppm-17} y={-43} width={34} align="center" text={`${m}`} fontSize={9} fill={ink} /></Group>)}
    <Line points={[-24,0,-24,H]} stroke={ink} strokeWidth={.7} />
    {marks(L.heightM).map(m => <Group key={`y${m}`}><Line points={[-28,m*ppm,-19,m*ppm]} stroke={ink} strokeWidth={.7} /><Text x={-48} y={m*ppm-5} width={19} align="right" text={`${m}`} fontSize={9} fill={ink} /></Group>)}
    <Line points={[0,H+16,0,H+35,W,H+35,W,H+16]} stroke={ink} strokeWidth={.7} />
    {[0,W].map(x => <Line key={x} points={[x-4,H+39,x+4,H+31]} stroke={ink} strokeWidth={1} />)}
    <Rect x={W/2-39} y={H+27} width={78} height={17} fill="#fafbf6" />
    <Text x={W/2-39} y={H+29} width={78} text={`${L.widthM.toFixed(2)} m`} align="center" fontSize={11} fill="#59634f" />
    <Line points={[W+16,0,W+31,0,W+31,H,W+16,H]} stroke={ink} strokeWidth={.7} />
    <Group x={W+31} y={H/2} rotation={90}><Rect x={-35} y={-8} width={70} height={16} fill="#fafbf6" /><Text x={-35} y={-5} width={70} align="center" text={`${L.heightM.toFixed(2)} m`} fontSize={11} fill="#59634f" /></Group>
    {aisles.map((a,i) => <Group key={i}>
      <Line points={[(a.x+a.w/2)*ppm,(a.y+.25)*ppm,(a.x+a.w/2)*ppm,(a.y+a.h-.25)*ppm]} stroke="#94a087" strokeWidth={.7} dash={[4,6]} />
      <Rect x={a.x*ppm+4} y={(a.y+a.h/2)*ppm-16} width={Math.max(0,a.w*ppm-8)} height={32} fill="#f5f5ed" opacity={.9} cornerRadius={2} />
      <Text x={a.x*ppm} y={(a.y+a.h/2)*ppm-10} width={a.w*ppm} align="center" text={`LỐI ĐI\n${a.w.toFixed(2)} m`} fontSize={8} lineHeight={1.5} fill="#68735c" />
    </Group>)}
  </>;
}
