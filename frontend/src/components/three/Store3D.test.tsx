import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Store3D from './Store3D';
import { StoreScene, type StoreSceneProps } from './StoreScene';
import { PRESETS } from '../../data/presets';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useThree: (selector: (state: any) => unknown) => selector({ gl: { domElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() } } })
}));
vi.mock('./StoreScene', () => ({ StoreScene: () => null }));
let renderer: ReactTestRenderer;
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals(); });

const CAMERA = { id: 'CAM-01', x: 0, y: 0, pan: 45, height: 2.4, fov: 85, res: 2560, range: 12 };
function props() {
  return {
    layout: { ...PRESETS[0], cameras: [CAMERA] }, cells: [], view: 'off', selected: null, people: [], showGrid: true, showAnchors: true,
    riskFilter: null, focusCell: null, cameraView: null, onSelect: vi.fn(), onCameraView: vi.fn(), onOverview: vi.fn(), onEditPlan: vi.fn(), onAddObstacle: vi.fn()
  } satisfies Omit<StoreSceneProps, 'reset' | 'cutaway'> & { onOverview: () => void; onEditPlan: () => void };
}
const buttonWith = (text: string) => renderer.root.findAllByType('button').find(button => button.children.includes(text))!;

describe('3D observation view controls', () => {
  it('toggles the combined surface view and returns to the editing toolbar', () => {
    act(() => { renderer = create(<Store3D {...props()} />); });
    expect(renderer.root.findByType(StoreScene).props.observationView).toBe(false);
    act(() => buttonWith(' Vùng quan sát').props.onClick());
    expect(renderer.root.findByType(StoreScene).props.observationView).toBe(true);
    expect(buttonWith(' Vùng quan sát').props['aria-pressed']).toBe(true);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Nội thất cần thêm trong 3D' })).toHaveLength(0);
    act(() => buttonWith(' Vùng quan sát').props.onClick());
    expect(renderer.root.findByType(StoreScene).props.observationView).toBe(false);
    expect(renderer.root.findByProps({ 'aria-label': 'Nội thất cần thêm trong 3D' }).props.disabled).toBe(false);
  });

  it('applies fixed POV quality and preserves the combined view when returning to overview', () => {
    const p = props();
    act(() => { renderer = create(<Store3D {...p} />); });
    act(() => buttonWith(' Vùng quan sát').props.onClick());
    act(() => renderer.update(<Store3D {...p} cameraView={CAMERA} />));
    expect(buttonWith(' Vùng quan sát').props.disabled).toBe(true);
    expect(renderer.root.findByType(StoreScene).props.observationView).toBe(false);
    expect(renderer.root.findAllByType('input')).toHaveLength(0);
    act(() => renderer.update(<Store3D {...p} />));
    expect(renderer.root.findByType(StoreScene).props.observationView).toBe(true);
  });
});
