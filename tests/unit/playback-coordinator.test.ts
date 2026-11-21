import { describe, expect, it, vi } from 'vitest';
import {
  PlaybackCoordinator,
  type Mode,
  type Output,
  type OutputEvent,
  type PlaybackRequest,
  type Route,
} from '../../src/app/playback/coordinator';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Driver implements Output {
  readonly duration = 12;
  position = 0;
  events: ((event: OutputEvent) => void)[] = [];
  constructor(readonly route: Route) {}
  start = vi.fn((at: number, notify: (event: OutputEvent) => void) => {
    this.position = at;
    this.events.push(notify);
  });
  stop = vi.fn();
  pause = vi.fn();
  time = () => this.position;
  event(event: OutputEvent, run = this.events.length - 1) {
    this.events[run](event);
  }
}
function setup(mode: Mode = 'loop', route: Route = 'std') {
  const jobs: { request: PlaybackRequest; result: ReturnType<typeof deferred<Driver>> }[] = [];
  const scene = vi.fn();
  const stopped = vi.fn();
  const c = new PlaybackCoordinator(
    {
      duration: () => 12,
      route: () => route,
      prepare(request) {
        const result = deferred<Driver>();
        jobs.push({ request, result });
        return result.promise;
      },
      selected: stopped,
      ready: scene,
      plays: () => 0,
      random: () => 0,
    },
    mode,
  );
  const open = async (i = jobs.length - 1, via = jobs[i].request.route) => {
    const out = new Driver(via);
    jobs[i].result.resolve(out);
    await Promise.resolve();
    return out;
  };
  return { c, jobs, open, scene, stopped };
}

