import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Camera as CameraIcon, Eye, Move, Plus, RotateCcw, Scan, ScanEye, PanelsTopLeft, UserRound } from 'lucide-react';
import type { Fixture, ObsType } from '../../types';
import { cameraProjection } from '../../core/camera';
import { StoreScene, type StoreSceneProps } from './StoreScene';
import { SceneFailure } from './SceneBoundary';
import './three-editor.css';

type Props = Omit<StoreSceneProps, 'reset' | 'cutaway' | 'editMode' | 'observationView' | 'imageEffectSupported'> & { onOverview: () => void; onEditPlan: () => void };

const FURNITURE: { label: string; type: ObsType; fixture?: Fixture }[] = [
  { label: 'Kệ hai mặt', type: 'shelf', fixture: 'gondola' },
  { label: 'Kệ sát tường', type: 'shelf', fixture: 'wall-shelf' },
  { label: 'Tủ mát', type: 'shelf', fixture: 'fridge' },
  { label: 'Tủ đông', type: 'shelf', fixture: 'freezer' },
  { label: 'Quầy thu ngân', type: 'pos' },
  { label: 'Quầy đồ ăn', type: 'shelf', fixture: 'food-counter' },
  { label: 'Bàn ngồi', type: 'shelf', fixture: 'seating' }
];

function ContextMonitor({ onLost }: { onLost: () => void }) {
  const canvas = useThree(state => state.gl.domElement);
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onLost(); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [canvas, onLost]);
  return null;
}

