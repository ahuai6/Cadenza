// Folia's visualizers on Cadenza: the Pixi-compatible stage keeps Pixi v8's semantics where Folia relies on them,
// the lyric model reaches Folia intact, and a style's composition depends on the song alone.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Graphics, Container, BlurFilter, ColorMatrixFilter, Color, Matrix } from '../../src/folia/pixi';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';
import { foliaLines } from '../../src/folia/adapt';
import { beatEvents, FoliaFrameMusic, installBeats } from '../../src/folia/live';
import {
  getBeatFxHeard,
  getBeatEffectStrength,
  getBeatFxTrackScale,
} from '../../src/folia/vendor/services/beatFx/beatFxLive';
import { compileSonnetProgram } from '../../src/folia/vendor/components/visualizer/sonnet/sonnetProgram';

const LRC = readFileSync(new URL('../fixtures/long.lrc', import.meta.url), 'utf8');
const docOf = () => {
  const map = RhythmMap.grid(112, 0.3, 160),
    p = parse(LRC);
  return { doc: buildLyrics(p, map, Math.max(...p.lines.map((l) => l.t)) + 6), map };
};

it('binds each stage to its own media time and strength even across an interleaved render', () => {
  const first = new FoliaFrameMusic();
  const next = new FoliaFrameMusic();
  const map = RhythmMap.grid(96, 0, 12);
  const inspect = () => [getBeatFxHeard(), getBeatEffectStrength('effect')];
  const start = inspect();
  const result = first.frame('first', map, { effect: 0.3 }, 3.7, true, undefined, inspect);
  expect(result).toEqual([{ key: 'first', time: 3.7 }, 0.3]);
  expect(next.frame('next', map, { effect: 1.2 }, 8, true, undefined, inspect)).toEqual([
    { key: 'next', time: 8 },
    1.2,
  ]);
  expect(first.frame('first', map, { effect: 0.3 }, 3.7, true, undefined, inspect)).toEqual(result);
  expect(inspect()).toEqual(start);
});

describe('the stage keeps Pixi v8 semantics', () => {
  it('a fill right after a stroke reuses its path, and cut() punches the last fill', () => {
    const g = new Graphics().rect(0, 0, 10, 10).stroke({ color: 0xff0000, width: 2 }).fill(0x00ff00);
    const ins = g.context.instructions;
    expect(ins.map((i) => i.action)).toEqual(['stroke', 'fill']);
    expect(ins[0].action !== 'texture' && ins[1].action !== 'texture' && ins[0].data.path === ins[1].data.path).toBe(
      true,
    );
    const h = new Graphics()
      .poly([0, 0, 20, 0, 20, 20])
      .fill({ color: 0xffffff, alpha: 0.5 })
      .poly([5, 2, 15, 2, 15, 12])
      .cut();
    const f = h.context.instructions[0];
    expect(f.action === 'fill' && f.data.hole?.ops.length).toBeGreaterThan(0);
    expect(f.action === 'fill' && f.data.style.alpha).toBe(0.5);
  });
  it('bounds follow transforms, pivots and the stroke width', () => {
    const c = new Container();
    const g = c.addChild(new Graphics().rect(0, 0, 100, 50).stroke({ width: 4 }));
    g.position.set(10, 20);
    g.pivot.set(50, 25);
    g.scale.set(2);
    const b = c.getLocalBounds();
    expect(b.x).toBeCloseTo(10 - 2 * 52, 5);
    expect(b.width).toBeCloseTo(2 * 104, 5);
    expect(b.height).toBeCloseTo(2 * 54, 5);
  });
  it('invisible children and masks are not measured', () => {
    const c = new Container();
    c.addChild(new Graphics().rect(0, 0, 10, 10).fill(0));
    const hidden = c.addChild(new Graphics().rect(0, 0, 1000, 1000).fill(0));
    hidden.visible = false;
    const m = c.addChild(new Graphics().rect(0, 0, 500, 500).fill(0));
    c.children[0].mask = m;
    expect(c.getLocalBounds().width).toBe(10);
  });
  it('the local transform is Pixi’s (rotation, skew, pivot)', () => {
    const c = new Container();
    c.position.set(5, 7);
    c.rotation = Math.PI / 2;
    c.pivot.set(1, 0);
    const m = c.updateLocalTransform(new Matrix());
    const p = m.apply({ x: 1, y: 0 });
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(7, 6);
  });
  it('filters: blur padding and spread, colour-matrix contrast, colours', () => {
    const b = new BlurFilter({ strength: 6, quality: 2 });
    expect(b.padding).toBe(12);
    b.repeatEdgePixels = true;
    expect(b.padding).toBe(0);
    expect(b.sigma(6)).toBeCloseTo(6 * Math.sqrt(1.669 / 2), 6);
    const cm = new ColorMatrixFilter();
    cm.contrast(0.5);
    expect(cm.matrix[0]).toBeCloseTo(1.5, 6);
    expect(Color.shared.setValue('#ff8000').toNumber()).toBe(0xff8000);
    expect(Color.shared.setValue('rgba(0, 128, 255, 0.5)').toArray()[3]).toBe(0.5);
  });
});

