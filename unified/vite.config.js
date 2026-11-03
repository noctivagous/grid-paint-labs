import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const unifiedRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: unifiedRoot,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@nct/nctgraphite': fileURLToPath(new URL('../NCTGraphite/packages/nctgraphite/src/index.ts', import.meta.url)) } },
  server: { port: 8124, strictPort: true, host: '127.0.0.1', fs: { allow: [repoRoot] } },
  build: { outDir: fileURLToPath(new URL('../dist-unified', import.meta.url)), emptyOutDir: true },
});
