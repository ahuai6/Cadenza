import { describe, it, expect, vi, afterEach } from 'vitest';
import { frameLoop } from '../../src/core/frames';

// a browser whose animation frames can be held back (a window a screen recorder covers)
function fakeBrowser() {
  let id = 0;
  const queue = new Map<number, (t: number) => void>();
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => (queue.set(++id, f), id));
  vi.stubGlobal('cancelAnimationFrame', (i: number) => queue.delete(i));
  vi.stubGlobal('document', { visibilityState: 'visible' });
  return {
    pending: () => queue.size,
    // the browser gives one frame
    frame() {
      const fs = [...queue.values()];
      queue.clear();
      fs.forEach((f) => f(performance.now()));
    },
  };
}

describe('frame loop', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('draws on from a timer when the browser stops giving frames, and hands back when they return', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const b = fakeBrowser();
    let n = 0;
    const loop = frameLoop(() => n++);
    b.frame();
    b.frame();
    expect(n).toBe(2);
    // no frames for a second: after a second the picture goes on at about 30 a second
    vi.advanceTimersByTime(2000);
    expect(n).toBeGreaterThan(25);
    expect(loop.stalls()).toBe(1);
    // the frames come back: one chain only — a browser frame draws once, and the timer stands down
    const before = n;
    b.frame();
    expect(n).toBe(before + 1);
    expect(b.pending()).toBe(1);
    for (let k = 0; k < 10; k++) {
      vi.advanceTimersByTime(16);
      b.frame();
    }
    expect(n).toBe(before + 11);
    loop.stop();
    vi.advanceTimersByTime(1000);
    b.frame();
    expect(n).toBe(before + 11);
  });
  it('leaves a hidden page alone (minimised)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    fakeBrowser();
    (document as { visibilityState: string }).visibilityState = 'hidden';
    let n = 0;
    const loop = frameLoop(() => n++);
    vi.advanceTimersByTime(1000);
    expect(n).toBe(0);
    loop.stop();
  });
});

describe('frame loop on a slow graphics card', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('backs off when the frames were only slow, not stopped', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    const b = fakeBrowser();
    let n = 0;
    const loop = frameLoop(() => n++);
    // frames every 1.4 s: the first gap is taken for a stall, then the wait grows past the card's pace
    for (let k = 0; k < 12; k++) {
      vi.advanceTimersByTime(1400);
      b.frame();
    }
    const before = loop.stalls();
    for (let k = 0; k < 12; k++) {
      vi.advanceTimersByTime(1400);
      b.frame();
    }
    expect(loop.stalls()).toBe(before);
    expect(before).toBeLessThanOrEqual(2);
    loop.stop();
  });
});
