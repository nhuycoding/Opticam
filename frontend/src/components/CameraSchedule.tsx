import { useEffect, useRef, useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { Camera } from '../types';
import { cameraNumber, cameraMount } from '../core/camera';
import type { Selection } from './canvas/shared';

export function CameraSchedule({ cameras, selected, onSelect }: {
  cameras: Camera[]; selected: Selection; onSelect: (selection: Selection) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const activeRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRow.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected?.id, selected?.kind]);

  return <aside className={`camera-schedule${collapsed ? ' collapsed' : ''}`} aria-label="Danh sách camera trên mặt bằng">
    <header>
      {!collapsed && <><h2>Camera</h2><span>{cameras.length}</span></>}
      <button
        type="button"
        className="camera-collapse-btn"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Mở rộng danh sách camera' : 'Thu nhỏ danh sách camera'}
        title={collapsed ? `Mở danh sách camera (${cameras.length})` : 'Thu nhỏ danh sách camera'}
        onClick={() => setCollapsed((v) => !v)}
      >
        {collapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
      </button>
    </header>
    {collapsed ? (
      <div className="camera-schedule-mini" aria-label={`Camera (${cameras.length})`}>
        <span className="camera-mini-count">{cameras.length}</span>
        {cameras.map((camera, index) => {
          const active = selected?.kind === 'cam' && selected.id === camera.id;
          return (
            <button
              key={camera.id}
              type="button"
              className={`camera-mini-pill${active ? ' active' : ''}`}
              aria-pressed={active}
              title={`${camera.id} (${camera.pan}°)`}
              aria-label={`Chọn camera ${cameraNumber(index)} · ${camera.id}`}
              onClick={() => onSelect({ kind: 'cam', id: camera.id })}
            >
              {cameraNumber(index)}
            </button>
          );
        })}
      </div>
    ) : (
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
              <span className="camera-schedule-spec">{cameraMount(camera) === 'ceiling' ? 'Trần' : 'Tường'} · FOV {camera.fov}° · H {Number(camera.height.toFixed(2))} m</span>
              {camera.target && <span className="camera-schedule-target" title={camera.target}>{camera.target}</span>}
            </span>
          </button>;
        })}
        {!cameras.length && <p className="camera-schedule-empty">Chưa có camera trên mặt bằng.</p>}
      </div>
    )}
  </aside>;
}
