import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Camera, Cell, Layout, Person } from '../../types';
import { cameraProjection } from '../../core/camera';
import { floorOutline } from '../../core/footprint';
import { wallAnchors } from '../../core/geometry';
import { DORI_COLOR, priorityBand, riskColor, type PriorityBand, type Selection, type ViewMode } from '../canvas/shared';
import { Block, Fixture3D } from './Fixtures3D';
import { cameraPose, floorShape, wallSegments, type WallSegment } from './sceneGeometry';

export interface StoreSceneProps {
  layout: Layout; cells: Cell[]; view: ViewMode; selected: Selection; people: Person[];
  showGrid: boolean; showAnchors: boolean; riskFilter: PriorityBand | null;
  focusCell: { r: number; c: number } | null;
  cameraView: Camera | null; reset: number; cutaway: boolean;
  onSelect: (selection: Selection) => void;
  onCameraView: (id: string) => void;
}

function CameraController({ layout, cameraView, reset, focusCell }: Pick<StoreSceneProps, 'layout' | 'cameraView' | 'reset' | 'focusCell'>) {
  const { camera, gl, invalidate, size } = useThree();
  const controls = useMemo(() => new OrbitControls(camera), [camera]);
  useEffect(() => {
    controls.domElement = gl.domElement;
    controls.connect();
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.minPolarAngle = 0.08;
    controls.minDistance = 2;
    const changed = () => invalidate();
    controls.addEventListener('change', changed);
    return () => { controls.removeEventListener('change', changed); controls.dispose(); };
  }, [controls, gl, invalidate]);
  useFrame(() => { if (controls.enabled) controls.update(); });

  useLayoutEffect(() => {
    const lens = camera as PerspectiveCamera;
    controls.maxDistance = Math.max(layout.widthM, layout.heightM) * 4;
    controls.enabled = !cameraView;
    lens.near = 0.03;
    lens.zoom = 1;
    if (cameraView) {
      const pose = cameraPose(cameraView, layout), projection = cameraProjection(cameraView);
      lens.fov = projection.vfov;
      lens.aspect = projection.aspect;
      lens.far = Math.max(60, Math.hypot(layout.widthM, layout.heightM) * 2);
      lens.position.copy(pose.position);
      lens.lookAt(pose.position.clone().add(pose.direction));
    } else {
      lens.fov = 43;
      lens.aspect = size.width / Math.max(1, size.height);
      lens.far = 500;
      const distance = Math.max(layout.heightM, layout.widthM / Math.max(0.45, lens.aspect)) * 1.25;
      controls.target.set(layout.widthM / 2, 0.6, layout.heightM / 2);
      lens.position.set(layout.widthM / 2 + distance * 0.6, distance * 0.95, layout.heightM / 2 + distance * 0.8);
      controls.update();
    }
    lens.updateProjectionMatrix();
    invalidate();
  }, [camera, controls, cameraView, reset, layout.name, layout.widthM, layout.heightM, layout.floorPolygon, size.width, size.height, invalidate]);

  useEffect(() => {
    if (!focusCell || cameraView) return;
    const x = (focusCell.c + 0.5) * layout.gridM, z = (focusCell.r + 0.5) * layout.gridM;
    camera.position.set(x + 4, 8, z + 6);
    controls.target.set(x, 0, z);
    controls.update(); invalidate();
  }, [focusCell, cameraView, camera, controls, layout.gridM, invalidate]);
  return null;
}

function Wall({ segment, height, cutaway }: { segment: WallSegment; height: number; cutaway: boolean }) {
  const group = useRef<Group>(null);
  const [ax, az] = segment.start, [bx, bz] = segment.end;
  const cx = (ax + bx) / 2, cz = (az + bz) / 2, length = Math.hypot(bx - ax, bz - az);
  useFrame(({ camera }) => {
    if (group.current) group.current.visible = !cutaway || (camera.position.x - cx) * segment.outward[0] + (camera.position.z - cz) * segment.outward[1] < 0.05;
  });
  return <group position={[cx, 0, cz]} rotation={[0, -Math.atan2(bz - az, bx - ax), 0]}>
    {!segment.opening && <Block size={[length + 0.015, 0.14, 0.12]} at={[0, 0.07, 0]} color="#b7b8ab" />}
    <group ref={group}>
      {segment.opening
        ? <Block size={[length, Math.max(0.06, height - 2.4), 0.12]} at={[0, 2.4 + Math.max(0.06, height - 2.4) / 2, 0]} color="#e1dfd3" />
        : <>
          <Block size={[length + 0.015, height - 0.14, 0.12]} at={[0, (height + 0.14) / 2, 0]} color="#e8e5d9" />
          <Block size={[length + 0.025, 0.045, 0.15]} at={[0, height, 0]} color="#c5c3b4" />
        </>}
    </group>
  </group>;
}

