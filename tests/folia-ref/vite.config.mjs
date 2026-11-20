import { defineConfig } from 'vite';
import { resolve } from 'node:path';
// Data sources only, never drawing code: the drum hits come in the way they do in Cadenza's port (its shim), so the
// two sides read the same hits instead of Folia's in-browser stem separation.
const SHIM = '/home/user/cadenza/src/folia/shim';
export default defineConfig({
  root: import.meta.dirname,
  css: { postcss: {} },
  resolve: {
    alias: [
      { find: /^.*services\/analysis\/drumHits$/, replacement: SHIM + '/drumHits.ts' },
      { find: '@', replacement: resolve(import.meta.dirname, '../src') },
    ],
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { index: resolve(import.meta.dirname, 'index.html'), bg: resolve(import.meta.dirname, 'bg.html') },
    },
  },
  logLevel: 'warn',
});
