import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ray, Vector3 } from 'three';
import { DraggableObject3D } from './DraggableObject3D';

let renderer: ReactTestRenderer;
beforeEach(() => { vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals(); });

function pointer(x: number, y: number, target: object, button = 0) {
  return { button, pointerId: 7, target, stopPropagation: vi.fn(), ray: new Ray(new Vector3(x, 10, y), new Vector3(0, -1, 0)) };
}

describe('3D floor dragging', () => {
  it('moves the object by its grabbed floor offset and restores navigation on release', () => {
    const onMove = vi.fn(), onInteraction = vi.fn(), onSelect = vi.fn();
    const target = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true };
    act(() => { renderer = create(<DraggableObject3D center={[2, 3]} selection={{ kind: 'obs', id: 'shelf' }} enabled onSelect={onSelect} onMove={onMove} onInteraction={onInteraction}><mesh /></DraggableObject3D>); });
    const handlers = renderer.root.findByType('group' as any).props;
    act(() => handlers.onPointerDown(pointer(1, 2, target)));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'obs', id: 'shelf' });
    expect(onInteraction).toHaveBeenLastCalledWith(true);
    expect(target.setPointerCapture).toHaveBeenCalledWith(7);
    act(() => handlers.onPointerMove(pointer(4, 6, target)));
    expect(onMove).not.toHaveBeenCalled();
    expect(renderer.root.findByType('group' as any).props.position).toEqual([3, 0, 4]);
    act(() => handlers.onPointerUp());
    expect(onMove).toHaveBeenCalledExactlyOnceWith(5, 7);
    expect(renderer.root.findByType('group' as any).props.position).toEqual([0, 0, 0]);
    expect(onInteraction).toHaveBeenLastCalledWith(false);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('cancels its preview and releases navigation without committing on cancellation', () => {
    const onMove = vi.fn(), onInteraction = vi.fn();
    const target = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true };
    act(() => { renderer = create(<DraggableObject3D center={[2, 3]} selection={{ kind: 'obs', id: 'shelf' }} enabled onSelect={vi.fn()} onMove={onMove} onInteraction={onInteraction}><mesh /></DraggableObject3D>); });
    const handlers = renderer.root.findByType('group' as any).props;
    act(() => { handlers.onPointerDown(pointer(1, 2, target)); handlers.onPointerMove(pointer(4, 6, target)); });
    act(() => handlers.onPointerCancel());
    expect(onMove).not.toHaveBeenCalled();
    expect(onInteraction).toHaveBeenLastCalledWith(false);
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(renderer.root.findByType('group' as any).props.position).toEqual([0, 0, 0]);
  });

  it('ignores read-only movement and right-button navigation', () => {
    const onMove = vi.fn(), onInteraction = vi.fn();
    const props = { center: [2, 3] as [number, number], selection: { kind: 'person' as const, id: 'P' }, onSelect: vi.fn(), onMove, onInteraction };
    act(() => { renderer = create(<DraggableObject3D {...props} enabled={false}><mesh /></DraggableObject3D>); });
    act(() => renderer.root.findByType('group' as any).props.onPointerDown(pointer(1, 2, {})));
    expect(onInteraction).not.toHaveBeenCalled();
    act(() => renderer.update(<DraggableObject3D {...props} enabled><mesh /></DraggableObject3D>));
    act(() => renderer.root.findByType('group' as any).props.onPointerDown(pointer(1, 2, {}, 2)));
    expect(onInteraction).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
