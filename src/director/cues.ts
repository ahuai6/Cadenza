/* Triggered effects, chosen ahead from the rhythm SDK. Flash, impact and shattering glass share one rule: the effect's
   slider is its sensitivity (how strong an accent must be to set it off, through RhythmMap.select), and how hard it
   lands comes from how densely accents fire around it, so a busy chorus hits harder than an isolated accent. */
import { clamp } from '../core/math';
import { rnd } from '../core/rng';
import type { RhythmMap } from '../rhythm/map';
import type { RhythmEvent } from '../rhythm/types';
import type { Style } from '../theme/style';
import type { Cues, PLine } from './types';

/** Density of events around each one: 1 ≈ one a bar, 0 ≈ alone (four bars either side, weighted). */
function density<T extends { t: number; k?: number }>(ev: T[], all: number[], bar: number): (T & { k: number })[] {
  return ev.map(e => { let d = 0; for (const t2 of all) { const u = (t2 - e.t) / bar; if (Math.abs(u) <= 4.5) d += Math.exp(-u * u / 8); } return { ...e, k: clamp((d - 1) / 3) }; });
}
const onBeat = (e: { off?: boolean; pos: number }) => !e.off && Math.abs(e.pos - Math.round(e.pos)) < 0.12;
/** An accent a chorus brings: its strength 0..1, and whether it opens the entry or is one of the hits right after it. */
export interface Entry { e: RhythmEvent; k: number; lead: boolean }
/** The lowest entry strength a trigger takes at a sensitivity (0..2, the effect's own slider through the trigger knob):
 *  at 1 a clear entry and the hits after it; lower, only the clearest; at 2, every one. */
export const entryFloor = (s: number) => clamp(1.05 - 0.6 * s, 0, 1);
/** The strength of each of the lyrics' chorus marks: #1 the strongest, #2 ordinary, #3 lighter. */
export const MARK_K = [0, 1, 0.75, 0.52];
/** Where choruses come in, as the lyrics mark them (#1, #2, #3 — the choice is the person's, not a guess at the music):
 *  each on the strongest accent on the beat near its mark, followed by the strongest on-beat hits of the two bars after
 *  it, a little weaker each. */
