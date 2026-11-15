import type { Camera, Layout, Person } from '../../types';
import { cameraMount, cameraProjection } from '../../core/camera';
import type { Selection } from '../canvas/shared';

export function SceneInspector({ layout, selected, people, onSelect, onEdit, onCameraView, readOnly = false, onRotateSelected, onDeleteSelected, onCameraPatch }: {
  layout: Layout; selected: Selection; people: Person[];
  onSelect: (selection: Selection) => void;
  onEdit: () => void; onCameraView: (id: string) => void;
  onCameraPatch?: (id: string, patch: Partial<Camera>) => void;
  readOnly?: boolean; onRotateSelected?: () => void; onDeleteSelected?: () => void;
}) {
  const camera = selected?.kind === 'cam' ? layout.cameras.find(c => c.id === selected.id) : undefined;
  const obstacle = selected?.kind === 'obs' ? layout.obstacles.find(o => o.id === selected.id) : undefined;
  const person = selected?.kind === 'person' ? people.find(p => p.id === selected.id) : undefined;
  return <section className="panel scene-inspector">
    <h3>{camera ? camera.id : obstacle ? obstacle.label : person ? 'Người quan sát' : 'Quan sát không gian 3D'}</h3>
    <label className="field">Đối tượng trong cửa hàng<select aria-label="Chọn đối tượng trong 3D" value={selected ? `${selected.kind}:${selected.id}` : ''} onChange={event => {
      const value = event.target.value, index = value.indexOf(':');
      onSelect(value ? { kind: value.slice(0, index) as 'cam' | 'obs' | 'person', id: value.slice(index + 1) } : null);
    }}>
      <option value="">Chọn để xem thông tin</option>
      <optgroup label="Camera">{layout.cameras.map(c => <option key={c.id} value={`cam:${c.id}`}>{c.id}</option>)}</optgroup>
      <optgroup label="Nội thất">{layout.obstacles.map(o => <option key={o.id} value={`obs:${o.id}`}>{o.label}</option>)}</optgroup>
      {!!people.length && <optgroup label="Người">{people.map(p => <option key={p.id} value={`person:${p.id}`}>{p.id}</option>)}</optgroup>}
    </select></label>
    {!selected && <div className="object-list">{layout.cameras.map(c => <button key={c.id} onClick={() => onCameraView(c.id)} aria-label={`Quan sát từ ${c.id}`}><span>{c.id}</span><small>{c.target ?? `Cao ${c.height} m · ${c.pan}°`}</small></button>)}</div>}
    {camera && <>
      {camera.target && <p className="camera-role">{camera.target}</p>}
      <dl className="scene-properties">
        <dt>Vị trí</dt><dd>{camera.x.toFixed(2)} · {camera.y.toFixed(2)} m</dd>
        <dt>Kiểu lắp</dt><dd>{cameraMount(camera) === 'ceiling' ? 'Gắn trần' : 'Gắn tường'}</dd>
        <dt>Độ cao ống kính</dt><dd>{camera.height} m</dd>
        <dt>Hướng ngang</dt><dd>{camera.pan}°</dd>
        <dt>Góc chúc xuống</dt><dd>{cameraProjection(camera).tilt}°</dd>
        <dt>FOV ngang × dọc</dt><dd>{camera.fov}° × {cameraProjection(camera).vfov.toFixed(1)}°</dd>
        <dt>Độ phân giải ngang</dt><dd>{camera.res} px</dd>
      </dl>
      {onCameraPatch && <fieldset className="scene-camera-fields" disabled={readOnly}>
        <label className="field">Kiểu lắp camera<select aria-label="Kiểu lắp camera trong 3D" value={cameraMount(camera)} onChange={event => onCameraPatch(camera.id, { mount: event.target.value as 'wall' | 'ceiling' })}>
          <option value="wall">Gắn tường</option><option value="ceiling">Gắn trần</option>
        </select></label>
        {cameraMount(camera) === 'ceiling' && <label className="field">Khoảng hạ từ trần (m)<input aria-label="Khoảng hạ camera từ trần trong 3D" type="number" min={0.15} max={1} step={0.05} value={camera.ceilingDrop ?? 0.15} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onCameraPatch(camera.id, { ceilingDrop: value }); }} /></label>}
        <label className="field">Hướng ngang (°)<input aria-label="Hướng camera trong 3D" type="number" min={0} max={359} step={15} value={camera.pan} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onCameraPatch(camera.id, { pan: value }); }} /></label>
        <label className="field">Góc chúc xuống (°)<input aria-label="Góc chúc camera trong 3D" type="number" min={0} max={90} step={5} value={cameraProjection(camera).tilt} onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value)) onCameraPatch(camera.id, { tilt: value }); }} /></label>
      </fieldset>}
      <button onClick={() => onCameraView(camera.id)}>Xem từ {camera.id}</button>
    </>}
    {obstacle && <dl className="scene-properties"><dt>Kích thước</dt><dd>{obstacle.w} × {obstacle.h} m</dd><dt>Chiều cao</dt><dd>{obstacle.elev} m</dd><dt>Góc xoay</dt><dd>{obstacle.angle}°</dd><dt>Vị trí</dt><dd>{obstacle.x.toFixed(2)} · {obstacle.y.toFixed(2)} m</dd></dl>}
    {person && <dl className="scene-properties"><dt>Vị trí</dt><dd>{person.x.toFixed(2)} · {person.y.toFixed(2)} m</dd><dt>Chiều cao mô hình</dt><dd>1,69 m</dd></dl>}
    {selected && !readOnly && <div className="scene-object-actions">
      {selected.kind !== 'person' && onRotateSelected && <button onClick={onRotateSelected}>Xoay 15°</button>}
      {onDeleteSelected && <button onClick={onDeleteSelected}>Xóa đối tượng</button>}
    </div>}
    <p className="muted">Chọn Di chuyển vật thể để kéo nội thất, người hoặc camera trần. Bật Camera trần rồi nhấp lưới để lắp thêm. Chọn camera để quan sát phối cảnh.</p>
    <button className="scene-edit-button" onClick={onEdit}>Mở bản vẽ 2.5D</button>
    <p className="muted scene-analysis-note">Lớp DORI thể hiện phân tích mặt bằng tại độ cao {layout.targetHeight} m. Góc chúc và FOV dọc được xét khi đánh giá vùng nhìn và tối ưu.</p>
  </section>;
}
