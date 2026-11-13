// The space's floor plan: where one may stand, and the ways between the rooms (never through a wall).
import { describe, expect, it } from 'vitest';
import {
  ALBUM_SLOTS,
  ATRIUM,
  PLACES,
  RING,
  regionAt,
  route,
  wallSegments,
  type P2,
  type RoomId,
} from '../../src/app/space/plan';

const ROOMS: RoomId[] = ['nave', 'dome', 'lists', 'settings', 'altar'];
const walkable = (a: P2, b: P2) => {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
  for (let k = 0; k <= n; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
    if (!regionAt(p)) return p;
  }
  return null;
};

describe('the floor plan', () => {
  it('every room is where its place says it is', () => {
    for (const r of ROOMS) expect(regionAt(PLACES[r].at)?.room, r).toBe(r);
  });

  it('every way between two rooms stays on the floor, through the doorways', () => {
    for (const a of ROOMS)
      for (const b of ROOMS) {
        if (a === b) continue;
        const pts = [PLACES[a].at, ...route(a, b), PLACES[b].at];
        for (let k = 1; k < pts.length; k++) {
          const off = walkable(pts[k - 1], pts[k]);
          expect(off, `${a} → ${b}: off the floor at ${off && [off.x.toFixed(1), off.z.toFixed(1)]}`).toBeNull();
        }
      }
  });

  it('goes round the ring, not across the atrium', () => {
    const pts = route('lists', 'altar');
    for (const p of pts) {
      const d = Math.hypot(p.x, p.z + 40);
      expect(d).toBeGreaterThan(ATRIUM.r);
    }
    // (the short way: a quarter of the ring, not three)
    expect(pts.length).toBeLessThan(16);
  });

  it('the walls stand where no one may: the atrium wall, the ring wall, beyond the ring', () => {
    expect(regionAt({ x: 0, z: -40 + ATRIUM.r + 0.45 + 0 })?.door).toBe(true); // (south: a doorway)
    expect(regionAt({ x: Math.sin(0.4) * (ATRIUM.r + 0.45), z: -40 - Math.cos(0.4) * (ATRIUM.r + 0.45) })).toBeNull();
    expect(regionAt({ x: 0, z: -40 + RING.r1 + 2 })).toBeNull(); // (south: a window, not a door)
    expect(regionAt({ x: 60, z: -40 })).toBeNull();
  });

  it('sixteen album places on the ring wall, each facing the atrium, none in a doorway', () => {
    expect(ALBUM_SLOTS.length).toBe(16);
    for (const s of ALBUM_SLOTS) {
      expect(Math.hypot(s.x, s.z + 40)).toBeCloseTo(RING.r1, 1);
      // (in front of it is the ring)
      const f = { x: s.x - Math.sin(s.th) * 2, z: s.z + Math.cos(s.th) * 2 };
      expect(regionAt(f)?.room).toBe('nave');
    }
  });

  it('wall segments surround the plan', () => {
    expect(wallSegments().length).toBeGreaterThan(200);
  });
});
