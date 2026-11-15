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
  const props = { number: '01', cam: makeCamera('CAM-01', 2, 0, 90), ppm, roomW: 10, roomH: 6, grid: 0.5, selected: true, onSelect: vi.fn(), onCamera: vi.fn() };

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

  it('moves ceiling cameras across the interior grid without snapping them to a wall', () => {
    const ceilingProps = { ...props, cam: { ...props.cam, mount: 'ceiling' as const, x: 2, y: 2, height: 3.05 } };
    const circle = descendants(renderCamera(ceilingProps)).find(element => element.props.draggable)!;
    const next = circle.props.dragBoundFunc.call(node, transform.point({ x: 4.2 * ppm, y: 3.1 * ppm }));
    const expected = transform.point({ x: 4 * ppm, y: 3 * ppm });
    expect(next.x).toBeCloseTo(expected.x);
    expect(next.y).toBeCloseTo(expected.y);
  });

  it('retains the last valid ceiling position when dragging into a concave notch or tall fixture', () => {
    const floorPolygon: [number, number][] = [[0, 0], [8, 0], [8, 2], [3, 2], [3, 6], [0, 6]];
    const ceilingProps = { ...props, roomW: 8, floorPolygon,
      cam: { ...props.cam, mount: 'ceiling' as const, x: 1, y: 3, height: 3.05 },
      obstacles: [{ id: 'tall', type: 'shelf' as const, label: 'Tall', x: 1.5, y: 3, w: 1, h: 1, angle: 0, elev: 3.1 }] };
    const circle = descendants(renderCamera(ceilingProps)).find(element => element.props.draggable)!;
    const valid = transform.point({ x: 1 * ppm, y: 4.5 * ppm });
    expect(circle.props.dragBoundFunc.call(node, valid)).toEqual(valid);
    expect(circle.props.dragBoundFunc.call(node, transform.point({ x: 6 * ppm, y: 4 * ppm }))).toEqual(valid);
    expect(circle.props.dragBoundFunc.call(node, transform.point({ x: 2 * ppm, y: 3.5 * ppm }))).toEqual(valid);
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

it('preserves camera coordinates exactly on a sloping wall when committing a drag', () => {
  const polygon: [number,number][] = [[0,0],[9,0],[7.5,9],[1.5,9]];
  const props = {number: '01', cam: makeCamera('SLOPE',9,0,180),ppm:68,roomW:9,roomH:9,grid:.25,selected:false,onSelect:vi.fn(),onCamera:vi.fn(),floorPolygon:polygon};
  const circle = descendants(renderCamera(props)).find(element=>element.props.draggable)!;
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{cb(0);return 1;});
  vi.stubGlobal('cancelAnimationFrame',vi.fn());
  try {
    const identity=new Transform();
    const node={getParent:()=>({getAbsoluteTransform:()=>identity})};
    const point=circle.props.dragBoundFunc.call(node,{x:8.7*68,y:3.7*68});
    circle.props.onDragMove({target:{x:()=>point.x,y:()=>point.y}});
    const camera=props.onCamera.mock.calls[0][0];
    expect(camera.x).toBeCloseTo(9-camera.y/6,9);
  } finally {vi.unstubAllGlobals();}
});
