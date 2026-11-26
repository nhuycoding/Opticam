import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Object3D } from 'three';
import type { ShelfTier } from '../../types';
import { GOODS_BY_ID } from '../../core/craved';

type Triple = [number, number, number];
interface ProductPart { at: Triple; size: Triple; color: string }
export interface ShelfStock { cartons: ProductPart[]; bottles: ProductPart[]; caps: ProductPart[]; labels: ProductPart[]; itemCount: number }
const PACKAGE_COLORS = ['#c8885f', '#a9ba7b', '#d4b56c', '#79a9a5', '#ba8e9b', '#b4be9c'];

/** Bounded stock built once per fixture, rendered with four instanced meshes. */
export function buildShelfStock(w: number, d: number, shelfYs: number[], thickness: number, oneSided: boolean, limit: number, tiers?: ShelfTier[]): ShelfStock {
  const stock: ShelfStock = { cartons: [], bottles: [], caps: [], labels: [], itemCount: 0 };
  const sides = oneSided ? [1] : [-1, 1];
  const rows = shelfYs.length - 1;
  const columns = Math.max(1, Math.min(16, Math.floor((w - 0.08) / 0.19), Math.floor(limit / Math.max(1, rows * sides.length))));
  for (let row = 0; row < rows; row++) {
    const available = shelfYs[row + 1] - shelfYs[row] - thickness;
    if (available < 0.08 || d < 0.13) continue;
    const tier = tiers?.length ? tiers[Math.min(tiers.length - 1, Math.floor((row / Math.max(1, rows)) * tiers.length))] : undefined;
    const tierGoods = tier?.goodsIds.map((id) => GOODS_BY_ID.get(id)).filter((g): g is NonNullable<typeof g> => Boolean(g)) ?? [];
    const palette = tierGoods.length ? tierGoods.flatMap((g) => g.colors) : PACKAGE_COLORS;
    const dominantShape = tierGoods[0]?.shape;
    const dominantSize = tierGoods[0]?.sizeHint ?? 'medium';
    const rowCols = dominantShape === 'bulk' ? Math.max(1, Math.min(6, Math.floor(columns * 0.55))) : columns;

    for (const side of sides) {
      for (let column = 0; column < rowCols && stock.itemCount < limit; column++) {
        const x = -w / 2 + (column + 0.5) * w / rowCols;
        const z = oneSided ? d * 0.08 : side * d * 0.29;
        const base = shelfYs[row] + thickness / 2;
        const color = palette[(column + row * 2 + (side > 0 ? 1 : 0)) % palette.length];
        const shape = tierGoods.length ? tierGoods[(column + row) % tierGoods.length].shape : ((column + row) % 3 === 0 ? 'bottle' : 'pouch');

        if (shape === 'bottle' || shape === 'cosmetic' || shape === 'can') {
          const isCosmetic = shape === 'cosmetic';
          const isCan = shape === 'can';
          const maxR = isCosmetic ? 0.026 : isCan ? 0.062 : 0.045;
          const radius = Math.min(w / rowCols * 0.36, d * (oneSided ? 0.24 : 0.16), maxR);
          const height = Math.min(isCan ? 0.19 : isCosmetic ? 0.14 : 0.25, available * (isCan ? 0.62 : 0.78));
          const bodyHeight = height * (isCan ? 0.9 : 0.78);
          stock.bottles.push({ at: [x, base + bodyHeight / 2, z], size: [radius, bodyHeight, radius], color });
          stock.caps.push({
            at: [x, base + bodyHeight + (height - bodyHeight) * 0.5, z],
            size: [radius * (isCan ? 0.96 : 0.52), Math.max(0.012, height - bodyHeight), radius * (isCan ? 0.96 : 0.52)],
            color: isCosmetic ? '#dfc180' : '#e5e4d0',
          });
          stock.labels.push({
            at: [x, base + bodyHeight * 0.5, z + side * (radius + 0.002)],
            size: [radius * 1.4, bodyHeight * 0.32, 0.003],
            color: '#f2ede0',
          });
        } else {
          const isBulk = shape === 'bulk' || dominantSize === 'large';
          const isCard = shape === 'card';
          const width = Math.min(w / rowCols * (isBulk ? 0.86 : 0.72), isBulk ? 0.26 : isCard ? 0.095 : 0.15);
          const depth = Math.min(d * (oneSided ? 0.52 : 0.34), isBulk ? 0.22 : isCard ? 0.04 : 0.13);
          const height = Math.min(isBulk ? 0.26 : isCard ? 0.18 : 0.21, available * (isBulk ? 0.84 : 0.72));
          stock.cartons.push({ at: [x, base + height / 2, z], size: [width, height, depth], color });
          stock.labels.push({
            at: [x, base + height * (isCard ? 0.78 : 0.55), z + side * (depth / 2 + 0.002)],
            size: [width * 0.74, height * (isCard ? 0.22 : 0.34), 0.003],
            color: isCard ? '#e4eceb' : '#f0e8d6',
          });
        }
        stock.itemCount++;
      }
    }
  }
  return stock;
}

function ProductInstances({ parts, cylindrical = false }: { parts: ProductPart[]; cylindrical?: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const item = new Object3D(), color = new Color();
    parts.forEach((part, index) => {
      item.position.set(...part.at); item.scale.set(...part.size); item.updateMatrix();
      mesh.setMatrixAt(index, item.matrix); mesh.setColorAt(index, color.set(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts]);
  if (!parts.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, parts.length]} castShadow receiveShadow>
    {cylindrical ? <cylinderGeometry args={[1, 1, 1, 8]} /> : <boxGeometry args={[1, 1, 1]} />}
    <meshStandardMaterial color="#ffffff" roughness={0.73} />
  </instancedMesh>;
}

export function ShelfProducts3D({ w, d, shelfYs, thickness, oneSided, limit = 72, tiers }: {
  w: number; d: number; shelfYs: number[]; thickness: number; oneSided: boolean; limit?: number; tiers?: ShelfTier[];
}) {
  const stock = useMemo(() => buildShelfStock(w, d, shelfYs, thickness, oneSided, Math.max(0, limit), tiers), [w, d, shelfYs, thickness, oneSided, limit, tiers]);
  return <group>
    <ProductInstances parts={stock.cartons} />
    <ProductInstances parts={stock.bottles} cylindrical />
    <ProductInstances parts={stock.caps} cylindrical />
    <ProductInstances parts={stock.labels} />
  </group>;
}
