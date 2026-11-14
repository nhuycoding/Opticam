import { Component, type ReactNode } from 'react';

export function SceneFailure({ onEditPlan }: { onEditPlan: () => void }) {
  return <div className="three-fallback" role="alert"><strong>Không thể hiển thị 3D trên phiên này.</strong><p>Hãy tải lại trang và kiểm tra WebGL trong trình duyệt.</p><button onClick={onEditPlan}>Mở mặt bằng 2.5D</button></div>;
}

export class SceneBoundary extends Component<{ children: ReactNode; onEditPlan: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error('OptiCam 3D', error); }
  render() { return this.state.failed ? <SceneFailure onEditPlan={this.props.onEditPlan} /> : this.props.children; }
}
