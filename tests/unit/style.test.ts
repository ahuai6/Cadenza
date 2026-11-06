// The three layers of a style (theme/style.ts): a look, a motion style and the knobs, taken in apart; the five tuning
// knobs over the detailed ones; styles saved before the layers had names unchanged; and the style recommended for a song.
import { describe, it, expect } from 'vitest';
import { presetStyle, normalizeStyle, styleFromStored, storedStyle, withLook, withMotion, motionPart, withSavedMotion, motionOf, knobbed, MOTIONS, MACROS, KNOBS, PRESETS } from '../../src/theme/style';
import { recommendMotion } from '../../src/director/recommend';
import { parse } from '../../src/lyrics/parse';
import { buildLyrics } from '../../src/lyrics/model';
import { RhythmMap } from '../../src/rhythm/map';

const custom = (id = 'cover') => normalizeStyle({ ...presetStyle(id), preset: 'custom' });

describe('looks and motion styles', () => {
  it('a new song: the cover look with its own motion, which is 敘事', () => {
    const s = presetStyle('cover'), r = MOTIONS.story;
    expect(motionOf(s)).toBe('story'); expect([s.cut, s.ltype ?? 'flow', s.tin, s.tout]).toEqual([r.cut, r.ltype, r.tin, r.tout]); expect(s.m0).toEqual(r.m0);
  });
  it('a motion style changes how the lyrics move, never the look', () => {
    const a = custom('gothic'), b = withMotion(a, 'float');
    for (const k of ['bg', 'bg2', 'text', 'accent', 'flash', 'font', 'bgStyle'] as const) expect(b[k]).toEqual(a[k]);
    expect(b.fx).toEqual(a.fx); expect([b.cut, b.ltype, b.tin, b.tout, b.motion]).toEqual(['hover', 'orbit', 'blur', 'spread', 'float']);
  });
  it('a look changes the backdrop, colours, typeface and effects, never the motion or the knobs', () => {
    const a = withMotion({ ...custom(), k: { ...custom().k, force: 1.4, pace: 0.8 } }, 'groove'), b = withLook(a, 'vinyl');
    expect([b.cut, b.ltype, b.tin, b.tout, b.motion]).toEqual([a.cut, a.ltype, a.tin, a.tout, a.motion]); expect(b.m0).toEqual(a.m0); expect(b.k).toEqual(a.k);
    expect([b.bgStyle, b.font]).toEqual([PRESETS.vinyl.bgStyle, PRESETS.vinyl.font]); expect(b.fx).toEqual(PRESETS.vinyl.fx);
  });
  it('a saved motion style (我的風格) carries how the lyrics move and every knob but the size, never the look', () => {
    const a = { ...withMotion(custom('gothic'), 'float'), trans: 'off' as const, future: 'hide' as const, k: { ...custom().k, force: 1.4, pace: 0.7, size: 1.3 } };
    const m = JSON.parse(JSON.stringify(motionPart(a))), b = withSavedMotion({ ...custom('vinyl'), k: { ...custom().k, size: 0.8 } }, m, 'm1', 'Mine');
    expect([b.cut, b.ltype, b.tin, b.tout, b.trans, b.future, b.motion]).toEqual([a.cut, a.ltype, a.tin, a.tout, 'off', 'hide', 'float']);
    expect(b.m0).toEqual(a.m0); expect(b.k.force).toBe(1.4); expect(b.k.pace).toBe(0.7); expect(b.k.size).toBe(0.8);
    expect([b.bgStyle, b.font]).toEqual([PRESETS.vinyl.bgStyle, PRESETS.vinyl.font]); expect([b.motionId, b.motionName]).toEqual(['m1', 'Mine']);
    expect(b.m).toEqual(knobbed(b.m0, b.k));
    // (a built-in style taken afterwards leaves the saved one)
    expect(withMotion(b, 'story').motionId).toBeNull();
  });
  it('a style saved before the styles had names reads as the one its camera is, and moves exactly as it did', () => {
    const old = { ...storedStyle(custom('liquid')) } as any; delete old.motion; old.k = { ...old.k }; for (const [m] of MACROS) delete old.k[m];
    const s = styleFromStored(old);
    expect(motionOf(s)).toBe('waltz'); expect(s.m).toEqual(knobbed(s.m0, Object.fromEntries(KNOBS.map(([k]) => [k, old.k[k] ?? 1]))));
  });
});

