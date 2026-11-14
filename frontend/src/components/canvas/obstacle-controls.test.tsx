import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ObstacleNode } from './ObstacleNode';
import type { Obstacle } from '../../types';

vi.mock('react-konva', () => Object.fromEntries(['Group', 'Circle', 'Line', 'Rect', 'Shape', 'Text'].map(name => [name, name.toLowerCase()])));

it.each([0.5, 1, 2])('rotates from an adjacent upright control without dragging at scale %s', labelScale => {
  const obstacle: Obstacle = { id: 's', type: 'shelf', label: 'Kệ', x: 2, y: 2, w: 2, h: 0.5, angle: 45, elev: 1.5 };
  const onRotate = vi.fn(), onSelect = vi.fn();
  let renderer!: ReturnType<typeof create>;
  act(() => { renderer = create(<ObstacleNode obs={obstacle} all={[obstacle]} ppm={68} roomW={10} roomH={6} grid={0.5} selected labelScale={labelScale} onRotate={onRotate} onSelect={onSelect} onObstacle={vi.fn()} />); });
  try {
    const control = renderer.root.findByProps({ name: 'obstacle-rotate-control' });
    const down = { cancelBubble: false }, click = { cancelBubble: false };
    act(() => { control.props.onPointerDown(down); control.props.onPointerClick(click); });
    expect(down.cancelBubble).toBe(true);
    expect(click.cancelBubble).toBe(true);
    expect(onRotate).toHaveBeenCalledWith(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(control.props.rotation).toBeUndefined();
    expect(control.props.scaleX).toBe(labelScale);
  } finally { act(() => renderer.unmount()); }
});