export function markedEntries(map: RhythmMap, marks: { t: number; level: number }[], inSong: (t: number) => boolean): Entry[] {
  const out: Entry[] = [], bar = (t: number) => map.meter * map.beatLen(t);
  for (const m of marks) { if (!inSong(m.t)) continue;
    const bl = map.beatLen(m.t), e = map.eventNear(m.t, bl * 0.6, 1) || map.eventNear(m.t, bl * 0.6, 0); if (!e || out.some(x => Math.abs(x.e.t - e.t) < bl * 0.5)) continue;
    out.push({ e, k: MARK_K[Math.min(3, Math.max(1, m.level))], lead: true }); }
  out.sort((a, b) => a.e.t - b.e.t);
  const leads = out.slice();
  for (const L of leads) {
    const bl = map.beatLen(L.e.t), next = leads.find(x => x.e.t > L.e.t)?.e.t ?? Infinity;
    const hits = map.eventsIn(L.e.t + bl * 0.6, Math.min(next - bl, L.e.t + 2 * bar(L.e.t) + bl * 0.1), 1).filter(e => onBeat(e) && inSong(e.t) && e.s >= L.e.s * 0.7).sort((a, b) => b.s - a.s);
    const took: RhythmEvent[] = [];
    for (const h of hits) { if (took.length >= 2) break; if (took.every(x => Math.abs(x.t - h.t) >= bl * 0.95)) took.push(h); }
    took.sort((a, b) => a.t - b.t).forEach((h, j) => out.push({ e: h, k: L.k * (j ? 0.72 : 0.82) * clamp(h.s / L.e.s, 0.85, 1.05), lead: false }));
  }
  return out.sort((a, b) => a.e.t - b.e.t);
}
export function planCues(map: RhythmMap, st: Style, lines: PLine[], musicEnd: number, idle: { a: number; b: number }[], marks: { t: number; level: number }[] = []): Cues {
  const M = st.m, bar = map.meter * map.beatLen(musicEnd / 2), inSong = (t: number) => t >= 0.5 && t <= musicEnd - 0.5;
  // flash, invert and glass land on the beat's own accents — a strong hit on a beat (a downbeat first), never a syncopated
  // one — and above all on the hit that opens a section that comes in louder (into a chorus, a drop)
  // every trigger takes the entries its own sensitivity reaches (the trigger knob moves all three together)
  const entries = markedEntries(map, marks, inSong), reach = (s: number, leadOnly = false) => entries.filter(x => x.k >= entryFloor(s) && (!leadOnly || x.lead)).map(x => x.e);
  const withEntries = <T extends { t: number }>(sel: T[], es: T[], gap: number) => { const out = [...es]; for (const e of sel) if (!out.some(x => Math.abs(x.t - e.t) < gap)) out.push(e); return out.sort((a, b) => a.t - b.t); };
  // flashes: at most one a bar in the loudest parts, one every two bars elsewhere (closer together when more sensitive)
  const fs = clamp(M.flash ?? 1, 0, 2);
  const flash0 = fs > 0.02 ? withEntries(map.select({ sensitivity: fs, gapBeats: (_e, lv) => (lv > 0.85 ? map.meter * 0.99 : map.meter * 1.99) / Math.max(0.5, fs) }).filter(e => inSong(e.t) && onBeat(e) && e.tier >= 2), reach(fs), map.meter * map.beatLen(1)) : [];
  // glass: only the strongest on-beat accents (section entries first, else drops or loud sections), never two within ~20 beats
  const gs = clamp(M.glassf ?? 1, 0, 2), gapG = Math.max(9, 20 * map.beatLen(1)) / Math.max(0.4, gs), glass0 = st.fx.glass && gs > 0.02
    ? withEntries(map.select({ sensitivity: gs * 0.5, gapBeats: () => Math.max(9 / map.beatLen(1), 20) / Math.max(0.4, gs) }).filter(e => inSong(e.t) && onBeat(e) && map.level(e.t) >= 0.65), reach(gs, true).filter(e => map.level(e.t) >= 0.45), gapG)
      .filter((e, i, a) => i === 0 || e.t - a[i - 1].t >= gapG * 0.6) : [];
  // impacts: past the impact threshold, plus every pane; while idle the camera answers weaker accents too
  const is = clamp(M.impact ?? 1, 0, 2); let imp: number[] = [];
  if (is > 0.02) {
    imp = map.select({ sensitivity: is, gapBeats: 1 }).map(e => e.t).concat(glass0.map(e => e.t), reach(is).map(e => e.t));
    for (const I of idle) for (const e of map.select({ sensitivity: Math.min(2, is * 1.8 + 0.3), gapBeats: 1, t0: I.a, t1: I.b })) imp.push(e.t);
    imp.sort((a, b) => a - b);
    imp = imp.filter((t, i) => t >= 0.5 && (i === 0 || t - imp[i - 1] >= map.beatLen(t) * 0.95));
  }
  // colour split and glitch: the same kind of accent as the glass (strong, on the beat), on the same sensitivity, at
  // most one every eight beats or so each, never on the same ordinary hit as each other or as the glass. A chorus the
  // lyrics mark (#1, #2, #3) brings every one of them that is on, on its opening hit — together with the glass — and
  // the hits after it as its strength reaches
  const strike = (on: boolean, salt: number, taken: number[]) => { if (!on || gs <= 0.02) return [] as RhythmEvent[];
    const gap = Math.max(4, 8 * map.beatLen(1)) / Math.max(0.4, gs), leads = new Set(entries.filter(x => x.lead && x.k >= entryFloor(gs) * 0.8).map(x => x.e));
    const sel = withEntries(map.select({ sensitivity: Math.min(2, gs * 0.8), gapBeats: () => 8 / Math.max(0.4, gs) }).filter(e => inSong(e.t) && onBeat(e) && e.tier >= 2 && map.level(e.t) >= 0.45), [...leads, ...reach(gs)], gap);
    const out: RhythmEvent[] = []; for (const e of sel) { const lead = leads.has(e);
      if (!lead && (taken.some(x => Math.abs(x - e.t) < 0.05) || (out.length && e.t - out[out.length - 1].t < gap * 0.6) || rnd(e.t * 3.1 + salt) < 0.15)) continue;
      out.push(e); }
    return out; };
  const chroma0 = strike(!!st.fx.chroma, 1.7, glass0.map(e => e.t)), glitch0 = strike(!!st.fx.glitch, 5.3, [...glass0, ...chroma0].map(e => e.t));
  const all = [...flash0.map(e => e.t), ...imp, ...glass0.map(e => e.t)];
  const flash = density(flash0.map(e => ({ t: e.t })), flash0.map(e => e.t), bar).map(e => ({ t: e.t, k: e.k }));
  const impacts = density(imp.map(t => ({ t })), imp, bar).map(e => ({ t: e.t, k: e.k, ang: rnd(e.t * 5.9) * 6.283, sg: rnd(e.t * 3.7) < 0.5 ? -1 : 1 }));
  const glass = density(glass0.map(e => ({ t: e.t })), all, bar).map(e => ({ t: e.t, seed: e.t * 31.7 + 3, x: 0.2 + rnd(e.t * 5.1) * 0.6, y: 0.2 + rnd(e.t * 9.3) * 0.55, size: (0.7 + rnd(e.t * 2.9) * 0.5) * (0.85 + 0.3 * e.k), k: 0.75 + 0.25 * e.k }));
  // glyph contours: a passage opens with one; a long passage changes it at most every few lines and seconds
  const glyphSlots: Cues['glyphSlots'] = [];
  if (st.fx.glyph) { let li = -9, lt = -1e9, side = 0; const gf = clamp(M.glyphf ?? 1, 0.2, 3), every = Math.max(1, Math.round(2 / gf)), minT = 6 / gf;
    lines.forEach((P, i) => { const fresh = i === 0 || P.sec !== lines[i - 1].sec;
      if (fresh || (i - li >= every && P.L.t - lt >= minT)) { if (glyphSlots.length) glyphSlots[glyphSlots.length - 1].end = Math.min(glyphSlots[glyphSlots.length - 1].end, P.L.t);
        glyphSlots.push({ t: P.L.t, end: P.secEnd, cut: isFinite(P.secEnd), line: P, side: side++ % 2 }); li = i; lt = P.L.t; } });
    for (let k = 0; k < glyphSlots.length - 1; k++) if (glyphSlots[k].end > glyphSlots[k + 1].t) { glyphSlots[k].end = glyphSlots[k + 1].t; glyphSlots[k].cut = false; }
    for (const g of glyphSlots) if (!isFinite(g.end)) g.end = musicEnd + 4; }
  const rings = map.eventsIn(0, musicEnd, 1);
  const chroma = density(chroma0.map(e => ({ t: e.t })), all, bar).map(e => ({ t: e.t, k: 0.7 + 0.3 * e.k }));
  const glitch = density(glitch0.map(e => ({ t: e.t })), all, bar).map(e => ({ t: e.t, k: 0.7 + 0.3 * e.k, seed: e.t * 17.3 + 1 }));
  return { flash, impacts, glass, glyphSlots, rings, chroma, glitch };
}
