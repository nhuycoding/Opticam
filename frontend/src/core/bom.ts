import type { Layout } from '../types';
import { center } from './geometry';

export const CAMERA_UNIT_COST = 1_250_000;  // VNĐ / camera IP PoE
export const INFRA_COST = 1_500_000;        // switch PoE + NVR + phụ kiện
export const DEFAULT_CAMERA_POWER_W = 12;   // giả định camera IP cố định trong nhà; xác nhận datasheet
export const POE_POWER_RESERVE = 1.2;       // dự phòng 20% công suất PoE
const SLACK = 3, MARGIN = 1.1;              // dây dư/thả tại đầu cuối, hệ số hao hụt

export interface BomRow {
  id: string; x: number; y: number; height: number; pan: number; fov: number;
  target: string; model: string; cableM: number; powerW: number;
}

/** NVR đặt tại POS; cáp theo Manhattan cộng cao độ camera, 3 m dư và 10% hao hụt. */
export function buildBom(l: Layout) {
  const pos = l.obstacles.find((o) => o.type === 'pos');
  const [nx, ny] = pos ? center(pos) : [0, 0];
  const rows: BomRow[] = l.cameras.map((c) => {
    const powerW = c.powerW ?? DEFAULT_CAMERA_POWER_W;
    if (!Number.isFinite(powerW) || powerW <= 0) {
      throw new RangeError(`Công suất camera ${c.id} phải là số hữu hạn lớn hơn 0 W.`);
    }
    return {
      id: c.id, x: c.x, y: c.y, height: c.height, pan: c.pan, fov: c.fov,
      target: c.target ?? 'Giám sát bổ sung', model: c.model ?? 'Dome IP 2MP',
      cableM: Math.ceil((Math.abs(c.x - nx) + Math.abs(c.y - ny) + c.height + SLACK) * MARGIN),
      powerW,
    };
  });
  const cable = rows.reduce((s, r) => s + r.cableM, 0);
  const totalCameraPowerW = Math.round(rows.reduce((sum, row) => sum + row.powerW, 0) * 10) / 10;
  return {
    rows,
    totalCameras: rows.length,
    totalCableM: cable,
    totalCameraPowerW,
    recommendedPoeBudgetW: Math.ceil(totalCameraPowerW * POE_POWER_RESERVE),
    totalCostVnd: rows.length * CAMERA_UNIT_COST + (rows.length ? INFRA_COST : 0),
    poePorts: rows.length,
  };
}

export function bomToCsv(l: Layout): string {
  const b = buildBom(l);
  const head = ['Ma cam', 'X (m)', 'Y (m)', 'Cao do (m)', 'Goc xoay (deg)', 'FOV (deg)', 'Muc tieu', 'Model', 'Cap du kien (m)', 'Cong suat (W)'];
  const lines = b.rows.map((r) => [r.id, r.x, r.y, r.height, r.pan, r.fov, r.target, r.model, r.cableM, r.powerW].map((v) => `"${v}"`).join(','));
  return '\uFEFF' + [
    head.join(','),
    ...lines,
    ['TONG', '', '', '', '', '', '', '', b.totalCableM, b.totalCameraPowerW].map((v) => `"${v}"`).join(','),
    ['Ngan sach PoE de xuat (W)', '', '', '', '', '', '', '', '', b.recommendedPoeBudgetW].map((v) => `"${v}"`).join(','),
    ['Du phong nguon PoE', '', '', '', '', '', '', '', '', '20%'].map((v) => `"${v}"`).join(','),
  ].join('\r\n');
}
