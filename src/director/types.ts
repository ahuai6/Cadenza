// The director's output: a plan of the whole song, made once when a song (or its style) is loaded, immutable after.
// Playback, export and look-ahead only *evaluate* it at a time. World units: the layout's own (a glyph is 150 tall at
// scale 1); the camera maps them to a reference frame 720 px tall (the renderer scales that to the real size).
import type { Word, Line, LyricDoc } from '../lyrics/model';
import type { RhythmMap } from '../rhythm/map';
import type { RhythmEvent } from '../rhythm/types';
import type { Style } from '../theme/style';

export const REF_H = 720;

export interface PUnit { c: string; t: number | null; ox: number; oy: number; w: number; h: number; rot: boolean }
export interface PWord {
  w: Word; line: PLine; k: number;
  /** world position of the word's centre, its tilt (deg), depth, glyph scale */
  x: number; y: number; tilt: number; d: number; s: number;
  /** size in world units (scaled), and at scale 1 */
  lw: number; lh: number; w0: number; h0: number;
  vert: boolean; units: PUnit[];
  /** the path's direction where the word sits (deg) */
  ang: number;
  /** a harmony sung with this word: drawn small at its lower right (its size measured unscaled; never part of the word's
   *  footprint, so the layout, the camera and the drawing order never change for it) */
  harm?: { text: string; t: number; w0: number; h0: number } | null;
  /** drawn in the accent of the flash, lit a little: a few characters of a line picked by chance, about one line in
   *  three or four — the units [from, to) of this word */
  emph?: [number, number];
  /** a lyric frame around this word (and up to two before it) */
  frame: FrameRef | null;
  /** appearing nudged inside the frame (world offset), gliding to its own place between t0 and t1 (entry.ts) */
  entry?: { dx: number; dy: number; t0: number; t1: number } | null;
  /** the roller (scenes.ts): turned half round onto the drum's next row, the camera rolling that way (−1 left, +1 right); 0 none */
  roll?: number;
  /** the roller: how long its half turn takes (s) — shorter, and lighter, for a word repeated quicker than the pace's own */
  rollD?: number;
  /** draw order: fixed at plan time (back to front), never view-dependent */
  order: number;
  /** when it appears (a little before it is sung), when it is over */
  show: number; end: number;
  /** entrance style */
  tin: string;
  /** per-word randoms, fixed */
  seed: number;
}
export interface PLine {
  L: Line; i: number; words: PWord[];
  /** the scene its arrangement follows (scenes.ts), null for the ordinary one */ scene?: import('./scenes').SceneId | null;
  /** passage index; when its passage ends (a transition), and how long the blur takes to rise there */
  sec: number; secEnd: number; secIn: number;
  /** box of the line (path direction), depth */
  ax: number; ay: number; bw: number; bh: number; prot: number; d: number;
  /** set as columns (one of a run of vertical lines, see layout.ts) */ vert?: boolean;
  back: boolean; rtl: boolean;
  /** laid while the path heads back against the reading direction (leftward): the camera hovers over it (as the hover
   *  style does), never character by character (following the singing would run the camera right, against the way the
   *  lines go) */ west?: boolean;
}
export interface FrameRef { words: PWord[]; ts: number; corner: boolean; pad: number; /** fades from here (the camera left it, too far to hold it in view) */ until?: number }

/** A full-frame blur transition: the blur rises over [t-inn, t], the camera cuts at t, clears over [t, t+out]. */
export interface Passage { t: number; inn: number; out: number; line: number; quick: boolean; reason: 'gap' | 'layout' | 'distance' | 'crowd' }

