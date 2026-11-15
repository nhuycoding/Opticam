import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, MOUSE, PerspectiveCamera, SRGBColorSpace, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Camera, Cell, Fixture, Layout, ObsType, Person } from '../../types';
import { cameraProjection } from '../../core/camera';
import { floorOutline } from '../../core/footprint';
import { wallAnchors } from '../../core/geometry';
import { DORI_COLOR, priorityBand, riskColor, type PriorityBand, type Selection, type ViewMode } from '../canvas/shared';
import { Block, Fixture3D } from './Fixtures3D';
import { cameraPose, floorShape, wallSegments, type WallSegment } from './sceneGeometry';
import { CameraModel3D } from './CameraModel3D';
import { PersonModel3D } from './PersonModel3D';
import { DraggableObject3D } from './DraggableObject3D';
import { CameraImageEffect } from './CameraImageEffect';

export interface StoreSceneProps {
  layout: Layout; cells: Cell[]; view: ViewMode; selected: Selection; people: Person[];
  showGrid: boolean; showAnchors: boolean; riskFilter: PriorityBand | null;
  focusCell: { r: number; c: number } | null;
  cameraView: Camera | null; reset: number; cutaway: boolean;
  onSelect: (selection: Selection) => void;
  onCameraView: (id: string) => void;
  readOnly?: boolean; editMode?: 'orbit' | 'move'; observationView?: boolean; imageEffectSupported?: boolean;
  onMoveObstacle?: (id: string, centerX: number, centerY: number) => void;
  onMovePerson?: (person: Person) => void;
  onAddObstacle?: (type: ObsType, fixture?: Fixture) => void;
  onAddPerson?: () => void;
  onRotateSelected?: () => void;
  onDeleteSelected?: () => void;
}

function CameraController({ layout, cameraView, reset, focusCell, controlsRef, dragActive, editMode }: Pick<StoreSceneProps, 'layout' | 'cameraView' | 'reset' | 'focusCell' | 'editMode'> & { controlsRef: MutableRefObject<OrbitControls | null>; dragActive: MutableRefObject<boolean> }) {
  const { camera, gl, invalidate, size } = useThree();
  const controls = useMemo(() => new OrbitControls(camera), [camera]);
  useEffect(() => {
    controlsRef.current = controls;
    controls.domElement = gl.domElement;
    controls.connect();
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.maxPolarAngle = Math.PI / 2 - 0.025;
    controls.minPolarAngle = 0.08;
    controls.minDistance = 2;
    const changed = () => invalidate();
    controls.addEventListener('change', changed);
    return () => { controls.removeEventListener('change', changed); controls.dispose(); if (controlsRef.current === controls) controlsRef.current = null; };
  }, [controls, gl, invalidate, controlsRef]);
  useEffect(() => { controls.mouseButtons.LEFT = editMode === 'move' ? null : MOUSE.ROTATE; }, [controls, editMode]);
  useFrame(() => { if (controls.enabled) controls.update(); });

  useLayoutEffect(() => {
    const lens = camera as PerspectiveCamera;
    controls.maxDistance = Math.max(layout.widthM, layout.heightM) * 4;
    controls.enabled = !cameraView && !dragActive.current;
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
      lens.near = 0.1;
      lens.far = Math.max(60, controls.maxDistance + Math.hypot(layout.widthM, layout.heightM) * 2);
      const distance = Math.max(layout.heightM, layout.widthM / Math.max(0.45, lens.aspect)) * 1.25;
      controls.target.set(layout.widthM / 2, 0.6, layout.heightM / 2);
      lens.position.set(layout.widthM / 2 + distance * 0.6, distance * 0.95, layout.heightM / 2 + distance * 0.8);
      controls.update();
    }
    lens.updateProjectionMatrix();
    invalidate();
  }, [camera, controls, cameraView, reset, layout.name, layout.widthM, layout.heightM, layout.floorPolygon, size.width, size.height, invalidate, dragActive]);

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
    <group ref={group} userData={{ observationWall: true }}>
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

