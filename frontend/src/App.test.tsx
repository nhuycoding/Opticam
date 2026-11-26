import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { OptiCamCanvas } from './components/canvas/OptiCamCanvas';
import { Inspector } from './components/Inspector';
import { CAMERA_OPTIMIZATION_FORM } from './components/CameraCountOptimizer';
import { PlanningSettings } from './components/PlanningSettings';
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
const submitOptimization = () => {
  const submit = button('Tối ưu phương án');
  expect(submit.props.form).toBe(CAMERA_OPTIMIZATION_FORM);
  return renderer.root.findByProps({ id: submit.props.form }).props.onSubmit({ preventDefault: vi.fn() });
};
const optimize = async () => { await act(async () => { await submitOptimization(); }); };

const workflowStep = (title: string) => renderer.root.findAllByType('button').find(node =>
  node.props.className?.includes('workflow-step') && node.findAllByType('strong').some(heading => heading.children.includes(title)))!;
const goTo = (title: string) => act(() => workflowStep(title).props.onClick());

beforeEach(() => {
  vi.mocked(Store3D).mockImplementation(() => <></>);
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: () => true });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(performance.now()); return 1; });
  vi.mocked(requestOptimize).mockResolvedValue({ cameras: [makeCamera('CAM-01', 0, 0, 45)], source: 'api' });
  act(() => { renderer = create(<App />); });
});
afterEach(() => { act(() => renderer.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Studio workflow', () => {
  it('adds and moves ceiling cameras in 3D, shares them with the plan and undoes a move', async () => {
    await click('3D');
    act(() => renderer.root.findByType(Store3D).props.onAddCamera(3, .5, 'ceiling'));
    let scene = renderer.root.findByType(Store3D).props;
    const added = scene.layout.cameras.at(-1);
    expect(added).toMatchObject({ mount: 'ceiling', x: 3, y: .5, tilt: 45 });
    expect(added.height).toBeCloseTo(3.05);
    // Start a separate history action so moving can be undone independently.
    await new Promise(resolve => setTimeout(resolve, 510));
    act(() => scene.onMoveCamera(added.id, 5, .5));
    expect(renderer.root.findByType(Store3D).props.layout.cameras.at(-1).x).toBe(5);
    act(() => renderer.root.findByProps({ 'aria-label': 'Hoàn tác' }).props.onClick());
    expect(renderer.root.findByType(Store3D).props.layout.cameras.at(-1).x).toBe(3);
    await click('2.5D');
    expect(canvas().layout.cameras.at(-1).mount).toBe('ceiling');
  });

  it('keeps an optimized interior position when only editing a ceiling camera angle', async () => {
    vi.mocked(requestOptimize).mockResolvedValueOnce({ cameras: [{ ...makeCamera('CAM-01', 3.12, .64, 90), mount: 'ceiling', height: 3.05, ceilingDrop: .15 }], source: 'api' });
    await optimize();
    const camera = canvas().layout.cameras[0];
    act(() => canvas().onCamera({ ...camera, pan: 120 }));
    expect(canvas().layout.cameras[0]).toMatchObject({ x: 3.12, y: .64, pan: 120 });
  });

  it('updates ceiling camera heights and mount choices using the default optimizer', async () => {
    act(() => canvas().onSelect({ kind: 'cam', id: canvas().layout.cameras[0].id }));
    const mount = renderer.root.findByProps({ 'aria-label': 'Kiểu lắp đặt camera' });
    act(() => mount.props.onChange({ target: { value: 'ceiling' } }));
    const changed = canvas().layout.cameras[0];
    expect(changed.mount).toBe('ceiling');
    expect(changed.x).toBeGreaterThan(0);
    act(() => button('Kích thước và nội thất').props.onClick());
    const height = renderer.root.findByProps({ 'aria-label': 'Chiều cao trần (m)' });
    act(() => height.props.onChange({ target: { value: '3.8' } }));
    act(() => renderer.root.findByProps({ 'aria-label': 'Chiều cao trần (m)' }).props.onBlur());
    expect(canvas().layout.cameras[0].height).toBeCloseTo(3.65);
    expect(renderer.root.findAllByProps({ 'aria-label': 'Thuật toán tối ưu' })).toHaveLength(0);
    act(() => renderer.root.findByProps({ 'aria-label': 'Vị trí cho phép tối ưu' }).props.onChange({ target: { value: 'ceiling' } }));
    await optimize();
    expect(vi.mocked(requestOptimize).mock.calls.at(-1)![0]).toMatchObject({ ceilingHeight: 3.8, optimization: { algorithm: 'kpi_hybrid', mounts: 'ceiling' } });
  });

  it('optimizes a typed camera count without deleting the existing cameras first', async () => {
    const originalCameras = canvas().layout.cameras;
    const input = renderer.root.findByProps({ 'aria-label': 'Số camera tùy chỉnh' });
    act(() => input.props.onChange({ target: { value: '2' } }));
    expect(canvas().layout.cameras).toBe(originalCameras);
    await optimize();
    expect(vi.mocked(requestOptimize).mock.calls.at(-1)![2]).toBe(2);
  });

  it('rejects invalid typed camera counts before calling the optimizer', async () => {
    for (const value of ['', '0', '21', '1.5', 'abc']) {
      act(() => renderer.root.findByProps({ 'aria-label': 'Số camera tùy chỉnh' }).props.onChange({ target: { value } }));
      await optimize();
      expect(requestOptimize).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ id: 'camera-count-error' }).props.role).toBe('alert');
    }
  });

  it('loads a populated template and supports moving people in 3D with undo', async () => {
    const index = PRESETS.findIndex(preset => preset.people?.length);
    act(() => renderer.root.findByProps({ 'aria-label': 'Chọn mặt bằng cửa hàng' }).props.onChange({ target: { value: String(index) } }));
    expect(renderer.root.findByProps({ role: 'dialog' })).toBeDefined();
    await click('Hủy');
    expect(canvas().people).toEqual([]);
    act(() => renderer.root.findByProps({ 'aria-label': 'Chọn mặt bằng cửa hàng' }).props.onChange({ target: { value: String(index) } }));
    await click('Đổi mặt bằng');
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
    for (const [label, view] of [['Kết quả', 'dori'], ['Mặt bằng', 'off']]) {
      goTo(label);
      expect(canvas().layout).toBe(edited);
      expect(canvas().view).toBe(view);
    }
  });

  it('shows the actual pre-optimization cameras and locks that preview', async () => {
    const original = canvas().layout;
    await optimize();
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
    await optimize();
    act(() => canvas().onCamera({ ...canvas().layout.cameras[0], pan: 90 }));
    expect(renderer.root.findAllByProps({ 'aria-label': 'So sánh trước và sau tối ưu' })).toHaveLength(0);
    expect(canvas().readOnly).toBe(false);
  });

  it('rejects optimization results if the room changed while solving', async () => {
    let finish!: (value: Awaited<ReturnType<typeof requestOptimize>>) => void;
    vi.mocked(requestOptimize).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = submitOptimization(); });
    const original = canvas().layout;
    act(() => canvas().onCamera({ ...original.cameras[0], pan: 120 }));
    await act(async () => { finish({ cameras: [makeCamera('STALE',0,0,45)], source: 'api' }); await pending; });
    expect(canvas().layout.cameras[0].pan).toBe(120);
    expect(canvas().layout.cameras.some((camera: { id: string }) => camera.id === 'STALE')).toBe(false);
    expect(renderer.root.findAllByProps({ 'aria-label': 'So sánh trước và sau tối ưu' })).toHaveLength(0);
  });

  it('loads every new retail template with its installation cameras and budget', async () => {
    for (let index=3; index<PRESETS.length; index++) {
      const picker=renderer.root.findByProps({ 'aria-label': 'Chọn mặt bằng cửa hàng' });
      act(() => picker.props.onChange({ target: { value: String(index) } }));
      await click('Đổi mặt bằng');
      expect(canvas().layout.cameras).toEqual(PRESETS[index].cameras);
      expect(canvas().layout.floorPolygon).toEqual(PRESETS[index].floorPolygon);
        expect(renderer.root.findByProps({ 'aria-label': 'Số camera tùy chỉnh' }).props.value).toBe(String(PRESETS[index].cameras.length));
    }
  });

  it('groups dimensions, priority and camera settings in the plan and shows only the analysis in results', async () => {
    const workflow = renderer.root.findByProps({ 'aria-label': 'Quy trình thiết kế' });
    expect(workflow.findAllByType('strong').map(heading => heading.children)).toEqual([['Mặt bằng'], ['Kết quả']]);
    expect(button('Kích thước và nội thất').props['aria-expanded']).toBe(true);
    act(() => renderer.root.findByProps({ id: 'group-priority' }).props.onClick());
    expect(button('Kích thước và nội thất').props['aria-expanded']).toBe(false);
    expect(renderer.root.findByProps({ id: 'group-priority' }).props['aria-expanded']).toBe(true);
    await click('Cao');
    expect(canvas()).toMatchObject({ view: 'risk', brush: 5 });
    await click('Camera và tối ưu');
    expect(button('Camera và tối ưu').props['aria-expanded']).toBe(true);
    expect(canvas().brush).toBeNull();
    expect(renderer.root.findAllByType(CameraSchedule)).toHaveLength(1);
    await click('3D');
    let scene = renderer.root.findByType(Store3D).props;
    expect(scene.onAddObstacle && scene.onAddCamera && scene.onAddPerson).toBeTypeOf('function');
    await optimize();
    scene = renderer.root.findByType(Store3D).props;
    expect(scene.onAddObstacle ?? scene.onAddCamera ?? scene.onAddPerson).toBeUndefined();
    expect(renderer.root.findAllByType(PlanningSettings)).toHaveLength(0);
    expect(renderer.root.findAllByType(CameraSchedule)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'panel result-actions' })).toHaveLength(1);
    await click('Chỉnh sửa mặt bằng');
    expect(renderer.root.findAllByType(PlanningSettings)).toHaveLength(1);
    expect(canvas().layout.cameras).toHaveLength(1);
  });

  it('keeps room edits available in the first step', () => {
    const settings = renderer.root.findByType(PlanningSettings);
    expect(settings.findByType('h3').children).toEqual(['Tùy chỉnh kích thước']);
    for (const label of ['Rộng (m)', 'Dài (m)', 'Tỷ lệ (px/m)', 'Chiều cao trần (m)']) {
      expect(settings.findByProps({ 'aria-label': label }).type).toBe('input');
    }
    const previous = canvas().layout;
    act(() => settings.findByProps({ 'aria-label': 'Kích thước ô (m)' }).props.onChange({ target: { value: '0.25' } }));
    act(() => settings.findByProps({ 'aria-label': 'Kích thước ô (m)' }).props.onBlur());
    expect(canvas().layout.gridM).toBe(.25);
    expect(canvas().layout.cameras).toBe(previous.cameras);
  });
});
