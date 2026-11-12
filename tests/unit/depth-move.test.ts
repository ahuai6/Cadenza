// The lyrics are things at their own distances (3.0.5): while the camera moves, a near word and a far word see the move
// a moment apart — they do not turn and slide as one sheet — and at rest the projection is exactly the planned one.
import { describe, it, expect } from 'vitest';
import { project, NO_FX, type Cam } from '../../src/director/project';

const W = 1280,
  H = 720;
const rest: Cam = { x: 100, y: 50, z: 1, r: 20, d: 0, yaw: 0, pitch: 0 };
const moving: Cam = { ...rest, vx: 600, vy: 0, vr: 40, vz: 0.5 };

describe('depth and the camera’s move', () => {
  it('at rest, every depth is projected as planned (no rates, nothing added)', () => {
    for (const d of [-300, 0, 300]) {
      const a = project(300, 120, d, rest, NO_FX, W, H),
        b = project(300, 120, d, { ...rest, vx: 0, vy: 0, vr: 0, vz: 0 }, NO_FX, W, H);
      expect(b).toEqual(a);
    }
  });
  it('a word at the camera’s own depth is not shifted by the move', () => {
    expect(project(300, 120, 0, moving, NO_FX, W, H)).toEqual(project(300, 120, 0, rest, NO_FX, W, H));
  });
  it('moving, near and far words turn by different amounts — near ahead, far behind', () => {
    const near = project(300, 120, -300, moving, NO_FX, W, H),
      mid = project(300, 120, 0, moving, NO_FX, W, H),
      far = project(300, 120, 300, moving, NO_FX, W, H);
    // (the camera rolls on: what is near has turned further with it, what is far less)
    expect(near.rot).toBeLessThan(mid.rot);
    expect(far.rot).toBeGreaterThan(mid.rot);
    expect(Math.abs(near.rot - far.rot)).toBeGreaterThan(1);
  });
  it('the difference is bounded: a hard, fast move never throws a word across the frame', () => {
    const wild: Cam = { ...rest, vx: 40000, vy: -40000, vr: 5000, vz: 50 };
    for (const d of [-600, -300, 300, 600]) {
      const a = project(300, 120, d, rest, NO_FX, W, H),
        b = project(300, 120, d, wild, NO_FX, W, H);
      expect(Math.hypot(b.sx - a.sx, b.sy - a.sy), `depth ${d}`).toBeLessThan(W * 0.09);
      expect(Math.abs(b.rot - a.rot)).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });
});