describe('PlaybackCoordinator', () => {
  it.each<Route>(['std', 'hifi'])('starts %s before the visual consumer can report readiness', async (route) => {
    const { c, open, scene } = setup('loop', route);
    const blocked = deferred<void>();
    scene.mockImplementation(() => blocked.promise);
    const selecting = c.replace(['A'], 0, true, false);
    const out = await open();
    await selecting;
    expect(scene).toHaveBeenCalledOnce();
    expect(out.start).toHaveBeenCalledBefore(scene);
    expect(c.get()).toMatchObject({ phase: 'buffering', intent: true, output: null });
    out.event('running');
    expect(c.get()).toMatchObject({ phase: 'playing', output: { id: 'A' } });
  });

  it('keeps the audio request alive when either scene observer throws synchronously', async () => {
    const { c, open, stopped, scene } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      stopped.mockImplementation(() => {
        throw new Error('old scene disposal');
      });
      scene.mockImplementation(() => {
        throw new Error('new scene scheduling');
      });
      const select = c.replace(['A'], 0, true, false);
      const a = await open();
      await select;
      a.event('running');
      expect(c.get()).toMatchObject({ phase: 'playing', error: null, output: { id: 'A' } });
      expect(a.stop).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('stops A before B preparation, revokes B, and ignores all late A/B results', async () => {
    const { c, jobs, open, stopped, scene } = setup();
    void c.replace(['A', 'B', 'C', 'A'], 0, true, false);
    const a = await open();
    a.event('running');
    void c.playAt(1);
    expect(a.stop).toHaveBeenCalledOnce();
    expect(a.stop.mock.invocationCallOrder[0]).toBeLessThan(stopped.mock.invocationCallOrder[1]);
    void c.playAt(2);
    expect(jobs[1].request.signal.aborted).toBe(true);
    const b = await open(1);
    expect(b.start).not.toHaveBeenCalled();
    expect(b.stop).toHaveBeenCalledOnce();
    a.event('running');
    a.event('ended');
    a.event({ error: 'late device error' });
    expect(scene).toHaveBeenCalledOnce();
    expect(c.get()).toMatchObject({ phase: 'preparing', target: { id: 'C' }, output: null, error: null });
    const driver = await open(2);
    driver.event('running');
    expect(c.get().output?.id).toBe('C');
    const oldKey = jobs[0].request.entry.key;
    void c.playAt(3);
    expect(c.get().target?.key).not.toBe(oldKey);
    a.event('ended');
    expect(c.get().index).toBe(3);
  });

  it('applies pause and the latest seek during preparation; resume and scrub submit only current commands', async () => {
    const { c, open } = setup();
    void c.replace(['A', 'B'], 0, true, false);
    c.seek(7);
    c.pause();
    c.pause();
    const a = await open();
    expect(a.start).not.toHaveBeenCalled();
    expect(c.time).toBe(7);
    c.play();
    c.play();
    expect(a.start).toHaveBeenCalledOnce();
    expect(a.position).toBe(7);
    c.seek(2, true);
    c.seek(3, true);
    expect(a.pause).toHaveBeenCalledOnce();
    a.event('ended', 0);
    expect(c.get().index).toBe(0);
    c.seek(4);
    expect(a.position).toBe(4);
    a.event('running', 0);
    expect(c.get().phase).toBe('buffering');
    a.event('running');
    expect(c.get().phase).toBe('playing');
    c.pause();
    void c.replace(['A', 'B'], 1, false, true);
    const b = await open();
    expect(b.start).not.toHaveBeenCalled();
    c.seek(5);
    c.play();
    expect(b.position).toBe(5);
  });

  it('uses backend EOF for albums, one, stop and occurrence-aware shuffle', async () => {
    const { c, open } = setup('stop');
    void c.replace(['A', 'A'], 0, true, true);
    const a = await open();
    a.event('running');
    const k = c.get().target?.key;
    a.event('ended');
    expect(c.get().index).toBe(1);
    expect(c.get().target?.key).not.toBe(k);
    const b = await open();
    b.event('ended');
    expect(c.get()).toMatchObject({ phase: 'ended', intent: false, index: 1, position: 12 });
    c.setMode('one');
    c.play();
    b.event('ended');
    expect(b.start).toHaveBeenCalledTimes(3);
    expect(b.position).toBe(0);
    c.setMode('shuffle');
    void c.replace(['A', 'A', 'B'], 0, true, false);
    (await open()).event('ended');
    expect(c.get().index).toBe(1);
    (await open()).event('ended');
    expect(c.get().index).toBe(2);
    void c.previous();
    expect(c.get().index).toBe(1);
    const back = await open();
    back.event('running');
    back.position = 3.1;
    await c.previous();
    expect(c.get().index).toBe(1);
    expect(back.position).toBe(0);
  });

  it('retains the selected occurrence on reorder, device replacement and failure retry', async () => {
    const { c, open, jobs } = setup('loop', 'hifi');
    void c.replace(['A', 'B', 'A'], 2, true, false);
    const a = await open();
    a.event('running');
    a.position = 8;
    const [first, b, current] = c.get().queue;
    c.reorder([current.key, b.key, first.key]);
    expect(c.get().index).toBe(0);
    void c.restart(true, c.time, 'std');
    expect(a.stop).toHaveBeenCalledOnce();
    expect(jobs[1].request.route).toBe('std');
    jobs[1].result.reject(new Error('unavailable'));
    await Promise.resolve();
    expect(c.get()).toMatchObject({ phase: 'error', intent: false, position: 8, target: current });
    c.play();
    const retry = await open();
    expect(retry.position).toBe(8);
    retry.event('running');
    c.stop();
    retry.event('ended');
    expect(c.get()).toMatchObject({ phase: 'paused', output: null, target: current });
    c.play();
    expect((await open()).start).toHaveBeenCalledOnce();
  });

  it('releases every superseded resource and never grants a stale load permission over 100 selections', async () => {
    const { c, open, jobs, scene } = setup();
    void c.replace(['A', 'B', 'C'], 0, true, false);
    for (let i = 0; i < 100; i++) void c.select(i % 3, true);
    const outputs = [];
    for (let i = 0; i < jobs.length; i++) outputs.push(await open(i));
    expect(outputs.slice(0, -1).every((o) => o.stop.mock.calls.length === 1 && !o.start.mock.calls.length)).toBe(true);
    expect(outputs.at(-1)?.start).toHaveBeenCalledOnce();
    expect(scene).toHaveBeenCalledOnce();
  });
});
