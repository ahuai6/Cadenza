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
  running?: () => boolean;
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

  // 4.0.0-alpha.6: the standard output joins the next song without a gap and is already sounding when it is selected
  it('goes straight to playing for an output that is already sounding, and still follows its events', async () => {
    const { c, open } = setup();
    const phases: string[] = [];
    c.subscribe((s) => phases.push(s.phase));
    const selecting = c.replace(['A', 'B'], 1, true, true);
    const out = await open();
    out.running = () => true;
    await selecting;
    // (open() resolved before running was set: start again with the joined output)
    c.pause();
    c.play();
    expect(c.get()).toMatchObject({ phase: 'playing', output: { id: 'B' } });
    expect(phases.at(-1)).toBe('playing');
    expect(phases.slice(phases.lastIndexOf('paused') + 1)).not.toContain('buffering');
    out.event('buffering');
    expect(c.get().phase).toBe('buffering');
    out.event('running');
    expect(c.get().phase).toBe('playing');
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
    c.seek(5, true);
    expect(c.get()).toMatchObject({ phase: 'paused', output: null, position: 5 });
    c.pause();
    void c.replace(['A', 'B'], 1, false, true);
    const b = await open();
    expect(b.start).not.toHaveBeenCalled();
    c.seek(5);
    c.play();
    expect(b.position).toBe(5);
  });

  it('does not submit an audio start revoked by a synchronous buffering observer', async () => {
    const { c, open } = setup();
    const off = c.subscribe((s) => {
      if (s.phase === 'buffering') c.pause();
    });
    void c.replace(['A'], 0, true, false);
    const a = await open();
    expect(a.start).not.toHaveBeenCalled();
    expect(c.get()).toMatchObject({ phase: 'paused', intent: false, output: null });
    off();
    c.play();
    expect(a.start).toHaveBeenCalledOnce();
  });

  it('does not let an EOF observer start two replacements or override the listener', async () => {
    const { c, open, jobs } = setup();
    void c.replace(['A', 'B', 'C'], 0, true, false);
    const a = await open();
    const off = c.subscribe((s) => {
      if (s.phase === 'ended') void c.playAt(2);
    });
    a.event('ended');
    off();
    expect(jobs.map((j) => j.request.entry.id)).toEqual(['A', 'C']);
    expect(c.get().target?.id).toBe('C');
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

  it('plays every occurrence once per shuffle round, including after the first wrap', async () => {
    const { c, open } = setup('shuffle');
    void c.replace(['A', 'A', 'B'], 0, true, false);
    await open();
    const played = [c.get().target!.key];
    for (let i = 1; i < 9; i++) {
      void c.next();
      await open();
      played.push(c.get().target!.key);
    }
    for (let i = 0; i < played.length; i += 3) expect(new Set(played.slice(i, i + 3)).size).toBe(3);
    expect(played.every((key, i) => i === 0 || key !== played[i - 1])).toBe(true);
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
