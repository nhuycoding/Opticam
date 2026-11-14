import { memo } from 'react';
import type { Person } from '../../types';
import type { Selection } from '../canvas/shared';
import { Block } from './Fixtures3D';

const SHIRT_COLORS = ['#668c7b', '#8c8fa9', '#b79065', '#6e94a2'];

export const PersonModel3D = memo(function PersonModel3D({ person, selected, onSelect }: {
  person: Person; selected: boolean; onSelect: (selection: Selection) => void;
}) {
  const variation = Array.from(person.id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const shirt = selected ? '#b68552' : SHIRT_COLORS[variation % SHIRT_COLORS.length];
  return <group position={[person.x, 0, person.y]} onClick={event => {
    if (event.delta > 5) return;
    event.stopPropagation(); onSelect({ kind: 'person', id: person.id });
  }}>
    <group rotation={[0, variation % 2 ? 0.32 : -0.28, 0]}>
      <mesh position={[0, 1.555, 0]} scale={[0.95, 1.15, 0.94]} castShadow>
        <sphereGeometry args={[0.115, 12, 10]} /><meshStandardMaterial color="#cfad8b" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.618, -0.015]} scale={[1.02, 0.64, 0.98]} castShadow>
        <sphereGeometry args={[0.116, 12, 8]} /><meshStandardMaterial color="#4d4a40" roughness={0.95} />
      </mesh>
      <Block size={[0.045, 0.045, 0.035]} at={[0, 1.55, 0.1]} color="#c6a280" />
      {[-1, 1].map(side => <Block key={side} size={[0.009, 0.009, 0.006]} at={[side * 0.035, 1.577, 0.108]} color="#4c5148" />)}
      <mesh position={[0, 1.403, 0]} castShadow><cylinderGeometry args={[0.055, 0.06, 0.095, 10]} /><meshStandardMaterial color="#cfad8b" roughness={0.9} /></mesh>
      <mesh position={[0, 1.14, 0]} scale={[1, 1, 0.66]} castShadow>
        <cylinderGeometry args={[0.18, 0.145, 0.48, 10]} /><meshStandardMaterial color={shirt} roughness={0.92} />
      </mesh>
      <Block size={[0.27, 0.14, 0.2]} at={[0, 0.855, 0]} color="#57665f" />
      <Block size={[0.285, 0.025, 0.207]} at={[0, 0.915, 0]} color="#414e48" />
      {[-1, 1].map(side => <group key={side}>
        <group position={[side * 0.205, 1.33, 0]} rotation={[0.08, 0, side * 0.12]}>
          <mesh position={[0, -0.105, 0]} castShadow><capsuleGeometry args={[0.061, 0.13, 3, 8]} /><meshStandardMaterial color={shirt} roughness={0.9} /></mesh>
          <mesh position={[0, -0.26, 0.015]} rotation={[-0.08, 0, 0]} castShadow><capsuleGeometry args={[0.042, 0.16, 3, 8]} /><meshStandardMaterial color="#cfad8b" roughness={0.9} /></mesh>
          <mesh position={[0, -0.385, 0.025]} scale={[0.8, 1.2, 0.65]} castShadow><sphereGeometry args={[0.045, 8, 6]} /><meshStandardMaterial color="#cfad8b" roughness={0.9} /></mesh>
        </group>
        <mesh position={[side * 0.085, 0.62, 0]} castShadow><capsuleGeometry args={[0.073, 0.24, 3, 8]} /><meshStandardMaterial color="#57665f" roughness={0.95} /></mesh>
        <mesh position={[side * 0.085, 0.265, 0.008]} castShadow><capsuleGeometry args={[0.059, 0.24, 3, 8]} /><meshStandardMaterial color="#57665f" roughness={0.95} /></mesh>
        <Block size={[0.135, 0.1, 0.245]} at={[side * 0.085, 0.055, 0.052]} color="#3f4d46" roughness={0.82} />
      </group>)}
    </group>
    {selected && <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}><ringGeometry args={[0.26, 0.29, 32]} /><meshBasicMaterial color="#b68552" /></mesh>}
  </group>;
});
