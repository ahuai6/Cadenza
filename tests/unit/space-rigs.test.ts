// The rigs that hold the space's view: walking (keys, walls, flights, sitting, following) and chosen shots.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShotRig } from '../../src/app/space/rigs/shots';
import { WalkRig } from '../../src/app/space/rigs/walk';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// a room 10 m square, 6 m high, and a second one beyond a wall at x = 5 (reached by way of a door at z = 4)
const room = (p: THREE.Vector3) =>
  (Math.abs(p.x) < 5 && Math.abs(p.z) < 5) ||
  (p.x > 6 && p.x < 16 && Math.abs(p.z) < 5) ||
  (p.x >= 5 && p.x <= 6 && Math.abs(p.z - 4) < 1)
    ? { top: 6 }
    : null;
const walker = (walked?: () => void) =>
  new WalkRig({
    start: { pos: V(0, 1.6, 0), yaw: 0, pitch: 0 },
    eye: 1.6,
    region: room,
    route: (to) => (to.x > 5 ? [V(4, 1.6, 4), V(7, 1.6, 4)] : []),
    speed: () => 1,
    sensitivity: () => 1,
    onWalk: walked,
  });
const run = (rig: { step(now: number, dt: number): void }, seconds: number, each?: () => void) => {
  const t0 = performance.now();
  for (let i = 1; i <= seconds * 60; i++) {
    rig.step(t0 + (i * 1000) / 60, 1 / 60);
    each?.();
  }
};

describe('walking', () => {
  it('goes where the keys say, and a wall stops it without sticking', () => {
    let walked = 0;
    const w = walker(() => walked++);
    w.steer({ forward: 1, right: 1, up: 0 });
    run(w, 4);
    // (forward is -z, right is +x: into the corner, held inside the room on both axes)
    expect(walked).toBeGreaterThan(0);
    expect(w.pose.pos.x).toBeGreaterThan(4.5);
    expect(w.pose.pos.x).toBeLessThan(5);
    expect(w.pose.pos.z).toBeLessThan(-4.5);
    expect(w.pose.pos.z).toBeGreaterThan(-5);
    // along a wall it still slides
    w.steer({ forward: 0, right: 0, up: 0 });
    run(w, 2);
    w.steer({ forward: -1, right: 1, up: 0 });
    const z0 = w.pose.pos.z;
    run(w, 1);
    expect(w.pose.pos.z).toBeGreaterThan(z0 + 1);
  });

  it('flies straight within a room and through the door to another, never through the wall', () => {
    const w = walker();
    w.fly(V(3, 1.6, -3), 1, 0.1);
    expect(w.flying).toBe(true);
    run(w, 3);
    expect(w.flying).toBe(false);
    expect(w.pose.pos.distanceTo(V(3, 1.6, -3))).toBeLessThan(1e-6);
    expect(w.pose.yaw).toBeCloseTo(1, 5);
    w.fly(V(11, 1.6, 0), 0, 0);
    run(w, 7, () => expect(room(w.pose.pos), `at ${w.pose.pos.toArray()}`).not.toBeNull());
    expect(w.pose.pos.distanceTo(V(11, 1.6, 0))).toBeLessThan(1e-3);
  });

  it('a resting hand does not end a flight; a deliberate look does', () => {
    const w = walker();
    w.fly(V(3, 1.6, -3), 0, 0);
    w.look(3, 2);
    expect(w.flying).toBe(true);
    w.look(60, 0);
    expect(w.flying).toBe(false);
  });

  it('sits until walked off, then rises to eye height', () => {
    const w = walker();
    w.sit(V(2, 1.15, 2), Math.PI);
    run(w, 2);
    expect(w.seated).toBe(true);
    expect(w.pose.pos.y).toBeCloseTo(1.15, 5);
    w.steer({ forward: 1, right: 0, up: 0 });
    run(w, 2);
    expect(w.seated).toBe(false);
    expect(w.pose.pos.y).toBeCloseTo(1.6, 2);
  });

  it('turns to follow from rest, without overshooting, and the hand takes over', () => {
    const w = walker();
    w.follow(0.8);
    w.step(performance.now(), 1 / 60);
    expect(Math.abs(w.pose.yaw)).toBeLessThan(0.01); // (it eases in)
    let max = 0;
    run(w, 4, () => (max = Math.max(max, w.pose.yaw)));
    expect(max).toBeLessThan(0.81);
    expect(w.pose.yaw).toBeCloseTo(0.8, 2);
    w.follow(-0.8);
    run(w, 0.2);
    w.look(10, 0);
    const y = w.pose.yaw;
    run(w, 1);
    expect(w.pose.yaw).toBeCloseTo(y, 6);
  });
});

describe('shots', () => {
  const shots = [
    { pos: V(0, 1.6, 0), yaw: 0, pitch: 0 },
    { pos: V(8, 2, -4), yaw: 3, pitch: 0.1 },
  ];
  it('rests on a shot and eases to the next when asked', () => {
    const r = new ShotRig({ shots, move: 2, reduced: () => true });
    run(r, 1);
    expect(r.pose.pos.distanceTo(shots[0].pos)).toBe(0);
    const moving = new ShotRig({ shots, move: 2, reduced: () => false });
    const t0 = performance.now();
    moving.go(1, t0);
    moving.step(t0 + 1000, 1 / 60);
    expect(moving.pose.pos.x).toBeCloseTo(4, 5); // (half way at half time)
    moving.step(t0 + 2000, 1 / 60);
    expect(moving.pose.pos.distanceTo(shots[1].pos)).toBeLessThan(1e-9);
  });
  it('reduced motion: there at once; the hand only leans the view, and it comes back', () => {
    const r = new ShotRig({ shots, reduced: () => true });
    r.go(1);
    r.step(performance.now(), 1 / 60);
    expect(r.pose.pos.distanceTo(shots[1].pos)).toBe(0);
    r.look(5000, 0);
    r.step(performance.now(), 1 / 60);
    expect(Math.abs(r.pose.yaw - 3)).toBeLessThan(0.13);
    run(r, 4);
    expect(r.pose.yaw).toBeCloseTo(3, 2);
  });
});
