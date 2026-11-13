import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Transform } from 'konva/lib/Util';
import { describe, expect, it, vi } from 'vitest';
import { CameraNode } from './CameraNode';
import { PersonNode } from './PersonNode';
import { makeCamera } from '../../core/optimizer';
import { PAD } from './shared';

vi.mock('react-konva', () => ({ Group: 'group', Circle: 'circle', Line: 'line', Rect: 'rect', Text: 'text', Wedge: 'wedge', Ellipse: 'ellipse' }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useRef: (value: unknown) => ({ current: value })
}));

function descendants(tree: ReactNode): ReactElement<Record<string, any>>[] {
  return Children.toArray(tree).flatMap((child) => {
    if (!isValidElement<Record<string, any>>(child)) return [];
    return [child, ...descendants(child.props.children)];
  });
}

function renderCamera(props: ComponentProps<typeof CameraNode>) {
  const component = CameraNode as unknown as { type: (props: ComponentProps<typeof CameraNode>) => ReactElement };
  return component.type(props);
}

function renderPerson(props: ComponentProps<typeof PersonNode>) {
  const component = PersonNode as unknown as { type: (props: ComponentProps<typeof PersonNode>) => ReactElement<Record<string, any>> };
  return component.type(props);
}

describe.each([0.35, 1, 2])('Drag coordinates at zoom %s', (zoom) => {
  const ppm = 68;
  const transform = new Transform().translate(73, -31).scale(zoom, zoom).translate(PAD, PAD);
  const node = { getParent: () => ({ getAbsoluteTransform: () => transform }) };
  const props = { cam: makeCamera('CAM-01', 2, 0, 90), ppm, roomW: 10, roomH: 6, grid: 0.5, selected: true, onSelect: vi.fn(), onCamera: vi.fn() };

  it('snaps the camera to a wall through the actual drag bound callback', () => {
    const circles = descendants(renderCamera(props)).filter((element) => element.props.draggable);
    const next = circles[0].props.dragBoundFunc.call(node, transform.point({ x: 0.4 * ppm, y: 3.1 * ppm }));
    const expected = transform.point({ x: 0, y: 3 * ppm });
    expect(next.x).toBeCloseTo(expected.x);
    expect(next.y).toBeCloseTo(expected.y);
  });

  it('snaps the rotation handle to the camera-relative angle', () => {
    const circles = descendants(renderCamera(props)).filter((element) => element.props.draggable);
    const next = circles[1].props.dragBoundFunc.call(node, transform.point({ x: 2 * ppm + 40, y: 4 }));
    const expected = transform.point({ x: 2 * ppm + 40, y: 0 });
    expect(next.x).toBeCloseTo(expected.x);
    expect(next.y).toBeCloseTo(expected.y);
  });

  it('keeps person dragging inside the room after zoom and pan', () => {
    const person = renderPerson({ person: { id: 'p', x: 2, y: 2 }, ppm, selected: true, roomW: 10, roomH: 6, obstacles: [], onSelect: vi.fn(), onMove: vi.fn() });
    person.props.onDragStart({ target: { getAbsolutePosition: () => transform.point({ x: 2 * ppm, y: 2 * ppm }) } });
    const valid = transform.point({ x: 3 * ppm, y: 2 * ppm });
    expect(person.props.dragBoundFunc.call(node, valid)).toEqual(valid);
    const invalid = transform.point({ x: 0.05 * ppm, y: 2 * ppm });
    expect(person.props.dragBoundFunc.call(node, invalid)).toEqual(valid);
  });
});
