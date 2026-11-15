import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector2, type WebGLRenderer } from 'three';
import { PRESETS } from '../../data/presets';
import { CameraImageEffect, createCameraImagePipeline, renderCameraImage } from './CameraImageEffect';

const mocks = vi.hoisted(() => ({ state: null as any, frames: [] as ((state: any) => void)[], quadRender: vi.fn() }));
vi.mock('@react-three/fiber', () => ({ useThree: () => mocks.state, useFrame: (callback: (state: any) => void) => mocks.frames.push(callback) }));
vi.mock('three/examples/jsm/postprocessing/Pass.js', () => ({ FullScreenQuad: class { render = mocks.quadRender; dispose = vi.fn(); } }));
const CAMERA = { id: 'CAM-01', x: 0, y: 0, pan: 45, height: 2.4, fov: 85, res: 2560, range: 12 };
const LAYOUT = { ...PRESETS[0], cameras: [CAMERA, { ...CAMERA, id: 'CAM-02', x: 10, y: 6, pan: 225 }] };
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; mocks.frames = []; vi.clearAllMocks(); });

function renderState(supported = true) {
  let target: unknown = null;
  const gl = {
    extensions: { has: () => supported }, capabilities: { maxTextureSize: 4096 },
    shadowMap: { autoUpdate: true, needsUpdate: true },
    getDrawingBufferSize: vi.fn((size: Vector2) => size.set(800, 500)),
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((next: unknown) => { target = next; }), clear: vi.fn(), render: vi.fn()
  };
  mocks.state = { gl, size: { width: 800, height: 500 }, viewport: { dpr: 1 }, invalidate: vi.fn() };
  return gl;
}

