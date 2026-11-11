// The dependency direction of docs/ARCHITECTURE.md, checked on every import under src/: a module imports only the
// modules below it, and the interface reaches everything under the engine through the engine's own index.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';

const SRC = resolve(__dirname, '../../src');
/** What each module may import (besides itself). */
const ALLOWED: Record<string, string[]> = {
  core: [],
  i18n: ['core'],
  text: ['core'],
  theme: ['core'],
  rhythm: ['core'],
  lyrics: ['core', 'text'],
  director: ['core', 'text', 'theme', 'rhythm', 'lyrics'],
  render: ['core', 'text', 'theme', 'rhythm', 'lyrics', 'director'],
  engine: ['core', 'text', 'theme', 'rhythm', 'lyrics', 'director', 'render'],
  app: ['core', 'theme', 'i18n', 'engine'],
  harness: ['core', 'text', 'theme', 'rhythm', 'lyrics', 'director', 'render', 'engine'],
};

const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(d, e.name))
      : /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')
        ? [join(d, e.name)]
        : [],
  );
const files = walk(SRC);
const imports = files.flatMap((f) => {
  const from = relative(SRC, f).split(sep)[0];
  return [...readFileSync(f, 'utf8').matchAll(/(?:from|import\()\s*'(\.[^'?]+)/g)]
    .map((m) => {
      const target = relative(SRC, resolve(dirname(f), m[1])),
        to = target.split(sep)[0];
      return { file: relative(SRC, f), from, to, target };
    })
    .filter((x) => x.to !== x.from);
});

describe('architecture', () => {
  it('every module under src/ is one the dependency rules know', () => {
    const mods = [...new Set(files.map((f) => relative(SRC, f).split(sep)[0]))].filter((m) => !/\.tsx?$/.test(m));
    expect(mods.filter((m) => !(m in ALLOWED))).toEqual([]);
  });
  it('imports only go down the layers', () => {
    const bad = imports
      .filter((x) => x.to in ALLOWED && !ALLOWED[x.from]?.includes(x.to))
      .map((x) => `${x.file} → ${x.target}`);
    expect(bad).toEqual([]);
  });
  it('in the interface, the logic never reaches into the views: an interface redo replaces views/ and ui/ only', () => {
    // (main.tsx is the entry that mounts the views; everything else — state, playback, actions, the bridge — is the
    // part a new interface keeps)
    // (the space, src/app/space, is an appearance too: the second one, beside views/)
    const viewish = (t: string) =>
      t.startsWith(`app${sep}views${sep}`) || t.startsWith(`app${sep}ui${sep}`) || t.startsWith(`app${sep}space${sep}`);
    const bad = files
      .filter((f) => {
        const r = relative(SRC, f);
        return r.startsWith(`app${sep}`) && !viewish(r) && r !== `app${sep}main.tsx`;
      })
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/(?:from|import\()\s*'(\.[^'?]+)/g)].map((m) => [
          relative(SRC, f),
          relative(SRC, resolve(dirname(f), m[1])),
        ]),
      )
      .filter(([, t]) => viewish(t))
      .map(([f, t]) => `${f} → ${t}`);
    expect(bad).toEqual([]);
  });
  it('the two appearances (the classic views and the space) never reach into each other', () => {
    const under = (r: string, d: string) => r.startsWith(`app${sep}${d}${sep}`);
    const bad = files
      .map((f) => relative(SRC, f))
      .filter((r) => under(r, 'space') || under(r, 'views'))
      .flatMap((r) =>
        [...readFileSync(join(SRC, r), 'utf8').matchAll(/(?:from|import\()\s*'(\.[^'?]+)/g)].map((m) => [
          r,
          relative(SRC, resolve(dirname(join(SRC, r)), m[1])),
        ]),
      )
      .filter(([f, t]) => (under(f, 'space') && under(t, 'views')) || (under(f, 'views') && under(t, 'space')))
      .map(([f, t]) => `${f} → ${t}`);
    expect(bad).toEqual([]);
  });
  it('the interface reaches the engine only through its index', () => {
    const bad = imports
      .filter((x) => x.from === 'app' && x.to === 'engine' && x.target !== 'engine')
      .map((x) => `${x.file} → ${x.target}`);
    expect(bad).toEqual([]);
  });
});

// The interface's look comes from its tokens (src/app/styles/tokens.css): a component never writes a corner radius or
// a duration as a number, so an interface redo retunes the scale in one place.
describe('interface tokens', () => {
  const APP = join(SRC, 'app'),
    TOKENS = join(APP, 'styles', 'tokens.css');
  const css = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? css(join(d, e.name)) : e.name.endsWith('.css') ? [join(d, e.name)] : [],
    );
  it('no literal radii or durations in the component styles', () => {
    const bad = css(APP)
      .filter((f) => f !== TOKENS)
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((l, i) =>
            /border-radius:\s*[0-9.]+(px|rem|em)\b|(?<![-\w.])\d{2,4}ms\b/.test(l)
              ? [`${relative(SRC, f)}:${i + 1}`]
              : [],
          ),
      );
    expect(bad).toEqual([]);
  });
});
