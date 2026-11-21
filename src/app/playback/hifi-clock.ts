export interface NativeObservation {
  epoch: number;
  t: number;
  run: boolean;
  limit: number;
}

/** Interpolate only between native observations and within submitted PCM for this run. */
export class HifiClock {
  private epoch = 0;
  private anchor = 0;
  private received = 0;
  private upper = 0;
  private last = 0;

  reset(position: number) {
    this.epoch = 0;
    this.last = this.anchor = this.upper = position;
  }

  accepts(epoch: number) {
    return Number.isSafeInteger(epoch) && epoch >= this.epoch;
  }

  observe({ epoch, t, run, limit }: NativeObservation, received: number) {
    if (!this.accepts(epoch) || !Number.isFinite(t) || t < 0 || !Number.isFinite(limit) || limit < t) return false;
    if (epoch !== this.epoch || !run) this.last = t;
    this.epoch = epoch;
    this.anchor = t;
    this.received = received;
    this.upper = run ? Math.min(limit, t + 0.055) : t;
    return true;
  }

  time(now: number) {
    const elapsed = Math.max(0, now - this.received) / 1000;
    return (this.last = Math.max(this.last, Math.min(this.upper, this.anchor + elapsed)));
  }

  remainingMs(now: number) {
    return Math.max(0, (this.upper - this.time(now)) * 1000);
  }
}
