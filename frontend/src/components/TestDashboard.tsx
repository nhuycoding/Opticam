import { useState } from 'react';
import type { Layout } from '../types';
import {
  runFrontendUiTests,
  runIntegrationUiTests,
  type UiTestGroup,
  type UiTestResult,
} from '../core/uiTestRunner';

type RunningSuite = UiTestGroup | 'all' | null;

export function TestDashboard({ layout }: { layout: Layout }) {
  const [results, setResults] = useState<UiTestResult[]>([]);
  const [running, setRunning] = useState<RunningSuite>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const run = async (suite: Exclude<RunningSuite, null>) => {
    if (running) return;
    setRunning(suite);
    setStartedAt(new Date().toLocaleString());
    setResults([]);
    try {
      const frontend = suite === 'integration' ? [] : await runFrontendUiTests(layout);
      const integration = suite === 'frontend' ? [] : await runIntegrationUiTests(layout);
      setResults([...frontend, ...integration]);
    } finally {
      setRunning(null);
    }
  };

  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.length - passed;
  const totalMs = results.reduce((sum, result) => sum + result.durationMs, 0);

  return (
    <section className="test-dashboard" aria-labelledby="test-dashboard-title">
      <div className="panel test-intro">
        <div>
          <h2 id="test-dashboard-title">Kiểm thử OptiCam</h2>
          <p className="muted">
            Kiểm tra logic frontend và tích hợp backend trên layout đang mở: <b>{layout.name}</b>
            {' '}({layout.widthM} × {layout.heightM} m, {layout.cameras.length} camera).
          </p>
          <p className="muted small">
            Đây là self-test chạy trong trình duyệt, không thay thế Vitest, pytest hoặc Playwright.
          </p>
        </div>
        <div className="row wrap test-actions">
          <button className="primary" disabled={running !== null} onClick={() => void run('all')}>
            Chạy tất cả
          </button>
          <button disabled={running !== null} onClick={() => void run('frontend')}>
            Chạy test frontend
          </button>
          <button disabled={running !== null} onClick={() => void run('integration')}>
            Test tích hợp API
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="test-summary">
          <h3>Kết quả chạy</h3>
          {running ? <span className="muted" role="status">Đang chạy kiểm thử…</span> : results.length > 0 ? (
            <span className={failed ? 'fail' : 'pass'}>
              {passed}/{results.length} đạt{failed ? ` · ${failed} lỗi` : ''} · {totalMs.toFixed(0)} ms
            </span>
          ) : <span className="muted">Chưa chạy test</span>}
        </div>
        {startedAt && <p className="muted small">Bắt đầu lúc {startedAt}</p>}
        {results.length > 0 && (
          <div className="scroll-x">
            <table className="test-results">
              <thead>
                <tr><th>Trạng thái</th><th>Nhóm</th><th>Kiểm thử</th><th>Thời gian</th><th>Chi tiết</th></tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.id}>
                    <td className={result.status === 'passed' ? 'pass' : 'fail'}>{result.status === 'passed' ? 'ĐẠT' : 'LỖI'}</td>
                    <td>{result.group === 'frontend' ? 'Frontend' : 'Tích hợp API'}</td>
                    <td>{result.name}</td>
                    <td>{result.durationMs.toFixed(1)} ms</td>
                    <td>{result.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Phạm vi kiểm thử</h3>
        <ul className="test-scope">
          <li>Frontend: FOV/PPM cảm biến, phân loại DORI, hình học camera/vật cản.</li>
          <li>Frontend: import/export layout, tính BOM cáp và nguồn PoE, heatmap/scorecard.</li>
          <li>Tích hợp: trạng thái backend và request tối ưu layout với giới hạn 3 camera.</li>
        </ul>
        <p className="muted small">
          API tích hợp cần backend đang hoạt động qua proxy Vite. Nếu API lỗi, các dòng test sẽ hiện nguyên nhân.
        </p>
      </div>
    </section>
  );
}
