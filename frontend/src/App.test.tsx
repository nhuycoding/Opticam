import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { OptiCamCanvas } from './components/canvas/OptiCamCanvas';
import { Inspector } from './components/Inspector';
import { requestOptimize } from './core/api';
import { PRESETS } from './data/presets';
import { makeCamera } from './core/optimizer';
import Store3D from './components/three/Store3D';
import { CameraSchedule } from './components/CameraSchedule';

// Exercise App's real state, geometry, scoring, and workflow. Canvas pixels are
// covered separately by drag/core tests and still need a browser visual review.
vi.mock('./components/canvas/OptiCamCanvas', () => ({ OptiCamCanvas: () => null }));
vi.mock('./components/three/Store3D', () => ({ default: vi.fn(() => <></>) }));
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
  vi.mocked(Store3D).mockImplementation(() => <></>);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: () => true });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(performance.now()); return 1; });
  vi.mocked(requestOptimize).mockResolvedValue({ cameras: [makeCamera('CAM-01', 0, 0, 45)], source: 'api' });
  act(() => { renderer = create(<App />); });
});
afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Studio workflow', () => {
  it('optimizes a typed camera count without deleting the existing cameras first', async () => {
    const step = renderer.root.findAllByType('button').find(n => n.props.className?.includes('workflow-step') && n.findAllByType('strong').some(c => c.children.includes('Camera')))!;
    act(() => step.props.onClick());
    const originalCameras = canvas().layout.cameras;
    const input = renderer.root.findByProps({ 'aria-label': 'Số camera tùy chỉnh' });
    act(() => input.props.onChange({ target: { value: '2' } }));
    expect(canvas().layout.cameras).toBe(originalCameras);
    await click('Tối ưu số camera đã nhập');
    expect(vi.mocked(requestOptimize).mock.calls.at(-1)![2]).toBe(2);
  });

  it('rejects invalid typed camera counts before calling the optimizer', async () => {
    const step = renderer.root.findAllByType('button').find(n => n.props.className?.includes('workflow-step') && n.findAllByType('strong').some(c => c.children.includes('Camera')))!;
    act(() => step.props.onClick());
    for (const value of ['', '0', '21', '1.5', 'abc']) {
      act(() => renderer.root.findByProps({ 'aria-label': 'Số camera tùy chỉnh' }).props.onChange({ target: { value } }));
      await click('Tối ưu số camera đã nhập');
      expect(requestOptimize).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ id: 'camera-count-error' }).props.role).toBe('alert');
    }
  });

  it('loads a populated template and supports moving people in 3D with undo', async () => {
    const index = PRESETS.findIndex(preset => preset.people?.length);
    act(() => renderer.root.findByProps({ 'aria-label': 'Chọn mặt bằng cửa hàng' }).props.onChange({ target: { value: String(index) } }));
    expect(canvas().people).toEqual(PRESETS[index].people);
    await click('3D');
    const scene = renderer.root.findByType(Store3D).props;
    const person = scene.people[0];
    act(() => scene.onMovePerson({ ...person, x: 5, y: 0.4 }));
    expect(renderer.root.findByType(Store3D).props.people[0].x).toBe(5);
    act(() => renderer.root.findByProps({ 'aria-label': 'Hoàn tác' }).props.onClick());
    expect(renderer.root.findByType(Store3D).props.people[0]).toEqual(person);
  });

  it('clears a removed person selection after undoing 3D insertion', async () => {
    await click('3D');
    act(() => renderer.root.findByType(Store3D).props.onAddPerson());
    expect(renderer.root.findByType(Store3D).props.selected.kind).toBe('person');
    act(() => renderer.root.findByProps({ 'aria-label': 'Hoàn tác' }).props.onClick());
    expect(renderer.root.findByType(Store3D).props.people).toHaveLength(0);
    expect(renderer.root.findByType(Store3D).props.selected).toBeNull();
  });

  it('returns to editable overview when undo removes the POV camera', async () => {
    const originalCount = canvas().layout.cameras.length;
    act(() => renderer.root.findByProps({ title: 'Thêm camera (C)' }).props.onClick());
    const added = canvas().layout.cameras.at(-1);
    await click('3D');
    act(() => renderer.root.findByType(Store3D).props.onCameraView(added.id));
    act(() => renderer.root.findByProps({ 'aria-label': 'Hoàn tác' }).props.onClick());
    expect(renderer.root.findByType(Store3D).props.cameraView).toBeNull();
    const keyHandler = vi.mocked(window.addEventListener).mock.calls.filter(call => call[0] === 'keydown').at(-1)![1] as (event: KeyboardEvent) => void;
    act(() => keyHandler({ key: 'c', target: { isContentEditable: false, tagName: 'BODY' }, preventDefault: vi.fn() } as unknown as KeyboardEvent));
    expect(renderer.root.findByType(Store3D).props.layout.cameras).toHaveLength(originalCount + 1);
  });
  it('selects the same camera from the schedule and diagram, keeping the list current', () => {
    const cameras = canvas().layout.cameras;
    const row = renderer.root.findByProps({ 'aria-label': `Chọn camera 02 · ${cameras[1].id}` });
    act(() => row.props.onClick());
    expect(canvas().selected).toEqual({ kind: 'cam', id: cameras[1].id });
    expect(renderer.root.findByProps({ 'aria-label': `Chọn camera 02 · ${cameras[1].id}` }).props['aria-pressed']).toBe(true);
    expect(renderer.root.findByType(Inspector).props.sel).toEqual(canvas().selected);
    act(() => canvas().onSelect({ kind: 'cam', id: cameras[0].id }));
    expect(renderer.root.findByType(CameraSchedule).props.selected).toEqual(canvas().selected);
    act(() => canvas().onCamera({ ...cameras[0], pan: 180, fov: 75 }));
    expect(renderer.root.findByType(CameraSchedule).props.cameras[0]).toMatchObject({ pan: 180, fov: 75 });
  });
  it('returns to the editable plan after a 3D renderer failure', async () => {
    const original = canvas().layout;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(Store3D).mockImplementation(() => { throw new Error('WebGL unavailable'); });
    try {
      await click('3D');
      expect(canvas().layout).toBe(original);
      expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
      await click('Mở mặt bằng 2.5D');
      expect(renderer.root.findByType(Inspector).props.layout).toBe(original);
    } finally { errorLog.mockRestore(); }
  });
  it('shares edits and camera selection across 2.5D and 3D', async () => {
    const original = canvas().layout;
    await click('3D');
    let scene = renderer.root.findByType(Store3D).props;
    expect(scene.layout).toBe(original);
    expect(renderer.root.findAllByType(Inspector)).toHaveLength(0);
    act(() => scene.onCameraView(original.cameras[0].id));
    scene = renderer.root.findByType(Store3D).props;
    expect(scene.cameraView).toBe(original.cameras[0]);
    expect(scene.selected).toEqual({ kind: 'cam', id: original.cameras[0].id });
    act(() => scene.onEditPlan());
    const inspector = renderer.root.findByType(Inspector);
    expect(inspector.props.sel.id).toBe(original.cameras[0].id);
    act(() => inspector.props.onCam(original.cameras[0].id, { tilt: 42, vfov: 61 }));
    const edited = canvas().layout;
    await click('3D');
    scene = renderer.root.findByType(Store3D).props;
    expect(scene.layout).toBe(edited);
    expect(scene.cameraView).toMatchObject({ tilt: 42, vfov: 61 });
    act(() => scene.onOverview());
    expect(renderer.root.findByType(Store3D).props.cameraView).toBeNull();
    await click('2.5D');
    expect(canvas().layout).toBe(edited);
  });
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
    expect(renderer.root.findByType(CameraSchedule).props.cameras).toBe(original.cameras);
    expect(canvas().readOnly).toBe(true);
    await click('Sau tối ưu');
    expect(canvas().layout).toBe(optimized);
    expect(renderer.root.findByType(CameraSchedule).props.cameras).toBe(optimized.cameras);
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

  it('loads every new retail template with its installation cameras and budget', () => {
    for (let index=3; index<PRESETS.length; index++) {
      const picker=renderer.root.findByProps({ 'aria-label': 'Chọn mặt bằng cửa hàng' });
      act(() => picker.props.onChange({ target: { value: String(index) } }));
      expect(canvas().layout.cameras).toEqual(PRESETS[index].cameras);
      expect(canvas().layout.floorPolygon).toEqual(PRESETS[index].floorPolygon);
      const step=renderer.root.findAllByType('button').find(n => n.props.className?.includes('workflow-step') && n.findAllByType('strong').some(c => c.children.includes('Camera')));
      act(() => step!.props.onClick());
      expect(renderer.root.findByProps({ 'aria-label': 'Ngân sách camera' }).props.value).toBe(PRESETS[index].cameras.length);
    }
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
