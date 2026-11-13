import type { Score } from '../types';
import type { ViewMode } from './canvas/shared';

export interface Compare { before?: Score; manual: Score; live: Score; unweighted: Score | null; solveMs: number; renderMs: number; heatMs: number }
export interface RiskMetrics {
  lowPercent: number; mediumPercent: number; highPercent: number;
  highCoverage: number | null; highTotal: number; uncoveredHigh: number;
  firstUncovered: { r: number; c: number } | null;
}
const ok = (v: number, t: number) => (v >= t ? 'pass' : 'fail');

export function Scorecard({ d, preview, view, riskMetrics, onFocusHighUncovered }: {
  preview?: Score; d: Compare; view: ViewMode; riskMetrics: RiskMetrics; onFocusHighUncovered: () => void;
}) {
  const shown = preview ?? d.live;
  const cols: [string, Score | null][] = [...(d.before ? [['Trước tối ưu', d.before] as [string, Score]] : []), ['Thủ công 4 góc', d.manual], ['Hiện tại', d.live], ['Greedy không trọng số', d.unweighted]];
  const row = (label: string, f: (s: Score) => string, cls?: (s: Score) => string) => (
    <tr key={label}><th>{label}</th>{cols.map(([k, s]) => <td key={k} className={s && cls ? cls(s) : ''}>{s ? f(s) : '—'}</td>)}</tr>
  );
  return (
    <div className="panel">
      <div className="scorecard-heading">
        <div><span className="eyebrow">PHÂN TÍCH HIỆU SUẤT</span><h3>{preview ? 'Trước tối ưu' : 'Hiệu quả phương án'}</h3></div>
        <span className="live-indicator"><i /> {preview ? 'BẢN GỐC' : 'LIVE'}</span>
      </div>
      {d.before && <div className="comparison-summary"><div><span>Số camera · trước → sau</span><strong>{d.before.cams} → {d.live.cams}</strong></div><div><span>Điểm Σ W × DORI</span><strong>{d.before.weighted} → {d.live.weighted}</strong></div></div>}
      {view === 'risk' ? (
        <div className="risk-score-panel">
          <div className="risk-area-stats">
            {([
              ['Thấp', riskMetrics.lowPercent, 'low'],
              ['Vừa', riskMetrics.mediumPercent, 'medium'],
              ['Cao', riskMetrics.highPercent, 'high']
            ] as const).map(([label, percent, band]) => (
              <div className={`risk-area-stat ${band}`} key={band}>
                <span>{label}</span><strong>{percent}%</strong>
              </div>
            ))}
          </div>
          <div className="risk-coverage">
            <div><span>W cao được camera phủ</span><strong>{riskMetrics.highCoverage === null ? '—' : `${riskMetrics.highCoverage}%`}</strong></div>
            {riskMetrics.highCoverage !== null && (
              <div className="kpi-track" role="progressbar" aria-label="W cao được camera phủ" aria-valuenow={riskMetrics.highCoverage} aria-valuemin={0} aria-valuemax={100}>
                <span className={ok(riskMetrics.highCoverage, 80)} style={{ width: `${riskMetrics.highCoverage}%` }} />
              </div>
            )}
            <small>{riskMetrics.uncoveredHigh} ô W cao chưa được phủ / {riskMetrics.highTotal} ô</small>
          </div>
          <button className="focus-risk-button" disabled={!riskMetrics.firstUncovered} onClick={onFocusHighUncovered}>
            Chuyển đến vùng W cao chưa phủ
          </button>
          <div className="risk-weighted-score"><span>Σ W × DORI</span><strong>{d.live.weighted}</strong></div>
        </div>
      ) : view === 'dori' ? (
        <>
          <div className="kpi-overview">
            {([
              { label: 'Vùng đỏ · ≥250 PPM', value: shown.red, target: 95, count: shown.redCells },
              { label: 'Vùng vàng · ≥125 PPM', value: shown.yellow, target: 80, count: shown.yellowCells }
            ]).map(({ label, value, target, count }) => (
              <div className="kpi-tile" key={label}>
                <div className="kpi-label">{label}<span>Mục tiêu {target}%</span></div>
                <div className="kpi-value-row">
                  <strong className={count === 0 ? 'muted' : ok(value, target)}>{count === 0 ? '—' : <>{value}<small>%</small></>}</strong>
                  <span className={`kpi-state ${count === 0 ? 'muted' : ok(value, target)}`}>{count === 0 ? 'CHƯA CÓ VÙNG' : value >= target ? 'ĐẠT' : 'CẦN CẢI THIỆN'}</span>
                </div>
                {count !== 0 && <div className="kpi-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${value}% · mục tiêu ${target}%`}>
                  <span className={ok(value, target)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
                  <i style={{ left: `${target}%` }} />
                </div>}
              </div>
            ))}
          </div>
          <details className="score-details" open={Boolean(d.before)}><summary>So sánh phương án</summary><div className="scroll-x"><table aria-label="So sánh các chỉ số hiệu quả phương án">
            <thead><tr><th scope="col" aria-label="Chỉ số"></th>{cols.map(([k]) => <th key={k} scope="col">{k}</th>)}</tr></thead>
            <tbody>
              {row('Vùng Đỏ ≥ 250 PPM (KPI ≥ 95%)', (s) => s.redCells === 0 ? '—' : `${s.red}%`, (s) => ok(s.red, 95))}
              {row('Vùng vàng ≥ 125 PPM (KPI ≥ 80%)', (s) => s.yellowCells === 0 ? '—' : `${s.yellow}%`, (s) => ok(s.yellow, 80))}
              {row('PPM thấp nhất vùng Đỏ', (s) => String(s.redMinPpm))}
              {row('Tổng điểm Σ W × DORI', (s) => String(s.weighted))}
              {row('Số camera', (s) => String(s.cams))}
            </tbody>
          </table></div></details>
        </>
      ) : <p className="muted">Chọn lớp DORI hoặc Rủi ro để xem số liệu tương ứng.</p>}
      <details className="score-details performance-details"><summary>Hiệu năng tính toán</summary>
      <p className="muted">Giải + vẽ lại heatmap: <b className={d.solveMs && d.solveMs + d.renderMs < 2000 ? 'pass' : ''}>{d.solveMs ? `${(d.solveMs + d.renderMs).toFixed(0)} ms` : '—'}</b> (KPI &lt; 2000 ms) · tính lưới: {d.live.ms} ms</p>
      <p className="muted">Vẽ heatmap (lần cuối): <b className={d.heatMs && d.heatMs <= 200 ? 'pass' : ''}>{d.heatMs ? `${d.heatMs.toFixed(1)} ms` : '—'}</b> (KPI ≤ 200 ms)</p>
      </details>
    </div>
  );
}