function FloorOverlay({ layout, cells, view, showGrid, riskFilter }: Pick<StoreSceneProps, 'layout' | 'cells' | 'view' | 'showGrid' | 'riskFilter'>) {
  const texture = useMemo(() => {
    const scale = Math.min(80, 1024 / Math.max(layout.widthM, layout.heightM));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(layout.widthM * scale); canvas.height = Math.ceil(layout.heightM * scale);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.scale(canvas.width / layout.widthM, canvas.height / layout.heightM);
    context.beginPath();
    floorOutline(layout).forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
    context.closePath(); context.clip();
    if (view !== 'off') for (const cell of cells) {
      if (cell.solid || (view === 'risk' && riskFilter && priorityBand(cell.w) !== riskFilter)) continue;
      context.fillStyle = view === 'dori' ? DORI_COLOR[cell.dori] : riskColor(cell.w);
      context.fillRect(cell.cx - layout.gridM / 2, cell.cy - layout.gridM / 2, layout.gridM, layout.gridM);
    }
    if (showGrid) {
      context.strokeStyle = '#7b837322'; context.lineWidth = 0.009;
      context.beginPath();
      for (let x = 0; x <= layout.widthM; x += layout.gridM) { context.moveTo(x, 0); context.lineTo(x, layout.heightM); }
      for (let y = 0; y <= layout.heightM; y += layout.gridM) { context.moveTo(0, y); context.lineTo(layout.widthM, y); }
      context.stroke();
    }
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace;
    return result;
  }, [layout.widthM, layout.heightM, layout.gridM, layout.floorPolygon, cells, view, showGrid, riskFilter]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[layout.widthM / 2, 0.012, layout.heightM / 2]} raycast={() => {}}>
    <planeGeometry args={[layout.widthM, layout.heightM]} />
    <meshBasicMaterial map={texture} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
  </mesh>;
}

function Label({ text, position, active = false }: { text: string; position: [number, number, number]; active?: boolean }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = active ? '#895b3b' : '#fffef5';
    ctx.beginPath(); ctx.roundRect(2, 2, 252, 60, 10); ctx.fill();
    ctx.font = '600 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = active ? '#fffdf6' : '#354c46'; ctx.fillText(text, 128, 33, 236);
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; return map;
  }, [text, active]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={position} scale={[0.9, 0.225, 1]}><spriteMaterial map={texture} depthTest={false} transparent /></sprite>;
}

function CameraModel({ camera, layout, selected, onSelect, onCameraView }: { camera: Camera; layout: Layout; selected: boolean } & Pick<StoreSceneProps, 'onSelect' | 'onCameraView'>) {
  const pose = cameraPose(camera, layout), pan = camera.pan * Math.PI / 180, pitch = cameraProjection(camera).tilt * Math.PI / 180;
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > 5) return;
    event.stopPropagation(); onSelect({ kind: 'cam', id: camera.id });
  };
  return <group position={pose.position} onClick={click} onDoubleClick={event => { event.stopPropagation(); onCameraView(camera.id); }}>
    <group rotation={[0, -pan, 0]}>
      <group rotation={[0, 0, -pitch]}>
        <Block size={[0.28, 0.16, 0.17]} color={selected ? '#b17c4e' : '#f7f6ec'} />
        <mesh position={[0.15, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.065, 0.065, 0.035, 16]} /><meshStandardMaterial color="#284c4b" roughness={0.22} />
        </mesh>
      </group>
      <Block size={[0.12, 0.04, 0.045]} at={[-0.13, 0.08, 0]} color="#788980" />
    </group>
    <Label text={camera.id} position={[0, 0.38, 0]} active={selected} />
    {selected && <mesh raycast={() => {}}><sphereGeometry args={[0.21, 16, 10]} /><meshBasicMaterial color="#bc8355" wireframe transparent opacity={0.25} /></mesh>}
  </group>;
}

function CameraFrustum({ camera, layout }: { camera: Camera; layout: Layout }) {
  const geometry = useMemo(() => {
    const { position, direction } = cameraPose(camera, layout);
    const right = new Vector3().crossVectors(direction, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, direction).normalize();
    const distance = Math.min(camera.range, 5);
    const halfW = Math.tan(camera.fov * Math.PI / 360) * distance;
    const halfH = Math.tan(cameraProjection(camera).vfov * Math.PI / 360) * distance;
    const center = position.clone().addScaledVector(direction, distance);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => center.clone().addScaledVector(right, halfW * x).addScaledVector(up, halfH * y));
    const positions = corners.flatMap((corner, i) => [...position.toArray(), ...corner.toArray(), ...corner.toArray(), ...corners[(i + 1) % 4].toArray()]);
    return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3));
  }, [camera, layout]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry} raycast={() => {}}><lineBasicMaterial color="#a36b3f" transparent opacity={0.55} depthWrite={false} /></lineSegments>;
}

