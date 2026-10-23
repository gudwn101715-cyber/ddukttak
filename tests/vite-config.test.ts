import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as httpRequest } from 'node:http';
import { createServer as createPortProbe, type AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { allowedPreviewHosts, createViteConfig } from '../vite.config';

const servers: ViteDevServer[] = [];
const cacheDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(cacheDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.unstubAllEnvs();
});

describe('trusted preview host configuration', () => {
  it('extracts exact HTTPS and local HTTP hosts without changing the implicit localhost access', () => {
    expect(allowedPreviewHosts('https://trusted-preview.example, http://localhost:5173, https://trusted-preview.example, http://127.0.0.1:5173, http://[::1]:5173'))
      .toEqual(['trusted-preview.example', 'localhost', '127.0.0.1', '[::1]']);
    expect(allowedPreviewHosts(undefined)).toEqual([]);
  });

  it.each([
    '*', 'https://*.example.com', 'https://.example.com', 'http://untrusted.example',
    'https://trusted.example/path', 'https://trusted.example/', 'https://trusted.example?grant=all',
    'https://trusted.example#fragment', 'https://user:pass@trusted.example', 'file:///tmp',
    'https:trusted.example', '.example.com', 'not a URL',
  ])('does not grant access for malformed or non-origin entry %s', (origin) => {
    expect(allowedPreviewHosts(origin)).toEqual([]);
  });

  it('serves a configured exact proxy host and rejects an unrelated host in a real Vite server', async () => {
    vi.stubEnv('DDUK_ALLOWED_ORIGINS', 'https://trusted-preview.example');
    const config = createViteConfig({ mode: 'development', command: 'serve' });
    const probe = createPortProbe();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const availablePort = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'ddukttak-vite-test-'));
    cacheDirectories.push(cacheDir);
    const server = await createServer({
      ...config,
      configFile: false,
      cacheDir,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { ...config.server, host: '127.0.0.1', port: availablePort, strictPort: true, hmr: false },
    });
    servers.push(server);
    await server.listen();
    const port = (server.httpServer!.address() as AddressInfo).port;
    const get = (host: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: '/', headers: { Host: host } }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      });
      request.on('error', reject);
      request.end();
    });
    const trusted = await get('trusted-preview.example');
    expect(trusted.status).toBe(200);
    expect(trusted.body).toContain('<html lang="ko">');
    expect((await get('127.0.0.1')).status).toBe(200);
    const untrusted = await get('unrelated.example');
    expect(untrusted.status).toBe(403);
    expect(untrusted.body).toContain('not allowed');
  });
});
