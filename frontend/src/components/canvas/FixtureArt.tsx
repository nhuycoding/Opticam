import { Circle, Group, Line, Rect } from 'react-konva';
import type { Obstacle } from '../../types';
import { analyzeObstacleCraved, type ItemShape } from '../../core/craved';

/** Simple crisp top-down motif for a single shelf item slot based on its CRAVED merchandise shape. */
export function ShelfItemGlyph({
  x, y, width, height, shape, color, accent,
}: {
  x: number; y: number; width: number; height: number; shape: ItemShape; color: string; accent: string;
}) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const r = Math.max(1.2, Math.min(width, height) * 0.36);

  if (shape === 'bottle') {
    return (
      <Group listening={false}>
        <Circle x={cx} y={cy} radius={r} fill={color} stroke="#636b5e" strokeWidth={0.5} />
        <Circle x={cx} y={cy} radius={Math.max(0.8, r * 0.42)} fill={accent} />
      </Group>
    );
  }
  if (shape === 'cosmetic') {
    return (
      <Group listening={false}>
        <Circle x={cx - width * 0.16} y={cy} radius={Math.max(1, r * 0.72)} fill={color} stroke="#7c5660" strokeWidth={0.45} />
        <Circle x={cx + width * 0.18} y={cy} radius={Math.max(0.9, r * 0.56)} fill={accent} stroke="#b69356" strokeWidth={0.45} />
      </Group>
    );
  }
  if (shape === 'can') {
    return (
      <Group listening={false}>
        <Circle x={cx} y={cy} radius={Math.max(1.4, r * 1.05)} fill={color} stroke="#6b7467" strokeWidth={0.6} />
        <Circle x={cx} y={cy} radius={Math.max(0.8, r * 0.65)} stroke="#f5f1e3" strokeWidth={0.6} />
      </Group>
    );
  }
  if (shape === 'card') {
    return (
      <Group listening={false}>
        <Rect x={x + 0.5} y={y + 0.5} width={Math.max(1, width - 1)} height={Math.max(1, height - 1)} cornerRadius={1} fill={color} stroke="#68787f" strokeWidth={0.45} />
        <Circle x={cx} y={y + Math.max(2, height * 0.25)} radius={Math.max(0.7, Math.min(width, height) * 0.12)} fill="#f8f6ee" />
      </Group>
    );
  }
  if (shape === 'pouch') {
    return (
      <Group listening={false}>
        <Rect x={x} y={y} width={Math.max(1, width)} height={Math.max(1, height)} cornerRadius={3} fill={color} stroke="#9c8b6d" strokeWidth={0.45} />
        <Line points={[x + 1.5, cy, x + width - 1.5, cy]} stroke={accent} strokeWidth={0.8} />
      </Group>
    );
  }
  // 'bulk' sacks / cartons / multi-packs
  return (
    <Group listening={false}>
      <Rect x={x} y={y} width={Math.max(1, width)} height={Math.max(1, height)} cornerRadius={2} fill={color} stroke="#848d7e" strokeWidth={0.55} />
      <Line points={[x + 2, y + 2, x + width - 2, y + height - 2]} stroke={accent} strokeWidth={0.7} opacity={0.75} />
      <Line points={[x + width - 2, y + 2, x + 2, y + height - 2]} stroke={accent} strokeWidth={0.7} opacity={0.75} />
    </Group>
  );
}

