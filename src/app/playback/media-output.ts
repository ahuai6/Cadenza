import type { AudioClock } from '../../engine';
import type { OutputEvent } from './coordinator';

type Run = {
  notify: (event: OutputEvent) => void;
  acknowledged: boolean;
  starved: boolean;
  running: boolean;
};

/** One detached element, reused for pause, seek and single-track repeat. Only the authorized run is connected. */
export class MediaOutput {
  private readonly element = new Audio();
  private readonly lifetime = new AbortController();
  private graph: ReturnType<AudioClock['mediaInput']> | null = null;
  private connected = false;
  private run: Run | null = null;
  private position = 0;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<void>;

  constructor(
    url: string,
    private readonly clock: AudioClock,
    private readonly gain: (remaining: number) => number,
    private readonly fade: boolean,
  ) {
    const { element, lifetime } = this;
    const { signal } = lifetime;
    element.crossOrigin = 'anonymous';
    // Browsers can fetch more than the headers, but only one detached candidate is allowed to preload.
    element.preload = 'metadata';
    this.ready = new Promise<void>((resolve, reject) => {
      element.addEventListener('loadedmetadata', () => resolve(), { signal, once: true });
      element.addEventListener('error', () => reject(this.error()), { signal, once: true });
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    element.addEventListener(
      'playing',
      () => {
        if (this.run) this.run.starved = false;
        this.refresh();
      },
      { signal },
    );
    element.addEventListener(
      'waiting',
      () => {
        if (this.run && element.readyState < element.HAVE_FUTURE_DATA) this.run.starved = true;
        this.refresh();
      },
      { signal },
    );
    element.addEventListener('seeking', this.refresh, { signal });
    element.addEventListener('seeked', this.refresh, { signal });
    element.addEventListener(
      'ended',
      () => {
        if (element.ended && !element.seeking && this.run?.acknowledged) {
          const { notify } = this.run;
          this.run = null;
          this.disconnect();
          notify('ended');
        }
      },
      { signal },
    );
    element.addEventListener('error', () => this.run?.notify({ error: this.error().message }), { signal });
    element.src = url;
  }

  get duration() {
    return Number.isFinite(this.element.duration) ? this.element.duration : 0;
  }

  start(at: number, notify: Run['notify']) {
    const { element, lifetime } = this;
    if (lifetime.signal.aborted) return;
    if (element.error) return notify({ error: this.error().message });
    this.disconnect();
    const run: Run = { notify, acknowledged: false, starved: false, running: false };
    this.run = run;
    this.position = at;
    if (!this.graph) {
      this.graph = this.clock.mediaInput(element);
      this.graph.context.addEventListener('statechange', this.refresh, { signal: lifetime.signal });
    }
    if (element.ended || Math.abs(element.currentTime - at) > 0.01) {
      element.pause();
      element.currentTime = at;
    }
    // Connect before play so the first frames are not lost while the playing event is queued.
    this.graph.source.connect(this.graph.input);
    this.connected = true;
    this.syncGain();
    const playing = element.play();
    void Promise.all([playing, this.graph.context.resume()]).then(
      () => {
        if (this.run !== run) return;
        run.acknowledged = true;
        this.refresh();
      },
      (error) => {
        if (this.run === run) notify({ error: String(error) });
      },
    );
  }

  pause() {
    this.run = null;
    this.disconnect();
    this.element.pause();
  }

  close() {
    if (this.lifetime.signal.aborted) return;
    this.pause();
    this.lifetime.abort();
    this.element.removeAttribute('src');
    this.element.load();
    this.graph = null;
  }

  time = () => {
    if (this.run?.running && !this.element.seeking && this.graph?.context.state === 'running') {
      const time = this.element.currentTime - this.clock.outputDelay();
      this.position = Math.max(this.position, Math.min(time, this.duration || Infinity));
    }
    return this.position;
  };

  syncGain = () => {
    if (!this.connected) return;
    this.clock.gain(this.gain(this.duration ? this.duration - this.time() : Infinity));
  };

  private refresh = () => {
    const { run, element, graph } = this;
    if (!run || !graph || !run.acknowledged) return;
    const running =
      !run.starved &&
      !element.paused &&
      !element.seeking &&
      !element.ended &&
      !element.error &&
      element.readyState >= element.HAVE_CURRENT_DATA &&
      graph.context.state === 'running';
    if (running === run.running) return;
    if (running) {
      run.running = true;
      this.fadeTick();
      run.notify('running');
    } else {
      this.time();
      run.running = false;
      clearTimeout(this.fadeTimer);
      run.notify('buffering');
    }
  };

  private fadeTick() {
    this.syncGain();
    if (!this.fade || !this.duration || !this.connected) return;
    const remaining = this.duration - this.time();
    this.fadeTimer = setTimeout(() => this.fadeTick(), Math.max(16, Math.min(30_000, (remaining - 1.6) * 1000)));
  }

  private disconnect() {
    clearTimeout(this.fadeTimer);
    if (this.connected) this.graph?.source.disconnect();
    this.connected = false;
  }

  private error() {
    const error = this.element.error;
    return new Error(`media-${error?.code ?? 'error'}${error?.message ? ': ' + error.message : ''}`);
  }
}
