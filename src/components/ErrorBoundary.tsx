import { Component, type ReactNode } from 'react';
import { ArrowLeft, RefreshCw, Zap } from 'lucide-react';

/** Keep a recoverable screen visible even if a component cannot render. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="recovery-screen" role="alert">
      <span className="brand-mark"><Zap size={25} fill="currentColor" /></span>
      <h1>화면을 다시 불러와 주세요</h1>
      <p>화면을 표시하는 중 문제가 생겼어요.<br />저장된 프로젝트와 작업 기록은 삭제하지 않았습니다.</p>
      <div>
        <button className="button secondary" onClick={() => { window.location.hash = 'home'; window.location.reload(); }}><ArrowLeft size={16} />대시보드로 돌아가기</button>
        <button className="button primary" onClick={() => window.location.reload()}><RefreshCw size={16} />다시 불러오기</button>
      </div>
    </main>;
  }
}