describe('Cadenza’s lyrics reach Folia intact', () => {
  it('each line’s segments are Cadenza’s words and join to its text', () => {
    const { doc } = docOf();
    const lines = foliaLines(doc);
    expect(lines.length).toBe(doc.lines.filter((L) => L.words.length).length);
    for (const L of lines) {
      expect(L.wordSegments!.join('')).toBe(L.fullText);
      expect(L.endTime).toBeGreaterThanOrEqual(L.startTime);
    }
  });
  it('the beat clock gets every beat, downbeats marked', () => {
    const { map } = docOf();
    const ev = beatEvents(map);
    expect(ev.length).toBe(map.beats.length);
    expect(ev.some((e) => e.kind === 'downbeat')).toBe(true);
  });
  it('consumes shared beat strength, tone and evidence at scene time', () => {
    const { a } = RhythmMap.grid(120, 0, 3);
    const values = (v: number) => a.beats.map(() => v);
    const map = new RhythmMap(
      {
        ...a,
        source: 'audio',
        accents: {
          impact: values(0.8),
          low: values(0.6),
          mid: values(0.3),
          high: values(0.1),
          rhythmic: a.beats.map((_, i) => Number(i > 0)),
          conf: values(4),
          trackScale: 0.5,
        },
      },
      0.25,
    );
    expect(beatEvents(map).slice(0, 2)).toEqual([
      { t: -0.25, kind: 'downbeat', impact: 0.8, tone: { low: 0.6, mid: 0.3, high: 0.1 }, barPos: 0, rhythmic: false },
      { t: 0.25, kind: 'beat', impact: 0.8, tone: { low: 0.6, mid: 0.3, high: 0.1 }, barPos: 1, rhythmic: true },
    ]);
    installBeats('shared-beat-evidence', map);
    expect(getBeatFxTrackScale()).toBe(0.5);
  });
  it('Sonnet’s program depends on the song alone (same song, same shots)', () => {
    const { doc } = docOf();
    const a = compileSonnetProgram(foliaLines(doc), 'song'),
      b = compileSonnetProgram(foliaLines(doc), 'song');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.paragraphs.length).toBeGreaterThan(1);
    expect(new Set(a.paragraphs.flatMap((p) => p.shots.map((s) => s.kind))).size).toBeGreaterThan(2);
  });
});

describe('the vendored Folia tree', () => {
  it('matches its manifest (scripts/folia-sync.mjs --check, when an upstream checkout is at hand)', () => {
    const up = process.env.FOLIA_UPSTREAM;
    if (!up) return;
    expect(() => execFileSync('node', ['scripts/folia-sync.mjs', '--check', up], { stdio: 'pipe' })).not.toThrow();
  });
});

describe('Folia backgrounds', () => {
  it('registers the five as backdrops whose settings read back as Folia tunings', async () => {
    await import('../../src/render/effects/foliaBackdrops');
    const { effect } = await import('../../src/render/effects/registry');
    const { latentTuning, monetTuning, nomandTuning } = await import('../../src/folia/backgrounds');
    const types = await import('../../src/folia/vendor/types');
    for (const id of ['f-common', 'f-latent', 'f-sora', 'f-monet', 'f-nomand']) {
      const e = effect(id);
      expect(e?.kind).toBe('backdrop');
      for (const p of e!.params || []) if (p.showIf) expect(e!.params!.some((q) => q.key === p.showIf![0])).toBe(true);
    }
    // every setting left at its default gives Folia's own defaults back
    const defs = (id: string) => Object.fromEntries(effect(id)!.params!.map((p) => [p.key, p.def]));
    expect(latentTuning(defs('f-latent'))).toEqual(types.DEFAULT_LATENT_BACKGROUND_TUNING);
    expect(monetTuning(defs('f-monet'))).toEqual(types.DEFAULT_MONET_BACKGROUND_TUNING);
    expect(nomandTuning(defs('f-nomand'))).toEqual(types.DEFAULT_NOMAND_BACKGROUND_TUNING);
  });
});