describe('combined camera image rendering', () => {
  it('captures occlusion once for every camera and reuses it while orbiting', () => {
    const gl = renderState(), layout = LAYOUT, scene = new Scene();
    const wall = new Group(); wall.userData.observationWall = true; wall.visible = false; scene.add(wall);
    const surface = new MeshStandardMaterial(), originalCompile = surface.onBeforeCompile;
    const geometry = new BoxGeometry(); scene.add(new Mesh(geometry, surface));
    const background = new Color('white'); scene.background = background;
    const pipeline = createCameraImagePipeline(gl as unknown as WebGLRenderer, layout.cameras.length);
    const observations: boolean[] = [];
    gl.render.mockImplementation((rendered: Scene) => {
      if (rendered.overrideMaterial) observations.push(wall.visible);
    });
    const camera = new PerspectiveCamera();
    renderCameraImage(gl as unknown as WebGLRenderer, scene, camera, pipeline, layout, null);
    expect(observations).toHaveLength(layout.cameras.length);
    expect(observations.every(Boolean)).toBe(true);
    expect(wall.visible).toBe(false);
    expect(scene.background).toBe(background);
    expect(scene.overrideMaterial).toBeNull();
    expect(gl.shadowMap).toEqual({ autoUpdate: true, needsUpdate: true });
    expect(gl.render).toHaveBeenCalledTimes(layout.cameras.length + 1);
    const worldMaskCompile = surface.onBeforeCompile, version = surface.version;
    expect(worldMaskCompile).not.toBe(originalCompile);
    camera.position.set(10, 12, 8);
    renderCameraImage(gl as unknown as WebGLRenderer, scene, camera, pipeline, layout, null);
    expect(gl.render).toHaveBeenCalledTimes(layout.cameras.length + 2);
    expect(surface.onBeforeCompile).toBe(worldMaskCompile);
    expect(surface.version).toBe(version);
    expect(mocks.quadRender).toHaveBeenCalledTimes(2);
    expect(gl.getRenderTarget()).toBeNull();
    pipeline.dispose();
    expect(surface.onBeforeCompile).toBe(originalCompile);
    surface.dispose(); geometry.dispose();
  });

  it('restores renderer, cutaway walls and scene state even if a capture fails', () => {
    const gl = renderState(), scene = new Scene();
    const wall = new Group(); wall.userData.observationWall = true; wall.visible = false; scene.add(wall);
    const background = new Color('black'); scene.background = background;
    const pipeline = createCameraImagePipeline(gl as unknown as WebGLRenderer, LAYOUT.cameras.length);
    gl.render.mockImplementation(() => { throw new Error('capture failed'); });
    expect(() => renderCameraImage(gl as unknown as WebGLRenderer, scene, new PerspectiveCamera(), pipeline, LAYOUT, null)).toThrow('capture failed');
    expect(wall.visible).toBe(false); expect(scene.overrideMaterial).toBeNull(); expect(scene.background).toBe(background);
    expect(gl.shadowMap.autoUpdate).toBe(true); expect(gl.shadowMap.needsUpdate).toBe(true);
    expect(gl.getRenderTarget()).toBeNull(); expect(pipeline.dirty).toBe(true);
    pipeline.dispose();
  });

  it('refreshes occlusion when geometry changes and releases all owned GPU resources', () => {
    const gl = renderState(), layout = LAYOUT;
    const props = { layout, people: [], cameraView: null };
    act(() => { renderer = create(createElement(CameraImageEffect, props)); });
    const frameState = { scene: new Scene(), camera: new PerspectiveCamera() };
    mocks.frames.at(-1)!(frameState);
    const targets = gl.setRenderTarget.mock.calls.map(([target]) => target as any).filter(Boolean);
    const atlas = targets[0], target = targets.at(-1);
    const atlasDispose = vi.spyOn(atlas, 'dispose'), targetDispose = vi.spyOn(target, 'dispose');
    const firstCalls = gl.render.mock.calls.length;
    act(() => renderer!.update(createElement(CameraImageEffect, { ...props, people: [{ id: 'P', x: 4, y: 2 }] })));
    mocks.frames.at(-1)!(frameState);
    expect(gl.render.mock.calls.length - firstCalls).toBe(layout.cameras.length + 1);
    gl.getDrawingBufferSize.mockImplementation(size => size.set(3200, 2000));
    mocks.state.viewport.dpr = 2;
    act(() => renderer!.update(createElement(CameraImageEffect, props)));
    expect(target.width).toBe(1600); expect(target.height).toBe(1000);
    atlasDispose.mockClear(); targetDispose.mockClear();
    act(() => renderer!.unmount()); renderer = undefined;
    expect(atlasDispose).toHaveBeenCalledOnce(); expect(targetDispose).toHaveBeenCalledOnce();
  });

  it('uses one fixed pixelation pass in POV and supports an empty camera layout', () => {
    const gl = renderState(), scene = new Scene(), camera = new PerspectiveCamera();
    const layout = { ...PRESETS[0], cameras: [] };
    const pipeline = createCameraImagePipeline(gl as unknown as WebGLRenderer, 0);
    renderCameraImage(gl as unknown as WebGLRenderer, scene, camera, pipeline, layout, null);
    expect(pipeline.material.uniforms.observationCount.value).toBe(0);
    expect(pipeline.material.uniforms.combinedView.value).toBe(true);
    const pov = { ...CAMERA, res: 1920, fov: 80, range: 12 };
    renderCameraImage(gl as unknown as WebGLRenderer, scene, camera, pipeline, layout, pov);
    expect(pipeline.material.uniforms.povPpmScale.value / 10).toBeCloseTo(1920 / (20 * Math.tan(40 * Math.PI / 180)));
    expect(pipeline.material.uniforms.ppmReference.value).toBe(250);
    expect(pipeline.material.uniforms.combinedView.value).toBe(false);
    expect(gl.render).toHaveBeenCalledTimes(2);
    pipeline.dispose();
  });

  it('preserves the ordinary rendering path when HDR targets are unavailable', () => {
    const gl = renderState(false);
    act(() => { renderer = create(createElement(CameraImageEffect, { layout: LAYOUT, people: [], cameraView: CAMERA })); });
    const state = { scene: new Scene(), camera: new PerspectiveCamera() };
    mocks.frames.at(-1)!(state);
    expect(gl.render).toHaveBeenCalledExactlyOnceWith(state.scene, state.camera);
    expect(gl.setRenderTarget).not.toHaveBeenCalled();
  });
});
