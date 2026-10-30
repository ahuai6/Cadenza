import { defineConfig } from 'vitest/config';
// (the word segmenter's dictionary reaches it as virtual modules: scripts/segmentData.mjs)
// @ts-expect-error (a plain ES module of the build, no types)
import { icuFoliaDataPlugin } from './scripts/segmentData.mjs';
export default defineConfig({ plugins: [icuFoliaDataPlugin()], test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 120000 } });
