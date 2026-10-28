/* Triggered effects, chosen ahead from the rhythm SDK. Flash, impact and shattering glass share one rule: the effect's
   slider is its sensitivity (how strong an accent must be to set it off, through RhythmMap.select), and how hard it
   lands comes from how densely accents fire around it, so a busy chorus hits harder than an isolated accent. */
import { clamp } from '../core/math';
import { rnd } from '../core/rng';
import type { RhythmMap } from '../rhythm/map';
import type { Style } from '../theme/style';
import type { Cues, PLine } from './types';

/** Density of events around each one: 1 ≈ one a bar, 0 ≈ alone (four bars either side, weighted). */
function density<T extends { t: number; k?: number }>(ev: T[], all: number[], bar: number): (T & { k: number })[] {
  return ev.map(e => { let d = 0; for (const t2 of all) { const u = (t2 - e.t) / bar; if (Math.abs(u) <= 4.5) d += Math.exp(-u * u / 8); } return { ...e, k: clamp((d - 1) / 3) }; });
}
export function planCues(map: RhythmMap, st: Style, lines: PLine[], musicEnd: number, idle: { a: number; b: number }[]): Cues {
  const M = st.m, bar = map.meter * map.beatLen(musicEnd / 2), inSong = (t: number) => t >= 0.5 && t <= musicEnd - 0.5;
  // flash, invert and glass land on the beat's own accents — a strong hit on a beat (a downbeat first), never a syncopated
  // one — and above all on the hit that opens a section that comes in louder (into a chorus, a drop)
  const onBeat = (e: { t: number; off?: boolean; pos: number }) => !e.off && Math.abs(e.pos - Math.round(e.pos)) < 0.12;
  const entries = map.sections.filter((S, i) => i > 0 && (S.drop || S.energy - map.sections[i - 1].energy > 0.18) && inSong(S.t0)).map(S => map.eventNear(S.t0, map.beatLen(S.t0) * 0.6, 1)).filter((e): e is NonNullable<typeof e> => !!e);
  const withEntries = <T extends { t: number }>(sel: T[], es: T[], gap: number) => { const out = [...es]; for (const e of sel) if (!out.some(x => Math.abs(x.t - e.t) < gap)) out.push(e); return out.sort((a, b) => a.t - b.t); };
  // flashes: at most one a bar in the loudest parts, one every two bars elsewhere (closer together when more sensitive)
  const fs = clamp(M.flash ?? 1, 0, 2);
  const flash0 = fs > 0.02 ? withEntries(map.select({ sensitivity: fs, gapBeats: (_e, lv) => (lv > 0.85 ? map.meter * 0.99 : map.meter * 1.99) / Math.max(0.5, fs) }).filter(e => inSong(e.t) && onBeat(e) && e.tier >= 2), entries, map.meter * map.beatLen(1)) : [];
  // glass: only the strongest on-beat accents (section entries first, else drops or loud sections), never two within ~20 beats
  const gs = clamp(M.glassf ?? 1, 0, 2), gapG = Math.max(9, 20 * map.beatLen(1)) / Math.max(0.4, gs), glass0 = st.fx.glass && gs > 0.02
    ? withEntries(map.select({ sensitivity: gs * 0.5, gapBeats: () => Math.max(9 / map.beatLen(1), 20) / Math.max(0.4, gs) }).filter(e => inSong(e.t) && onBeat(e) && (map.level(e.t) >= 0.65 || map.section(e.t).s?.drop)), entries.filter(e => map.level(e.t) >= 0.45), gapG)
      .filter((e, i, a) => i === 0 || e.t - a[i - 1].t >= gapG * 0.6) : [];
  // impacts: past the impact threshold, plus every pane; while idle the camera answers weaker accents too
  const is = clamp(M.impact ?? 1, 0, 2); let imp: number[] = [];
  if (is > 0.02) {
    imp = map.select({ sensitivity: is, gapBeats: 1 }).map(e => e.t).concat(glass0.map(e => e.t));
    for (const I of idle) for (const e of map.select({ sensitivity: Math.min(2, is * 1.8 + 0.3), gapBeats: 1, t0: I.a, t1: I.b })) imp.push(e.t);
    imp.sort((a, b) => a - b);
    imp = imp.filter((t, i) => t >= 0.5 && (i === 0 || t - imp[i - 1] >= map.beatLen(t) * 0.95));
  }
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
  return { flash, impacts, glass, glyphSlots, rings };
}
