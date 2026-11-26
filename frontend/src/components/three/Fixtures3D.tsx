import { memo, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Obstacle } from '../../types';
import type { Selection } from '../canvas/shared';
import type { Pt } from '../../core/geometry';
import { fixtureBodyRotation } from './sceneGeometry';
import { ShelfProducts3D } from './ShelfProducts3D';

type Triple = [number, number, number];

export function Block({ size, at = [0, 0, 0], color = '#dadbd3', roughness = 0.8, ...rest }: {
  size: Triple; at?: Triple; color?: string; roughness?: number;
  rotation?: Triple; opacity?: number;
}) {
  return <mesh position={at} rotation={rest.rotation} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={roughness} transparent={rest.opacity !== undefined} opacity={rest.opacity ?? 1} />
  </mesh>;
}

function Shelving({ w, d, h, oneSided, productLimit }: { w: number; d: number; h: number; oneSided: boolean; productLimit: number }) {
  const levels = Math.max(2, Math.min(5, Math.round(h / 0.4)));
  const baseHeight = Math.min(0.12, h * 0.14), thickness = Math.min(0.035, h * 0.035);
  const shelfYs = Array.from({ length: levels }, (_, i) => baseHeight + thickness / 2 + (h - baseHeight - thickness) * i / (levels - 1));
  const panelHeight = Math.max(h * 0.1, h - baseHeight - thickness - 0.01);
  const postHeight = Math.max(h * 0.2, h - thickness - 0.012);
  return <>
    <Block size={[w, baseHeight, d]} at={[0, baseHeight / 2, 0]} color="#9fa99f" />
    <Block size={[Math.max(0.02, w - 0.05), panelHeight, Math.min(0.045, d * 0.18)]} at={[0, baseHeight + panelHeight / 2, oneSided ? -d / 2 + 0.025 : 0]} color="#bdc7be" />
    {[-1, 1].map(side => <Block key={side} size={[Math.min(0.03, w * 0.1), postHeight, Math.max(0.02, d - 0.03)]} at={[side * (w / 2 - 0.025), postHeight / 2, 0]} color="#8b9991" />)}
    {shelfYs.map((y, i) => <Block key={i} size={[w, thickness, d]} at={[0, y, 0]} color="#e2e7df" />)}
    <ShelfProducts3D w={w} d={d} shelfYs={shelfYs} thickness={thickness} oneSided={oneSided} limit={productLimit} />
  </>;
}

function Cabinet({ w, d, h, freezer }: { w: number; d: number; h: number; freezer: boolean }) {
  const doors = Math.max(1, Math.min(4, Math.round(w / 0.65)));
  const capHeight = Math.min(0.12, h * 0.2);
  const bodyHeight = h - capHeight;
  return <>
    <Block size={[w, bodyHeight, d]} at={[0, bodyHeight / 2, 0]} color="#c9d6d4" />
    <Block size={[w + 0.015, capHeight, d + 0.015]} at={[0, h - capHeight / 2, 0]} color="#728c88" />
    {Array.from({ length: doors }, (_, i) => <group key={i}>
      <Block size={freezer ? [Math.max(0.01, w / doors - 0.05), 0.025, d * 0.78] : [Math.max(0.01, w / doors - 0.05), h * 0.74, 0.025]}
        at={freezer ? [-w / 2 + w / doors * (i + 0.5), h + 0.015, 0] : [-w / 2 + w / doors * (i + 0.5), h * 0.49, d / 2 + 0.015]} color="#96b9b7" roughness={0.24} />
      {!freezer && <>
        <Block size={[Math.min(0.04, w / doors * 0.1), h * 0.61, 0.003]} at={[-w / 2 + w / doors * (i + 0.24), h * 0.49, d / 2 + 0.031]} color="#d0e2d9" opacity={0.28} roughness={0.18} />
        <Block size={[0.025, h * 0.22, 0.035]} at={[-w / 2 + w / doors * (i + 0.9), h * 0.49, d / 2 + 0.04]} color="#4d6967" />
      </>}
    </group>)}
    {!freezer && <>
      <Block size={[w * 0.8, Math.min(0.045, h * 0.05), 0.012]} at={[0, h * 0.055, d / 2 + 0.009]} color="#839e95" />
      <Block size={[Math.min(0.04, w * 0.1), Math.min(0.015, capHeight * 0.25), 0.008]} at={[w * 0.35, h - capHeight / 2, d / 2 + 0.014]} color="#9ebf91" />
    </>}
  </>;
}

