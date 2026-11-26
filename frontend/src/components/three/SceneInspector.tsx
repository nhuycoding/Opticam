import type { Camera, Layout, Person } from '../../types';
import { cameraMount, cameraProjection } from '../../core/camera';
import type { Selection } from '../canvas/shared';
import { StudioSelect } from '../StudioSelect';

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
  const options = mode === 'room'
    ? layout.obstacles.map(o => ({ value: `obs:${o.id}`, label: o.label, meta: `${Math.round(o.w * 10) / 10}×${Math.round(o.h * 10) / 10}m` }))
    : [
        ...layout.cameras.map(c => ({ value: `cam:${c.id}`, label: c.id, group: 'Camera', meta: `${cameraMount(c) === 'ceiling' ? 'Trần' : 'Tường'} · ${c.pan}°` })),
        ...people.map(p => ({ value: `person:${p.id}`, label: p.id, group: 'Người' })),
      ];
  return <section className="panel scene-inspector">
    <div className="field">
      <span>{label}</span>
      <StudioSelect
        ariaLabel={label}
        value={canSelect ? `${selected.kind}:${selected.id}` : ''}
        placeholder="Chọn đối tượng"
        options={options}
        onChange={(value) => {
          const index = value.indexOf(':');
          onSelect(value ? { kind: value.slice(0, index) as 'cam' | 'obs' | 'person', id: value.slice(index + 1) } : null);
        }}
      />
    </div>
    {camera && <>
      {camera.target && <p className="camera-role">{camera.target}</p>}
      {onCameraPatch && <fieldset className="scene-camera-fields" disabled={readOnly}>
        <div className="field">
          <span>Kiểu lắp camera</span>
          <div className="segmented-pills segmented-2" role="group" aria-label="Kiểu lắp camera trong 3D">
            {([['wall', 'Gắn tường'], ['ceiling', 'Gắn trần']] as const).map(([value, text]) => (
              <button
                key={value}
                type="button"
                className={cameraMount(camera) === value ? 'active' : ''}
                aria-pressed={cameraMount(camera) === value}
                onClick={() => onCameraPatch(camera.id, { mount: value })}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
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
