import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import type { Artifact, Work } from '../src/creative/model';

type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;
const servers: Server[] = [];
const directories: string[] = [];
const sessionKey = 'test-session-secret-not-a-real-api-key';
const nextKey = 'test-replacement-secret-not-a-real-api-key';
const baseArtifact: Artifact = {
  title: '실제 응답 코드로 만든 게임', description: '생성된 버튼을 누르면 점수가 올라갑니다.', instructions: '버튼을 눌러 점수를 올려 보세요.',
  html: '<button id="provider-code-button">AI 코드 실행</button><output id="provider-score">0</output>',
  css: '#provider-code-button{background:var(--accent);padding:20px}',
  js: 'let score=0;document.querySelector("#provider-code-button").onclick=()=>{document.querySelector("#provider-score").textContent=String(++score)};',
  origin: 'starter', settings: { accent: '#7755cc', difficulty: 'normal' },
};
const input = { kind: 'game', title: '나만의 점수 게임', prompt: '누를 때마다 점수가 올라가는 게임을 만들어 주세요.' };

function providerReply(artifact: Artifact): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(artifact) } }] });
}
function connectedReply(): Response { return Response.json({ choices: [{ message: { content: '연결을 확인했습니다.' } }] }); }
function bodyOf(init: RequestInit): Record<string, any> { return JSON.parse(String(init.body)); }

