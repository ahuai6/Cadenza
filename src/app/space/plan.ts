// The space's floor plan (docs/SPACE.md, 格局): a round atrium open to the sky, a ring gallery all the way round it,
// and three rooms off the ring — the collection room to the north, the listening room to the east, the studio to the
// west. Every room is reached through a round doorway; walking the ring brings you back where you began.
//
// Pure numbers, metres: the scene (world.ts) builds its walls from these and asks here where one may stand and which
// way leads from room to room. Compass: north is −z, east is +x; an angle θ runs clockwise from north.

export type RoomId = 'nave' | 'dome' | 'lists' | 'settings' | 'altar';
export interface P2 {
  x: number;
  z: number;
}

/** wall thickness */
export const T = 0.9;
/** the atrium's centre */
export const A: P2 = { x: 0, z: -40 };
/** the atrium: its wall's inner face, its height, the open circle in its roof */
export const ATRIUM = { r: 14, h: 12, oculus: 8 };
/** the ring: from the atrium wall's outer face to the outer wall's inner face; its ceiling */
export const RING = { r0: ATRIUM.r + T, r1: 21.9, h: 7 };
/** the ring's middle line (where the way round runs) */
export const RING_MID = (RING.r0 + RING.r1) / 2;
/** the short round passage from the ring's outer wall to a room's near wall */
export const PASSAGE = { from: RING.r1 + T, len: 2 };
/** a room's near wall's inner face, from the atrium's centre */
export const ROOM_IN = PASSAGE.from + PASSAGE.len + T;
/** a round doorway: a circle sunk into the floor (its centre this high), so its foot is a walkable width */
export const DOOR = { r: 2.6, cy: 1.9 };
/** half the doorway's width at the floor */
export const DOOR_HALF = Math.sqrt(DOOR.r * DOOR.r - DOOR.cy * DOOR.cy);
/** the doorway's top */
export const DOOR_TOP = DOOR.cy + DOOR.r;

/** the rooms off the ring: which way, and their shape (a rectangle: across × deep; a circle: its radius) */
export const ROOMS = {
  lists: { th: 0, kind: 'rect' as const, w: 12, d: 10, h: 8 },
  altar: { th: Math.PI / 2, kind: 'round' as const, r: 7, h: 8 },
  settings: { th: (Math.PI * 3) / 2, kind: 'rect' as const, w: 12, d: 10, h: 8 },
};
export type SideRoom = keyof typeof ROOMS;
/** the atrium's doorways (to the ring), and the ring's (to the rooms; the south one is a window onto the sky) */
export const ATRIUM_DOORS = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
export const RING_DOORS = [ROOMS.lists.th, ROOMS.altar.th, ROOMS.settings.th];

/** the unit vector a given way (θ from north, clockwise) */
export const dir = (th: number): P2 => ({ x: Math.sin(th), z: -Math.cos(th) });
/** a point at distance `along` from the atrium's centre in direction θ, `lat` to the right of that line */
export function at(th: number, along: number, lat = 0): P2 {
  const u = dir(th),
    v = dir(th + Math.PI / 2);
  return { x: A.x + u.x * along + v.x * lat, z: A.z + u.z * along + v.z * lat };
}
/** the way from the atrium's centre to a point, and how far */
export function polar(p: P2) {
  const x = p.x - A.x,
    z = p.z - A.z;
  return { th: norm(Math.atan2(x, -z)), rho: Math.hypot(x, z) };
}
/** an angle in [0, 2π) */
export const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
/** the signed shortest turn from a to b */
export const turn = (a: number, b: number) => {
  const d = norm(b - a);
  return d > Math.PI ? d - Math.PI * 2 : d;
};
/** a room's centre */
export function centre(id: SideRoom): P2 {
  const R = ROOMS[id];
  return at(R.th, ROOM_IN + (R.kind === 'rect' ? R.d / 2 : R.r));
}
/** (a point, in a room's own frame: how far out from the atrium's centre, how far to the right) */
function local(p: P2, th: number) {
  const u = dir(th),
    v = dir(th + Math.PI / 2),
    x = p.x - A.x,
    z = p.z - A.z;
  return { along: x * u.x + z * u.z, lat: x * v.x + z * v.z };
}

