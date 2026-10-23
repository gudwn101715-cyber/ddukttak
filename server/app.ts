import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { generateSchema, editSchema } from '../src/lib/generator.js';
import { defaultAppContent, validateSchema } from '../src/lib/schema.js';
import type { AppSchema, AppVersion, ChatMessage, Project } from '../src/lib/schema.js';
import { renderAppHtml } from '../src/lib/renderer.js';
import { WorkspaceStore } from './store.js';
import { AiServiceError, requestAiSchema, type AiOptions } from './ai.js';

class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export interface AppOptions {
  dataDir?: string;
  aiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  staticDir?: string;
  allowedOrigins?: string[];
}
const feature = z.enum(['contact', 'booking', 'gallery', 'faq', 'newsletter', 'testimonials']);
const createInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(3).max(2000),
  kind: z.enum(['landing', 'booking', 'portfolio', 'store']),
  style: z.enum(['warm', 'minimal', 'bold', 'natural']).default('warm'),
  features: z.array(feature).max(6).default([]),
}).strict();
const textInput = z.object({ prompt: z.string().trim().min(2).max(2000) }).strict();
const routeId = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const now = () => new Date().toISOString();
const version = (schema: AppSchema, label: string): AppVersion => ({ id: randomUUID(), label, createdAt: now(), schema: structuredClone(schema) });
const message = (role: ChatMessage['role'], content: string): ChatMessage => ({ id: randomUUID(), role, content, createdAt: now() });
const findProject = (projects: Project[], id: unknown): Project => {
  const validId = routeId.parse(id);
  const project = projects.find((entry) => entry.id === validId);
  if (!project) throw new HttpError(404, '프로젝트를 찾을 수 없습니다. 목록을 새로고침해 주세요.');
  return project;
};
function checkpoint(project: Project, schema: AppSchema, label: string) {
  project.schema = structuredClone(schema);
  project.name = schema.name;
  project.description = schema.description;
  project.kind = schema.kind;
  project.updatedAt = now();
  project.versions.push(version(schema, label));
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = new WorkspaceStore(options.dataDir ?? path.resolve('.data'));
  const ai: AiOptions = { key: options.aiKey ?? process.env.DDUK_AI_API_KEY, baseUrl: options.aiBaseUrl ?? process.env.DDUK_AI_BASE_URL, model: options.aiModel ?? process.env.DDUK_AI_MODEL };
  const allowedOrigins = new Set([
    'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173',
    ...(options.allowedOrigins ?? (process.env.DDUK_ALLOWED_ORIGINS?.split(',').map((item) => item.trim()).filter(Boolean) ?? [])),
  ]);
  // Host validation also prevents DNS-rebinding access to this private loopback service.
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  for (const origin of allowedOrigins) {
    try { allowedHosts.add(new URL(origin).hostname); } catch { /* Invalid configured origins do not grant access. */ }
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!allowedHosts.has(req.hostname)) {
      next(new HttpError(403, '허용되지 않은 호스트의 요청입니다. 로컬 주소로 작업 공간에 접속해 주세요.'));
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      const ownOrigin = `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== ownOrigin && !allowedOrigins.has(origin)) {
        next(new HttpError(403, '허용되지 않은 출처의 요청입니다. 이 작업 공간에서 다시 시도해 주세요.'));
        return;
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        next(new HttpError(403, '다른 사이트에서 작업 공간을 변경할 수 없습니다.'));
        return;
      }
      if (!req.is('application/json') && req.method !== 'DELETE') {
        next(new HttpError(415, 'JSON 형식으로 요청해 주세요.'));
        return;
      }
    }
    next();
  });
  app.use(express.json({ limit: '3mb' }));

  const generationRequests = new Map<string, { count: number; reset: number }>();
  const costly = (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? 'local';
    const current = generationRequests.get(key);
    const time = Date.now();
    if (!current || time > current.reset) {
      generationRequests.set(key, { count: 1, reset: time + 60_000 });
    } else if (current.count >= 10) {
      next(new HttpError(429, '잠시 쉬었다가 다시 요청해 주세요. 1분에 10번까지 제작·수정할 수 있습니다.'));
      return;
    } else current.count++;
    next();
  };

  app.get('/api/status', (_req, res) => res.json({
    mode: ai.key ? 'ai' : 'local', aiConfigured: Boolean(ai.key), hosting: 'local',
    model: ai.key ? (ai.model || 'gpt-4.1') : null,
    workspace: 'single-local',
    message: ai.key ? 'AI 연결 설정이 있습니다. 생성 시 실제 연결 상태를 확인합니다.' : '기본 제작 모드입니다. 검증된 구성 요소를 조합하며 AI 키 없이 작동합니다.',
  }));
  app.get('/api/projects', async (_req, res) => {
    res.json(await store.read((data) => [...data.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
  });
  app.post('/api/projects', costly, async (req, res) => {
    const input = createInput.parse(req.body);
    input.features = [...new Set(input.features)];
    const schema = ai.key ? await requestAiSchema(ai, input) : validateSchema(generateSchema(input));
    const createdAt = now();
    const project: Project = {
      id: randomUUID(), name: schema.name, description: schema.description, kind: schema.kind, schema,
      createdAt, updatedAt: createdAt, versions: [version(schema, '첫 번째 앱 완성')],
      messages: [message('assistant', ai.key
        ? '말씀하신 내용을 바탕으로 앱을 만들었어요. 미리보기에서 직접 눌러 보고, 바꾸고 싶은 부분을 알려 주세요.'
        : '기본 제작 모드로 앱을 만들었어요. 색상과 문구를 바꾸거나 문의·예약·갤러리 같은 기능을 더할 수 있어요.')],
    };
    await store.mutate((data) => { data.projects.push(project); });
    res.status(201).json(project);
  });
  app.get('/api/projects/:id', async (req, res) => {
    res.json(await store.read((data) => findProject(data.projects, req.params.id)));
  });
  app.delete('/api/projects/:id', async (req, res) => {
    await store.mutate((data) => {
      const project = findProject(data.projects, req.params.id);
      data.projects = data.projects.filter((entry) => entry.id !== project.id);
      for (const [slug, snapshot] of Object.entries(data.publications)) {
        if (snapshot.projectId === project.id) delete data.publications[slug];
      }
    });
    res.status(204).end();
  });
  app.post('/api/projects/:id/edit', costly, async (req, res) => {
    const { prompt } = textInput.parse(req.body);
    const previous = await store.read((data) => findProject(data.projects, req.params.id));
    let nextSchema: AppSchema;
    let summary: string;
    if (ai.key) {
      nextSchema = await requestAiSchema(ai, { schema: previous.schema, prompt });
      summary = '요청하신 내용을 반영했어요. 이전 버전은 변경 기록에 보관해 두었어요.';
    } else {
      const edit = editSchema(previous.schema, prompt);
      if (!edit.changed) throw new HttpError(422, edit.summary || '요청을 이해하지 못했어요. “배경을 파란색으로”, “예약 기능 추가”, “제목을 ‘우리 동네 꽃집’으로”처럼 알려 주세요.');
      nextSchema = validateSchema(edit.schema);
      summary = edit.summary;
    }
    if (JSON.stringify(nextSchema) === JSON.stringify(previous.schema)) throw new HttpError(422, '변경된 내용이 없어요. 바꾸고 싶은 색상, 문구, 기능을 조금 더 구체적으로 알려 주세요.');
    const result = await store.mutate((data) => {
      const project = findProject(data.projects, req.params.id);
      if (project.updatedAt !== previous.updatedAt) throw new HttpError(409, '다른 변경 사항이 먼저 저장되었어요. 최신 화면을 확인하고 다시 요청해 주세요.');
      checkpoint(project, nextSchema, prompt.slice(0, 70));
      project.messages.push(message('user', prompt), message('assistant', summary));
      return project;
    });
    res.json(result);
  });
  app.patch('/api/projects/:id/schema', async (req, res) => {
    const input = z.object({ schema: z.unknown(), label: z.string().trim().min(1).max(80).optional() }).strict().parse(req.body);
    let schema: AppSchema;
    try { schema = validateSchema(input.schema); } catch { throw new HttpError(400, '앱 설정 형식이 올바르지 않습니다. 입력값을 확인해 주세요.'); }
    const project = await store.mutate((data) => {
      const current = findProject(data.projects, req.params.id);
      if (JSON.stringify(current.schema) !== JSON.stringify(schema)) {
        checkpoint(current, schema, input.label || '직접 설정 수정');
        current.messages.push(message('assistant', `${input.label || '설정 변경'}을 저장했어요. 변경 기록에서 언제든 복원할 수 있어요.`));
      }
      return current;
    });
    res.json(project);
  });
  app.post('/api/projects/:id/restore', async (req, res) => {
    const { versionId } = z.object({ versionId: routeId }).strict().parse(req.body);
    const result = await store.mutate((data) => {
      const project = findProject(data.projects, req.params.id);
      const old = project.versions.find((entry) => entry.id === versionId);
      if (!old) throw new HttpError(404, '복원할 버전을 찾지 못했습니다.');
      checkpoint(project, old.schema, `복원: ${old.label}`.slice(0, 80));
      project.messages.push(message('assistant', '선택한 버전으로 되돌렸어요. 복원하기 전의 작업도 변경 기록에 남아 있어요.'));
      return project;
    });
    res.json(result);
  });
  app.post('/api/projects/:id/publish', async (req, res) => {
    const result = await store.mutate((data) => {
      const project = findProject(data.projects, req.params.id);
      const current = project.versions.at(-1);
      if (!current) throw new HttpError(400, '먼저 앱을 만들어 주세요.');
      const slug = project.publishedSlug || `app-${project.id}`;
      data.publications[slug] = { projectId: project.id, versionId: current.id, schema: structuredClone(project.schema), publishedAt: now() };
      project.publishedSlug = slug;
      project.publishedVersionId = current.id;
      return { project, path: `/published/${slug}` };
    });
    res.json(result);
  });
  app.get('/api/projects/:id/export', async (req, res) => {
    const schema = await store.read((data) => findProject(data.projects, req.params.id).schema);
    const downloadName = encodeURIComponent(schema.name).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Disposition', `attachment; filename="ddukttak-app.html"; filename*=UTF-8''${downloadName}.html`);
    res.type('html').send(renderAppHtml(schema));
  });
  app.get('/published/:slug', async (req, res) => {
    const slug = routeId.parse(req.params.slug);
    const snapshot = await store.read((data) => Object.hasOwn(data.publications, slug) ? data.publications[slug] : undefined);
    if (!snapshot) throw new HttpError(404, '저장된 실행본을 찾을 수 없습니다.');
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src https: data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-forms");
    res.type('html').send(renderAppHtml(snapshot.schema));
  });
  app.get('/api/projects/:id/check', async (req, res) => {
    const project = await store.read((data) => findProject(data.projects, req.params.id));
    const checks: { id: string; label: string; status: 'passed' | 'warning' | 'failed'; detail: string }[] = [];
    let schema: AppSchema | undefined;
    try {
      schema = validateSchema(project.schema);
      checks.push({ id: 'schema', label: '앱 구성 확인', status: 'passed', detail: '지원하는 구성 요소와 설정 형식이 올바릅니다.' });
    } catch {
      checks.push({ id: 'schema', label: '앱 구성 확인', status: 'failed', detail: '설정 형식이 올바르지 않아 실행본을 만들 수 없습니다.' });
    }
    if (schema) {
      const html = renderAppHtml(schema);
      checks.push({ id: 'render', label: '실행 파일 생성', status: html.includes('<!DOCTYPE html>') || html.toLowerCase().includes('<!doctype html>') ? 'passed' : 'failed', detail: '현재 설정을 독립 실행 HTML 파일로 변환했습니다.' });
      checks.push({ id: 'responsive', label: '모바일 화면 설정', status: html.includes('name="viewport"') || html.includes("name='viewport'") ? 'passed' : 'failed', detail: '모바일 기기 화면 너비를 사용하는 설정을 확인했습니다. 실제 기기 검토도 권장합니다.' });
      checks.push({ id: 'interaction', label: '실제 사용 점검', status: 'warning', detail: '미리보기에서 버튼과 양식을 직접 눌러 보세요. 이 점검은 브라우저 동작 테스트를 대신하지 않습니다.' });
      if (schema.features.some((item) => ['contact', 'booking', 'newsletter'].includes(item))) {
        checks.push({ id: 'forms', label: '양식 데이터 전달', status: 'warning', detail: '양식은 방문자 기기에만 저장됩니다. 운영자에게 전달하려면 별도 수집 서버 연결이 필요합니다.' });
      }
      const content = schema.content ?? defaultAppContent(schema.kind);
      if (schema.features.includes('gallery') && (content.gallery.length === 0 || content.gallery.some((item) => !item.image))) {
        checks.push({ id: 'gallery-content', label: '갤러리 사진', status: 'warning', detail: '사진이 없는 갤러리 항목에는 예시 그림이 표시됩니다. 직접 수정에서 실제 사진을 추가해 주세요.' });
      }
      if (schema.features.includes('testimonials') && (content.testimonials.length === 0 || content.testimonials.some((item) => /^(예시|샘플|sample)/i.test(item.name) || /^(예시|샘플|sample)/i.test(item.quote)))) {
        checks.push({ id: 'testimonial-content', label: '후기 확인', status: 'warning', detail: '후기가 비어 있거나 예시 문구가 남아 있습니다. 공개하기 전에 실제 고객 후기로 바꿔 주세요.' });
      }
    }
    checks.push({ id: 'hosting', label: '외부 인터넷 공개', status: 'warning', detail: '현재는 로컬 실행 환경입니다. 파일을 내려받아 호스팅에 업로드하면 인터넷에 공개할 수 있습니다.' });
    res.json({ checks, checkedAt: now() });
  });

  app.use('/api', (_req, _res, next) => next(new HttpError(404, '요청한 기능을 찾지 못했습니다.')));
  const staticDir = options.staticDir ?? path.resolve('dist');
  if (existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error: '입력값을 확인해 주세요. 이름·설명·기능 설정이 올바른지 확인한 뒤 다시 시도해 주세요.' });
    } else if (error instanceof AiServiceError) {
      res.status(502).json({ error: error.message });
    } else if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: '요청 내용을 읽을 수 없습니다. 화면을 새로고침하고 다시 시도해 주세요.' });
    } else if ((error as { type?: string })?.type === 'entity.too.large') {
      res.status(413).json({ error: '입력 내용이 너무 큽니다. 설명을 조금 줄여 주세요.' });
    } else {
      // Store errors may contain internal paths. Keep their details server-side without printing payloads.
      console.error('Workspace operation failed:', error instanceof Error ? error.name : 'UnknownError');
      res.status(500).json({ error: '작업을 저장하지 못했어요. 저장 공간과 서버 상태를 확인한 뒤 다시 시도해 주세요.' });
    }
  });
  return app;
}
