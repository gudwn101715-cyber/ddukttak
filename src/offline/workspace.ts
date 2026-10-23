import type { CheckResult, RuntimeStatus } from '../api';
import { editSchema, generateSchema } from '../lib/generator';
import { defaultAppContent, featureKeys, validateSchema } from '../lib/schema';
import type { AppSchema, AppVersion, ChatMessage, GenerateInput, Project } from '../lib/schema';
import { renderAppHtml } from '../lib/renderer';

const STORAGE_KEY = 'ddukttak-portable-workspace-v1';
interface Publication {
  projectId: string;
  versionId: string;
  schema: AppSchema;
  publishedAt: string;
}
interface Workspace {
  format: 1;
  projects: Project[];
  publications: Record<string, Publication>;
}

export class PortableWorkspaceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'PortableWorkspaceError';
  }
}

const emptyWorkspace = (): Workspace => ({ format: 1, projects: [], publications: {} });
const now = () => new Date().toISOString();
let fallbackId = 0;
function id(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* Some file-based browsers expose the method without permitting it. */ }
  fallbackId++;
  return `local-${Date.now().toString(36)}-${fallbackId.toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

const readableStorageError = () => new PortableWorkspaceError(503,
  '브라우저 저장 공간에 접근할 수 없어요. Chrome 또는 Edge에서 파일을 열고 브라우저의 파일·사이트 저장 허용 설정을 확인해 주세요. 기존 작업은 덮어쓰지 않았습니다.');
const invalidWorkspaceError = () => new PortableWorkspaceError(409,
  '저장된 작업을 읽을 수 없어요. 기존 데이터는 덮어쓰지 않았습니다. 브라우저 데이터를 지우지 말고 다른 브라우저에서 새 작업을 시작하거나 지원을 요청해 주세요.');

function storage(): Storage {
  try {
    const value = globalThis.localStorage;
    if (!value || typeof value.getItem !== 'function' || typeof value.setItem !== 'function') throw readableStorageError();
    return value;
  } catch { throw readableStorageError(); }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,120}$/.test(value);
}
function timestamp(value: unknown): value is string {
  return nonempty(value) && Number.isFinite(Date.parse(value));
}
function validProject(value: unknown): value is Project {
  if (!record(value) || !identifier(value.id) || !nonempty(value.name) || !nonempty(value.description)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
    || !Array.isArray(value.versions) || value.versions.length === 0 || !Array.isArray(value.messages)) return false;
  const schema = validateSchema(value.schema);
  if (value.kind !== schema.kind) return false;
  if (value.publishedSlug !== undefined && !identifier(value.publishedSlug)) return false;
  if (value.publishedVersionId !== undefined && !identifier(value.publishedVersionId)) return false;
  const versionIds = new Set<string>();
  for (const version of value.versions) {
    if (!record(version) || !identifier(version.id) || versionIds.has(version.id)
      || !nonempty(version.label) || !timestamp(version.createdAt)) return false;
    versionIds.add(version.id);
    validateSchema(version.schema);
  }
  if (value.publishedVersionId !== undefined && !versionIds.has(value.publishedVersionId as string)) return false;
  for (const message of value.messages) {
    if (!record(message) || !identifier(message.id) || !nonempty(message.content)
      || !timestamp(message.createdAt) || !['user', 'assistant'].includes(message.role as string)) return false;
  }
  return true;
}

/** Never replace malformed stored work with an empty workspace. */
function loadWorkspace(): Workspace {
  let serialized: string | null;
  try { serialized = storage().getItem(STORAGE_KEY); } catch { throw readableStorageError(); }
  if (serialized === null) return emptyWorkspace();
  try {
    const workspace: unknown = JSON.parse(serialized);
    if (!record(workspace) || workspace.format !== 1 || !Array.isArray(workspace.projects) || !record(workspace.publications)) throw invalidWorkspaceError();
    const projectIds = new Set<string>();
    for (const project of workspace.projects) {
      if (!validProject(project) || projectIds.has(project.id)) throw invalidWorkspaceError();
      projectIds.add(project.id);
    }
    for (const [slug, snapshot] of Object.entries(workspace.publications)) {
      if (!identifier(slug) || !record(snapshot) || !identifier(snapshot.projectId) || !projectIds.has(snapshot.projectId)
        || !identifier(snapshot.versionId) || !timestamp(snapshot.publishedAt)) throw invalidWorkspaceError();
      validateSchema(snapshot.schema);
    }
    return workspace as unknown as Workspace;
  } catch { throw invalidWorkspaceError(); }
}

function saveWorkspace(workspace: Workspace): void {
  // Native Storage.setItem is atomic: a quota/security failure leaves the previous value intact.
  const serialized = JSON.stringify(workspace);
  try { storage().setItem(STORAGE_KEY, serialized); }
  catch {
    throw new PortableWorkspaceError(507,
      '브라우저 저장 공간에 작업을 저장하지 못했어요. 사진 용량을 줄이거나 기존 앱을 HTML로 내려받은 뒤 다시 시도해 주세요. 기존 저장 내용은 유지됩니다.');
  }
}

// Each operation reloads the latest committed state. A rejected operation cannot poison the queue.
let mutations: Promise<void> = Promise.resolve();
function mutate<T>(change: (workspace: Workspace) => T): Promise<T> {
  const operation = mutations.then(() => {
    const workspace = loadWorkspace();
    const result = change(workspace);
    saveWorkspace(workspace);
    return clone(result);
  });
  mutations = operation.then(() => undefined, () => undefined);
  return operation;
}
async function read<T>(select: (workspace: Workspace) => T): Promise<T> {
  await mutations;
  return clone(select(loadWorkspace()));
}
function findProject(workspace: Workspace, projectId: string): Project {
  const project = workspace.projects.find(project => project.id === projectId);
  if (!project) throw new PortableWorkspaceError(404, '프로젝트를 찾을 수 없어요. 목록을 새로고침해 주세요.');
  return project;
}
function version(schema: AppSchema, label: string): AppVersion {
  return { id: id(), label, createdAt: now(), schema: clone(schema) };
}
function message(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: id(), role, content, createdAt: now() };
}
function checkpoint(project: Project, schema: AppSchema, label: string): void {
  project.schema = clone(schema);
  project.name = schema.name;
  project.description = schema.description;
  project.kind = schema.kind;
  // Ensure the visible order remains deterministic for rapid consecutive edits.
  project.updatedAt = new Date(Math.max(Date.now(), Date.parse(project.updatedAt) + 1)).toISOString();
  project.versions.push(version(schema, label));
}

function createInput(value: GenerateInput): GenerateInput {
  if (!record(value) || Object.keys(value).some(key => !['name', 'description', 'kind', 'style', 'features'].includes(key))) {
    throw new PortableWorkspaceError(400, '앱 이름·설명·종류·디자인 설정을 확인해 주세요.');
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const description = typeof value.description === 'string' ? value.description.trim() : '';
  const style = value.style ?? 'warm';
  const features = value.features ?? [];
  if (!name || name.length > 80 || description.length < 3 || description.length > 2000
    || !['landing', 'booking', 'portfolio', 'store'].includes(value.kind as string)
    || !['warm', 'minimal', 'bold', 'natural'].includes(style as string)
    || !Array.isArray(features) || features.length > 6
    || features.some(feature => !featureKeys.includes(feature))) {
    throw new PortableWorkspaceError(400, '이름은 80자 이내, 설명은 3~2,000자로 입력하고 앱 종류와 기능을 확인해 주세요.');
  }
  return { name, description, kind: value.kind, style, features: [...new Set(features)] } as GenerateInput;
}
function safeSchema(value: unknown): AppSchema {
  try { return validateSchema(value); }
  catch (error) {
    throw new PortableWorkspaceError(400, error instanceof Error ? error.message : '앱 설정을 확인해 주세요.');
  }
}

type BlobEntry = { key: string; url: string };
const exportBlobs = new Map<string, BlobEntry>();
const publicationBlobs = new Map<string, BlobEntry>();
function revokeBlob(url: string): void {
  try { URL.revokeObjectURL(url); } catch { /* Cleanup must not turn a committed save into an apparent failure. */ }
}
function blobUrl(cache: Map<string, BlobEntry>, projectId: string, key: string, schema: AppSchema): string {
  const previous = cache.get(projectId);
  if (previous?.key === key) return previous.url;
  const html = renderAppHtml(safeSchema(schema));
  let url: string;
  try { url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' })); }
  catch { throw new PortableWorkspaceError(503, '실행 파일을 만들지 못했어요. 최신 Chrome 또는 Edge에서 다시 열어 주세요.'); }
  cache.set(projectId, { key, url });
  if (previous) revokeBlob(previous.url);
  return url;
}

/** A standalone file of the current draft; does not need or contact a server. */
export function exportUrl(project: Project): string {
  const current = project.versions.at(-1)?.id ?? '';
  return blobUrl(exportBlobs, project.id, `${project.updatedAt}:${current}`, project.schema);
}
function publicationUrl(snapshot: Publication): string {
  return blobUrl(publicationBlobs, snapshot.projectId, snapshot.versionId, snapshot.schema);
}
/** Always resolves the persisted published snapshot, independent of later draft edits. */
export function publishedUrl(project: Project): string {
  const workspace = loadWorkspace();
  const snapshot = project.publishedSlug && Object.hasOwn(workspace.publications, project.publishedSlug)
    ? workspace.publications[project.publishedSlug]
    : Object.values(workspace.publications).find(snapshot => snapshot.projectId === project.id);
  if (!snapshot || snapshot.projectId !== project.id) return '';
  return publicationUrl(snapshot);
}

export const offlineApi = {
  exportUrl,
  publishedUrl,
  status: async (): Promise<RuntimeStatus & { storage: 'browser' }> => ({
    mode: 'local', aiConfigured: false, hosting: 'browser', storage: 'browser',
  }),
  list: (): Promise<Project[]> => read(workspace => [...workspace.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))),
  create: async (input: GenerateInput): Promise<Project> => {
    const schema = safeSchema(generateSchema(createInput(input)));
    const createdAt = now();
    const project: Project = {
      id: id(), name: schema.name, description: schema.description, kind: schema.kind, schema,
      createdAt, updatedAt: createdAt, versions: [version(schema, '첫 번째 앱 완성')],
      messages: [message('assistant', '기본 제작 모드로 앱을 만들었어요. 색상과 문구를 바꾸거나 문의·예약·갤러리 같은 기능을 더할 수 있어요. 작업은 이 브라우저에 저장됩니다.')],
    };
    return mutate(workspace => { workspace.projects.push(clone(project)); return project; });
  },
  edit: (projectId: string, prompt: string): Promise<Project> => mutate(workspace => {
    if (typeof prompt !== 'string' || prompt.trim().length < 2 || prompt.trim().length > 2000) {
      throw new PortableWorkspaceError(400, '수정할 내용을 2~2,000자로 입력해 주세요.');
    }
    const request = prompt.trim();
    const project = findProject(workspace, projectId);
    const edited = editSchema(project.schema, request);
    if (!edited.changed || JSON.stringify(edited.schema) === JSON.stringify(project.schema)) {
      throw new PortableWorkspaceError(422, edited.summary || '바꿀 내용이 없어요. 색상·문구·추가할 기능을 구체적으로 알려 주세요.');
    }
    checkpoint(project, safeSchema(edited.schema), request.slice(0, 70));
    project.messages.push(message('user', request), message('assistant', edited.summary));
    return project;
  }),
  save: (projectId: string, schema: AppSchema, label: string): Promise<Project> => mutate(workspace => {
    const labelText = label === undefined ? '직접 설정 수정' : typeof label === 'string' ? label.trim() : '';
    if (!labelText || labelText.length > 80) throw new PortableWorkspaceError(400, '변경 기록 이름을 80자 이내로 입력해 주세요.');
    const next = safeSchema(schema);
    const project = findProject(workspace, projectId);
    if (JSON.stringify(project.schema) !== JSON.stringify(next)) {
      checkpoint(project, next, labelText);
      project.messages.push(message('assistant', `${labelText}을 저장했어요. 변경 기록에서 언제든 복원할 수 있어요.`));
    }
    return project;
  }),
  restore: (projectId: string, versionId: string): Promise<Project> => mutate(workspace => {
    const project = findProject(workspace, projectId);
    const previous = project.versions.find(version => version.id === versionId);
    if (!previous) throw new PortableWorkspaceError(404, '복원할 버전을 찾지 못했어요.');
    checkpoint(project, safeSchema(previous.schema), `복원: ${previous.label}`.slice(0, 80));
    project.messages.push(message('assistant', '선택한 버전으로 되돌렸어요. 복원하기 전의 작업도 변경 기록에 남아 있어요.'));
    return project;
  }),
  publish: async (projectId: string): Promise<{ project: Project; path: string }> => {
    const result = await mutate(workspace => {
      const project = findProject(workspace, projectId);
      const current = project.versions.at(-1);
      if (!current) throw new PortableWorkspaceError(400, '먼저 앱을 만들어 주세요.');
      const schema = safeSchema(project.schema);
      renderAppHtml(schema);
      const slug = project.publishedSlug || `app-${project.id}`;
      const snapshot: Publication = { projectId: project.id, versionId: current.id, schema: clone(schema), publishedAt: now() };
      workspace.publications[slug] = snapshot;
      project.publishedSlug = slug;
      project.publishedVersionId = current.id;
      return { project, snapshot };
    });
    return { project: result.project, path: publicationUrl(result.snapshot) };
  },
  remove: async (projectId: string): Promise<void> => {
    await mutate(workspace => {
      findProject(workspace, projectId);
      workspace.projects = workspace.projects.filter(project => project.id !== projectId);
      for (const [slug, snapshot] of Object.entries(workspace.publications)) {
        if (snapshot.projectId === projectId) delete workspace.publications[slug];
      }
    });
    for (const cache of [exportBlobs, publicationBlobs]) {
      const entry = cache.get(projectId);
      if (entry) { revokeBlob(entry.url); cache.delete(projectId); }
    }
  },
  check: (projectId: string): Promise<CheckResult> => read(workspace => {
    const project = findProject(workspace, projectId);
    const checks: CheckResult['checks'] = [];
    let schema: AppSchema | undefined;
    try {
      schema = validateSchema(project.schema);
      checks.push({ id: 'schema', label: '앱 구성 확인', status: 'passed', detail: '지원하는 구성 요소와 설정 형식이 올바릅니다.' });
    } catch {
      checks.push({ id: 'schema', label: '앱 구성 확인', status: 'failed', detail: '설정 형식이 올바르지 않아 실행 파일을 만들 수 없습니다.' });
    }
    if (schema) {
      try {
        const html = renderAppHtml(schema);
        checks.push({ id: 'render', label: '실행 파일 생성', status: html.toLowerCase().includes('<!doctype html>') ? 'passed' : 'failed', detail: '현재 설정을 독립 실행 HTML 파일로 변환했습니다.' });
        checks.push({ id: 'responsive', label: '모바일 화면 설정', status: html.includes('name="viewport"') ? 'passed' : 'failed', detail: '모바일 화면 너비 설정을 확인했습니다. 실제 기기에서도 직접 확인해 주세요.' });
      } catch {
        checks.push({ id: 'render', label: '실행 파일 생성', status: 'failed', detail: '실행 파일을 만들지 못했습니다. 앱 설정을 확인한 뒤 다시 시도해 주세요.' });
      }
      checks.push({ id: 'interaction', label: '실제 사용 점검', status: 'warning', detail: '미리보기에서 버튼과 양식을 직접 눌러 보세요. 이 점검은 브라우저 동작 테스트를 대신하지 않습니다.' });
      if (schema.features.some(feature => ['contact', 'booking', 'newsletter'].includes(feature))) {
        checks.push({ id: 'forms', label: '양식 데이터 전달', status: 'warning', detail: '양식은 방문자 기기에만 저장됩니다. 운영자에게 전달하려면 별도 수집 서버 연결이 필요합니다.' });
      }
      const content = schema.content ?? defaultAppContent(schema.kind);
      if (schema.features.includes('gallery') && (content.gallery.length === 0 || content.gallery.some(item => !item.image))) {
        checks.push({ id: 'gallery-content', label: '갤러리 사진', status: 'warning', detail: '사진이 없는 항목에는 예시 그림이 표시됩니다. 직접 수정에서 실제 사진을 추가해 주세요.' });
      }
      if (schema.features.includes('testimonials') && (content.testimonials.length === 0 || content.testimonials.some(item => /^(예시|샘플|sample)/i.test(item.name) || /^(예시|샘플|sample)/i.test(item.quote)))) {
        checks.push({ id: 'testimonial-content', label: '후기 확인', status: 'warning', detail: '후기가 비어 있거나 예시 문구가 남아 있습니다. 공개 전에 실제 고객 후기로 바꿔 주세요.' });
      }
    }
    checks.push({ id: 'ai', label: 'AI 연결', status: 'warning', detail: '이 파일은 외부 AI 없이 기본 제작과 지원하는 대화 수정을 실행합니다. 외부 AI 요청은 전송하지 않습니다.' });
    checks.push({ id: 'storage', label: '작업 보관', status: 'warning', detail: '작업은 이 브라우저에만 저장됩니다. 브라우저 데이터 삭제 전에 완성한 앱을 HTML로 내려받아 보관해 주세요.' });
    checks.push({ id: 'hosting', label: '외부 인터넷 공개', status: 'warning', detail: '실행 링크는 이 브라우저에서만 열리는 임시 주소입니다. 앱 HTML을 내려받아 호스팅에 업로드해야 다른 사람도 인터넷에서 볼 수 있습니다.' });
    return { checks, checkedAt: now() };
  }),
};
