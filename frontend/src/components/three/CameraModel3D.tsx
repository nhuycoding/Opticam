import { memo, useEffect, useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import type { Camera, Layout } from '../../types';
import type { Selection } from '../canvas/shared';
import { cameraProjection } from '../../core/camera';
import { Block } from './Fixtures3D';
import { cameraAssemblyPose } from './sceneGeometry';

function CameraLabel({ id, selected }: { id: string; selected: boolean }) {
  const map = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = selected ? '#895b3b' : '#fffef5';
    context.beginPath(); context.roundRect(2, 2, 252, 60, 10); context.fill();
    context.font = '600 25px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillStyle = selected ? '#fffdf6' : '#354c46'; context.fillText(id, 128, 33, 236);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
  }, [id, selected]);
  useEffect(() => () => map.dispose(), [map]);
  return <sprite position={[0, 0.4, 0]} scale={[0.85, 0.2125, 1]}><spriteMaterial map={map} depthTest={false} transparent /></sprite>;
}

export const CameraModel3D = memo(function CameraModel3D({ camera, layout, selected, onSelect, onCameraView }: {
  camera: Camera; layout: Layout; selected: boolean;
  onSelect: (selection: Selection) => void; onCameraView: (id: string) => void;
}) {
  const pose = cameraAssemblyPose(camera, layout);
  const armEnd = pose.bodyPosition.clone().add(new Vector3(0, 0.06, 0));
  const armVector = armEnd.clone().sub(pose.mountPosition);
  const armRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), armVector.clone().normalize());
  const plateRotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), pose.mountDirection);
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 5) return;
    event.stopPropagation(); onSelect({ kind: 'cam', id: camera.id });
  };
  return <group onClick={click} onDoubleClick={event => { event.stopPropagation(); onCameraView(camera.id); }}>
    <mesh position={pose.mountPosition} quaternion={plateRotation} castShadow>
      <cylinderGeometry args={[0.095, 0.095, 0.025, 16]} /><meshStandardMaterial color="#aeb8af" roughness={0.5} metalness={0.2} />
    </mesh>
    {armVector.lengthSq() > 0.0001 && <mesh position={pose.mountPosition.clone().add(armEnd).multiplyScalar(0.5)} quaternion={armRotation} castShadow>
      <cylinderGeometry args={[0.022, 0.026, armVector.length(), 8]} /><meshStandardMaterial color="#829287" roughness={0.55} metalness={0.2} />
    </mesh>}
    <group position={pose.bodyPosition}>
      <group rotation={[0, -camera.pan * Math.PI / 180, 0]}>
        <group rotation={[0, 0, -cameraProjection(camera).tilt * Math.PI / 180]}>
          <Block size={[0.3, 0.16, 0.18]} color={selected ? '#d5b98f' : '#eeeee3'} roughness={0.48} />
          <Block size={[0.29, 0.014, 0.194]} at={[0.015, 0.087, 0]} color="#faf9ef" roughness={0.45} />
          <mesh position={[0.173, 0, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.077, 0.077, 0.074, 20]} /><meshStandardMaterial color="#334743" roughness={0.42} metalness={0.15} />
          </mesh>
          <mesh position={[0.212, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.041, 0.041, 0.006, 20]} /><meshStandardMaterial color="#183c40" roughness={0.16} metalness={0.4} />
          </mesh>
          {Array.from({ length: 6 }, (_, index) => {
            const angle = index * Math.PI / 3;
            return <mesh key={index} position={[0.212, Math.cos(angle) * 0.059, Math.sin(angle) * 0.059]}>
              <sphereGeometry args={[0.006, 6, 4]} /><meshStandardMaterial color="#bbc8b6" roughness={0.28} />
            </mesh>;
          })}
          <Block size={[0.025, 0.009, 0.004]} at={[0.08, 0.043, 0.093]} color="#5f9a72" roughness={0.35} />
          {selected && <mesh raycast={() => {}}><boxGeometry args={[0.34, 0.205, 0.215]} /><meshBasicMaterial color="#bc8355" wireframe transparent opacity={0.4} /></mesh>}
        </group>
      </group>
      <CameraLabel id={camera.id} selected={selected} />
    </group>
  </group>;
});
