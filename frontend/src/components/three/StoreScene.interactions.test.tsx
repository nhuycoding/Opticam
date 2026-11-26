import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOUSE, PerspectiveCamera, Ray, Vector3 } from 'three';
import { CeilingGrid, StoreScene, type StoreSceneProps } from './StoreScene';
import { DraggableObject3D } from './DraggableObject3D';
import { CameraImageEffect } from './CameraImageEffect';
import { CameraModel3D } from './CameraModel3D';
import { Fixture3D } from './Fixtures3D';
import { PRESETS } from '../../data/presets';

const mocks = vi.hoisted(() => ({ controls: [] as any[], state: null as any }));
vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: (selector?: (state: any) => unknown) => selector ? selector(mocks.state) : mocks.state }));
vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return { OrbitControls: class {
    enabled = true; target = new Vector3(); mouseButtons = { LEFT: 0 as number | null }; domElement: unknown;
    connect = vi.fn(); update = vi.fn(); dispose = vi.fn(); addEventListener = vi.fn(); removeEventListener = vi.fn();
    constructor() { mocks.controls.push(this); }
  } };
});
vi.mock('./CameraModel3D', () => ({ CameraModel3D: () => null }));
vi.mock('./PersonModel3D', () => ({ PersonModel3D: () => null }));
vi.mock('./Fixtures3D', () => ({ Fixture3D: () => <mesh />, Block: () => null }));
vi.mock('./CameraImageEffect', () => ({ CameraImageEffect: () => null }));

let renderer: ReactTestRenderer;
beforeEach(() => {
  mocks.controls.length = 0;
  mocks.state = { camera: new PerspectiveCamera(), gl: { domElement: {} }, invalidate: vi.fn(), size: { width: 800, height: 500 } };
  const context = Object.fromEntries(['clearRect', 'scale', 'beginPath', 'lineTo', 'moveTo', 'closePath', 'clip', 'fillRect', 'stroke'].map(name => [name, vi.fn()]));
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals(); });

function props(): StoreSceneProps {
  return {
    layout: { ...PRESETS[0], cameras: [], obstacles: [{ id: 'shelf', type: 'shelf', label: 'Kệ', x: 2, y: 2, w: 1, h: 1, elev: 1.5, angle: 0 }] },
    cells: [], view: 'off', selected: null, people: [{ id: 'P', x: 5, y: 3 }], showGrid: false, showAnchors: false,
    riskFilter: null, focusCell: null, cameraView: null, reset: 0, cutaway: true, editMode: 'move',
    onSelect: vi.fn(), onCameraView: vi.fn(), onMoveObstacle: vi.fn(), onMovePerson: vi.fn()
  };
}

