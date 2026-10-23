import { defineConfig, loadEnv, type ConfigEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Convert trusted, exact origins into exact Vite hosts without wildcard expansion. */
export function allowedPreviewHosts(origins: string | undefined): string[] {
  const hosts = new Set<string>();
  for (const value of origins?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? []) {
    try {
      const origin = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.hostname.endsWith('.localhost');
      // Requiring the canonical origin rejects paths, trailing slashes, query/hash,
      // credentials, and non-origin URL syntax. A leading dot has wildcard meaning
      // in Vite, so never accept it as an exact trusted host.
      if (origin.origin !== value || origin.username || origin.password || origin.hostname.startsWith('.') || origin.hostname.includes('*')) continue;
      if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local)) continue;
      hosts.add(origin.hostname);
    } catch { /* A malformed configuration entry grants no host access. */ }
  }
  return [...hosts];
}

export function createViteConfig({ mode }: ConfigEnv) {
  // DDUK_ values stay server-side: only the existing VITE_ prefix is exposed to
  // browser code. Explicit process settings take precedence over .env files.
  const environment = loadEnv(mode, process.cwd(), 'DDUK_');
  const origins = process.env.DDUK_ALLOWED_ORIGINS ?? environment.DDUK_ALLOWED_ORIGINS;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      allowedHosts: allowedPreviewHosts(origins),
      proxy: {
        '/api': 'http://127.0.0.1:3001',
        '/published': 'http://127.0.0.1:3001',
      },
    },
    test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 },
  };
}

export default defineConfig(createViteConfig);
