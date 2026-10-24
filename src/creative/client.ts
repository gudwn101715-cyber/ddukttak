import { isPortable } from '../offline/mode';
import { artifactSchema, createWorkInputSchema, workSchema } from './model';
import type { Artifact, CreateWorkInput, Work, WorkVersion } from './model';
import { createStarter } from './starters';
import { renderArtifact } from './runtime';

export interface ConnectionStatus {
  configured: boolean;
  verified: boolean;
  model: string;
  baseUrl: string;
  source: 'environment' | 'session' | 'none';
  message: string;
}
export interface ConnectionInput { apiKey?: string; model: string; baseUrl?: string }

const offlineStatus = (): ConnectionStatus => ({
  configured: false, verified: false, model: 'gpt-4.1', baseUrl: 'https://api.openai.com/v1', source: 'none',
  message: '이 파일은 설치 없이 실행하는 체험판입니다. 예제 작품과 직접 수정을 사용할 수 있으며, 실제 AI 생성은 전체 앱을 실행한 뒤 API를 연결해 사용합니다.',
});
const AI_OFFLINE_MESSAGE = '이 파일에서는 AI 서버에 연결할 수 없습니다. 전체 소스의 실행 도구로 앱을 시작하고 ‘AI 연결’에서 API를 연결해 주세요. 현재 작품은 그대로 보관됩니다.';
const STORAGE_KEY = 'ddukttak-creative-works-v1';
interface OfflineWorkspace { format: 1; works: Work[] }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uuid = (): string => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID() : `work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const now = () => new Date().toISOString();
const version = (artifact: Artifact, label: string): WorkVersion => ({ id: uuid(), label, createdAt: now(), artifact: clone(artifact) });

function readOffline(): OfflineWorkspace {
  let raw: string | null;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { throw new Error('브라우저 저장소에 접근할 수 없습니다. 일반 브라우저 창에서 다시 열어 주세요.'); }
  if (!raw) return { format: 1, works: [] };
  try {
    const data = JSON.parse(raw) as Partial<OfflineWorkspace>;
    if (data.format !== 1 || !Array.isArray(data.works)) throw new Error('invalid');
    return { format: 1, works: data.works.map((work) => workSchema.parse(work)) };
  } catch {
    throw new Error('저장된 작품을 읽지 못했습니다. 기존 저장 내용은 유지했습니다. 원래 사용한 브라우저에서 다시 열어 주세요.');
  }
}
function writeOffline(workspace: OfflineWorkspace): void {
  const serialized = JSON.stringify(workspace);
  try { localStorage.setItem(STORAGE_KEY, serialized); }
  catch { throw new Error('브라우저 저장 공간이 부족하거나 저장이 차단되어 변경을 보관하지 못했습니다. 기존 작품은 유지했습니다. 실행 파일을 내려받은 뒤 저장 공간을 확보해 주세요.'); }
}
function findOffline(workspace: OfflineWorkspace, id: string): Work {
  const work = workspace.works.find((item) => item.id === id);
  if (!work) throw new Error('작품을 찾지 못했습니다. 작품 목록을 새로고침해 주세요.');
  return work;
}
function assertCurrent(work: Work, baseVersionId: string): void {
  if (work.versions.at(-1)?.id !== baseVersionId) {
    throw new Error('다른 변경 사항이 먼저 저장되었습니다. 작품을 다시 열어 최신 버전을 확인한 뒤 수정해 주세요.');
  }
}
function checkpoint(work: Work, artifact: Artifact, label: string): void {
  work.artifact = clone(artifact);
  work.title = artifact.title;
  work.description = artifact.description;
  work.updatedAt = now();
  work.versions.push(version(artifact, label));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 125_000);
  try {
    const response = await fetch(`/api${path}`, {
      ...init, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
      credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown };
      const message = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : '';
      throw new Error(message || '요청을 완료하지 못했습니다. 서버 연결을 확인한 뒤 다시 시도해 주세요.');
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('서버 응답이 늦어 요청을 중단했습니다. 저장된 작품을 확인한 뒤 다시 시도해 주세요.');
    if (error instanceof TypeError) throw new Error('앱 서버에 연결할 수 없습니다. 실행 도구가 켜져 있는지 확인해 주세요.');
    throw error;
  } finally { clearTimeout(timeout); }
}
const idPath = (id: string) => `/works/${encodeURIComponent(id)}`;
const remoteClient = {
  status: () => request<ConnectionStatus>('/creative/status'),
  connect: (input: ConnectionInput) => request<ConnectionStatus>('/creative/connect', { method: 'POST', body: JSON.stringify(input) }),
  disconnect: () => request<ConnectionStatus>('/creative/connect', { method: 'DELETE' }),
  list: () => request<Work[]>('/works'),
  create: (input: CreateWorkInput) => request<Work>('/works', { method: 'POST', body: JSON.stringify(input) }),
  edit: (id: string, prompt: string, baseVersionId: string) => request<Work>(`${idPath(id)}/edit`, { method: 'POST', body: JSON.stringify({ prompt, baseVersionId }) }),
  save: (id: string, artifact: Artifact, baseVersionId: string, label?: string) => request<Work>(`${idPath(id)}/artifact`, { method: 'PATCH', body: JSON.stringify({ artifact, baseVersionId, label }) }),
  restore: (id: string, versionId: string, baseVersionId: string) => request<Work>(`${idPath(id)}/restore`, { method: 'POST', body: JSON.stringify({ versionId, baseVersionId }) }),
  remove: (id: string) => request<void>(idPath(id), { method: 'DELETE' }),
  repair: (id: string, error: string, baseVersionId: string) => request<Work>(`${idPath(id)}/repair`, { method: 'POST', body: JSON.stringify({ error, baseVersionId }) }),
  exportHtml: (work: Work): string => renderArtifact(work.artifact),
};
const offlineClient: typeof remoteClient = {
  status: async () => offlineStatus(),
  connect: async () => { throw new Error(AI_OFFLINE_MESSAGE); },
  disconnect: async () => offlineStatus(),
  list: async () => clone(readOffline().works).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  create: async (rawInput) => {
    const input = createWorkInputSchema.parse(rawInput);
    if (input.mode === 'ai') throw new Error(AI_OFFLINE_MESSAGE);
    const artifact = artifactSchema.parse(createStarter(input.kind, input.title, input.prompt));
    const createdAt = now();
    const work = workSchema.parse({
      id: uuid(), title: artifact.title, description: artifact.description, kind: input.kind, artifact,
      versions: [version(artifact, '움직이는 예제로 시작')],
      messages: [{ id: uuid(), role: 'assistant', content: '직접 실행할 수 있는 예제 작품을 만들었습니다. 이 작품은 AI 생성 결과가 아닙니다. 설정을 바꾸거나 전체 앱에서 AI를 연결해 원하는 기능을 더해 보세요.', createdAt }],
      createdAt, updatedAt: createdAt,
    });
    // Read and commit synchronously so two clicks cannot overwrite another completed mutation.
    const workspace = readOffline();
    workspace.works.push(work);
    writeOffline(workspace);
    return clone(work);
  },
  edit: async () => { throw new Error(AI_OFFLINE_MESSAGE); },
  save: async (id, rawArtifact, baseVersionId, label) => {
    const artifact = artifactSchema.parse(rawArtifact);
    const workspace = readOffline();
    const work = findOffline(workspace, id);
    assertCurrent(work, baseVersionId);
    if (JSON.stringify(work.artifact) !== JSON.stringify(artifact)) {
      checkpoint(work, artifact, (label?.trim() || '직접 수정').slice(0, 80));
      work.messages.push({ id: uuid(), role: 'assistant', content: '수정 내용을 저장했습니다. 변경 기록에서 이전 버전으로 돌아갈 수 있습니다.', createdAt: now() });
      writeOffline(workspace);
    }
    return clone(work);
  },
  restore: async (id, versionId, baseVersionId) => {
    const workspace = readOffline();
    const work = findOffline(workspace, id);
    assertCurrent(work, baseVersionId);
    const previous = work.versions.find((item) => item.id === versionId);
    if (!previous) throw new Error('복원할 버전을 찾지 못했습니다.');
    checkpoint(work, previous.artifact, `복원: ${previous.label}`.slice(0, 80));
    writeOffline(workspace);
    return clone(work);
  },
  remove: async (id) => {
    const workspace = readOffline();
    findOffline(workspace, id);
    workspace.works = workspace.works.filter((item) => item.id !== id);
    writeOffline(workspace);
  },
  repair: async () => { throw new Error(AI_OFFLINE_MESSAGE); },
  exportHtml: (work) => renderArtifact(work.artifact),
};

/** Runtime selection is deliberate: a portable preview never pretends to have an AI server. */
export const creativeClient = isPortable() ? offlineClient : remoteClient;
