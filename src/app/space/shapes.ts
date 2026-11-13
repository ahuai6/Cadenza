// The space's shape kit (docs/SPACE.md, 形狀): walls drawn flat — a length and a height, round doorways sunk into the
// floor, round windows — then stood up straight, or bent round a circle. Everything architectural is made of these.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DOOR, DOOR_HALF } from './plan';

export interface Hole {
  /** along the wall, metres from its start */
  u: number;
  y: number;
  r: number;
}
/** A wall's face, drawn flat: `len` long, `h` high, round doorways (at these places along it) cut out of its foot and
 *  round windows through it. */
export function wallShape(len: number, h: number, doors: number[] = [], holes: Hole[] = []) {
  const s = new THREE.Shape(),
    foot = Math.asin(DOOR.cy / DOOR.r),
    N = 48;
  s.moveTo(0, 0);
  for (const u of [...doors].sort((a, b) => a - b)) {
    s.lineTo(u - DOOR_HALF, 0);
    // (over the top of the circle, from its left foot to its right one)
    for (let k = 1; k < N; k++) {
      const p = Math.PI + foot - ((Math.PI + 2 * foot) * k) / N;
      s.lineTo(u + DOOR.r * Math.cos(p), DOOR.cy + DOOR.r * Math.sin(p));
    }
    s.lineTo(u + DOOR_HALF, 0);
  }
  s.lineTo(len, 0);
  s.lineTo(len, h);
  s.lineTo(0, h);
  s.closePath();
  for (const w of holes) {
    const p = new THREE.Path();
    p.absarc(w.u, w.y, w.r, 0, Math.PI * 2, true);
    s.holes.push(p);
  }
  return s;
}

/** A wall `depth` thick from a face shape (the face at z = 0, the wall toward +z). */
export const slab = (shape: THREE.Shape, depth: number) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 });

/** The same geometry with no edge longer than `max` (so that bending it keeps it round). Non-indexed; one group. */
export function subdivide(geo: THREE.BufferGeometry, max: number) {
  const g = geo.index ? geo.toNonIndexed() : geo,
    P = g.attributes.position,
    Nn = g.attributes.normal;
  const pos: number[] = [],
    nor: number[] = [];
  const stack: number[][] = [];
  for (let i = 0; i < P.count; i += 3) {
    const t: number[] = [];
    for (let k = 0; k < 3; k++)
      t.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k), Nn.getX(i + k), Nn.getY(i + k), Nn.getZ(i + k));
    stack.push(t);
  }
  const d2 = (t: number[], a: number, b: number) =>
    (t[a * 6] - t[b * 6]) ** 2 + (t[a * 6 + 1] - t[b * 6 + 1]) ** 2 + (t[a * 6 + 2] - t[b * 6 + 2]) ** 2;
  const mid = (t: number[], a: number, b: number) => {
    const m: number[] = [];
    for (let k = 0; k < 6; k++) m.push((t[a * 6 + k] + t[b * 6 + k]) / 2);
    const l = Math.hypot(m[3], m[4], m[5]) || 1;
    m[3] /= l;
    m[4] /= l;
    m[5] /= l;
    return m;
  };
  const vtx = (t: number[], a: number) => t.slice(a * 6, a * 6 + 6);
  while (stack.length) {
    const t = stack.pop()!,
      e = [d2(t, 0, 1), d2(t, 1, 2), d2(t, 2, 0)],
      k = e.indexOf(Math.max(...e));
    if (e[k] <= max * max) {
      for (let a = 0; a < 3; a++) {
        pos.push(t[a * 6], t[a * 6 + 1], t[a * 6 + 2]);
        nor.push(t[a * 6 + 3], t[a * 6 + 4], t[a * 6 + 5]);
      }
      continue;
    }
    // (split the longest edge at its middle, keeping the winding)
    const a = k,
      b = (k + 1) % 3,
      c = (k + 2) % 3,
      m = mid(t, a, b);
    stack.push([...vtx(t, a), ...m, ...vtx(t, c)], [...m, ...vtx(t, b), ...vtx(t, c)]);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

/** A long wall drawn flat, `depth` thick and ready to bend: cut into panels — one about each doorway and window, plain
 *  ones between — each triangulated and subdivided on its own. Drawn as one shape, the doorways' arcs were joined by
 *  long slivers to corners metres away, and keeping those round when bent split them into five times the triangles of
 *  the wall itself (a round wall with three doors: 128 000 against 25 000). */
export function wallPanels(len: number, h: number, doors: number[], holes: Hole[], depth: number, max: number) {
  const feats = [
    ...doors.map((u) => [u - DOOR.r - 0.4, u + DOOR.r + 0.4]),
    ...holes.map((w) => [w.u - w.r - 0.4, w.u + w.r + 0.4]),
  ]
    .map(([a, b]) => [Math.max(0, a), Math.min(len, b)])
    .sort((x, y) => x[0] - y[0]);
  // (overlapping features make one panel)
  const merged: number[][] = [];
  for (const f of feats) {
    const l = merged[merged.length - 1];
    if (l && f[0] <= l[1]) l[1] = Math.max(l[1], f[1]);
    else merged.push([...f]);
  }
  const parts: THREE.BufferGeometry[] = [];
  const add = (a: number, b: number, withFeats: boolean) => {
    if (b - a < 1e-3) return;
    const sh = withFeats
      ? wallShape(
          b - a,
          h,
          doors.filter((u) => u > a && u < b).map((u) => u - a),
          holes.filter((w) => w.u > a && w.u < b).map((w) => ({ ...w, u: w.u - a })),
        )
      : wallShape(b - a, h);
    const g = slab(sh, depth),
      d = subdivide(g, max);
    g.dispose();
    d.translate(a, 0, 0);
    parts.push(d);
  };
  let at = 0;
  for (const [a, b] of merged) {
    add(at, a, false);
    add(a, b, true);
    at = b;
  }
  add(at, len, false);
  const out = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  return out;
}

/** The lining of a round doorway through from one wall to another: a horseshoe band (the doorway's own outline, a
 *  little narrower than the doorways it joins, `band` thick), `len` long along z. Only the lining — no faces of a block
 *  that would lie in the walls it passes through. x about 0. */
export function doorTube(len: number, inset = 0.12, band = 0.4, N = 40) {
  const ri = DOOR.r - inset,
    ro = ri + band,
    s = new THREE.Shape(),
    fi = Math.asin(Math.min(1, DOOR.cy / ri)),
    fo = Math.asin(Math.min(1, DOOR.cy / ro));
  // (outer arc from its left foot over the top to its right foot, then the inner arc back)
  const arc = (r: number, foot: number, back: boolean) => {
    for (let k = 0; k <= N; k++) {
      const q = back ? N - k : k,
        p = Math.PI + foot - ((Math.PI + 2 * foot) * q) / N;
      s.lineTo(r * Math.cos(p), DOOR.cy + r * Math.sin(p));
    }
  };
  s.moveTo(-Math.sqrt(ro * ro - DOOR.cy * DOOR.cy), 0);
  arc(ro, fo, false);
  s.lineTo(Math.sqrt(ri * ri - DOOR.cy * DOOR.cy), 0);
  arc(ri, fi, true);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 4 });
}

