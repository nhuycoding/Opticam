import { useEffect, useRef } from 'react';
import type { Camera } from '../types';
import { cameraNumber } from '../core/camera';
import type { Selection } from './canvas/shared';

export function CameraSchedule({ cameras, selected, onSelect }: {
  cameras: Camera[]; selected: Selection; onSelect: (selection: Selection) => void;
}) {
  const activeRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRow.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected?.id, selected?.kind]);
  return <aside className="camera-schedule" aria-label="Danh sách camera trên mặt bằng">
    <header><h2>Camera</h2><span>{cameras.length}</span></header>
    <div className="camera-schedule-list">
      {cameras.map((camera, index) => {
        const active = selected?.kind === 'cam' && selected.id === camera.id;
        return <button key={camera.id} ref={active ? activeRow : undefined}
          className={`camera-schedule-row${active ? ' active' : ''}`} aria-pressed={active}
          aria-label={`Chọn camera ${cameraNumber(index)} · ${camera.id}`}
          onClick={() => onSelect({ kind: 'cam', id: camera.id })}>
          <span className="camera-number">{cameraNumber(index)}</span>
          <span className="camera-schedule-info">
            <span className="camera-schedule-title"><strong title={camera.id}>{camera.id}</strong><span>{camera.pan}°</span></span>
            <span className="camera-schedule-spec">FOV {camera.fov}° · H {camera.height} m</span>
            {camera.target && <span className="camera-schedule-target" title={camera.target}>{camera.target}</span>}
          </span>
        </button>;
      })}
      {!cameras.length && <p className="camera-schedule-empty">Chưa có camera trên mặt bằng.</p>}
    </div>
  </aside>;
}
