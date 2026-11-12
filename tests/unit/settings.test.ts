// Every setting is declared once (src/app/settings/schema.ts); what is generated from it must be up to date.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULTS, SCHEMA, allowed, type SettingKey } from '../../src/app/settings/schema';

describe('the settings schema', () => {
  it("the main process's defaults are the schema's (npm run gen:settings)", () => {
    const saved = JSON.parse(readFileSync(new URL('../../electron/settings.defaults.json', import.meta.url), 'utf8'));
    expect(saved).toEqual(DEFAULTS);
  });
  it('every default is a value its own declaration allows; a stray value is not', () => {
    for (const k of Object.keys(SCHEMA) as SettingKey[]) expect(allowed(k, DEFAULTS[k]), k).toBe(true);
    expect(allowed('gfx', 'ultra')).toBe(false);
    expect(allowed('spaceWalk', 9)).toBe(false);
    expect(allowed('volBalance', 'yes')).toBe(false);
  });
  it('the main process keeps no list of its own, and reads the generated one', () => {
    const main = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
    expect(main).toContain("const DEFAULTS = require('./settings.defaults.json');");
  });
});
