import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Vector2 } from 'three';
import { PovDistanceBlur, povBlurSettings } from './PovDistanceBlur';

const mocks = vi.hoisted(() => ({ state: null as any, frames: [] as ((state: any) => void)[] }));
vi.mock('@react-three/fiber', () => ({ useThree: () => mocks.state, useFrame: (callback: (state: any) => void) => mocks.frames.push(callback) }));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; mocks.frames = []; });

function renderState(supported: boolean) {
  const gl = {
    extensions: { has: () => supported },
    getDrawingBufferSize: vi.fn((size: Vector2) => size.set(800, 500)),
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(), clear: vi.fn(), render: vi.fn()
  };
  mocks.state = { gl, size: { width: 800, height: 500 }, viewport: { dpr: 1 }, invalidate: vi.fn() };
  return gl;
}

describe('POV distance blur settings', () => {
  it('keeps a clear near zone before progressively blurring distant objects', () => {
    const settings = povBlurSettings(18, 0.75);
    expect(settings.start).toBe(2.5);
    expect(settings.end).toBe(18);
    expect(settings.radius).toBe(4.5);
    const short = povBlurSettings(1, 1);
    expect(short.start).toBeLessThan(short.end);
    expect(short.end).toBe(1);
  });
  it('bounds rendering cost and permits a sharp preview', () => {
    expect(povBlurSettings(10, 0).radius).toBe(0);
    expect(povBlurSettings(10, 5).radius).toBe(6);
    expect(povBlurSettings(10, -1).radius).toBe(0);
  });

  it('keeps the normal direct render path when HDR targets are unsupported', () => {
    const gl = renderState(false);
    act(() => { renderer = create(createElement(PovDistanceBlur, { range: 12, strength: 0.75 })); });
    const scene = new Scene(), camera = new PerspectiveCamera();
    mocks.frames.at(-1)!({ scene, camera });
    expect(gl.render).toHaveBeenCalledExactlyOnceWith(scene, camera);
    expect(gl.setRenderTarget).not.toHaveBeenCalled();
  });

  it('resizes on display-density changes and disposes its offscreen resources', () => {
    const gl = renderState(true);
    act(() => { renderer = create(createElement(PovDistanceBlur, { range: 12, strength: 0.75 })); });
    const scene = new Scene(), camera = new PerspectiveCamera();
    mocks.frames.at(-1)!({ scene, camera });
    const target = gl.setRenderTarget.mock.calls[0][0] as any;
    expect(target.width).toBe(800); expect(target.height).toBe(500);
    expect(gl.setRenderTarget).toHaveBeenLastCalledWith(null);
    gl.getDrawingBufferSize.mockImplementation(size => size.set(3200, 2000));
    mocks.state.viewport.dpr = 2;
    act(() => renderer!.update(createElement(PovDistanceBlur, { range: 12, strength: 0.75 })));
    expect(target.width).toBe(1600); expect(target.height).toBe(1000);
    const dispose = vi.spyOn(target, 'dispose');
    act(() => renderer!.unmount()); renderer = undefined;
    expect(dispose).toHaveBeenCalledOnce();
  });
});
