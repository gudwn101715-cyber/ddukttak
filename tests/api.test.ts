import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import type { AppSchema, GenerateInput, Project } from '../src/lib/schema';

const servers: Server[] = [];
const directories: string[] = [];
const input: GenerateInput = {
  name: '테스트 공방',
  description: '수제 도자기 체험 수업을 소개하는 예약 페이지',
  kind: 'booking',
  style: 'warm',
  features: ['booking', 'contact', 'faq'],
};

async function workspace() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ddukttak-test-'));
  directories.push(dataDir);
  return dataDir;
}

async function start(dataDir: string) {
  const app = await createApp({ dataDir, aiKey: '' });
  const server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const create = async () => {
    const response = await request('/api/projects', input);
    expect(response.status).toBe(201);
    return await response.json() as Project;
  };
  return { base, request, create, server };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('project API and persistence', () => {
  it('identifies no-key mode honestly and starts with no fabricated projects', async () => {
    const api = await start(await workspace());
    const status = await (await api.request('/api/status')).json();
    expect(status.mode).toBe('local');
    expect(status.aiConfigured).toBe(false);
    expect(status.hosting).toBe('local');
    expect(await (await api.request('/api/projects')).json()).toEqual([]);
  });

  it('persists created apps for a new app instance using the same workspace', async () => {
    const dataDir = await workspace();
    const first = await start(dataDir);
    const project = await first.create();
    expect(project.id.length).toBeGreaterThan(0);
    expect(project.schema.name).toBe(input.name);
    expect(project.versions).toHaveLength(1);
    const second = await start(dataDir);
    const response = await second.request(`/api/projects/${project.id}`);
    expect(response.status).toBe(200);
    const restored = await response.json();
    expect(restored).toEqual(project);
    expect(await (await second.request('/api/projects')).json()).toEqual([project]);
  });

  it('rejects invalid create/update input and unavailable projects without corrupting state', async () => {
    const api = await start(await workspace());
    for (const body of [{}, { ...input, name: '' }, { ...input, kind: 'execute' }, { ...input, features: ['execute'] }]) {
      expect((await api.request('/api/projects', body)).status).toBe(400);
    }
    expect((await api.request('/api/projects/not-a-project')).status).toBe(404);
    const project = await api.create();
    const invalidSchema = { ...project.schema, theme: { ...project.schema.theme, primary: 'url(javascript:alert(1))' } };
    expect((await api.request(`/api/projects/${project.id}/schema`, { schema: invalidSchema }, 'PATCH')).status).toBe(400);
    const unchanged = await (await api.request(`/api/projects/${project.id}`)).json();
    expect(unchanged.schema).toEqual(project.schema);
    expect(unchanged.versions).toHaveLength(1);
  });

  it('rejects cross-site mutation requests and requires JSON instead of ambient form submissions', async () => {
    const api = await start(await workspace());
    const crossSite = await fetch(`${api.base}/api/projects`, {
      method: 'POST',
      headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(crossSite.status).toBe(403);
    const form = await fetch(`${api.base}/api/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'name=injected',
    });
    expect(form.status).toBe(415);
    expect(await (await api.request('/api/projects')).json()).toEqual([]);
  });

  it('rejects an untrusted Host and does not resolve inherited object properties as published pages', async () => {
    const api = await start(await workspace());
    // Node fetch normalizes Host; raw HTTP is needed to exercise actual rebinding.
    const rebindingStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${api.base}/api/status`, { headers: { Host: 'attacker.test' } }, response => {
        response.resume();
        resolve(response.statusCode || 0);
      });
      request.on('error', reject);
      request.end();
    });
    expect(rebindingStatus).toBe(403);
    const inherited = await api.request('/published/constructor');
    expect(inherited.status).toBe(404);
  });

  it('accepts the browser publish request with a JSON header and empty body', async () => {
    const api = await start(await workspace());
    const project = await api.create();
    const response = await fetch(`${api.base}/api/projects/${project.id}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    expect(response.status).toBe(200);
    const published = await response.json();
    expect(published.project.publishedVersionId).toBe(project.versions[0].id);
    expect((await api.request(published.path)).status).toBe(200);
  });

  it('saves edits and restores an old snapshot into a new version', async () => {
    const api = await start(await workspace());
    const project = await api.create();
    const response = await api.request(`/api/projects/${project.id}/edit`, { prompt: '제목을 "새로운 공방 이야기"로 바꿔줘' });
    expect(response.status).toBe(200);
    const edited = await response.json() as Project;
    expect(edited.schema.hero.title).toBe('새로운 공방 이야기');
    expect(edited.schema.features).toEqual(project.schema.features);
    expect(edited.versions).toHaveLength(2);
    expect(edited.messages.some(message => message.role === 'user' && message.content.includes('새로운 공방 이야기'))).toBe(true);
    const restoredResponse = await api.request(`/api/projects/${project.id}/restore`, { versionId: project.versions[0].id });
    expect(restoredResponse.status).toBe(200);
    const restored = await restoredResponse.json() as Project;
    expect(restored.schema).toEqual(project.schema);
    expect(restored.versions).toHaveLength(3);
    expect(new Set(restored.versions.map(version => version.id)).size).toBe(3);
    expect(restored.versions.some(version => version.schema.hero.title === '새로운 공방 이야기')).toBe(true);
  });

  it('does not fabricate a changed version for unsupported local automation', async () => {
    const api = await start(await workspace());
    const project = await api.create();
    const response = await api.request(`/api/projects/${project.id}/edit`, { prompt: '매주 수요일 고객들에게 문자 메시지를 전송해줘' });
    expect([200, 422]).toContain(response.status);
    const unchanged = await (await api.request(`/api/projects/${project.id}`)).json() as Project;
    expect(unchanged.schema).toEqual(project.schema);
    expect(unchanged.versions).toHaveLength(1);
  });

  it('persists user-authored content and includes it in standalone exports', async () => {
    const api = await start(await workspace());
    const project = await api.create();
    const content = {
      gallery: [{ title: '첫 번째 도자기 사진', description: '오래 간직하고 싶은 작품', image: 'data:image/jpeg;base64,/9j/2Q==' }],
      faq: [{ question: '초보자도 괜찮나요?', answer: '처음인 분도 한 단계씩 안내해 드려요.' }],
      testimonials: [{ quote: '친절한 설명으로 즐겁게 배웠어요.', name: '수강생 이씨' }],
    };
    const schema: AppSchema = { ...project.schema, features: ['gallery', 'faq', 'testimonials'], content };
    const response = await api.request(`/api/projects/${project.id}/schema`, { schema, label: '사진과 상세 내용 수정' }, 'PATCH');
    expect(response.status).toBe(200);
    const saved = await response.json() as Project;
    expect(saved.schema.content).toEqual(content);
    const readBack = await (await api.request(`/api/projects/${project.id}`)).json() as Project;
    expect(readBack.schema.content).toEqual(content);
    const exported = await (await api.request(`/api/projects/${project.id}/export`)).text();
    expect(exported).toContain(content.gallery[0].title);
    expect(exported).toContain(content.gallery[0].image);
    expect(exported).toContain(content.faq[0].answer);
    expect(exported).toContain(content.testimonials[0].quote);
  });

  it('keeps a published snapshot independent of later draft edits and exports the current draft', async () => {
    const api = await start(await workspace());
    const project = await api.create();
    const publishResponse = await api.request(`/api/projects/${project.id}/publish`, {});
    expect(publishResponse.status).toBe(200);
    const published = await publishResponse.json() as { project: Project; path: string };
    expect(published.path).toMatch(/^\/published\//);
    expect(published.project.publishedVersionId).toBe(project.versions[0].id);
    const initialResponse = await api.request(published.path);
    expect(initialResponse.status).toBe(200);
    const initialHtml = await initialResponse.text();
    expect(initialHtml).toContain(project.schema.name);
    const nextSchema: AppSchema = { ...project.schema, hero: { ...project.schema.hero, title: '아직 공개하지 않은 제목' } };
    const edited = await api.request(`/api/projects/${project.id}/schema`, { schema: nextSchema, label: '제목 변경' }, 'PATCH');
    expect(edited.status).toBe(200);
    const snapshotAfterEdit = await (await api.request(published.path)).text();
    expect(snapshotAfterEdit).toBe(initialHtml);
    expect(snapshotAfterEdit).not.toContain(nextSchema.hero.title);
    const exported = await api.request(`/api/projects/${project.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('text/html');
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    expect(await exported.text()).toContain(nextSchema.hero.title);
  });

  it('reports actual checks and keeps external service readiness distinguishable', async () => {
    const api = await start(await workspace());
    const project = await api.create();
    const response = await api.request(`/api/projects/${project.id}/check`);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.checks.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    expect(result.checks.some((check: {status: string}) => check.status === 'passed')).toBe(true);
    expect(result.checks.some((check: {status: string}) => check.status === 'warning')).toBe(true);
    expect(result.checks.every((check: {label?: string; detail?: string}) => Boolean(check.label && check.detail))).toBe(true);
  });

  it('deletes only the requested project and removes its published route', async () => {
    const api = await start(await workspace());
    const one = await api.create();
    const two = await api.create();
    const published = await (await api.request(`/api/projects/${one.id}/publish`, {})).json();
    expect((await api.request(`/api/projects/${one.id}`, undefined, 'DELETE')).status).toBe(204);
    expect((await api.request(`/api/projects/${one.id}`)).status).toBe(404);
    expect((await api.request(published.path)).status).toBe(404);
    expect((await api.request(`/api/projects/${two.id}`)).status).toBe(200);
  });
});
