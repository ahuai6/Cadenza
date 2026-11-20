/* The camera programs: how the camera goes from word to word. Each is a record of what sets it apart — the director's
   planner (camera.ts), layout (layout.ts) and word entries (entry.ts) read these traits, never a program's name — so a
   style picks any program, and a new one is a registration (traits, or a planner of its own), not a change across the
   director. The six of them are Cadenza's own. */
import type { CameraPlan } from './types';

export interface CameraProgram {
  id: string;
  /** its name in the interface (a dictionary key) */
  label: string;
  /** moves eased and rounded (all but a hard cut-to-cut program) */
  smooth: boolean;
  /** goes round on curves, the frame swinging as it arrives (waltz's family) */
  curves: boolean;
  /** rests over the middle of the words rather than following each character */
  hover: boolean;
  /** holds every word close (its own zoom) */
  close: boolean;
  /** holds still in the middle: whole lines, no columns; the camera of its own planner */
  held: boolean;
  /** how a long word is travelled along: a quick drive onto each character, a steady step round it, or a run that
   *  never stops */
  follow: 'punch' | 'step' | 'run';
  /** a run's moves keep the pace they arrive with (no slowing into each stop) */
  cruise: boolean;
  /** how far ahead of a word the camera sets off (share of a beat at 120 BPM's pace) */
  lead: number;
  /** how fast it drifts on while resting */
  drift: number;
  /** the frame's lean as the camera arrives: its push and its roll */
  cone: number;
  coneRoll: number;
  /** the frame kicks on arrivals that land on an accent (a spring) */
  kicks: boolean;
  /** how far ahead (s, at speed 1) the path is smoothed toward where it goes next; 0: never (it cuts or holds close) */
  lookahead: number;
  /** an accent's flash: its rise (s) and its peak */
  flashRise: number;
  flashPeak: number;
  /** how much the planned path is softened (s): its position, its roll and its zoom (the zoom's at speed 1) */
  soften: [number, number, number];
}

/** A program's own planner, where it has one (the held program frames lines, not words). */
export type CameraPlanner = (inp: import('./camera').CameraInput) => CameraPlan;

const REG = new Map<string, CameraProgram>();
const PLANNERS = new Map<string, CameraPlanner>();
export function registerCamera(p: CameraProgram, plan?: CameraPlanner) {
  REG.set(p.id, p);
  if (plan) PLANNERS.set(p.id, plan);
  return p;
}
/** The program by id; an unknown one is the glide. */
export const cameraProgram = (id: string | undefined): CameraProgram => REG.get(id || '') ?? REG.get('glide')!;
export const cameraPlanner = (id: string | undefined) => PLANNERS.get(id || '');
export const cameraPrograms = () => [...REG.values()];

const base = {
  smooth: true,
  curves: false,
  hover: false,
  close: false,
  held: false,
  follow: 'run' as const,
  cruise: false,
  lead: 0.08,
  drift: 0.05,
  cone: 0.016,
  coneRoll: 0.35,
  kicks: false,
  lookahead: 0.9,
  flashRise: 0.05,
  flashPeak: 0.6,
  soften: [0.2, 0.16, 0.45] as [number, number, number],
};
/** 衝擊: hard cuts and quick drives onto each character */
registerCamera({
  ...base,
  id: 'punch',
  label: 'cut.punch',
  smooth: false,
  follow: 'punch',
  drift: 0.03,
  cone: 0.03,
  coneRoll: 0.5,
  lookahead: 0,
  soften: [0.05, 0.05, 0.15],
});
/** 圓舞: on curves, a steady step round each character, a spring kick on accents */
registerCamera({
  ...base,
  id: 'waltz',
  label: 'cut.waltz',
  curves: true,
  follow: 'step',
  lead: 0.09,
  cone: 0.026,
  coneRoll: 1.1,
  kicks: true,
  lookahead: 0.6,
  flashRise: 0.16,
  flashPeak: 0.5,
  soften: [0.1, 0.1, 0.3],
});
/** 滑行: always on the way, a run from word to word */
registerCamera({ ...base, id: 'glide', label: 'cut.glide', cruise: true, lead: 0.1, flashRise: 0.12 });
/** 特寫: close on every character, running */
registerCamera({
  ...base,
  id: 'close',
  label: 'cut.close',
  close: true,
  cruise: true,
  lead: 0.07,
  lookahead: 0,
  flashRise: 0.12,
  soften: [0.16, 0.16, 0.45],
});
/** 懸浮: over the middle of the words, on the waltz's curves */
registerCamera({ ...base, id: 'hover', label: 'cut.hover', curves: true, hover: true, cone: 0.026, coneRoll: 1.1 });
/** 置中: held in the middle, whole lines (its planner registers in camera.ts) */
registerCamera({ ...base, id: 'center', label: 'cut.center', held: true });