describe('scene editing and navigation guards', () => {
  it('stops orbit synchronously for object dragging and commits once on drop', () => {
    const p = props();
    act(() => { renderer = create(<StoreScene {...p} />); });
    const controls = mocks.controls[0];
    expect(controls.mouseButtons.LEFT).toBeNull();
    const wrapper = renderer.root.findAllByType(DraggableObject3D)[0];
    const group = wrapper.findByType('group' as any);
    const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const event = (x: number, z: number) => ({ button: 0, pointerId: 1, target: capture, stopPropagation: vi.fn(), ray: new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0)) });
    act(() => group.props.onPointerDown(event(2.5, 2.5)));
    expect(controls.enabled).toBe(false);
    act(() => group.props.onPointerMove(event(4, 3)));
    expect(p.onMoveObstacle).not.toHaveBeenCalled();
    act(() => group.props.onPointerUp());
    expect(p.onMoveObstacle).toHaveBeenCalledExactlyOnceWith('shelf', 4, 3);
    expect(controls.enabled).toBe(true);
  });

  it('guards all draggable models in read-only and camera POV views', () => {
    const p = props();
    act(() => { renderer = create(<StoreScene {...p} readOnly />); });
    expect(renderer.root.findAllByType(DraggableObject3D).every(node => node.props.enabled === false)).toBe(true);
    expect(mocks.controls[0].mouseButtons.LEFT).toBe(MOUSE.ROTATE);
    const camera = { id: 'CAM', x: 0, y: 0, pan: 45, fov: 85, vfov: 55, tilt: 20, res: 2560, height: 2.8, range: 15 };
    act(() => renderer.update(<StoreScene {...p} cameraView={camera} />));
    expect(renderer.root.findAllByType(DraggableObject3D).every(node => node.props.enabled === false)).toBe(true);
    expect(mocks.controls[0].enabled).toBe(false);
  });

  it('cancels a held drag on mode changes without enabling orbit in POV', () => {
    const p = props();
    act(() => { renderer = create(<StoreScene {...p} />); });
    const group = renderer.root.findAllByType(DraggableObject3D)[0].findByType('group' as any);
    const capture = { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() };
    const event = { button: 0, pointerId: 1, target: capture, stopPropagation: vi.fn(), ray: new Ray(new Vector3(2.5, 10, 2.5), new Vector3(0, -1, 0)) };
    act(() => group.props.onPointerDown(event));
    const camera = { id: 'CAM', x: 0, y: 0, pan: 45, fov: 85, res: 2560, height: 2.8, range: 15 };
    act(() => renderer.update(<StoreScene {...p} cameraView={camera} />));
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(p.onMoveObstacle).not.toHaveBeenCalled();
    expect(mocks.controls[0].enabled).toBe(false);
  });

  it('renders physical surfaces without camera helpers or selection outlines in the observation view', () => {
    const p = props();
    p.layout.cameras = [{ id: 'CAM', x: 0, y: 0, pan: 45, fov: 85, res: 2560, height: 2.8, range: 15 }];
    act(() => { renderer = create(<StoreScene {...p} observationView selected={{ kind: 'obs', id: 'shelf' }} showAnchors showGrid />); });
    expect(renderer.root.findAllByType(DraggableObject3D).every(node => node.props.enabled === false)).toBe(true);
    expect(renderer.root.findAllByType(CameraModel3D)).toHaveLength(0);
    expect(renderer.root.findByType(Fixture3D).props.selected).toBe(false);
    expect(renderer.root.findByType(CameraImageEffect).props.cameraView).toBeNull();
    expect(renderer.root.findByType('color' as any).props.args).toEqual(['#000000']);
  });
  it('places cameras on the ceiling grid without floor editing and hides the grid during observation', () => {
    const p = { ...props(), onAddCamera: vi.fn(), onMoveCamera: vi.fn(), showCeilingGrid: true, editMode: 'ceiling' as const };
    act(() => { renderer = create(<StoreScene {...p} />); });
    expect(mocks.controls[0].mouseButtons.LEFT).toBeNull();
    const grid = renderer.root.findByType(CeilingGrid).findByType('mesh' as any);
    const stopPropagation = vi.fn();
    act(() => grid.props.onClick({ point: new Vector3(4, 3.2, 2), delta: 0, stopPropagation }));
    expect(p.onAddCamera).toHaveBeenCalledExactlyOnceWith(4, 2, 'ceiling');
    expect(stopPropagation).toHaveBeenCalled();
    const physicalCeiling = renderer.root.findAllByType('group' as any).find(node => node.props.userData?.physicalCeiling);
    expect(physicalCeiling?.props.visible).toBe(false);
    expect(physicalCeiling?.props.userData.observationWall).toBe(true);
    act(() => renderer.update(<StoreScene {...p} observationView />));
    expect(renderer.root.findAllByType(CeilingGrid)).toHaveLength(0);
  });

  it('only makes ceiling cameras draggable and uses their optical height as the drag plane', () => {
    const p = props();
    const camera = { id: 'CEILING', x: 4, y: 3, pan: 45, fov: 85, res: 2560, height: 3.05, range: 15, mount: 'ceiling' as const };
    p.layout.cameras = [camera, { ...camera, id: 'WALL', mount: 'wall' }];
    act(() => { renderer = create(<StoreScene {...p} onMoveCamera={vi.fn()} />); });
    const cameras = renderer.root.findAllByType(DraggableObject3D).filter(node => node.props.selection?.kind === 'cam');
    expect(cameras[0].props.enabled).toBe(true);
    expect(cameras[0].props.planeHeight).toBe(3.05);
    expect(cameras[1].props.enabled).toBe(false);
  });

});