export function StoreScene(props: StoreSceneProps) {
  const { layout, selected, cameraView } = props;
  const observationView = Boolean(props.observationView && !cameraView);
  const controlsRef = useRef<OrbitControls | null>(null), dragActive = useRef(false);
  const cameraViewRef = useRef(cameraView);
  cameraViewRef.current = cameraView;
  const canMove = !props.readOnly && !cameraView && !observationView && props.editMode === 'move';
  const onInteraction = useCallback((active: boolean) => {
    dragActive.current = active;
    if (controlsRef.current) controlsRef.current.enabled = !active && !cameraViewRef.current;
  }, []);
  const shape = useMemo(() => floorShape(layout), [layout.widthM, layout.heightM, layout.floorPolygon]);
  const outline = useMemo(() => floorOutline(layout), [layout.widthM, layout.heightM, layout.floorPolygon]);
  const walls = useMemo(() => wallSegments(layout), [layout.widthM, layout.heightM, layout.floorPolygon, layout.obstacles]);
  const anchors = useMemo(() => props.showAnchors ? wallAnchors(layout.widthM, layout.heightM, Math.max(0.5, layout.gridM), layout.floorPolygon) : [], [props.showAnchors, layout.widthM, layout.heightM, layout.gridM, layout.floorPolygon]);
  const wallHeight = Math.max(3.2, ...layout.cameras.map(c => c.height + 0.5));
  const productLimit = Math.min(72, Math.floor(2400 / Math.max(1, layout.obstacles.length)));
  const selectedCamera = selected?.kind === 'cam' ? layout.cameras.find(c => c.id === selected.id) : undefined;
  return <>
    <color attach="background" args={[observationView ? '#000000' : cameraView ? '#e2e8e3' : '#f1f0e7']} />
    <ambientLight intensity={0.8} />
    <hemisphereLight args={['#fffdf1', '#a5b3aa', 1.4]} />
    <directionalLight position={[-3, 15, 8]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005}
      shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={100} />
    <CameraController layout={layout} cameraView={cameraView} reset={props.reset} focusCell={props.focusCell} controlsRef={controlsRef} dragActive={dragActive} editMode={canMove ? 'move' : 'orbit'} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.14, 0]} receiveShadow onClick={event => { if (event.delta <= 5) props.onSelect(null); }}>
      <extrudeGeometry args={[shape, { depth: 0.14, bevelEnabled: false }]} />
      <meshStandardMaterial color="#deded0" side={DoubleSide} roughness={0.94} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} receiveShadow onClick={event => { if (event.delta <= 5) props.onSelect(null); }}>
      <shapeGeometry args={[shape]} /><meshStandardMaterial color="#f3f0df" roughness={0.95} />
    </mesh>
    {!observationView && <FloorOverlay layout={layout} cells={props.cells} view={props.view} showGrid={props.showGrid} riskFilter={props.riskFilter} />}
    {walls.map((wall, i) => <Wall key={i} segment={wall} height={wallHeight} cutaway={!cameraView && props.cutaway} />)}
    {layout.obstacles.map(o => <DraggableObject3D key={o.id} center={[o.x + o.w / 2, o.y + o.h / 2]}
      selection={{ kind: 'obs', id: o.id }} enabled={canMove && Boolean(props.onMoveObstacle)}
      onSelect={props.onSelect} onMove={(x, y) => props.onMoveObstacle?.(o.id, x, y)} onInteraction={onInteraction}>
      <Fixture3D obstacle={o} outline={outline} productLimit={productLimit} selected={!observationView && selected?.kind === 'obs' && selected.id === o.id} onSelect={props.onSelect} />
    </DraggableObject3D>)}
    {!cameraView && !observationView && layout.cameras.map(c => <CameraModel3D key={c.id} camera={c} layout={layout} selected={selected?.kind === 'cam' && selected.id === c.id} onSelect={props.onSelect} onCameraView={props.onCameraView} />)}
    {!cameraView && !observationView && selectedCamera && <CameraFrustum camera={selectedCamera} layout={layout} />}
    {!cameraView && !observationView && anchors.map(([x, z], i) => <mesh key={i} position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <circleGeometry args={[0.035, 8]} /><meshBasicMaterial color="#6a9790" />
    </mesh>)}
    {props.people.map(person => <DraggableObject3D key={person.id} center={[person.x, person.y]}
      selection={{ kind: 'person', id: person.id }} enabled={canMove && Boolean(props.onMovePerson)}
      onSelect={props.onSelect} onMove={(x, y) => props.onMovePerson?.({ ...person, x, y })} onInteraction={onInteraction}>
      <PersonModel3D person={person} selected={!observationView && selected?.kind === 'person' && selected.id === person.id} onSelect={props.onSelect} />
    </DraggableObject3D>)}
    {(cameraView || observationView) && props.imageEffectSupported !== false && <CameraImageEffect layout={layout} people={props.people} cameraView={cameraView} />}
    {props.focusCell && !cameraView && !observationView && <mesh position={[(props.focusCell.c + 0.5) * layout.gridM, 0.025, (props.focusCell.r + 0.5) * layout.gridM]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
      <ringGeometry args={[layout.gridM * 0.5, layout.gridM * 0.64, 32]} /><meshBasicMaterial color="#ac4f37" />
    </mesh>}
  </>;
}
