import type { Camera, Layout, Person } from '../../types';
import { cameraMount, cameraProjection } from '../../core/camera';
import type { Selection } from '../canvas/shared';

export function SceneInspector({ mode, layout, selected, people, onSelect, onEdit, readOnly = false, onRotateSelected, onDeleteSelected, onCameraPatch }: {
  mode: 'room' | 'camera'; layout: Layout; selected: Selection; people: Person[];
  onSelect: (selection: Selection) => void;
  onEdit: () => void;
  onCameraPatch?: (id: string, patch: Partial<Camera>) => void;
  readOnly?: boolean; onRotateSelected?: () => void; onDeleteSelected?: () => void;
}) {
  const camera = mode === 'camera' && selected?.kind === 'cam' ? layout.cameras.find(c => c.id === selected.id) : undefined;
  const canSelect = selected && (mode === 'room' ? selected.kind === 'obs' : selected.kind !== 'obs');
  const label = mode === 'room' ? 'Nội thất' : 'Camera và người kiểm tra';
  return <section className="panel scene-inspector">
    <label className="field">{label}<select value={canSelect ? `${selected.kind}:${selected.id}` : ''} onChange={event => {
      const value = event.target.value, index = value.indexOf(':');
      onSelect(value ? { kind: value.slice(0, index) as 'cam' | 'obs' | 'person', id: value.slice(index + 1) } : null);
    }}>
      <option value="">Chọn đối tượng</option>
      {mode === 'camera' && <optgroup label="Camera">{layout.cameras.map(c => <option key={c.id} value={`cam:${c.id}`}>{c.id}</option>)}</optgroup>}
      {mode === 'room' && layout.obstacles.map(o => <option key={o.id} value={`obs:${o.id}`}>{o.label}</option>)}
      {mode === 'camera' && !!people.length && <optgroup label="Người">{people.map(p => <option key={p.id} value={`person:${p.id}`}>{p.id}</option>)}</optgroup>}
    </select></label>
    {camera && <>
      {camera.target && <p className="camera-role">{camera.target}</p>}
      {onCameraPatch && <fieldset className="scene-camera-fields" disabled={readOnly}>
        <label className="field">Kiểu lắp camera<select aria-label="Kiểu lắp camera trong 3D" value={cameraMount(camera)} onChange={event => onCameraPatch(camera.id, { mount: event.target.value as 'wall' | 'ceiling' })}>
          <option value="wall">Gắn tường</option><option value="ceiling">Gắn trần</option>
        </select></label>
        {cameraMount(camera) === 'ceiling' && <label className="field">Khoảng hạ từ trần (m)<input aria-label="Khoảng hạ camera từ trần trong 3D" type="number" min={0.15} max={1} step={0.05} value={camera.ceilingDrop ?? 0.15} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onCameraPatch(camera.id, { ceilingDrop: value }); }} /></label>}
        <label className="field">Hướng ngang (°)<input aria-label="Hướng camera trong 3D" type="number" min={0} max={359} step={15} value={camera.pan} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onCameraPatch(camera.id, { pan: value }); }} /></label>
        <label className="field">Góc chúc xuống (°)<input aria-label="Góc chúc camera trong 3D" type="number" min={0} max={90} step={5} value={cameraProjection(camera).tilt} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onCameraPatch(camera.id, { tilt: value }); }} /></label>
      </fieldset>}
    </>}
    {canSelect && !readOnly && <div className="scene-object-actions">
      {selected.kind !== 'person' && onRotateSelected && <button onClick={onRotateSelected}>Xoay 15°</button>}
      {onDeleteSelected && <button onClick={onDeleteSelected}>Xóa đối tượng</button>}
    </div>}
    <button className="scene-edit-button" onClick={onEdit}>Mở bản vẽ 2.5D</button>
  </section>;
}