function Counter({ w, d, h, pos }: { w: number; d: number; h: number; pos: boolean }) {
  const topHeight = Math.min(0.06, h * 0.25), bodyHeight = h - topHeight;
  return <>
    <Block size={[Math.max(0.02, w - 0.04), bodyHeight, Math.max(0.02, d - 0.04)]} at={[0, bodyHeight / 2, 0]} color="#c5b79d" />
    <Block size={[w, topHeight, d]} at={[0, h - topHeight / 2, 0]} color="#5f6c62" />
    {pos ? <>
      <Block size={[Math.min(0.22, w * 0.25), 0.12, Math.min(0.18, d * 0.3)]} at={[0, h + 0.06, 0]} color="#374b48" />
      <Block size={[Math.min(0.35, w * 0.4), 0.23, 0.045]} at={[0, h + 0.23, 0]} color="#253a38" rotation={[-0.12, 0, 0]} />
    </> : <Block size={[w * 0.35, 0.18, d * 0.55]} at={[-w * 0.22, h + 0.09, 0]} color="#a7b8ae" />}
  </>;
}

function Entrance({ w, d, h }: { w: number; d: number; h: number }) {
  return <>
    <Block size={[w, 0.025, d]} at={[0, 0.018, 0]} color="#b8ccc7" />
    {[-1, 1].map(side => <Block key={side} size={[0.04, h, 0.04]} at={[side * (w / 2 - 0.02), h / 2, 0]} color="#6e8c88" />)}
    <Block size={[w, 0.06, 0.055]} at={[0, h - 0.03, 0]} color="#6e8c88" />
  </>;
}

export const Fixture3D = memo(function Fixture3D({ obstacle: o, selected, onSelect, outline, productLimit = 72 }: {
  obstacle: Obstacle; selected: boolean; onSelect: (s: Selection) => void; outline: Pt[]; productLimit?: number;
}) {
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 5) return;
    event.stopPropagation(); onSelect({ kind: 'obs', id: o.id });
  };
  const alignLongSide = o.fixture !== 'column' && o.fixture !== 'partition' && o.h > o.w;
  const w = alignLongSide ? o.h : o.w, d = alignLongSide ? o.w : o.h, h = Math.max(0.03, o.elev);
  let body: ReactNode;
  if (o.type === 'entrance') body = <Entrance w={w} d={d} h={h} />;
  else if (o.type === 'pos' || o.fixture === 'food-counter') body = <Counter w={w} d={d} h={h} pos={o.type === 'pos'} />;
  else if (o.fixture === 'fridge' || o.fixture === 'freezer') body = <Cabinet w={w} d={d} h={h} freezer={o.fixture === 'freezer'} />;
  else if (o.fixture === 'seating') body = <>
    <Block size={[w, Math.min(0.06, h * 0.25), d]} at={[0, h - Math.min(0.06, h * 0.25) / 2, 0]} color="#cdbb99" />
    {[-1, 1].map(side => <Block key={side} size={[Math.min(0.06, w * 0.15), h - Math.min(0.06, h * 0.25), Math.max(0.05, d * 0.7)]} at={[side * w * 0.36, (h - Math.min(0.06, h * 0.25)) / 2, 0]} color="#7e8980" />)}
  </>;
  else if (o.fixture === 'partition' || o.fixture === 'column') body = <Block size={[w, h, d]} at={[0, h / 2, 0]} color="#d5d1c5" />;
  else body = <Shelving w={w} d={d} h={h} oneSided={o.fixture === 'wall-shelf'} productLimit={productLimit} />;
  return <group position={[o.x + o.w / 2, 0, o.y + o.h / 2]} rotation={[0, -o.angle * Math.PI / 180, 0]} onClick={click}>
    <group rotation={[0, fixtureBodyRotation(o, outline), 0]}>{body}</group>
    {selected && <mesh position={[0, h / 2, 0]} raycast={() => {}}>
      <boxGeometry args={[o.w + 0.06, h + 0.045, o.h + 0.06]} />
      <meshBasicMaterial color="#aa6c3f" wireframe transparent opacity={0.85} />
    </mesh>}
  </group>;
});
