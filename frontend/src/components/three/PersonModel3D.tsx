import { memo } from 'react';
import type { Person } from '../../types';
import type { Selection } from '../canvas/shared';

const SHIRT_COLORS = ['#567a6b', '#6d7792', '#a87f58', '#587e8d', '#8c6662'];
const PANT_COLORS = ['#47524d', '#4c5460', '#5b554c'];
const SKIN_TONES = ['#d6b697', '#cfa884', '#ddbda0'];
const HAIR_COLORS = ['#3b362f', '#4e4237', '#2b2926'];

export const PersonModel3D = memo(function PersonModel3D({ person, selected, onSelect }: {
  person: Person; selected: boolean; onSelect: (selection: Selection) => void;
}) {
  const variation = Array.from(person.id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const shirt = selected ? '#b68552' : SHIRT_COLORS[variation % SHIRT_COLORS.length];
  const pants = PANT_COLORS[variation % PANT_COLORS.length];
  const skin = SKIN_TONES[variation % SKIN_TONES.length];
  const hair = HAIR_COLORS[variation % HAIR_COLORS.length];
  const pose = variation % 3;
  const yaw = (variation % 4 - 1.5) * 0.28;

  return <group position={[person.x, 0, person.y]} onClick={event => {
    if (event.delta > 5) return;
    event.stopPropagation(); onSelect({ kind: 'person', id: person.id });
  }}>
    <group rotation={[0, yaw, 0]}>
      {/* Ground subtle contact shadow */}
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
        <circleGeometry args={[0.21, 20]} />
        <meshBasicMaterial color="#2f352e" transparent opacity={0.14} />
      </mesh>

      {/* Head & natural facial proportions (eyes ~1.58 m) */}
      <group position={[0, 1.565, 0]} rotation={[pose === 0 ? -0.05 : 0.04, pose === 0 ? 0.14 : -0.1, 0]}>
        <mesh scale={[0.92, 1.12, 0.96]} castShadow>
          <sphereGeometry args={[0.105, 16, 12]} />
          <meshStandardMaterial color={skin} roughness={0.86} />
        </mesh>
        {/* Hair crown + subtle back/bun variation */}
        <mesh position={[0, 0.042, -0.012]} scale={[0.98, 0.72, 1.02]} castShadow>
          <sphereGeometry args={[0.108, 16, 10]} />
          <meshStandardMaterial color={hair} roughness={0.92} />
        </mesh>
        {pose === 1 && (
          <mesh position={[0, 0.015, -0.115]} scale={[0.9, 0.9, 0.85]} castShadow>
            <sphereGeometry args={[0.045, 10, 8]} />
            <meshStandardMaterial color={hair} roughness={0.92} />
          </mesh>
        )}
        {/* Subtle ears & nose bridge (rounded, non-blocky) */}
        {[-1, 1].map((side) => (
          <mesh key={`ear-${side}`} position={[side * 0.095, -0.005, -0.005]} scale={[0.45, 0.8, 0.65]}>
            <sphereGeometry args={[0.022, 8, 6]} />
            <meshStandardMaterial color={skin} roughness={0.88} />
          </mesh>
        ))}
        <mesh position={[0, -0.008, 0.098]} scale={[0.65, 1.1, 0.75]}>
          <sphereGeometry args={[0.015, 8, 6]} />
          <meshStandardMaterial color={skin} roughness={0.85} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh key={`eye-${side}`} position={[side * 0.032, 0.012, 0.092]}>
            <sphereGeometry args={[0.006, 8, 6]} />
            <meshStandardMaterial color="#343832" roughness={0.5} />
          </mesh>
        ))}
      </group>

      {/* Neck & Collar */}
      <mesh position={[0, 1.42, 0]} castShadow>
        <cylinderGeometry args={[0.046, 0.056, 0.09, 12]} />
        <meshStandardMaterial color={skin} roughness={0.88} />
      </mesh>
      <mesh position={[0, 1.375, 0]} castShadow>
        <cylinderGeometry args={[0.072, 0.088, 0.03, 12]} />
        <meshStandardMaterial color={shirt} roughness={0.9} />
      </mesh>

      {/* Contoured Torso & Rounded Shoulders */}
      <mesh position={[0, 1.155, 0]} scale={[1.04, 1, 0.64]} castShadow>
        <cylinderGeometry args={[0.175, 0.142, 0.45, 14]} />
        <meshStandardMaterial color={shirt} roughness={0.88} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={`sh-${side}`} position={[side * 0.175, 1.335, 0]} scale={[0.9, 0.85, 0.78]} castShadow>
          <sphereGeometry args={[0.062, 10, 8]} />
          <meshStandardMaterial color={shirt} roughness={0.88} />
        </mesh>
      ))}

      {/* Curved Pelvis & Belt */}
      <mesh position={[0, 0.92, 0]} scale={[1.02, 1, 0.66]} castShadow>
        <cylinderGeometry args={[0.145, 0.145, 0.035, 14]} />
        <meshStandardMaterial color="#3a403c" roughness={0.75} />
      </mesh>
      <mesh position={[0, 0.855, 0]} scale={[1, 1, 0.68]} castShadow>
        <cylinderGeometry args={[0.144, 0.132, 0.11, 14]} />
        <meshStandardMaterial color={pants} roughness={0.92} />
      </mesh>

      {/* Left Arm (carries basket when pose === 1, otherwise relaxed) */}
      <group position={[-0.195, 1.33, 0]} rotation={[pose === 1 ? -0.18 : 0.06, 0, -0.1]}>
        <mesh position={[0, -0.105, 0]} castShadow>
          <capsuleGeometry args={[0.052, 0.14, 4, 10]} />
          <meshStandardMaterial color={shirt} roughness={0.88} />
        </mesh>
        <group position={[0, -0.21, 0]} rotation={[pose === 1 ? -0.35 : -0.15, 0, 0.04]}>
          <mesh position={[0, -0.095, 0]} castShadow>
            <capsuleGeometry args={[0.038, 0.15, 4, 10]} />
            <meshStandardMaterial color={skin} roughness={0.86} />
          </mesh>
          <mesh position={[0, -0.205, 0.01]} scale={[0.75, 1.15, 0.58]} castShadow>
            <sphereGeometry args={[0.038, 10, 8]} />
            <meshStandardMaterial color={skin} roughness={0.86} />
          </mesh>
          {pose === 1 && (
            <group position={[-0.03, -0.33, 0.04]}>
              <mesh castShadow>
                <boxGeometry args={[0.18, 0.17, 0.26]} />
                <meshStandardMaterial color="#6e867c" roughness={0.78} />
              </mesh>
              <mesh position={[0, 0.09, 0]}>
                <boxGeometry args={[0.19, 0.018, 0.27]} />
                <meshStandardMaterial color="#4e635b" roughness={0.65} />
              </mesh>
              <mesh position={[0, 0.125, 0]}>
                <boxGeometry args={[0.018, 0.075, 0.14]} />
                <meshStandardMaterial color="#3c4b45" roughness={0.6} />
              </mesh>
            </group>
          )}
        </group>
      </group>

      {/* Right Arm (browsing reach at ~1.0m hand height in poses 0 & 2) */}
      <group position={[0.195, 1.33, 0]} rotation={[pose === 0 ? -0.52 : pose === 2 ? -0.25 : 0.06, 0, 0.1]}>
        <mesh position={[0, -0.105, 0]} castShadow>
          <capsuleGeometry args={[0.052, 0.14, 4, 10]} />
          <meshStandardMaterial color={shirt} roughness={0.88} />
        </mesh>
        <group position={[0, -0.21, 0]} rotation={[pose === 0 ? -0.55 : pose === 2 ? -0.75 : -0.12, 0, -0.05]}>
          <mesh position={[0, -0.095, 0]} castShadow>
            <capsuleGeometry args={[0.038, 0.15, 4, 10]} />
            <meshStandardMaterial color={skin} roughness={0.86} />
          </mesh>
          <mesh position={[0, -0.205, 0.01]} scale={[0.75, 1.15, 0.58]} castShadow>
            <sphereGeometry args={[0.038, 10, 8]} />
            <meshStandardMaterial color={skin} roughness={0.86} />
          </mesh>
          {pose === 2 && (
            <mesh position={[-0.01, -0.215, 0.03]} rotation={[0.4, 0, 0]}>
              <boxGeometry args={[0.048, 0.088, 0.008]} />
              <meshStandardMaterial color="#2a3335" roughness={0.4} />
            </mesh>
          )}
        </group>
      </group>

      {/* Natural Legs & Rounded Shoes */}
      {[-1, 1].map((side) => {
        const stride = side * (pose === 0 ? 0.035 : 0.015);
        return (
          <group key={`leg-${side}`} position={[side * 0.082, 0, stride]}>
            <mesh position={[0, 0.625, 0]} castShadow>
              <capsuleGeometry args={[0.066, 0.25, 4, 10]} />
              <meshStandardMaterial color={pants} roughness={0.92} />
            </mesh>
            <mesh position={[0, 0.27, 0.006]} castShadow>
              <capsuleGeometry args={[0.053, 0.24, 4, 10]} />
              <meshStandardMaterial color={pants} roughness={0.92} />
            </mesh>
            <mesh position={[0, 0.045, 0.038]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1.15, 0.72]} castShadow>
              <capsuleGeometry args={[0.052, 0.11, 4, 10]} />
              <meshStandardMaterial color="#3c4641" roughness={0.78} />
            </mesh>
          </group>
        );
      })}
    </group>
    {selected && <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}><ringGeometry args={[0.26, 0.295, 32]} /><meshBasicMaterial color="#b68552" /></mesh>}
  </group>;
});
