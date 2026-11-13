import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { OptiCamCanvas } from './components/canvas/OptiCamCanvas';
import { Inspector } from './components/Inspector';
import { requestOptimize } from './core/api';
import { makeCamera } from './core/optimizer';

// Exercise App's real state, geometry, scoring, and workflow. Canvas pixels are
// covered separately by drag/core tests and still need a browser visual review.
vi.mock('./components/canvas/OptiCamCanvas', () => ({ OptiCamCanvas: () => null }));
vi.mock('./core/api', () => ({ requestOptimize: vi.fn() }));
let renderer: ReactTestRenderer;
const canvas = () => renderer.root.findByType(OptiCamCanvas).props;
function button(label: string): ReactTestInstance {
  const text = (n: ReactTestInstance | string): string => typeof n === 'string' ? n : n.children.map(text).join('');
  const node = renderer.root.findAllByType('button').find(n => text(n).includes(label));
  if (!node) throw new Error(`Missing button ${label}`);
  return node;
}
const click = async (label: string) => { await act(async () => { await button(label).props.onClick(); }); };

beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: () => true });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(performance.now()); return 1; });
  vi.mocked(requestOptimize).mockResolvedValue({ cameras: [makeCamera('CAM-01', 0, 0, 45)], source: 'api' });
  act(() => { renderer = create(<App />); });
});
afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Studio workflow', () => {
  it('navigates all steps freely, preserving the same edited floor plan', async () => {
    const before = canvas().layout;
    const updated = { ...before.cameras[0], pan: 60 };
    act(() => canvas().onCamera(updated));
    const edited = canvas().layout;
    for (const [label, view] of [['Ưu tiên', 'risk'], ['Camera', 'dori'], ['Kết quả', 'dori'], ['Mặt bằng', 'off']]) {
      // Workflow buttons have a step-index, avoiding similarly named tool buttons.
      const step = renderer.root.findAllByType('button').find(n => n.props.className?.includes('workflow-step') && n.findAllByType('strong').some(c => c.children.includes(label)));
      expect(step).toBeDefined();
      act(() => step!.props.onClick());
      expect(canvas().layout).toBe(edited);
      expect(canvas().view).toBe(view);
    }
  });

  it('shows the actual pre-optimization cameras and locks that preview', async () => {
    const original = canvas().layout;
    await click('Tối ưu phương án');
    const optimized = canvas().layout;
    expect(optimized.cameras).toHaveLength(1);
    expect(renderer.root.findByProps({ 'aria-current': 'step' }).findByType('strong').children).toEqual(['Kết quả']);
    await click('Trước tối ưu');
    expect(canvas().layout).toBe(original);
    expect(canvas().readOnly).toBe(true);
    await click('Sau tối ưu');
    expect(canvas().layout).toBe(optimized);
    expect(canvas().readOnly).toBe(false);
  });

  it('clears a stale before/after comparison after a camera edit', async () => {
    await click('Tối ưu phương án');
    act(() => canvas().onCamera({ ...canvas().layout.cameras[0], pan: 90 }));
    expect(renderer.root.findAllByProps({ 'aria-label': 'So sánh trước và sau tối ưu' })).toHaveLength(0);
    expect(canvas().readOnly).toBe(false);
  });

  it('rejects optimization results if the room changed while solving', async () => {
    let finish!: (value: Awaited<ReturnType<typeof requestOptimize>>) => void;
    vi.mocked(requestOptimize).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = button('Tối ưu phương án').props.onClick(); });
    const original = canvas().layout;
    act(() => canvas().onCamera({ ...original.cameras[0], pan: 120 }));
    await act(async () => { finish({ cameras: [makeCamera('STALE',0,0,45)], source: 'api' }); await pending; });
    expect(canvas().layout.cameras[0].pan).toBe(120);
    expect(canvas().layout.cameras.some((camera: { id: string }) => camera.id === 'STALE')).toBe(false);
    expect(renderer.root.findAllByProps({ 'aria-label': 'So sánh trước và sau tối ưu' })).toHaveLength(0);
  });

  it('keeps room edits available in the first step', () => {
    const inspector = renderer.root.findByType(Inspector);
    expect(inspector.props.mode).toBe('room');
    const previous = canvas().layout;
    act(() => inspector.props.onGrid(.25));
    expect(canvas().layout.gridM).toBe(.25);
    expect(canvas().layout.cameras).toBe(previous.cameras);
  });
});