function PersonModel({ person, selected, onSelect }: { person: Person; selected: boolean; onSelect: StoreSceneProps['onSelect'] }) {
  return <group position={[person.x, 0, person.y]} onClick={event => { if (event.delta <= 5) { event.stopPropagation(); onSelect({ kind: 'person', id: person.id }); } }}>
    <mesh position={[0, 1.57, 0]} castShadow><sphereGeometry args={[0.12, 16, 12]} /><meshStandardMaterial color="#c9ac87" /></mesh>
    <mesh position={[0, 1.15, 0]} castShadow><capsuleGeometry args={[0.15, 0.45, 4, 12]} /><meshStandardMaterial color={selected ? '#b68552' : '#527c72'} /></mesh>
    {[-1, 1].map(side => <Block key={side} size={[0.12, 0.7, 0.15]} at={[side * 0.09, 0.37, 0]} color="#53655e" />)}
  </group>;
}

export function StoreScene(props: StoreSceneProps) {
  const { layout, selected, cameraView } = props;
  const shape = useMemo(() => floorShape(layout), [layout.widthM, layout.heightM, layout.floorPolygon]);
  const outline = useMemo(() => floorOutline(layout), [layout.widthM, layout.heightM, layout.floorPolygon]);
  const walls = useMemo(() => wallSegments(layout), [layout.widthM, layout.heightM, layout.floorPolygon, layout.obstacles]);
  const anchors = useMemo(() => props.showAnchors ? wallAnchors(layout.widthM, layout.heightM, Math.max(0.5, layout.gridM), layout.floorPolygon) : [], [props.showAnchors, layout.widthM, layout.heightM, layout.gridM, layout.floorPolygon]);
  const wallHeight = Math.max(3.2, ...layout.cameras.map(c => c.height + 0.25));
  const selectedCamera = selected?.kind === 'cam' ? layout.cameras.find(c => c.id === selected.id) : undefined;
  return <>
    <color attach="background" args={[cameraView ? '#e2e8e3' : '#f1f0e7']} />
    <ambientLight intensity={1.15} />
    <hemisphereLight args={['#fffdf1', '#9cae9e', 1.8]} />
    <directionalLight position={[-3, 15, 8]} intensity={2.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005}
      shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={100} />
    <CameraController layout={layout} cameraView={cameraView} reset={props.reset} focusCell={props.focusCell} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]} receiveShadow onClick={event => { if (event.delta <= 5) props.onSelect(null); }}>
      <extrudeGeometry args={[shape, { depth: 0.14, bevelEnabled: false }]} />
      <meshStandardMaterial color="#deded0" side={DoubleSide} roughness={0.94} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow onClick={event => { if (event.delta <= 5) props.onSelect(null); }}>
      <shapeGeometry args={[shape]} /><meshStandardMaterial color="#f3f0df" roughness={0.95} />
    </mesh>
    <FloorOverlay layout={layout} cells={props.cells} view={props.view} showGrid={props.showGrid} riskFilter={props.riskFilter} />
    {walls.map((wall, i) => <Wall key={i} segment={wall} height={wallHeight} cutaway={!cameraView && props.cutaway} />)}
    {layout.obstacles.map(o => <Fixture3D key={o.id} obstacle={o} outline={outline} selected={selected?.kind === 'obs' && selected.id === o.id} onSelect={props.onSelect} />)}
    {!cameraView && layout.cameras.map(c => <CameraModel key={c.id} camera={c} layout={layout} selected={selected?.kind === 'cam' && selected.id === c.id} onSelect={props.onSelect} onCameraView={props.onCameraView} />)}
    {!cameraView && selectedCamera && <CameraFrustum camera={selectedCamera} layout={layout} />}
    {!cameraView && anchors.map(([x, z], i) => <mesh key={i} position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <circleGeometry args={[0.035, 8]} /><meshBasicMaterial color="#6a9790" />
    </mesh>)}
    {props.people.map(person => <PersonModel key={person.id} person={person} selected={selected?.kind === 'person' && selected.id === person.id} onSelect={props.onSelect} />)}
    {props.focusCell && !cameraView && <mesh position={[(props.focusCell.c + 0.5) * layout.gridM, 0.025, (props.focusCell.r + 0.5) * layout.gridM]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <ringGeometry args={[layout.gridM * 0.5, layout.gridM * 0.64, 32]} /><meshBasicMaterial color="#ac4f37" />
    </mesh>}
  </>;
}
