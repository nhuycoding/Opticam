import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Camera as CameraIcon, Eye, RotateCcw, Scan, PanelsTopLeft } from 'lucide-react';
import { cameraProjection } from '../../core/camera';
import { StoreScene, type StoreSceneProps } from './StoreScene';
import { SceneFailure } from './SceneBoundary';

type Props = Omit<StoreSceneProps, 'reset' | 'cutaway'> & { onOverview: () => void; onEditPlan: () => void };

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
  const frameWidth = projection ? Math.min(size.width, size.height * projection.aspect) : size.width;
  const frameHeight = projection ? frameWidth / projection.aspect : size.height;
  return <div className={`three-workspace${props.cameraView ? ' camera-pov' : ''}`}>
    <div className="three-toolbar">
      <div className="three-view-switch" role="group" aria-label="Góc nhìn 3D">
        <button className={!props.cameraView ? 'on' : ''} aria-pressed={!props.cameraView} onClick={props.onOverview}><PanelsTopLeft size={14} /> Tổng thể</button>
        <label><CameraIcon size={14} /><select aria-label="Xem từ camera" value={props.cameraView?.id ?? ''} onChange={event => event.target.value ? props.onCameraView(event.target.value) : props.onOverview()}>
          <option value="">Chọn camera để quan sát</option>
          {props.layout.cameras.map(camera => <option key={camera.id} value={camera.id}>{camera.id}{camera.target ? ` · ${camera.target}` : ''}</option>)}
        </select></label>
      </div>
      <div className="three-tools">
        <button disabled={Boolean(props.cameraView)} aria-pressed={cutaway} title="Tự ẩn tường phía trước theo góc nhìn" onClick={() => setCutaway(value => !value)}><Eye size={14} /> Tường tự ẩn</button>
        <button disabled={Boolean(props.cameraView)} title="Đặt lại góc nhìn tổng thể" aria-label="Đặt lại góc nhìn 3D" onClick={() => setReset(value => value + 1)}><RotateCcw size={14} /></button>
      </div>
    </div>
    <div className="three-stage" ref={viewportRef} role="region" aria-label={props.cameraView ? `Góc nhìn 3D từ ${props.cameraView.id}` : 'Mô hình 3D cửa hàng'}>
      <div className="three-render-frame" style={{ width: frameWidth, height: frameHeight }}>
        {contextLost ? <SceneFailure onEditPlan={props.onEditPlan} /> :
          <Canvas frameloop="demand" dpr={[1, 1.75]} shadows={props.layout.obstacles.length <= 100}
            camera={{ position: [15, 15, 18], fov: 43, near: 0.03, far: 500 }}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
            fallback={<span>Mô hình không gian cửa hàng 3D</span>}>
            <ContextMonitor onLost={() => setContextLost(true)} />
            <StoreScene {...props} reset={reset} cutaway={cutaway} />
          </Canvas>
        }
      </div>
      {!props.cameraView && <div className="three-orientation" aria-hidden="true"><Scan size={13} /><span>1 m = 1 đơn vị</span></div>}
    </div>
    {props.cameraView ? <div className="three-view-status" aria-live="polite"><span><strong>{props.cameraView.id}</strong> · Mô phỏng góc nhìn</span><span>Cao {props.cameraView.height} m · Chúc {projection!.tilt}° · FOV {props.cameraView.fov}° × {projection!.vfov.toFixed(1)}°</span></div>
      : <div className="three-view-status"><span>Xoay bằng chuột trái · Di chuyển bằng chuột phải · Cuộn để thu phóng</span><span>Nhấp đúp camera để quan sát</span></div>}
  </div>;
}