/** Bends a flat wall (x along it, y up, z through it) round a circle of radius r about (cx, cz): x = 0 at the compass
 *  way `seam` (θ from north, clockwise), running anticlockwise; the face at z = 0 on the circle, the wall outward. */
export function bendRound(geo: THREE.BufferGeometry, r: number, cx: number, cz: number, seam: number) {
  const P = geo.attributes.position,
    N = geo.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const u = P.getX(i),
      y = P.getY(i),
      w = P.getZ(i),
      th = seam - u / r,
      rad = r + w,
      s = Math.sin(th),
      c = Math.cos(th);
    P.setXYZ(i, cx + s * rad, y, cz - c * rad);
    // (along the wall is now the way of decreasing θ; through it is outward)
    const nx = N.getX(i),
      ny = N.getY(i),
      nz = N.getZ(i);
    N.setXYZ(i, -c * nx + s * nz, ny, -s * nx - c * nz);
  }
  P.needsUpdate = true;
  N.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}
/** Where along a round wall (bent with this seam) a compass way θ falls. */
export const alongRound = (th: number, r: number, seam: number) => {
  const T = Math.PI * 2;
  return ((((seam - th) % T) + T) % T) * r;
};

/** Stands a flat wall up: its start at `p0` (on its face), running toward `p1`, the wall on the side x × up. */
export function standFlat(geo: THREE.BufferGeometry, p0: THREE.Vector3, p1: THREE.Vector3) {
  const x = p1.clone().sub(p0).setY(0).normalize(),
    up = new THREE.Vector3(0, 1, 0),
    z = new THREE.Vector3().crossVectors(x, up);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(x, up, z).setPosition(p0));
  return geo;
}

/** A flat ring or disc lying at height y, its plane given in the floor's coordinates (x, z). */
export function floorShape(shape: THREE.Shape, y: number, down = true) {
  const g = new THREE.ShapeGeometry(shape, 32);
  // (shape x → world x, shape y → world z)
  const P = g.attributes.position,
    N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    P.setXYZ(i, P.getX(i), y, P.getY(i));
    N.setXYZ(i, 0, down ? -1 : 1, 0);
  }
  return g;
}