export default function Store3D(props: Props) {
  const [reset, setReset] = useState(0), [cutaway, setCutaway] = useState(true);
  const [contextLost, setContextLost] = useState(false);
  const [editMode, setEditMode] = useState<'orbit' | 'move'>('orbit');
  const [observationView, setObservationView] = useState(false);
  const [imageEffectSupported, setImageEffectSupported] = useState(true);
  const [furniture, setFurniture] = useState(0);
  useEffect(() => { if (props.readOnly || props.cameraView || observationView) setEditMode('orbit'); }, [props.readOnly, props.cameraView, observationView]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const projection = props.cameraView ? cameraProjection(props.cameraView) : null;
  const combinedView = observationView && !props.cameraView && imageEffectSupported;
  const canEdit = !props.readOnly && !props.cameraView && !combinedView;
  const frameWidth = projection ? Math.min(size.width, size.height * projection.aspect) : size.width;
  const frameHeight = projection ? frameWidth / projection.aspect : size.height;
  return <div className={`three-workspace${props.cameraView ? ' camera-pov' : ''}${combinedView ? ' observation-view' : ''}`}>
    <div className="three-toolbar">
      <div className="three-view-switch" role="group" aria-label="Góc nhìn 3D">
        <button className={!props.cameraView ? 'on' : ''} aria-pressed={!props.cameraView} onClick={props.onOverview}><PanelsTopLeft size={14} /> Tổng thể</button>
        <label><CameraIcon size={14} /><select aria-label="Xem từ camera" value={props.cameraView?.id ?? ''} onChange={event => event.target.value ? props.onCameraView(event.target.value) : props.onOverview()}>
          <option value="">Chọn camera để quan sát</option>
          {props.layout.cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.id}{camera.target ? ` · ${camera.target}` : ''}</option>)}
        </select></label>
      </div>
      <div className="three-tools">
        <button disabled={Boolean(props.cameraView) || !imageEffectSupported} className={combinedView ? 'on' : ''} aria-pressed={combinedView}
          title="Chỉ hiện các bề mặt 3D được ít nhất một camera quan sát, tính cả vật cản che khuất"
          onClick={() => setObservationView(value => !value)}><ScanEye size={14} /> Vùng quan sát</button>
        <button disabled={Boolean(props.cameraView)} aria-pressed={cutaway} title="Tự ẩn tường phía trước theo góc nhìn" onClick={() => setCutaway(value => !value)}><Eye size={14} /> Tường tự ẩn</button>
        <button disabled={Boolean(props.cameraView)} title="Đặt lại góc nhìn tổng thể" aria-label="Đặt lại góc nhìn 3D" onClick={() => setReset(value => value + 1)}><RotateCcw size={14} /></button>
      </div>
    </div>
    {props.cameraView || combinedView ? <div className="camera-image-status" role="status">
      {combinedView ? <><span><i aria-hidden="true" /> Phần màu đen nằm ngoài vùng quan sát</span><span>{props.layout.cameras.length ? `${props.layout.cameras.length} camera · Ưu tiên hình ảnh rõ nhất khi trùng vùng nhìn` : 'Chưa có camera trên mặt bằng'}</span></>
        : <span>{imageEffectSupported ? 'Mô phỏng PPM · DORI (IEC 62676-4:2014)' : 'Thiết bị hiện tại dùng hình ảnh sắc nét'}</span>}
    </div> : <div className="three-edit-toolbar">
      <div className="three-interaction-mode" role="group" aria-label="Thao tác trong 3D">
        <button aria-pressed={editMode === 'orbit'} className={editMode === 'orbit' ? 'on' : ''} onClick={() => setEditMode('orbit')}><PanelsTopLeft size={14} /> Xoay góc nhìn</button>
        <button aria-pressed={editMode === 'move'} className={editMode === 'move' ? 'on' : ''} disabled={!canEdit} onClick={() => setEditMode('move')}><Move size={14} /> Di chuyển vật thể</button>
      </div>
      <div className="three-add-furniture">
        <select aria-label="Nội thất cần thêm trong 3D" disabled={!canEdit || !props.onAddObstacle} value={furniture} onChange={event => setFurniture(Number(event.target.value))}>
          {FURNITURE.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}
        </select>
        <button disabled={!canEdit || !props.onAddObstacle} onClick={() => { const item = FURNITURE[furniture]; props.onAddObstacle?.(item.type, item.fixture); setEditMode('move'); }}><Plus size={14} /> Thêm nội thất</button>
        <button disabled={!canEdit || !props.onAddPerson} onClick={() => { props.onAddPerson?.(); setEditMode('move'); }}><UserRound size={14} /> Thêm người</button>
      </div>
    </div>}
    <div className="three-stage" ref={viewportRef} role="region" style={{ cursor: canEdit && editMode === 'move' ? 'move' : props.cameraView ? 'default' : 'grab' }} aria-label={props.cameraView ? `Góc nhìn 3D từ ${props.cameraView.id}` : 'Mô hình 3D cửa hàng'}>
      <div className="three-render-frame" style={{ width: frameWidth, height: frameHeight }}>
        {contextLost ? <SceneFailure onEditPlan={props.onEditPlan} /> :
          <Canvas frameloop="demand" dpr={[1, 1.75]} shadows={props.layout.obstacles.length <= 100}
            onCreated={({ gl }) => setImageEffectSupported(gl.extensions.has('EXT_color_buffer_float'))}
            camera={{ position: [15, 15, 18], fov: 43, near: 0.03, far: 500 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            fallback={<span>Mô hình không gian cửa hàng 3D</span>}>
            <ContextMonitor onLost={() => setContextLost(true)} />
            <StoreScene {...props} reset={reset} cutaway={cutaway} editMode={canEdit ? editMode : 'orbit'} observationView={combinedView} imageEffectSupported={imageEffectSupported} />
          </Canvas>
        }
      </div>
      {!props.cameraView && <div className="three-orientation" aria-hidden="true"><Scan size={13} /><span>{combinedView ? 'Mô phỏng PPM · DORI (IEC 62676-4:2014)' : '1 m = 1 đơn vị'}</span></div>}
    </div>
    {props.cameraView ? <div className="three-view-status" aria-live="polite"><span><strong>{props.cameraView.id}</strong> · Mô phỏng góc nhìn</span><span>Cao {props.cameraView.height} m · Chúc {projection!.tilt}° · FOV {props.cameraView.fov}° × {projection!.vfov.toFixed(1)}°</span></div>
      : <div className="three-view-status"><span>{canEdit && editMode === 'move' ? 'Kéo nội thất hoặc người để di chuyển trên sàn · Chuột phải để dịch góc nhìn' : 'Xoay bằng chuột trái · Di chuyển bằng chuột phải · Cuộn để thu phóng'}</span><span>{combinedView ? 'Chỉ hiện bề mặt camera nhìn thấy' : !imageEffectSupported ? 'Thiết bị chưa hỗ trợ hiệu ứng vùng quan sát' : 'Nhấp đúp camera để quan sát'}</span></div>}
  </div>;
}
