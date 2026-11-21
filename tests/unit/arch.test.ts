// The current boundary and its known exceptions are documented in docs/ARCHITECTURE.md.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { boundaryViolation, buildDependencies, cyclicRuntimeEdges, references, type Edge } from './_dependencies';

const ROOT = resolve(__dirname, '../..');
const SRC = join(ROOT, 'src');
const ALLOWED: Record<string, string[]> = {
  core: [],
  i18n: ['core'],
  text: ['core'],
  theme: ['core'],
  rhythm: ['core'],
  lyrics: ['core', 'text'],
  director: ['core', 'text', 'theme', 'rhythm', 'lyrics'],
  folia: ['core', 'text', 'theme', 'rhythm', 'lyrics'],
  render: ['core', 'text', 'theme', 'rhythm', 'lyrics', 'director', 'folia'],
  engine: ['core', 'text', 'theme', 'rhythm', 'lyrics', 'director', 'render', 'folia'],
  app: ['core', 'theme', 'i18n', 'engine'],
  harness: ['core', 'text', 'theme', 'rhythm', 'lyrics', 'director', 'render', 'engine', 'folia'],
};

const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((file) => file.isFile() && /\.tsx?$/.test(file.name))
  .map((file) => join(file.parentPath, file.name));
const { edges, unresolved } = await buildDependencies(files, ROOT);

const dependency = (from: string, to: string, typeOnly = false): Edge => ({ from, to, line: 1, typeOnly });

describe('architecture', () => {
  it('resolves local imports and checks layer direction, entry points and views', () => {
    expect(unresolved).toEqual([]);
    expect(
      edges.flatMap((edge) => {
        const why = boundaryViolation(edge, ALLOWED);
        return why ? [edge.from + ':' + edge.line + ' → ' + edge.to + ' (' + why + ')'] : [];
      }),
    ).toEqual([]);
  });

  it('knows every source layer', () => {
    const layers = new Set(
      files.map((name) => relative(SRC, name).split(/[\\/]/)[0]).filter((layer) => !/\.tsx?$/.test(layer)),
    );
    expect([...layers].filter((layer) => !(layer in ALLOWED))).toEqual([]);
  });

  it('does not add runtime cycle edges to the 3.6.0 graph', () => {
    const baseline = new Set([
      // G9: shared controls and album presentation still reach across sibling views.
      'src/app/views/AlbumLine.tsx → src/app/views/Library.tsx',
      'src/app/views/Effect.tsx → src/app/views/Modals.tsx',
      'src/app/views/Effect.tsx → src/app/views/Settings.tsx',
      'src/app/views/Library.tsx → src/app/views/AlbumLine.tsx',
      'src/app/views/Modals.tsx → src/app/views/Effect.tsx',
      'src/app/views/Settings.tsx → src/app/views/Modals.tsx',
      // Lyrics parsing and TTML conversion currently call back into each other.
      'src/lyrics/parse.ts → src/lyrics/ttml.ts',
      'src/lyrics/ttml.ts → src/lyrics/parse.ts',
      // G6: the analysis entry re-exports the streaming helper that calls it.
      'src/rhythm/index.ts → src/rhythm/stream.ts',
      'src/rhythm/stream.ts → src/rhythm/index.ts',
    ]);
    expect(cyclicRuntimeEdges(edges).filter((edge) => !baseline.has(edge))).toEqual([]);
  });
});

describe('architecture checker', () => {
  it('keeps the playback state machine independent of platform and visual adapters', () => {
    const coordinator = 'src/app/playback/coordinator.ts';
    expect(boundaryViolation(dependency(coordinator, 'src/engine/index.ts'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency(coordinator, 'src/app/bridge.ts'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency(coordinator, 'src/app/playback/outputs.ts'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency(coordinator, 'src/core/emitter.ts'), ALLOWED)).toBeNull();
  });
  it('finds executable and type references without interpreting comments or strings', () => {
    const content = [
      '// import fake from "../fake";',
      'const label = "import fake from another";',
      'import "../side-effect";',
      'import { thing } from "../double";',
      'export { other } from "../re-export";',
      'export type { Style } from "../types";',
      'import { type Shape } from "../shape";',
      'type T = import("../contract").T;',
      'const worker = import(`../worker?worker&inline`);',
      'const fromAlias = require("@app/alias");',
    ].join('\n');
    expect(references('fixture.ts', content)).toEqual([
      { specifier: '../side-effect', line: 3, typeOnly: false },
      { specifier: '../double', line: 4, typeOnly: false },
      { specifier: '../re-export', line: 5, typeOnly: false },
      { specifier: '../types', line: 6, typeOnly: true },
      { specifier: '../shape', line: 7, typeOnly: true },
      { specifier: '../contract', line: 8, typeOnly: true },
      { specifier: '../worker?worker&inline', line: 9, typeOnly: false },
      { specifier: '@app/alias', line: 10, typeOnly: false },
    ]);
  });

  it('checks the resolved alias, even when it points to an internal file rather than a public entry', async () => {
    const file = join(__dirname, 'fixtures/architecture/importer.ts.txt');
    const { edges: imports, unresolved: missing } = await buildDependencies([file], ROOT, {
      '@stage': join(SRC, 'engine/engine.ts'),
      '@engine': join(SRC, 'engine/index.ts'),
    });
    expect(missing).toEqual([]);
    expect(imports.map((edge) => edge.to)).toEqual([
      'src/engine/engine.ts',
      'src/engine/index.ts',
      'electron',
      'node:fs',
    ]);
    expect(imports.map((edge) => boundaryViolation({ ...edge, from: 'src/app/playback/player.ts' }, ALLOWED))).toEqual([
      'engine public entry',
      null,
      'source must use the platform bridge',
      'source must use the platform bridge',
    ]);
  });

  it('keeps platform access and view dependencies behind their boundaries', () => {
    expect(boundaryViolation(dependency('src/app/playback/player.ts', 'electron/main.cjs'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency('src/app/actions/a.ts', 'src/app/ui/widget.tsx'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency('src/app/views/a.tsx', 'src/app/space/b.ts'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency('src/rhythm/a.ts', 'src/app/actions/b.ts'), ALLOWED)).toBeTruthy();
    expect(boundaryViolation(dependency('src/app/views/a.tsx', 'src/app/ui/widget.tsx'), ALLOWED)).toBeNull();
    expect(boundaryViolation(dependency('src/app/main.tsx', 'src/app/views/a.tsx'), ALLOWED)).toBeNull();
  });

  it('finds indirect runtime cycles without treating references to types as runtime loads', () => {
    const a = dependency('a', 'b');
    const b = dependency('b', 'c');
    const c = dependency('c', 'a');
    expect(cyclicRuntimeEdges([a, b, c, dependency('d', 'a')])).toEqual(['a → b', 'b → c', 'c → a']);
    expect(cyclicRuntimeEdges([a, b, { ...c, typeOnly: true }])).toEqual([]);
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