async function start(creativeFetch?: ProviderFetch, aiKey = '') {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'ddukttak-creative-test-'));
  directories.push(dataDir);
  const app = createApp({ dataDir, aiKey, creativeFetch });
  const server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (url: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(`${base}${url}`, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const connect = (apiKey = sessionKey, model = 'test-creative-model') => request('/api/creative/connect', { apiKey, model, baseUrl: 'https://api.openai.com/v1' });
  const list = async () => await (await request('/api/works')).json() as Work[];
  const create = async (mode: 'starter' | 'ai' = 'starter') => {
    const response = await request('/api/works', { ...input, mode });
    expect(response.status).toBe(201);
    return await response.json() as Work;
  };
  return { base, dataDir, request, connect, list, create };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('creative generation uses actual provider responses', () => {
  it('creates honest starters without AI and rejects AI creation without a key instead of falling back', async () => {
    let providerCalls = 0;
    const api = await start(async () => { providerCalls++; return providerReply(baseArtifact); });
    const status = await (await api.request('/api/creative/status')).json();
    expect(status.configured).toBe(false);
    expect(status.verified).toBe(false);
    const unavailable = await api.request('/api/works', { ...input, mode: 'ai' });
    expect(unavailable.status).toBe(409);
    expect(await api.list()).toEqual([]);
    const work = await api.create('starter');
    expect(work.artifact.origin).toBe('starter');
    expect(work.versions).toHaveLength(1);
    expect(providerCalls).toBe(0);
    expect((await api.request('/api/works', { ...input, mode: 'pretend-ai' })).status).toBe(400);
  });

  it('verifies a key, saves generated executable code, edits and repairs with real provider calls, and never stores the key', async () => {
    const requests: { url: string; headers: Headers; body: Record<string, any> }[] = [];
    let generations = 0;
    const api = await start(async (url, init) => {
      const body = bodyOf(init);
      requests.push({ url, headers: new Headers(init.headers), body });
      if (!body.response_format) return connectedReply();
      generations++;
      return providerReply({ ...baseArtifact, title: `응답 코드 ${generations}`, js: `${baseArtifact.js}\n// provider-result-${generations}` });
    });
    const connected = await api.connect();
    expect(connected.status).toBe(200);
    const connectionText = await connected.text();
    expect(connectionText).not.toContain(sessionKey);
    const status = JSON.parse(connectionText);
    expect(status).toMatchObject({ configured: true, verified: true, source: 'session' });
    const work = await api.create('ai');
    expect(work.artifact.origin).toBe('ai');
    expect(work.artifact.html).toBe(baseArtifact.html);
    expect(work.artifact.js).toContain('provider-result-1');
    const editedResponse = await api.request(`/api/works/${work.id}/edit`, { prompt: '점수를 더 크게 보여 주세요.', baseVersionId: work.versions.at(-1)!.id });
    expect(editedResponse.status).toBe(200);
    const edited = await editedResponse.json() as Work;
    expect(edited.artifact.js).toContain('provider-result-2');
    expect(edited.versions).toHaveLength(2);
    const repairedResponse = await api.request(`/api/works/${work.id}/repair`, { error: 'ReferenceError: score is not defined', baseVersionId: edited.versions.at(-1)!.id });
    expect(repairedResponse.status).toBe(200);
    const repaired = await repairedResponse.json() as Work;
    expect(repaired.artifact.js).toContain('provider-result-3');
    expect(repaired.versions).toHaveLength(3);
    expect(generations).toBe(3);
    expect(requests).toHaveLength(4);
    expect(requests.every(request => request.url.startsWith('https://api.openai.com/v1/'))).toBe(true);
    expect(requests.every(request => request.headers.get('authorization') === `Bearer ${sessionKey}`)).toBe(true);
    expect(requests[1].body.response_format.type).toBe('json_schema');
    expect(requests[1].body.response_format.json_schema.strict).toBe(true);
    const exported = await api.request(`/api/works/${work.id}/export`);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('attachment');
    const html = await exported.text();
    expect(html).toContain('provider-result-3');
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    const stored = await readFile(path.join(api.dataDir, 'works.json'), 'utf8');
    expect(stored).not.toContain(sessionKey);
    expect(JSON.stringify(await api.list())).not.toContain(sessionKey);
  });

  it('preserves the complete prior work on AI edit and repair failure, with one provider call per click and no starter fallback', async () => {
    let failedCalls = 0;
    const api = await start(async (_url, init) => {
      if (!bodyOf(init).response_format) return connectedReply();
      failedCalls++;
      return Response.json({ error: { message: `upstream-private-diagnostic-${sessionKey}` } }, { status: 502 });
    });
    expect((await api.connect()).status).toBe(200);
    const work = await api.create();
    const versionId = work.versions.at(-1)!.id;
    for (const [route, body] of [
      ['edit', { prompt: '보너스 점수를 추가해 주세요.', baseVersionId: versionId }],
      ['repair', { error: 'ReferenceError: missingCounter', baseVersionId: versionId }],
    ] as const) {
      const response = await api.request(`/api/works/${work.id}/${route}`, body);
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).not.toContain(sessionKey);
      expect(text).not.toContain('upstream-private-diagnostic');
      expect(await api.list()).toEqual([work]);
    }
    expect(failedCalls).toBe(2);
  });

  it.each(['invalid structured content', 'oversized chunked response', 'transport exception'])('preserves a work after %s without retrying or exposing provider diagnostics', async failure => {
    let generationCalls = 0;
    const api = await start(async (_url, init) => {
      if (!bodyOf(init).response_format) return connectedReply();
      generationCalls++;
      if (failure === 'transport exception') throw new Error(`provider-auth-diagnostic:${sessionKey}`);
      if (failure === 'invalid structured content') return Response.json({ choices: [{ message: { content: '{not-valid-json' } }] });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(600_000)));
          controller.enqueue(new TextEncoder().encode('y'.repeat(600_000)));
          controller.close();
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    expect((await api.connect()).status).toBe(200);
    const original = await api.create();
    const response = await api.request(`/api/works/${original.id}/edit`, { prompt: '실제로 새 기능을 만들어 주세요.', baseVersionId: original.versions.at(-1)!.id });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(sessionKey);
    expect(text).not.toContain('provider-auth-diagnostic');
    expect(generationCalls).toBe(1);
    expect(await api.list()).toEqual([original]);
  });
});

describe('creative connection and version safety', () => {
  it('does not replace a verified session with a failed new key or expose either key', async () => {
    const authorizations: string[] = [];
    const api = await start(async (_url, init) => {
      const authorization = new Headers(init.headers).get('authorization') || '';
      authorizations.push(authorization);
      if (authorization === `Bearer ${nextKey}`) return Response.json({ error: `rejected-${nextKey}` }, { status: 401 });
      return bodyOf(init).response_format ? providerReply(baseArtifact) : connectedReply();
    });
    expect((await api.connect()).status).toBe(200);
    const rejected = await api.connect(nextKey, 'rejected-new-model');
    expect(rejected.status).toBe(502);
    expect(await rejected.text()).not.toContain(nextKey);
    const status = await (await api.request('/api/creative/status')).json();
    expect(status).toMatchObject({ verified: true, model: 'test-creative-model', source: 'session' });
    await api.create('ai');
    expect(authorizations.at(-1)).toBe(`Bearer ${sessionKey}`);
    expect(JSON.stringify(status)).not.toContain(sessionKey);
    expect(JSON.stringify(status)).not.toContain(nextKey);
  });

  it('keeps environment credentials configured but unverified after disconnecting a session override', async () => {
    const envKey = 'test-environment-key-not-real';
    const api = await start(async () => connectedReply(), envKey);
    expect(await (await api.request('/api/creative/status')).json()).toMatchObject({ configured: true, verified: false, source: 'environment' });
    expect((await api.connect()).status).toBe(200);
    const disconnected = await api.request('/api/creative/connect', undefined, 'DELETE');
    expect(disconnected.status).toBe(200);
    const status = await disconnected.json();
    expect(status).toMatchObject({ configured: true, verified: false, source: 'environment' });
    expect(JSON.stringify(status)).not.toContain(envKey);
    expect(JSON.stringify(status)).not.toContain(sessionKey);
  });

  it('rejects private and insecure provider destinations before sending credentials', async () => {
    let calls = 0;
    const api = await start(async () => { calls++; return connectedReply(); });
    for (const baseUrl of ['http://127.0.0.1/v1', 'https://127.0.0.1/v1', 'https://10.0.0.1/v1', 'https://169.254.169.254/v1', 'https://[::1]/v1', 'https://user:password@api.openai.com/v1']) {
      const response = await api.request('/api/creative/connect', { apiKey: sessionKey, model: 'test-model', baseUrl });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(sessionKey);
    }
    expect(calls).toBe(0);
  });

  it('requires an explicit new key before forwarding a saved key to a different provider', async () => {
    const destinations: string[] = [];
    const api = await start(async url => { destinations.push(url); return connectedReply(); });
    expect((await api.connect()).status).toBe(200);
    const response = await api.request('/api/creative/connect', { model: 'another-model', baseUrl: 'https://different-provider.example/v1' });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(sessionKey);
    expect(destinations).toEqual(['https://api.openai.com/v1/chat/completions']);
  });

  it('rejects stale updates before spending AI calls and rejects an AI result made stale by a concurrent direct edit', async () => {
    let release!: (response: Response) => void;
    let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const providerResult = new Promise<Response>(resolve => { release = resolve; });
    let aiCalls = 0;
    const api = await start(async (_url, init) => {
      if (!bodyOf(init).response_format) return connectedReply();
      aiCalls++;
      started();
      return providerResult;
    });
    expect((await api.connect()).status).toBe(200);
    const original = await api.create();
    const initialVersion = original.versions.at(-1)!.id;
    const editing = api.request(`/api/works/${original.id}/edit`, { prompt: '게임의 새로운 보너스 기능을 추가해 주세요.', baseVersionId: initialVersion });
    await providerStarted;
    const directArtifact = { ...original.artifact, title: '먼저 저장한 나의 수정' };
    const directResponse = await api.request(`/api/works/${original.id}/artifact`, { artifact: directArtifact, baseVersionId: initialVersion, label: '직접 수정' }, 'PATCH');
    expect(directResponse.status).toBe(200);
    const direct = await directResponse.json() as Work;
    release(providerReply({ ...baseArtifact, title: '늦게 도착한 AI 수정' }));
    expect((await editing).status).toBe(409);
    expect(await api.list()).toEqual([direct]);
    const stale = await api.request(`/api/works/${original.id}/edit`, { prompt: '이미 지난 버전으로 수정', baseVersionId: initialVersion });
    expect(stale.status).toBe(409);
    expect(aiCalls).toBe(1);
    const restoredResponse = await api.request(`/api/works/${original.id}/restore`, { versionId: initialVersion, baseVersionId: direct.versions.at(-1)!.id });
    expect(restoredResponse.status).toBe(200);
    const restored = await restoredResponse.json() as Work;
    expect(restored.artifact).toEqual(original.artifact);
    expect(restored.versions).toHaveLength(3);
    expect(restored.versions.some(version => version.artifact.title === directArtifact.title)).toBe(true);
    const staleSave = await api.request(`/api/works/${original.id}/artifact`, { artifact: directArtifact, baseVersionId: direct.versions.at(-1)!.id }, 'PATCH');
    expect(staleSave.status).toBe(409);
    expect(await api.list()).toEqual([restored]);
  });
});
