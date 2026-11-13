import type { MinimumCameraSolution } from './optimizer';
import type { SolverRequest } from './optimizer.worker';

export function solveLocally(request: SolverRequest, signal?: AbortSignal): Promise<MinimumCameraSolution> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Đã hủy tối ưu.', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Đã hủy tối ưu.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error('Không thể khởi chạy bộ tối ưu trên trình duyệt.'));
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
