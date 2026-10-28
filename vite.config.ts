import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// mode 'app': the desktop interface (dist-app), 'web': the workshop as one HTML file (dist-web), 'harness': the test page
export default defineConfig(({ mode }) => {
  const app = mode === 'app', harness = mode === 'harness';
  const fonts = app ? `<script>window.CADENZA_FONTS='fonts/';</script>` : '';
  const csp = app
    ? "default-src 'self' cadenza: data: blob:; img-src 'self' cadenza: data: blob: https:; media-src 'self' cadenza: blob:; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' file:; font-src 'self' data: file:; connect-src 'self' cadenza: data: blob:"
    : '';
  return {
    base: './',
    plugins: [react(), ...(harness ? [] : [viteSingleFile({ removeViteModuleLoader: true })]),
      { name: 'cadenza-html', transformIndexHtml: (html: string) => html.replace('<!--CSP-->', csp ? `<meta http-equiv="Content-Security-Policy" content="${csp}">` : '').replace('<!--FONTS-->', fonts) }],
    worker: { format: 'es' },
    build: { outDir: app ? 'dist-app' : harness ? 'dist-harness' : 'dist-web', emptyOutDir: true, assetsInlineLimit: 100000000, chunkSizeWarningLimit: 100000,
      rollupOptions: { input: harness ? resolve(import.meta.dirname, 'harness.html') : app ? resolve(import.meta.dirname, 'index.html') : resolve(import.meta.dirname, 'web.html') } },
    resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  };
});
