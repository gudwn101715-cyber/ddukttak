import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateSchema } from '../src/lib/generator';
import { defaultAppContent } from '../src/lib/schema';
import type { GenerateInput, Project } from '../src/lib/schema';
import { createApp } from '../server/app';
import { requestAiSchema } from '../server/ai';

const servers: Server[] = [];
const directories: string[] = [];
const input: GenerateInput = {
  name: '느린 오후', description: '커피와 책이 함께하는 작은 카페', kind: 'landing', style: 'natural', features: ['contact'],
};

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('structured AI integration', () => {
  it('sends a strict schema request and accepts a validated structured response', async () => {
    let recordedRequest: Record<string, any> | undefined;
    // The model contract excludes directly edited gallery/FAQ/review content.
    const { content: _localContent, ...expected } = generateSchema(input);
    const base = await listen(createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      recordedRequest = JSON.parse(body);
      expect(req.url).toBe('/v1/chat/completions');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(expected) } }] }));
    }));
    const result = await requestAiSchema({ key: 'test-key-not-a-real-secret', baseUrl: `${base}/v1`, model: 'test-structured-model' }, input);
    expect(result).toEqual({ ...expected, content: defaultAppContent(expected.kind) });
    expect(recordedRequest?.model).toBe('test-structured-model');
    expect(recordedRequest?.response_format.type).toBe('json_schema');
    expect(recordedRequest?.response_format.json_schema.strict).toBe(true);
    expect(recordedRequest?.messages.some((entry: {role: string;content: string}) => entry.role === 'user' && entry.content.includes(input.name))).toBe(true);
  });

  it.each(['malformed JSON', 'oversized chunked response'])('retries %s AI edits exactly twice and retains the previous app without leaking credentials', async failureMode => {
    const schema = generateSchema(input);
    let calls = 0;
    const mockBase = await listen(createServer((_req, res) => {
      calls++;
      res.setHeader('Content-Type', 'application/json');
      if (calls === 1) {
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(schema) } }] }));
      } else if (failureMode === 'oversized chunked response') {
        // No Content-Length: the client must enforce its limit while streaming.
        res.write('x'.repeat(80_000));
        res.end('y'.repeat(80_000));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: '{invalid-json' } }] }));
      }
    }));
    const dataDir = await mkdtemp(path.join(tmpdir(), 'ddukttak-ai-test-'));
    directories.push(dataDir);
    const fakeKey = 'test-private-key-never-expose-to-client';
    const app = createApp({ dataDir, aiKey: fakeKey, aiBaseUrl: `${mockBase}/v1` });
    const appBase = await listen(createServer(app));
    const post = (url: string, body: unknown) => fetch(`${appBase}${url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const createdResponse = await post('/api/projects', input);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as Project;
    const editResponse = await post(`/api/projects/${created.id}/edit`, { prompt: '페이지 설명을 더 자세하게 해줘' });
    expect(editResponse.status).toBe(502);
    const errorText = await editResponse.text();
    expect(errorText).not.toContain(fakeKey);
    expect(errorText).not.toContain('{invalid-json');
    expect(calls).toBe(4); // One successful creation, then three edit attempts.
    const unchanged = await (await fetch(`${appBase}/api/projects/${created.id}`)).json() as Project;
    expect(unchanged.schema).toEqual(created.schema);
    expect(unchanged.versions).toEqual(created.versions);
    expect(unchanged.messages).toEqual(created.messages);
  });

  it('does not retry an authentication rejection or surface upstream response text', async () => {
    let calls = 0;
    const mockBase = await listen(createServer((_req, res) => {
      calls++;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'upstream-private-diagnostic' }));
    }));
    await expect(requestAiSchema({ key: 'test-auth-key', baseUrl: `${mockBase}/v1` }, input)).rejects.toThrow('AI 서비스');
    expect(calls).toBe(1);
  });

  it('keeps user-authored image and feature content out of AI requests and preserves it during edits', async () => {
    const schema = generateSchema(input);
    const content = {
      gallery: [{ title: '사용자가 올린 사진', description: '직접 쓴 사진 설명', image: 'data:image/jpeg;base64,/9j/2Q==' }],
      faq: [{ question: '직접 쓴 질문', answer: '직접 쓴 답변' }],
      testimonials: [{ quote: '직접 입력한 후기', name: '홍길동' }],
    };
    let requestBody = '';
    const base = await listen(createServer(async (req, res) => {
      for await (const chunk of req) requestBody += chunk;
      res.setHeader('Content-Type', 'application/json');
      const generated = { ...schema, hero: { ...schema.hero, title: 'AI가 수정한 메인 제목' }, content: { gallery: [], faq: [], testimonials: [] } };
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(generated) } }] }));
    }));
    const result = await requestAiSchema({ key: 'test-only-key', baseUrl: `${base}/v1` }, { schema: { ...schema, content }, prompt: '메인 제목을 새롭게 다듬어줘' });
    expect(result.hero.title).toBe('AI가 수정한 메인 제목');
    expect(result.content).toEqual(content);
    expect(requestBody).not.toContain(content.gallery[0].image);
    expect(requestBody).not.toContain(content.gallery[0].title);
    expect(requestBody).not.toContain(content.faq[0].answer);
    expect(requestBody).not.toContain(content.testimonials[0].quote);
  });
});
