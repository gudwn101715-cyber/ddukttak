import { useEffect, useRef, useState, type FormEvent } from 'react';
import './ConnectionPanel.css';
import { CheckCircle2, ChevronDown, ChevronUp, KeyRound, LoaderCircle, Plug, ShieldCheck, Unplug, X } from 'lucide-react';
import { isPortable } from '../offline/mode';
import { creativeClient, type ConnectionStatus } from './client';

export interface ConnectionPanelProps {
  status: ConnectionStatus | null;
  onChange: (status: ConnectionStatus) => void;
  onClose: () => void;
}

export default function ConnectionPanel({ status, onChange, onClose }: ConnectionPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(status?.model || 'gpt-4.1');
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl || 'https://api.openai.com/v1');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const portable = isPortable();
  const dialogRef = useRef<HTMLElement>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const busyRef = useRef(busy);
  const onCloseRef = useRef(onClose);
  busyRef.current = busy;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (portable ? closeRef.current : apiKeyRef.current)?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (!busyRef.current) { event.preventDefault(); onCloseRef.current(); }
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
      )).filter((control) => control.getAttribute('tabindex') !== '-1');
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [portable]);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setSuccess('');
    const input = { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), model: model.trim(), baseUrl: baseUrl.trim() };
    // The key is used only in this request, never in localStorage, a URL, or a project.
    setApiKey('');
    try {
      const result = await creativeClient.connect(input);
      onChange(result);
      setSuccess(result.verified ? '실제 AI 응답을 확인했습니다. 이제 원하는 작품을 설명해 주세요.' : result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 연결을 확인하지 못했습니다.');
    } finally { setBusy(false); }
  }
  async function disconnect() {
    if (busy) return;
    setBusy(true); setError(''); setSuccess(''); setApiKey('');
    try {
      const result = await creativeClient.disconnect();
      onChange(result);
      setSuccess(result.source === 'environment'
        ? '입력했던 임시 연결을 지웠습니다. 서버 환경변수의 연결 설정은 남아 있습니다.'
        : '임시 연결 정보를 지웠습니다. 저장된 작품은 그대로 사용할 수 있습니다.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '연결 해제에 실패했습니다.'); }
    finally { setBusy(false); }
  }

  return <div className="creative-modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="connection-panel creative-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
      <div className="connection-heading">
        <span className="connection-icon"><Plug size={24} /></span>
        <button ref={closeRef} type="button" className="creative-icon-button" onClick={onClose} disabled={busy} aria-label="AI 연결 창 닫기"><X size={20} /></button>
      </div>
      <p className="creative-eyebrow">실제 AI로 작품 만들기</p>
      <h2 id="connection-title">아이디어를 구현할 AI를 연결하세요</h2>
      <p className="connection-intro">AI가 HTML·CSS·JavaScript 코드를 만들어 게임의 규칙과 기능까지 바꿉니다. 예제는 연결 없이도 실행할 수 있어요.</p>
      <div className={`connection-status ${status?.verified ? 'is-connected' : ''}`}>
        {status?.verified ? <CheckCircle2 size={19} /> : <KeyRound size={19} />}
        <div><strong>{portable ? '설치 없는 체험판 · AI 미연결' : status?.verified ? '실제 AI 응답 확인됨' : status?.configured ? '연결 설정 있음 · 응답 확인 필요' : 'AI가 아직 연결되지 않았습니다'}</strong>
          <p>{status?.message || 'API를 연결하고 응답을 확인한 뒤 AI 제작을 시작할 수 있습니다.'}</p></div>
      </div>
      <p className="connection-key-help">키가 없다면 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI API 키 만들기</a>에서 발급받으세요. 키 값은 채팅에 보내지 마세요.</p>
      {portable ? <div className="connection-portable-guide">
        <h3>AI를 사용하려면 전체 앱을 실행해 주세요</h3>
        <ol>
          <li>내려받은 소스 폴더의 <strong>tools</strong>를 엽니다.</li>
          <li>Windows는 <strong>start-windows.cmd</strong>, macOS는 <strong>start-macos.command</strong>를 실행합니다. Node.js 24 LTS를 권장하며, 22 이상이 필요합니다.</li>
          <li>실행된 앱에서 <strong>AI 연결</strong>을 열고 API 키와 모델을 입력한 뒤 응답을 확인합니다.</li>
        </ol>
        <p>이 HTML 파일에는 AI 서버가 포함되어 있지 않습니다. 여기서 만든 실행 파일은 인터넷 연결 없이도 계속 사용할 수 있습니다. 체험판 작품 기록과 전체 앱의 작품 기록은 별도로 저장됩니다.</p>
        <a className="creative-button creative-button-secondary" href="https://github.com/gudwn101715-cyber/ddukttak/tree/codex-ddukttak-preview#readme" target="_blank" rel="noreferrer">전체 앱 실행 안내</a>
      </div> : <form className="connection-form" onSubmit={connect} autoComplete="off">
        <label htmlFor="creative-api-key">API 키 {status?.configured && <span>새 키를 입력하지 않으면 서버의 기존 설정을 검사합니다</span>}</label>
        <input ref={apiKeyRef} id="creative-api-key" type="password" name="creative-api-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={status?.configured ? '기존 연결로 검사하거나 새 API 키 입력' : '사용할 API 키 입력'} spellCheck={false} required={!status?.configured} disabled={busy} />
        <label htmlFor="creative-ai-model">모델 이름</label>
        <input id="creative-ai-model" name="creative-ai-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="예: gpt-4.1" maxLength={120} required disabled={busy} />
        <p className="connection-help">API 이용 요금은 연결한 제공업체에서 청구됩니다. ChatGPT 구독과 API 사용 요금은 별개입니다.</p>
        <button className="connection-advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />} 다른 OpenAI 호환 API 사용</button>
        {advanced && <div className="connection-advanced">
          <label htmlFor="creative-ai-base">API 기본 주소</label>
          <input id="creative-ai-base" type="url" name="creative-ai-base" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" required disabled={busy} />
          <p className="connection-help">신뢰하는 제공업체의 HTTPS 주소를 입력하세요. 키가 이 주소로 전송됩니다. OpenAI 호환 Chat Completions와 JSON 구조 출력을 지원해야 합니다.</p>
        </div>}
        <div className="connection-security"><ShieldCheck size={18} /><p>키는 서버 메모리에만 보관하며 서버를 종료하면 사라집니다. 브라우저 저장소·작품·Git 파일에는 저장하지 않습니다. 환경변수 <code>DDUK_AI_API_KEY</code>로 설정할 수도 있습니다.</p></div>
        <div className="connection-actions">
          <button className="creative-button creative-button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle size={17} className="creative-spin" /> : <Plug size={17} />}{busy ? '실제 AI 응답 확인 중…' : '연결하고 응답 확인'}</button>
          {status?.source === 'session' && <button className="creative-button creative-button-secondary" type="button" onClick={disconnect} disabled={busy}><Unplug size={16} />임시 연결 지우기</button>}
        </div>
      </form>}
      {error && <div className="creative-alert creative-alert-error" role="alert">{error}</div>}
      {success && <div className="creative-alert creative-alert-success" role="status">{success}</div>}
    </section>
  </div>;
}
