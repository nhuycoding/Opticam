import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Object3D } from 'three';

type Triple = [number, number, number];
interface ProductPart { at: Triple; size: Triple; color: string }
export interface ShelfStock { cartons: ProductPart[]; bottles: ProductPart[]; caps: ProductPart[]; labels: ProductPart[]; itemCount: number }
const PACKAGE_COLORS = ['#c8885f', '#a9ba7b', '#d4b56c', '#79a9a5', '#ba8e9b', '#b4be9c'];

/** Bounded stock built once per fixture, rendered with four instanced meshes. */
export function buildShelfStock(w: number, d: number, shelfYs: number[], thickness: number, oneSided: boolean, limit: number): ShelfStock {
  const stock: ShelfStock = { cartons: [], bottles: [], caps: [], labels: [], itemCount: 0 };
  const sides = oneSided ? [1] : [-1, 1];
  const rows = shelfYs.length - 1;
  const columns = Math.max(1, Math.min(16, Math.floor((w - 0.08) / 0.19), Math.floor(limit / Math.max(1, rows * sides.length))));
  for (let row = 0; row < rows; row++) {
    const available = shelfYs[row + 1] - shelfYs[row] - thickness;
    if (available < 0.08 || d < 0.13) continue;
    for (const side of sides) {
      for (let column = 0; column < columns && stock.itemCount < limit; column++) {
        const x = -w / 2 + (column + 0.5) * w / columns;
        const z = oneSided ? d * 0.08 : side * d * 0.29;
        const height = Math.min(0.23, available * (0.72 + (column % 3) * 0.06));
        const width = Math.min(0.135, w / columns * 0.75);
        const depth = Math.min(0.14, d * (oneSided ? 0.5 : 0.34));
        const base = shelfYs[row] + thickness / 2;
        const color = PACKAGE_COLORS[(column + row * 2 + (side > 0 ? 1 : 0)) % PACKAGE_COLORS.length];
        if ((column + row) % 3 === 0) {
          const radius = Math.min(width / 2, depth / 2, 0.045), bodyHeight = height * 0.86;
          stock.bottles.push({ at: [x, base + bodyHeight / 2, z], size: [radius, bodyHeight, radius], color });
          stock.caps.push({ at: [x, base + bodyHeight + height * 0.07, z], size: [radius * 0.55, height * 0.14, radius * 0.55], color: '#e5e4d0' });
          stock.labels.push({ at: [x, base + bodyHeight * 0.48, z + side * (radius + 0.002)], size: [radius * 1.5, bodyHeight * 0.28, 0.003], color: '#eee9d6' });
        } else {
          stock.cartons.push({ at: [x, base + height / 2, z], size: [width, height, depth], color });
          stock.labels.push({ at: [x, base + height * 0.55, z + side * (depth / 2 + 0.002)], size: [width * 0.7, height * 0.3, 0.003], color: '#f0e8d6' });
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

export function ShelfProducts3D({ w, d, shelfYs, thickness, oneSided, limit = 72 }: {
  w: number; d: number; shelfYs: number[]; thickness: number; oneSided: boolean; limit?: number;
}) {
  const stock = useMemo(() => buildShelfStock(w, d, shelfYs, thickness, oneSided, Math.max(0, limit)), [w, d, shelfYs, thickness, oneSided, limit]);
  return <group>
    <ProductInstances parts={stock.cartons} />
    <ProductInstances parts={stock.bottles} cylindrical />
    <ProductInstances parts={stock.caps} cylindrical />
    <ProductInstances parts={stock.labels} />
  </group>;
}
