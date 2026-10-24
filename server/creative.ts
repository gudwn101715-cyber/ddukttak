import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { artifactSchema, createWorkInputSchema, workSchema, type Artifact, type Work } from '../src/creative/model.js';
import { createStarter } from '../src/creative/starters.js';
import { renderArtifact } from '../src/creative/runtime.js';
import {
  CreativeError, normalizeCreativeBaseUrl, requestCreativeArtifact, verifyCreativeConnection,
  type CreativeAiOptions, type CreativeFetch,
} from './creative-ai.js';

export interface CreativeRouteOptions {
  dataDir?: string;
  aiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  /** Trusted dependency injection for provider transport; never configurable by a browser request. */
  creativeFetch?: CreativeFetch;
}

interface WorksWorkspace { format: 1; works: Work[] }
class WorksStore {
  private queue: Promise<unknown> = Promise.resolve();
  private file: string;
  constructor(private readonly directory: string) { this.file = path.join(directory, 'works.json'); }
  private async load(): Promise<WorksWorkspace> {
    try {
      const parsed = z.object({ format: z.literal(1), works: z.array(workSchema) }).strict().parse(JSON.parse(await readFile(this.file, 'utf8')));
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: 1, works: [] };
      // Refuse to overwrite malformed or unsupported data.
      throw new CreativeError(500, '저장된 작품을 읽지 못했습니다. 데이터 파일을 보관한 뒤 서버 상태를 확인해 주세요.');
    }
  }
  async read<T>(select: (workspace: WorksWorkspace) => T): Promise<T> {
    await this.queue;
    return select(await this.load());
  }
  async mutate<T>(change: (workspace: WorksWorkspace) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const data = await this.load();
      const result = change(data);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.directory, `.works-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
        await rename(temporary, this.file);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}

const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const editInput = z.object({ prompt: z.string().trim().min(2).max(6000), baseVersionId: idSchema }).strict();
const repairInput = z.object({ error: z.string().trim().min(1).max(4000), baseVersionId: idSchema }).strict();
const saveInput = z.object({ artifact: artifactSchema, baseVersionId: idSchema, label: z.string().trim().min(1).max(80).optional() }).strict();
const restoreInput = z.object({ versionId: idSchema, baseVersionId: idSchema }).strict();
const connectInput = z.object({
  apiKey: z.string().trim().min(8).max(4096).regex(/^\S+$/).optional(),
  model: z.string().trim().min(1).max(120),
  baseUrl: z.string().trim().min(8).max(400).optional(),
}).strict();
const now = () => new Date().toISOString();
const publicBaseUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '').slice(0, 400);
  } catch { return 'https://api.openai.com/v1'; }
};
const message = (role: 'user' | 'assistant', content: string) => ({ id: randomUUID(), role, content, createdAt: now() });
const snapshot = (artifact: Artifact, label: string) => ({ id: randomUUID(), label, createdAt: now(), artifact: structuredClone(artifact) });
function findWork(data: WorksWorkspace, id: unknown): Work {
  const validId = idSchema.parse(id);
  const work = data.works.find((entry) => entry.id === validId);
  if (!work) throw new CreativeError(404, '작품을 찾지 못했습니다. 작품 목록을 새로고침해 주세요.');
  return work;
}
function checkVersion(work: Work, expected: string): void {
  if (work.versions.at(-1)?.id !== expected) throw new CreativeError(409, '다른 변경 사항이 먼저 저장됐습니다. 최신 작품을 열고 다시 시도해 주세요.');
}
function checkpoint(work: Work, artifact: Artifact, label: string): void {
  work.artifact = structuredClone(artifact);
  work.title = artifact.title;
  work.description = artifact.description;
  work.updatedAt = now();
  work.versions.push(snapshot(artifact, label.slice(0, 80)));
}

export function registerCreativeRoutes(app: Express, options: CreativeRouteOptions = {}): void {
  const router = express.Router();
  const store = new WorksStore(options.dataDir ?? path.resolve('.data'));
  const environment: CreativeAiOptions = {
    key: options.aiKey ?? process.env.DDUK_AI_API_KEY ?? '',
    model: options.aiModel ?? process.env.DDUK_AI_MODEL ?? 'gpt-4.1',
    baseUrl: options.aiBaseUrl ?? process.env.DDUK_AI_BASE_URL ?? 'https://api.openai.com/v1',
    transport: options.creativeFetch,
  };
  let session: CreativeAiOptions | undefined;
  let verifiedConfiguration: CreativeAiOptions | undefined;
  let connectionRevision = 0;
  const currentConfiguration = (): CreativeAiOptions => session ?? environment;
  const status = () => {
    const current = currentConfiguration();
    const configured = Boolean(current.key);
    const verified = configured && verifiedConfiguration === current;
    return {
      configured, verified, model: current.model, baseUrl: publicBaseUrl(current.baseUrl),
      source: configured ? (session ? 'session' : 'environment') : 'none',
      message: verified ? 'OpenAI 호환 API의 실제 응답을 확인했습니다. AI로 작품을 만들거나 수정할 수 있습니다.'
        : configured ? 'AI 인증 설정이 있습니다. 연결 확인을 눌러 실제 응답을 확인해 주세요.'
          : 'AI가 아직 연결되지 않았습니다. API를 연결하거나, 동작하는 예제 작품부터 시작해 보세요.',
    };
  };
  const requireAi = (): CreativeAiOptions => {
    const current = currentConfiguration();
    if (!current.key) throw new CreativeError(409, 'AI 연결이 필요합니다. AI 연결 창에서 API 키를 입력한 뒤 실제 연결을 확인해 주세요. 예제 제작과 직접 수정은 키 없이 사용할 수 있습니다.');
    return current;
  };
  const requests = new Map<string, { count: number; reset: number }>();
  const costly = (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip || 'local';
    const time = Date.now();
    const previous = requests.get(key);
    if (!previous || time >= previous.reset) requests.set(key, { count: 1, reset: time + 60_000 });
    else if (previous.count >= 10) {
      next(new CreativeError(429, '1분에 10번까지 AI 연결·제작·수정을 요청할 수 있습니다. 잠시 후 다시 시도해 주세요.'));
      return;
    } else previous.count++;
    if (requests.size > 1000) for (const [entry, value] of requests) if (time > value.reset) requests.delete(entry);
    next();
  };

  router.get('/creative/status', (_req, res) => res.json(status()));
  router.post('/creative/connect', costly, async (req, res) => {
    const input = connectInput.parse(req.body);
    const previous = currentConfiguration();
    const baseUrl = normalizeCreativeBaseUrl(input.baseUrl || previous.baseUrl);
    if (!input.apiKey && baseUrl !== normalizeCreativeBaseUrl(previous.baseUrl)) {
      throw new CreativeError(400, 'AI 제공자 주소를 바꾸려면 해당 제공자의 API 키를 직접 입력해 주세요. 저장된 키를 다른 주소로 전달할 수 없습니다.');
    }
    const candidate: CreativeAiOptions = {
      key: input.apiKey || previous.key,
      model: input.model,
      baseUrl,
      transport: options.creativeFetch,
    };
    if (!candidate.key) throw new CreativeError(409, 'API 키가 없습니다. 키를 입력하거나 서버의 DDUK_AI_API_KEY 환경 변수를 설정해 주세요.');
    const revision = ++connectionRevision;
    await verifyCreativeConnection(candidate);
    if (revision !== connectionRevision) throw new CreativeError(409, '연결 설정이 변경됐습니다. 현재 연결 상태를 다시 확인해 주세요.');
    // A failed test never replaces the previous working credentials/configuration.
    session = candidate;
    verifiedConfiguration = candidate;
    res.json(status());
  });
  router.delete('/creative/connect', (_req, res) => {
    connectionRevision++;
    session = undefined;
    verifiedConfiguration = undefined;
    res.json(status());
  });
  router.get('/works', async (_req, res) => res.json(await store.read((data) => [...data.works].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))));
  router.post('/works', costly, async (req, res) => {
    const input = createWorkInputSchema.parse(req.body);
    const config = input.mode === 'ai' ? requireAi() : undefined;
    const artifact = config
      ? await requestCreativeArtifact(config, { kind: input.kind, title: input.title, prompt: input.prompt })
      : createStarter(input.kind, input.title, input.prompt);
    if (config && config === currentConfiguration()) verifiedConfiguration = config;
    const timestamp = now();
    const work: Work = {
      id: randomUUID(), title: artifact.title, description: artifact.description, kind: input.kind, artifact,
      createdAt: timestamp, updatedAt: timestamp, versions: [snapshot(artifact, config ? 'AI로 첫 작품 제작' : '예제 작품으로 시작')],
      messages: [message('user', input.prompt), message('assistant', config
        ? 'AI가 HTML·CSS·JavaScript로 작품을 만들었습니다. 직접 실행해 보고 바꾸고 싶은 점을 알려 주세요.'
        : '직접 동작하는 예제 작품으로 시작했습니다. 자유로운 설명으로 새 작품을 만들거나 기능을 추가하려면 AI를 연결해 주세요.')],
    };
    await store.mutate((data) => { data.works.push(work); });
    res.status(201).json(work);
  });
  router.get('/works/:id', async (req, res) => res.json(await store.read((data) => findWork(data, req.params.id))));
  router.delete('/works/:id', async (req, res) => {
    await store.mutate((data) => {
      const current = findWork(data, req.params.id);
      data.works = data.works.filter((entry) => entry.id !== current.id);
    });
    res.status(204).end();
  });
  router.post('/works/:id/edit', costly, async (req, res) => {
    const { prompt, baseVersionId } = editInput.parse(req.body);
    const previous = await store.read((data) => findWork(data, req.params.id));
    checkVersion(previous, baseVersionId);
    const config = requireAi();
    const artifact = await requestCreativeArtifact(config, { kind: previous.kind, artifact: previous.artifact, prompt });
    const updated = await store.mutate((data) => {
      const work = findWork(data, req.params.id);
      checkVersion(work, baseVersionId);
      checkpoint(work, artifact, prompt);
      work.messages.push(message('user', prompt), message('assistant', 'AI가 요청을 반영한 새 버전을 저장했습니다. 실행해 확인하고 변경 기록에서 언제든 되돌릴 수 있습니다.'));
      return work;
    });
    if (config === currentConfiguration()) verifiedConfiguration = config;
    res.json(updated);
  });
  router.patch('/works/:id/artifact', async (req, res) => {
    const { artifact, baseVersionId, label } = saveInput.parse(req.body);
    res.json(await store.mutate((data) => {
      const work = findWork(data, req.params.id);
      checkVersion(work, baseVersionId);
      if (JSON.stringify(work.artifact) !== JSON.stringify(artifact)) {
        // Direct edits cannot turn a starter into a falsely AI-generated work.
        checkpoint(work, { ...artifact, origin: work.artifact.origin }, label || '직접 수정');
        work.messages.push(message('assistant', '직접 수정한 내용을 저장했습니다. 이전 버전도 변경 기록에 보관했습니다.'));
      }
      return work;
    }));
  });
  router.post('/works/:id/restore', async (req, res) => {
    const { versionId, baseVersionId } = restoreInput.parse(req.body);
    res.json(await store.mutate((data) => {
      const work = findWork(data, req.params.id);
      checkVersion(work, baseVersionId);
      const selected = work.versions.find((entry) => entry.id === versionId);
      if (!selected) throw new CreativeError(404, '복원할 작품 버전을 찾지 못했습니다.');
      checkpoint(work, selected.artifact, `복원: ${selected.label}`);
      work.messages.push(message('assistant', '선택한 버전으로 복원했습니다. 복원 전 작업도 기록에 남아 있습니다.'));
      return work;
    }));
  });
  router.post('/works/:id/repair', costly, async (req, res) => {
    const { error, baseVersionId } = repairInput.parse(req.body);
    const previous = await store.read((data) => findWork(data, req.params.id));
    checkVersion(previous, baseVersionId);
    const config = requireAi();
    const artifact = await requestCreativeArtifact(config, { kind: previous.kind, artifact: previous.artifact, error });
    const updated = await store.mutate((data) => {
      const work = findWork(data, req.params.id);
      checkVersion(work, baseVersionId);
      checkpoint(work, artifact, 'AI로 실행 오류 수정');
      work.messages.push(message('user', `실행 오류 수정: ${error}`), message('assistant', 'AI가 실행 오류 수정을 시도한 새 버전입니다. 작품을 다시 실행해 결과를 확인해 주세요.'));
      return work;
    });
    if (config === currentConfiguration()) verifiedConfiguration = config;
    res.json(updated);
  });
  router.get('/works/:id/export', async (req, res) => {
    const work = await store.read((data) => findWork(data, req.params.id));
    const name = encodeURIComponent(work.title).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.setHeader('Content-Disposition', `attachment; filename="ddukttak-work.html"; filename*=UTF-8''${name}.html`);
    res.type('html').send(renderArtifact(work.artifact));
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof CreativeError) res.status(error.status).json({ error: error.message });
    else if (error instanceof z.ZodError) res.status(400).json({ error: '작품 입력 형식이 올바르지 않습니다. 제목, 설명과 코드 길이를 확인해 주세요.' });
    else next(error);
  });
  app.use('/api', router);
}
