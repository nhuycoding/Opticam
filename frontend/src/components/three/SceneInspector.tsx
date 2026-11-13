import type { Layout, Person } from '../../types';
import { cameraProjection } from '../../core/camera';
import type { Selection } from '../canvas/shared';

export function SceneInspector({ layout, selected, people, onSelect, onEdit, onCameraView }: {
  layout: Layout; selected: Selection; people: Person[];
  onSelect: (selection: Selection) => void;
  onEdit: () => void; onCameraView: (id: string) => void;
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
        <dt>Độ cao lắp đặt</dt><dd>{camera.height} m</dd>
        <dt>Hướng ngang</dt><dd>{camera.pan}°</dd>
        <dt>Góc chúc xuống</dt><dd>{cameraProjection(camera).tilt}°</dd>
        <dt>FOV ngang × dọc</dt><dd>{camera.fov}° × {cameraProjection(camera).vfov.toFixed(1)}°</dd>
        <dt>Độ phân giải ngang</dt><dd>{camera.res} px</dd>
      </dl>
      <button onClick={() => onCameraView(camera.id)}>Xem từ {camera.id}</button>
    </>}
    {obstacle && <dl className="scene-properties"><dt>Kích thước</dt><dd>{obstacle.w} × {obstacle.h} m</dd><dt>Chiều cao</dt><dd>{obstacle.elev} m</dd><dt>Góc xoay</dt><dd>{obstacle.angle}°</dd><dt>Vị trí</dt><dd>{obstacle.x.toFixed(2)} · {obstacle.y.toFixed(2)} m</dd></dl>}
    {person && <dl className="scene-properties"><dt>Vị trí</dt><dd>{person.x.toFixed(2)} · {person.y.toFixed(2)} m</dd><dt>Chiều cao mô hình</dt><dd>1,69 m</dd></dl>}
    <p className="muted">Chọn nội thất để xem kích thước. Chọn camera để quan sát phối cảnh và vật thể che khuất.</p>
    <button className="scene-edit-button" onClick={onEdit}>Chỉnh sửa trong 2.5D</button>
    <p className="muted scene-analysis-note">Lớp DORI thể hiện phân tích mặt bằng tại độ cao {layout.targetHeight} m. Góc chúc và FOV dọc điều khiển phần xem 3D.</p>
  </section>;
}