export interface Region {
  room: RoomId;
  /** how high one may float here */
  top: number;
  door?: true;
}
/** the margin kept from every wall */
const M = 0.6;
/** Where a point on the floor belongs, or null where no one may stand (a wall, outside). Every doorway reaches 1.5 m
 *  into the rooms on both its sides, so the walkable areas always overlap. */
export function regionAt(p: P2): Region | null {
  const { rho } = polar(p);
  if (rho < ATRIUM.r - M) return { room: 'dome', top: 20 };
  const doorTop = DOOR_TOP - 0.6;
  for (const d of ATRIUM_DOORS) {
    const q = local(p, d);
    if (Math.abs(q.lat) < DOOR_HALF - 0.4 && q.along > ATRIUM.r - 1.5 && q.along < RING.r0 + 1.5)
      return { room: q.along < ATRIUM.r + T / 2 ? 'dome' : 'nave', top: doorTop, door: true };
  }
  if (rho > RING.r0 + M && rho < RING.r1 - M) return { room: 'nave', top: RING.h - 0.6 };
  for (const id of Object.keys(ROOMS) as SideRoom[]) {
    const R = ROOMS[id],
      q = local(p, R.th);
    if (Math.abs(q.lat) < DOOR_HALF - 0.4 && q.along > RING.r1 - 1.5 && q.along < ROOM_IN + 1.5)
      return { room: q.along < PASSAGE.from + PASSAGE.len / 2 ? 'nave' : id, top: doorTop, door: true };
    if (R.kind === 'rect') {
      if (q.along > ROOM_IN + M && q.along < ROOM_IN + R.d - M && Math.abs(q.lat) < R.w / 2 - M)
        return { room: id, top: R.h - 0.6 };
    } else {
      const c = centre(id);
      if (Math.hypot(p.x - c.x, p.z - c.z) < R.r - M) return { room: id, top: R.h - 0.6 };
    }
  }
  return null;
}

/** where each room is first seen from: a point, the way one faces (yaw: 0 is north, π/2 is west) */
export const PLACES: Record<RoomId, { at: P2; yaw: number; pitch: number }> = {
  // (on the ring, south, facing the atrium through its doorway)
  nave: { at: at(Math.PI, RING_MID), yaw: 0, pitch: 0.05 },
  dome: { at: at(Math.PI, ATRIUM.r - 4), yaw: 0, pitch: 0.03 },
  lists: { at: at(ROOMS.lists.th, ROOM_IN + 2), yaw: 0, pitch: 0.02 },
  altar: { at: at(ROOMS.altar.th, ROOM_IN + 1.6), yaw: -Math.PI / 2, pitch: 0.06 },
  settings: { at: at(ROOMS.settings.th, ROOM_IN + 2), yaw: Math.PI / 2, pitch: -0.04 },
};

/** The points to pass on the way from one room to another (the last is just inside the room; the place itself is the
 *  caller's): out through the rooms' doorways and round the ring — never across the atrium. `from`: where one stands
 *  (on the ring, it sets where the way round begins). */
export function route(fromRoom: RoomId, toRoom: RoomId, from?: P2, to?: P2): P2[] {
  if (fromRoom === toRoom) return [];
  const angleOf = (room: RoomId, p?: P2): number | null =>
    room === 'nave' ? polar(p ?? PLACES.nave.at).th : room === 'dome' ? null : ROOMS[room as SideRoom].th;
  let a = angleOf(fromRoom, from),
    b = angleOf(toRoom, to ?? PLACES[toRoom].at);
  // (the atrium is left or entered by the doorway nearest the other end)
  const nearestDoor = (x: number) =>
    ATRIUM_DOORS.reduce((m, d) => (Math.abs(turn(x, d)) < Math.abs(turn(x, m)) ? d : m));
  if (a == null) a = nearestDoor(b ?? 0);
  if (b == null) b = nearestDoor(a);
  const out: P2[] = [];
  // out of the room to the ring
  out.push(...chain(fromRoom, a));
  // round the ring, the short way, a point every quarter of a quadrant
  const d = turn(a, b),
    n = Math.floor(Math.abs(d) / (Math.PI / 8));
  for (let k = 1; k <= n; k++) {
    const t = a + (d * k) / (n + 1);
    out.push(at(t, RING_MID));
  }
  if (Math.abs(d) > 1e-6 || fromRoom === 'nave' || toRoom === 'nave') out.push(at(b, RING_MID));
  // and into the room
  out.push(...chain(toRoom, b).reverse());
  // (no two points on top of each other)
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.z - out[i - 1].z) > 0.4);
}
/** from inside a room to the ring, at the room's way θ (for the atrium: through its doorway that way) */
function chain(room: RoomId, th: number): P2[] {
  if (room === 'nave') return [];
  if (room === 'dome') return [at(th, ATRIUM.r - 3), at(th, ATRIUM.r + T / 2), at(th, RING_MID)];
  return [
    at(th, ROOM_IN + 2),
    at(th, ROOM_IN - T / 2),
    at(th, PASSAGE.from + PASSAGE.len / 2),
    at(th, RING.r1 + T / 2),
    at(th, RING_MID),
  ];
}

