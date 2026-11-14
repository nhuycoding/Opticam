import { Circle, Group, Line, Rect } from 'react-konva';
import type { Obstacle } from '../../types';

/** Top-view furniture details remain inside the obstacle's collision footprint. */
export function FixtureArt({ obstacle: o, width: w, height: h, ppm, roomW, roomH }: {
  obstacle: Obstacle; width: number; height: number; ppm: number; roomW: number; roomH: number;
}) {
  const vertical = h > w;
  const length = Math.max(w, h);
  const sections = Math.max(1, Math.min(12, Math.round(length / (ppm * .65))));
  const kind = o.fixture;
  if (kind === 'fridge' || kind === 'freezer') {
    return <Group listening={false}>
      <Rect x={2} y={2} width={Math.max(0,w-4)} height={Math.max(0,h-4)} fill={kind === 'fridge' ? '#dce9e5' : '#e5eff0'} stroke="#8ca9a3" strokeWidth={.8} cornerRadius={2} />
      {Array.from({length:sections},(_,i) => {
        const start = i * length / sections, end = (i+1) * length / sections;
        return <Group key={i}>
          <Rect x={vertical ? 5 : start+4} y={vertical ? start+4 : 5} width={vertical ? Math.max(0,w-10) : Math.max(0,end-start-8)} height={vertical ? Math.max(0,end-start-8) : Math.max(0,h-10)} fill="#edf5ee" stroke="#a4bdb2" strokeWidth={.6} cornerRadius={1}/>
          <Line points={vertical ? [w-8,start+9,w-8,end-9] : [start+9,h-8,end-9,h-8]} stroke="#718e82" strokeWidth={1.6}/>
          {[0,1,2].map(j => <Circle key={j} x={vertical ? w/2 : start+(j+1)*(end-start)/4} y={vertical ? start+(j+1)*(end-start)/4 : h/2} radius={Math.min(3,Math.min(w,h)/8)} fill={['#b7c9a3','#c2cfbd','#d5cfac'][j]} />)}
        </Group>;
      })}
    </Group>;
  }
  if (kind === 'seating') {
    return <Group listening={false}>
      <Rect x={2} y={2} width={Math.max(0,w-4)} height={Math.max(0,h-4)} fill="#ede5d3" cornerRadius={2} />
      <Rect x={vertical ? 3 : 3} y={3} width={vertical ? w*.48 : w-6} height={vertical ? h-6 : h*.48} fill="#c4b38e" stroke="#998669" strokeWidth={.8} cornerRadius={2}/>
      {Array.from({length:sections},(_,i) => <Circle key={i} x={vertical ? w*.77 : (i+.5)*w/sections} y={vertical ? (i+.5)*h/sections : h*.77} radius={Math.max(1,Math.min(Math.min(w,h)*.16,7))} fill="#e3d5b8" stroke="#a49475" strokeWidth={.8}/>)}
    </Group>;
  }
  if (kind === 'food-counter') {
    return <Group listening={false}>
      <Rect x={3} y={3} width={Math.max(0,w-6)} height={Math.max(0,h-6)} fill="#ddcfb2" stroke="#a99a7a" strokeWidth={.7}/>
      {Array.from({length:sections},(_,i) => <Rect key={i} x={vertical ? 6 : i*w/sections+5} y={vertical ? i*h/sections+5 : 6} width={vertical ? Math.max(0,w-12) : Math.max(0,w/sections-10)} height={vertical ? Math.max(0,h/sections-10) : Math.max(0,h-12)} fill={i%2 ? '#b9c4ae' : '#727e6d'} cornerRadius={2} stroke="#f4f0e2" strokeWidth={1}/>)}
    </Group>;
  }
  if (kind === 'partition' || kind === 'column') return <Rect x={2} y={2} width={Math.max(0,w-4)} height={Math.max(0,h-4)} fill="#c6c8bc" stroke="#999f89" strokeWidth={1} listening={false}/>;
  // One-sided wall shelving has a rear panel and a single bank of products.
  const backLeft = o.x + o.w/2 < roomW/2, backTop = o.y + o.h/2 < roomH/2;
  return <Group listening={false}>
    <Rect x={3} y={3} width={Math.max(0,w-6)} height={Math.max(0,h-6)} fill="#f0eedf" stroke="#b4bca4" strokeWidth={.6}/>
    <Rect x={vertical ? (backLeft ? 2 : w-6) : 2} y={vertical ? 2 : (backTop ? 2 : h-6)} width={vertical ? 4 : Math.max(0,w-4)} height={vertical ? Math.max(0,h-4) : 4} fill="#899678"/>
    {Array.from({length:sections},(_,i) => <Group key={i}>
      {[0,1,2].map(j => <Rect key={j} x={vertical ? 8 : (i+j/3)*w/sections+4} y={vertical ? (i+j/3)*h/sections+4 : 8} width={vertical ? Math.max(0,w-16) : Math.max(0,w/sections/3-5)} height={vertical ? Math.max(0,h/sections/3-5) : Math.max(0,h-16)} fill={['#c8cdb3','#dbccaa','#b9c5a5'][(i+j)%3]} stroke="#acb497" strokeWidth={.4} cornerRadius={1}/>)}
      <Line points={vertical ? [4,(i+1)*h/sections,w-4,(i+1)*h/sections] : [(i+1)*w/sections,4,(i+1)*w/sections,h-4]} stroke="#a3ae91" strokeWidth={.8}/>
    </Group>)}
  </Group>;
}
