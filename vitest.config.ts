import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: [process.env.DBG ? 'tests/debug/**/*.test.ts' : 'tests/unit/**/*.test.ts'], testTimeout: 120000 } });