/** Top-view furniture details remain inside the obstacle's collision footprint. */
export function FixtureArt({ obstacle: o, width: w, height: h, ppm, roomW, roomH }: {
  obstacle: Obstacle; width: number; height: number; ppm: number; roomW: number; roomH: number;
}) {
  const vertical = h > w;
  const length = Math.max(w, h);
  const sections = Math.max(1, Math.min(12, Math.round(length / (ppm * .65))));
  const kind = o.fixture;
  const cravedAnalysis = analyzeObstacleCraved(o);
  const goods = cravedAnalysis.tierAnalyses.flatMap((t) => t.goods);
  const stockColors = goods.length ? goods.map((g) => g.colors[0]) : ['#c8cdb3', '#dbccaa', '#b9c5a5'];
  const stockAccents = goods.length ? goods.map((g) => g.colors[1]) : ['#e2e5d4', '#ede4cb', '#d8e0c9'];
  const stockShapes: ItemShape[] = goods.length ? goods.map((g) => g.shape) : ['pouch'];

  if (kind === 'fridge' || kind === 'freezer') {
    return <Group listening={false}>
      <Rect x={2} y={2} width={Math.max(0,w-4)} height={Math.max(0,h-4)} fill={kind === 'fridge' ? '#dce9e5' : '#e5eff0'} stroke="#8ca9a3" strokeWidth={.8} cornerRadius={2} />
      {Array.from({length:sections},(_,i) => {
        const start = i * length / sections, end = (i+1) * length / sections;
        return <Group key={i}>
          <Rect x={vertical ? 5 : start+4} y={vertical ? start+4 : 5} width={vertical ? Math.max(0,w-10) : Math.max(0,end-start-8)} height={vertical ? Math.max(0,end-start-8) : Math.max(0,h-10)} fill="#edf5ee" stroke="#a4bdb2" strokeWidth={.6} cornerRadius={1}/>
          <Line points={vertical ? [w-8,start+9,w-8,end-9] : [start+9,h-8,end-9,h-8]} stroke="#718e82" strokeWidth={1.6}/>
          {[0,1,2].map(j => <Circle key={j} x={vertical ? w/2 : start+(j+1)*(end-start)/4} y={vertical ? start+(j+1)*(end-start)/4 : h/2} radius={Math.min(3,Math.min(w,h)/8)} fill={stockColors[(i+j) % stockColors.length]} />)}
        </Group>;
      })}
    </Group>;
  }
  if (kind === 'locked-cabinet') {
    return <Group listening={false}>
      <Rect x={2} y={2} width={Math.max(0, w - 4)} height={Math.max(0, h - 4)} fill="#e7eff0" stroke="#5b797a" strokeWidth={1.3} cornerRadius={2} />
      <Rect x={4} y={4} width={Math.max(0, w - 8)} height={Math.max(0, h - 8)} fill="#f3f8f8" stroke="#99b6b7" strokeWidth={0.6} dash={[4, 2]} cornerRadius={1} />
      {Array.from({ length: sections }, (_, i) => {
        const span = length / sections;
        return <Group key={i}>
          {[0, 1].map((j) => {
            const idx = (i + j) % stockColors.length;
            const gx = vertical ? w * 0.25 : (i + 0.14 + j * 0.38) * span;
            const gy = vertical ? (i + 0.14 + j * 0.38) * span : h * 0.25;
            const gw = vertical ? Math.max(3, w * 0.5) : Math.max(3, span * 0.3);
            const gh = vertical ? Math.max(3, span * 0.3) : Math.max(3, h * 0.5);
            return <ShelfItemGlyph key={j} x={gx} y={gy} width={gw} height={gh} shape={stockShapes[idx % stockShapes.length]} color={stockColors[idx]} accent={stockAccents[idx % stockAccents.length]} />;
          })}
          <Circle x={vertical ? w - 6 : (i + 0.5) * span} y={vertical ? (i + 0.5) * span : h - 6} radius={2.2} fill="#b57d3b" />
        </Group>;
      })}
    </Group>;
  }
  if (kind === 'promo-island') {
    return <Group listening={false}>
      <Rect x={2} y={2} width={Math.max(0, w - 4)} height={Math.max(0, h - 4)} fill="#ebe6d6" stroke="#9c9379" strokeWidth={1} cornerRadius={4} />
      <Rect x={Math.max(4, w * 0.18)} y={Math.max(4, h * 0.18)} width={Math.max(2, w * 0.64)} height={Math.max(2, h * 0.64)} fill="#f7f4ea" stroke="#b3a787" strokeWidth={0.8} cornerRadius={3} />
      <ShelfItemGlyph x={w * 0.3} y={h * 0.3} width={Math.max(4, w * 0.4)} height={Math.max(4, h * 0.4)} shape={stockShapes[0]} color={stockColors[0]} accent={stockAccents[0]} />
    </Group>;
  }
  if (kind === 'locker') {
    const cubbies = Math.max(2, Math.min(8, Math.round(length / (ppm * 0.35))));
    return <Group listening={false}>
      <Rect x={2} y={2} width={Math.max(0, w - 4)} height={Math.max(0, h - 4)} fill="#d9dedb" stroke="#7d8882" strokeWidth={1} cornerRadius={2} />
      {Array.from({ length: cubbies }, (_, i) => {
        const span = length / cubbies;
        return <Group key={i}>
          <Line points={vertical ? [3, i * span, w - 3, i * span] : [i * span, 3, i * span, h - 3]} stroke="#8e9993" strokeWidth={0.8} />
          <Circle x={vertical ? w - 6 : (i + 0.5) * span} y={vertical ? (i + 0.5) * span : h - 6} radius={1.6} fill="#5c6661" />
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
  if (kind === 'partition' || kind === 'column') {
    const isWall = kind === 'partition' && length > Math.min(w, h) * 2;
    return (
      <Group listening={false}>
        <Rect x={1} y={1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} fill="#bfc4b4" stroke="#647156" strokeWidth={1.1} />
        {isWall && Array.from({ length: Math.max(2, Math.floor(length / 10)) }, (_, i) => {
          const offset = i * 10 + 3;
          return vertical
            ? <Line key={i} points={[2, offset, Math.max(2, w - 2), offset + 5]} stroke="#7a856d" strokeWidth={0.6} opacity={0.55} />
            : <Line key={i} points={[offset, 2, offset + 5, Math.max(2, h - 2)]} stroke="#7a856d" strokeWidth={0.6} opacity={0.55} />;
        })}
      </Group>
    );
  }
  // One-sided shelves (wall-shelf, endcap, checkout-rack) have a rear panel and a front bank of products.
  const backLeft = o.x + o.w/2 < roomW/2, backTop = o.y + o.h/2 < roomH/2;
  const accentFill = kind === 'checkout-rack' ? '#f7f1e3' : '#f0eedf';
  return <Group listening={false}>
    <Rect x={3} y={3} width={Math.max(0,w-6)} height={Math.max(0,h-6)} fill={accentFill} stroke="#b4bca4" strokeWidth={.6}/>
    <Rect x={vertical ? (backLeft ? 2 : w-6) : 2} y={vertical ? 2 : (backTop ? 2 : h-6)} width={vertical ? 4 : Math.max(0,w-4)} height={vertical ? Math.max(0,h-4) : 4} fill={kind === 'endcap' ? '#7b8a6c' : '#899678'}/>
    {Array.from({length:sections},(_,i) => <Group key={i}>
      {[0,1,2].map(j => {
        const idx = (i + j) % stockColors.length;
        return <ShelfItemGlyph key={j}
          x={vertical ? 8 : (i+j/3)*w/sections+4}
          y={vertical ? (i+j/3)*h/sections+4 : 8}
          width={vertical ? Math.max(0,w-16) : Math.max(0,w/sections/3-5)}
          height={vertical ? Math.max(0,h/sections/3-5) : Math.max(0,h-16)}
          shape={stockShapes[idx % stockShapes.length]}
          color={stockColors[idx]}
          accent={stockAccents[idx % stockAccents.length]}
        />;
      })}
      <Line points={vertical ? [4,(i+1)*h/sections,w-4,(i+1)*h/sections] : [(i+1)*w/sections,4,(i+1)*w/sections,h-4]} stroke="#a3ae91" strokeWidth={.8}/>
    </Group>)}
  </Group>;
}
