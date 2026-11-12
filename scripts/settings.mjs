// Writes electron/settings.defaults.json — the defaults the desktop's main process saves over — from the one place
// every setting is declared (src/app/settings/schema.ts). Run after adding or changing a setting; a unit test fails
// while the file is out of date. (Node reads the TypeScript file directly: 22.18 or later.)
import { writeFileSync } from 'node:fs';
import { DEFAULTS } from '../src/app/settings/schema.ts';

const out = new URL('../electron/settings.defaults.json', import.meta.url);
writeFileSync(out, JSON.stringify(DEFAULTS, null, 2) + '\n');
console.log(`settings: ${Object.keys(DEFAULTS).length} → electron/settings.defaults.json`);