describe('the five tuning knobs', () => {
  it('each turns its detailed knobs with it, and at 1 changes nothing', () => {
    const s = custom('gothic'), base = knobbed(s.m0, s.k);
    expect(knobbed(s.m0, { ...s.k, force: 1, space: 1 })).toEqual(base);
    const f = knobbed(s.m0, { ...s.k, force: 1.5 }), e = knobbed(s.m0, { ...s.k, energy: 1.5, trigger: 1.5 });
    expect(f.shake).toBeCloseTo(e.shake, 9); expect(f.flash).toBeCloseTo(e.flash, 9); expect(f.punch).toBeGreaterThan(base.punch);
    const sp = knobbed(s.m0, { ...s.k, space: 0.5 }); expect(sp.depth).toBeLessThan(base.depth); expect(sp.float).toBeLessThan(base.float); expect(sp.turn).toBeLessThan(base.turn);
  });
  it('a detailed knob tuned on top multiplies with its macro, kept within its own range', () => {
    const s = custom(), both = knobbed(s.m0, { ...s.k, speed: 1.5, pace: 1.5 }), cap = knobbed(s.m0, { ...s.k, pace: 1.6 });
    expect(both.speed).toBeCloseTo(cap.speed, 9);   // (1.5 × 1.5 is past the pace knob's 1.6: held at it)
  });
});

describe('the style recommended for a song', () => {
  const doc = (src: string, map: RhythmMap) => buildLyrics(parse(src), map, 60);
  const lines = (n: number, per: number, text: string) => Array.from({ length: n }, (_, i) => `[00:${String(2 + i * per).padStart(2, '0')}.00]${text}`).join('\n');
  const A = (o: object) => ({ version: 3, duration: 60, rate: 10, tempo: { bpm: 100, confidence: 1 }, beats: [], meter: 4, downbeat: 0, phrase: 0, halfTime: false, events: [], sections: [], builds: [], level: [], loud: [], odf: [], ...o }) as any;
  it('reads tempo, metre, drums and how dense the lyrics are', () => {
    const slow = RhythmMap.grid(80, 0, 60), fast = RhythmMap.grid(140, 0, 60), waltz = RhythmMap.grid(100, 0, 60, 3), mid = RhythmMap.grid(105, 0, 60);
    const some = lines(6, 5, '我們 沿著 街道'), dense = lines(6, 2, '一二三四五六七八九十一二三四五六');
    expect(recommendMotion({ doc: doc('[00:02.00]純音樂，請欣賞', mid), map: mid, analysis: null })).toBe('stage');
    expect(recommendMotion({ doc: doc(some, mid), map: mid, analysis: A({ stems: 'drumless' }) })).toBe('float');
    expect(recommendMotion({ doc: doc(dense, mid), map: mid, analysis: null })).toBe('close');
    expect(recommendMotion({ doc: doc(some, waltz), map: waltz, analysis: null })).toBe('waltz');
    expect(recommendMotion({ doc: doc(some, slow), map: slow, analysis: null })).toBe('waltz');
    expect(recommendMotion({ doc: doc(some, fast), map: fast, analysis: A({ source: 'audio', drums: { t: Array.from({ length: 300 }, (_, i) => i * 0.2), s: [], k: [] } }) })).toBe('groove');
    expect(recommendMotion({ doc: doc(some, fast), map: fast, analysis: null })).toBe('story');   // (fast, but nothing says it drives)
    expect(recommendMotion({ doc: doc(some, mid), map: mid, analysis: null })).toBe('story');
  });
});

describe('fonts that show the whole of a song\'s lyrics', () => {
  it('judged by the characters each face has, not by the script it is labelled for', async () => {
    const { loadCoverage, fontCoverage } = await import('../../src/app/ui/fontCoverage');
    await loadCoverage();
    const tc = '我們一起走過這條街', sc = '我们一起走过这条街';
    // (a face made from Simplified and Traditional both: either lyrics wholly in it)
    expect(fontCoverage('wenkai', tc)).toBe(1); expect(fontCoverage('wenkai', sc)).toBe(1);
    // (a Simplified face: Simplified lyrics whole, Traditional ones partly in a stand-in)
    expect(fontCoverage('kuaile', sc)).toBe(1); expect(fontCoverage('kuaile', tc)).toBeLessThan(1);
    // (a Latin face: Chinese lyrics none of it; the Noto faces follow the lyrics' script: always whole)
    expect(fontCoverage('caveat', tc)).toBe(0); expect(fontCoverage('caveat', 'walk this street')).toBe(1); expect(fontCoverage('notosans', tc + 'の한', true)).toBe(1);
  });
});
