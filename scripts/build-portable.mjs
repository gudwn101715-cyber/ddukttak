import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const target = path.resolve(process.argv[2] || 'artifacts/ddukttak-preview.html');
const results = await build({
  configFile: false,
  publicDir: false,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'warn',
  build: {
    write: false,
    lib: { entry: path.resolve('src/portable-main.tsx'), name: 'DdukttakPortable', formats: ['iife'] },
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const outputs = (Array.isArray(results) ? results : [results]).flatMap(result => result.output);
const javascript = outputs.filter(output => output.type === 'chunk').map(output => output.code).join('\n');
const css = outputs.filter(output => output.type === 'asset' && output.fileName.endsWith('.css')).map(output => String(output.source)).join('\n');
if (!javascript || !css || outputs.some(output => output.type === 'asset' && !output.fileName.endsWith('.css'))) {
  throw new Error('Portable build must contain one inline script and styles with no separate assets.');
}
const safeScript = javascript.replace(/<\/script/gi, '<\\/script');
const safeStyles = css.replace(/<\/style/gi, '<\\/style');
const packages = ['react', 'react-dom', 'lucide-react', '@fontsource-variable/dm-sans', '@fontsource-variable/noto-sans-kr'];
const notices = (await Promise.all(packages.map(async name => `${name}\n${await readFile(path.resolve('node_modules', name, 'LICENSE'), 'utf8')}`))).join('\n\n');
const html = `<!doctype html>
<!-- Third-party licenses\n${notices.replace(/-->/g, '-- >')}\n-->
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; font-src data:; img-src data: blob: https:; frame-src 'self' blob: data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>무엇이든 뚝딱 — 설치 없는 체험판</title><style>${safeStyles}</style></head>
<body><div id="root"></div><script>window.__DDUKTTAK_PORTABLE__=true;\n${safeScript}</script></body></html>`;
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, html, 'utf8');
await writeFile(path.join(path.dirname(target), 'THIRD_PARTY_NOTICES.txt'), notices, 'utf8');
console.log(`Portable HTML created: ${target} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