export interface Pose { x: number; y: number; z: number; r: number; d: number }
/** A camera stop: what is framed, from when. */
export interface Stop extends Pose {
  t: number;              // the words' time (first sung)
  arrive: number;         // the camera is settled here by this time
  leave: number;          // the move to the next stop starts no earlier than this
  sungEnd: number;        // the framed words are sung by here
  box: { x: number; y: number; w: number; h: number; tilt: number };
  dir: [number, number];  // reading direction (unit)
  /** hovered over, as the hover style does (a line laid heading back: no follow along its characters) */ hov?: boolean;
  /** a line timed only as a whole, held whole by this one stop (drifting along its own way, not leftward) */ whole?: boolean;
  drift: number;          // how far the camera drifts along `dir` while it holds (world units)
  cut: boolean;           // reached by a cut (a transition), not a move
  over: boolean;          // the ending pull-back
  rest: number;           // the pause after these words
  words: PWord[];
  /** not visited: the camera reached it too late and went straight on to the next stop's framing (camera.ts) */ skipped?: boolean;
  roll?: number;          // the roller: reached by half a turn this way (−1 left, +1 right)
  rollD?: number;         // … taking this long (s)
  /** the follow: the axis the camera travels along these words' characters, and each step [t0, t1, dx, dy, ease] */
  fax?: [number, number]; follow?: [number, number, number, number, string][];
  /** what of these words is in view on arrival, and each character as a box (for keeping what is sung in frame) */
  head?: UBox[]; ubox?: (UBox & { t: number; end: number })[];
}
export interface UBox { x: number; y: number; lw: number; lh: number; tilt: number }
/** One move between stops: displacement added over [s, a] with an ease; moves may overlap (they superpose). */
export interface Move { s: number; a: number; dx: number; dy: number; dz: number; dr: number; dd: number; ease: string; bow: [number, number];
  /** 'roll': the spring's force and overshoot; and how far the view breathes out at the roll's middle (log zoom) */
  spring?: [number, number]; zb?: number;
  /** the turn on its own timing: from s + a·span over (b − a + 1)·span, with its own ease (a hard cut, a curve, a long
   *  soft landing); a lean into the bend at the move's middle (deg); the bow's peak early (a corner taken wide first) */
  rot?: [number, number, string]; bank?: number; apex?: boolean }

export interface CameraPlan {
  style: string; start: Pose; stops: Stop[]; moves: Move[];
  /** what came out wrong while planning and was put right (a stop not finite…), with its details: for the debug log */
  warnings?: string[];
  /** drifts while holding, and the steps of a follow: [t0, t1, dx, dy, ease?] */
  drifts: [number, number, number, number, string?][];
  /** cut times (passages), with the jump the base path makes there (the backdrop's camera skips these) */
  cuts: { t: number; dx: number; dy: number; dz: number; dr: number }[];
  /** idle stretches (long instrumentals) */
  /** long stretches without words: idle from a (after a wait) to b; g, where the words stopped */
  idle: { a: number; b: number; g: number }[];
  dyn: { cone: number; coneRoll: number; float: number; sway: number };
  /** waltz: each accented arrival pushes the frame once (roll, distance, position), critically damped */
  kicks?: { t: number; a: number; sg: number; px: number; py: number }[];
  /** punch: each arrival nudges the frame once in one direction and lets it settle */
  arrivals?: { t: number; ang: number; sg: number; k: number }[];
  /** the path the camera follows: the moves sampled and given inertia (see smoothPath) */
  path?: { rate: number; n: number; seg: Int32Array; /** the cuts, in order: segment i ends at cutT[i] */ cutT: number[]; x: Float32Array; y: Float32Array; lz: Float32Array; r: Float32Array; d: Float32Array };
}

export interface Cues {
  flash: { t: number; k: number }[];
  impacts: { t: number; k: number; ang: number; sg: number }[];
  /** (life: how long the pane is up, s — 2.2, or less when the next one strikes soon after: it gives way to it) */
  glass: { t: number; seed: number; x: number; y: number; size: number; k: number; life: number }[];
  /** colour split and glitch: struck like the glass, a little more often (each only when its effect is on) */
  chroma: { t: number; k: number }[];
  glitch: { t: number; k: number; seed: number }[];
  glyphSlots: { t: number; end: number; cut: boolean; line: PLine; side: number }[];
  rings: RhythmEvent[];
}
export interface Titles {
  intro: { kind: 'card' | 'top'; t0: number; t1: number } | null;
  end: { t0: number } | null;
  title: string; artist: string; credits: [string, string][];
}

export interface ScenePlan {
  doc: LyricDoc; map: RhythmMap; style: Style;
  /** reference frame (720 tall) */
  W: number; H: number;
  dur: number; endLen: number; musicEnd: number;
  lines: PLine[]; words: PWord[]; drawOrder: PWord[];
  passages: Passage[]; camera: CameraPlan; cues: Cues; titles: Titles;
  /** deepest word, for fog */
  dmin: number;
  /** captions (translations) present */
  hasSubs: boolean;
}