/** the albums' places on the ring's outer wall: four in each quarter between the doorways, facing the atrium */
export const ALBUM_SLOTS = (() => {
  const out: { x: number; z: number; ry: number; th: number }[] = [];
  for (const q of [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4])
    for (const o of [-22.5, -7.5, 7.5, 22.5]) {
      const th = q + (o * Math.PI) / 180,
        p = at(th, RING.r1 - 0.02);
      out.push({ ...p, ry: -th, th });
    }
  return out;
})();

/** The walls' footprints as segments (for the floor's shading where wall meets floor). */
export function wallSegments(step = Math.PI / 48): [number, number, number, number][] {
  const segs: [number, number, number, number][] = [];
  const circle = (c: P2, r: number, gaps: number[], gapHalf: number) => {
    for (let a = 0; a < Math.PI * 2 - 1e-9; a += step) {
      const b = a + step,
        m = (a + b) / 2;
      if (gaps.some((g) => Math.abs(turn(m, g)) < gapHalf)) continue;
      segs.push([c.x + Math.sin(a) * r, c.z - Math.cos(a) * r, c.x + Math.sin(b) * r, c.z - Math.cos(b) * r]);
    }
  };
  circle(A, ATRIUM.r, ATRIUM_DOORS, DOOR_HALF / ATRIUM.r);
  circle(A, RING.r0, ATRIUM_DOORS, DOOR_HALF / RING.r0);
  circle(A, RING.r1, RING_DOORS, DOOR_HALF / RING.r1);
  for (const id of Object.keys(ROOMS) as SideRoom[]) {
    const R = ROOMS[id];
    // the passage's two sides
    for (const s of [-1, 1]) {
      const p = at(R.th, RING.r1 + T, s * DOOR_HALF),
        q = at(R.th, ROOM_IN - T, s * DOOR_HALF);
      segs.push([p.x, p.z, q.x, q.z]);
    }
    if (R.kind === 'rect') {
      const c = (al: number, la: number) => at(R.th, al, la),
        n0 = ROOM_IN,
        n1 = ROOM_IN + R.d,
        h = R.w / 2;
      const ring = [c(n0, -h), c(n1, -h), c(n1, h), c(n0, h)];
      for (let k = 0; k < 3; k++) segs.push([ring[k].x, ring[k].z, ring[k + 1].x, ring[k + 1].z]);
      // the near wall, either side of its doorway
      for (const [l0, l1] of [
        [h, DOOR_HALF],
        [-DOOR_HALF, -h],
      ]) {
        const p = c(n0, l0),
          q = c(n0, l1);
        segs.push([p.x, p.z, q.x, q.z]);
      }
    } else {
      const cc = centre(id);
      // (the doorway faces back toward the atrium)
      circle(cc, R.r, [norm(R.th + Math.PI)], DOOR_HALF / R.r);
    }
  }
  return segs;
}
/** the plan's bounds (x0, x1, z0, z1), with a margin */
export function bounds(m = 3) {
  const far = ROOM_IN + Math.max(ROOMS.lists.d, ROOMS.settings.d, ROOMS.altar.r * 2) + T + m;
  return { x0: A.x - far, x1: A.x + far, z0: A.z - far, z1: A.z + RING.r1 + T + m };
}
