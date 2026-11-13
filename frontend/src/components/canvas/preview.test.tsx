import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OptiCamCanvas, type CanvasProps } from './OptiCamCanvas';
import { PRESETS, withManualCams } from '../../data/presets';
import { cameraLabelBoxes } from './shared';

vi.mock('react-konva', () => Object.fromEntries(['Stage','Layer','Shape','Group','Circle','Line','Rect','Text','Wedge','Ellipse','Image'].map(name => [name, name.toLowerCase()])));
let renderer: ReactTestRenderer | undefined;
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; });

describe('Plan preview editing guards', () => {
  it('disables object dragging, person placement, and Alt-wheel rotation in the before view', () => {
    const props: CanvasProps = {
      layout: withManualCams(PRESETS[0]), cells: [], view: 'dori', tool: 'person', brush: null,
      selected: null, people: [], riskFilter: null, focusCell: null, readOnly: true,
      showGrid: true, showAnchors: false, measure: null, stageRef: { current: null }, drawMsRef: { current: 0 },
      onRiskFilter: vi.fn(), onCamera: vi.fn(), onObstacle: vi.fn(), onPaint: vi.fn(),
      onAddPerson: vi.fn(), onPerson: vi.fn(), onInvalidPerson: vi.fn(), onSelect: vi.fn(), onRotate: vi.fn(), onMeasure: vi.fn()
    };
    act(() => { renderer = create(<OptiCamCanvas {...props} />); });
    const stage = renderer!.root.findByType('stage' as any);
    const event = { evt: { preventDefault: vi.fn(), altKey: true, deltaY: -1 }, target: { getStage: () => ({ getPointerPosition: () => ({ x: 10, y: 10 }) }) } };
    act(() => { stage.props.onPointerClick(event); stage.props.onWheel(event); });
    expect(props.onAddPerson).not.toHaveBeenCalled();
    expect(props.onRotate).not.toHaveBeenCalled();
    const objectLayers = renderer!.root.findAllByType('layer' as any).filter(n => n.props.x !== undefined && n.props.listening !== undefined);
    expect(objectLayers.every(n => n.props.listening === false)).toBe(true);
  });
});

describe('Camera annotation bounds', () => {
  it.each([.3, 1, 2])('keeps dense camera labels inside the room at zoom %s', zoom => {
    const cameras = Array.from({ length: 20 }, (_, i) => ({ id: String(i), x: i % 2 ? 3 : 0, y: (i % 10) / 3 }));
    const boxes = cameraLabelBoxes(cameras, 3, 3, 30, 1 / Math.max(.55, zoom));
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(90);
      expect(box.y + box.height).toBeLessThanOrEqual(90);
    }
  });
});
