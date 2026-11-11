import type { Score } from '../types';
import type { ViewMode } from './canvas/shared';

export interface Compare { manual: Score; live: Score; unweighted: Score | null; solveMs: number; renderMs: number; heatMs: number }
export interface RiskMetrics {
  lowPercent: number; mediumPercent: number; highPercent: number;
  highCoverage: number | null; highTotal: number; uncoveredHigh: number;
  firstUncovered: { r: number; c: number } | null;
}
const ok = (v: number, t: number) => (v >= t ? 'pass' : 'fail');

export function Scorecard({ d, view, riskMetrics, onFocusHighUncovered }: {
  d: Compare; view: ViewMode; riskMetrics: RiskMetrics; onFocusHighUncovered: () => void;
}) {
  const cols: [string, Score | null][] = [['Thủ công 4 góc', d.manual], ['Hiện tại (live)', d.live], ['Greedy không trọng số', d.unweighted]];
  const row = (label: string, f: (s: Score) => string, cls?: (s: Score) => string) => (
    <tr key={label}><th>{label}</th>{cols.map(([k, s]) => <td key={k} className={s && cls ? cls(s) : ''}>{s ? f(s) : '—'}</td>)}</tr>
  );
  return (
    <div className="panel">
      <div className="scorecard-heading">
        <div><span className="eyebrow">PHÂN TÍCH HIỆU SUẤT</span><h3>Hiệu quả phương án</h3></div>
        <span className="live-indicator"><i /> LIVE</span>
      </div>
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
              { label: 'Vùng đỏ · ≥250 PPM', value: d.live.red, target: 95 },
              { label: 'Vùng vàng · ≥125 PPM', value: d.live.yellow, target: 80 }
            ]).map(({ label, value, target }) => (
              <div className="kpi-tile" key={label}>
                <div className="kpi-label">{label}<span>Mục tiêu {target}%</span></div>
                <div className="kpi-value-row">
                  <strong className={ok(value, target)}>{value}<small>%</small></strong>
                  <span className={`kpi-state ${ok(value, target)}`}>{value >= target ? 'ĐẠT' : 'CẦN CẢI THIỆN'}</span>
                </div>
                <div className="kpi-track" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${value}% · mục tiêu ${target}%`}>
                  <span className={ok(value, target)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
                  <i style={{ left: `${target}%` }} />
                </div>
              </div>
            ))}
          </div>
          <table aria-label="So sánh các chỉ số hiệu quả phương án">
            <thead><tr><th scope="col" aria-label="Chỉ số"></th>{cols.map(([k]) => <th key={k} scope="col">{k}</th>)}</tr></thead>
            <tbody>
              {row('Vùng Đỏ ≥ 250 PPM (KPI ≥ 95%)', (s) => `${s.red}%`, (s) => ok(s.red, 95))}
              {row('Hành lang ≥ 125 PPM (KPI ≥ 80%)', (s) => `${s.yellow}%`, (s) => ok(s.yellow, 80))}
              {row('PPM thấp nhất vùng Đỏ', (s) => String(s.redMinPpm))}
              {row('Tổng điểm Σ W × DORI', (s) => String(s.weighted))}
              {row('Số camera', (s) => String(s.cams))}
            </tbody>
          </table>
        </>
      ) : <p className="muted">Chọn lớp DORI hoặc Rủi ro để xem số liệu tương ứng.</p>}
      <p className="muted">Giải + vẽ lại heatmap: <b className={d.solveMs && d.solveMs + d.renderMs < 2000 ? 'pass' : ''}>{d.solveMs ? `${(d.solveMs + d.renderMs).toFixed(0)} ms` : '—'}</b> (KPI &lt; 2000 ms) · tính lưới: {d.live.ms} ms</p>
      <p className="muted">Vẽ heatmap (lần cuối): <b className={d.heatMs && d.heatMs <= 200 ? 'pass' : ''}>{d.heatMs ? `${d.heatMs.toFixed(1)} ms` : '—'}</b> (KPI ≤ 200 ms)</p>
    </div>
  );
}
