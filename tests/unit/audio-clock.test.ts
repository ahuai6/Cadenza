import { expect, it, vi } from 'vitest';
import { AudioClock } from '../../src/engine/audio';

it('holds its last output position on suspend, even while the wall clock advances', () => {
  vi.useFakeTimers({ toFake: ['performance'] });
  try {
    const source = { connect() {}, start() {}, stop() {}, disconnect() {} };
    let state: AudioContextState = 'running';
    let currentTime = 1;
    const context = {
      get state() {
        return state;
      },
      get currentTime() {
        return currentTime;
      },
      getOutputTimestamp: () => ({ contextTime: 0.25, performanceTime: 50 }),
      createGain: () => ({ connect() {} }),
      createBufferSource: () => source,
      resume: () => Promise.resolve(),
    };
    const clock = new AudioClock(() => context as unknown as AudioContext);
    clock.start(3, { getChannelData: () => new Float32Array() } as unknown as AudioBuffer, 0, 20);
    vi.advanceTimersByTime(1000);
    currentTime = 1.3;
    const before = clock.now(0);
    expect(before).toBeGreaterThan(3);
    state = 'suspended';
    vi.advanceTimersByTime(500);
    expect(clock.now(0)).toBe(before);
    clock.stop();
  } finally {
    vi.useRealTimers();
  }
});
