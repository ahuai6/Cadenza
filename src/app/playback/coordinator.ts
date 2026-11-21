import { createStore } from '../../core/emitter';

export type Route = 'std' | 'hifi';
export type Mode = 'loop' | 'shuffle' | 'one' | 'stop';
export type Phase = 'idle' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
export type Entry = Readonly<{ id: string; key: number }>;
export type OutputEvent = 'running' | 'buffering' | 'ended' | { error: string };
export interface Output {
  readonly route: Route;
  readonly duration: number;
  start(at: number, notify: (event: OutputEvent) => void): void;
  pause(): void;
  stop(): void;
  time(): number;
}
export interface PlaybackRequest {
  readonly generation: number;
  readonly entry: Entry;
  readonly signal: AbortSignal;
  readonly route: Route;
  readonly direction: -1 | 0 | 1;
  readonly automatic: boolean;
}
type Options<T extends Output> = {
  duration(id: string): number;
  route(): Route;
  prepare(request: PlaybackRequest): Promise<T>;
  selected(request: PlaybackRequest): void;
  ready(request: PlaybackRequest, output: T): void;
  plays(id: string): number;
  random?: () => number;
};
export type PlaybackState = Readonly<{
  queue: readonly Entry[];
  index: number;
  target: Entry | null;
  output: Entry | null;
  generation: number;
  direction: -1 | 0 | 1;
  intent: boolean;
  phase: Phase;
  route: Route;
  duration: number;
  position: number;
  error: string | null;
  mode: Mode;
  album: boolean;
  candidate: Entry | null;
}>;

export class PlaybackCoordinator<T extends Output> {
  private readonly state;
  private current: { request: PlaybackRequest; abort: AbortController; output: T | null } | null = null;
  private run = 0;
  private entryKey = 0;
  private scrubbing = false;
  private readonly history: number[] = [];
  private readonly round = new Set<number>();

  constructor(
    private readonly options: Options<T>,
    mode: Mode,
  ) {
    this.state = createStore<PlaybackState>({
      queue: [],
      index: -1,
      target: null,
      output: null,
      generation: 0,
      direction: 0,
      intent: false,
      phase: 'idle',
      route: 'std',
      duration: 0,
      position: 0,
      error: null,
      mode,
      album: false,
      candidate: null,
    });
  }
  get = () => this.state.get();
  subscribe = (fn: (next: PlaybackState, prev: PlaybackState) => void) => this.state.subscribe(fn);
  get time() {
    const s = this.get();
    return s.phase === 'playing' && this.current?.output
      ? Math.min(s.duration || Infinity, Math.max(0, this.current.output.time()))
      : s.position;
  }

  private queue(queue: readonly Entry[], index: number, patch: Partial<PlaybackState> = {}) {
    const { mode, album } = { ...this.get(), ...patch };
    const candidate =
      mode === 'one'
        ? queue[index]
        : mode === 'shuffle' && !album
          ? undefined
          : queue[index + 1] || (mode === 'loop' ? queue[0] : undefined);
    this.state.set({ queue, index, candidate: candidate || null, ...patch });
  }
  async replace(ids: readonly string[], index: number, intent: boolean, album: boolean) {
    const entries = ids.map((id) => this.entry(id));
    if (!entries[index]) return;
    this.history.length = 0;
    this.round.clear();
    await this.select(index, intent, 0, 0, false, this.options.route(), entries, album);
  }
  private entry(id: string): Entry {
    return { id, key: ++this.entryKey };
  }
  /** Reconcile list additions or Play Next without reassigning the active occurrence. */
  reconcile(ids: readonly string[]) {
    const { queue, target, index } = this.get();
    const unused = new Map<string, Entry[]>();
    for (const e of queue) {
      if (e === target) continue;
      const es = unused.get(e.id) || [];
      es.push(e);
      unused.set(e.id, es);
    }
    // List following only inserts new IDs. Play Next keeps the prefix including the active entry.
    const before = target ? queue.slice(0, index).filter((e) => e.id === target.id).length : 0;
    let occurrences = 0;
    const entries = ids.map((id) => {
      if (target?.id === id && occurrences++ === before) return target;
      return unused.get(id)?.shift() || this.entry(id);
    });
    this.queue(entries, target ? entries.indexOf(target) : -1);
  }
  reorder(keys: readonly number[]) {
    const { queue, target } = this.get();
    if (keys.length !== queue.length || new Set(keys).size !== keys.length) return;
    const byKey = new Map(queue.map((e) => [e.key, e]));
    const entries = keys.map((key) => byKey.get(key)!);
    if (entries.some((e) => !e)) return;
    this.queue(entries, target ? entries.indexOf(target) : -1);
  }
  remove(index: number) {
    const s = this.get();
    if (!s.queue[index] || index === s.index) return;
    this.queue(
      s.queue.filter((_, i) => i !== index),
      index < s.index ? s.index - 1 : s.index,
    );
  }
  clearQueue() {
    const { target } = this.get();
    this.history.length = 0;
    this.round.clear();
    this.queue(target ? [target] : [], target ? 0 : -1);
  }
  setMode(mode: Mode) {
    const { queue, index } = this.get();
    if (mode === 'shuffle') this.round.clear();
    this.queue(queue, index, { mode });
  }
  private revoke() {
    this.run++;
    const current = this.current;
    this.current = null;
    current?.abort.abort();
    current?.output?.stop();
  }
  async select(
    index: number,
    intent: boolean,
    at = 0,
    direction: -1 | 0 | 1 = 0,
    automatic = false,
    route = this.options.route(),
    queue = this.get().queue,
    album = this.get().album,
  ) {
    const entry = queue[index];
    if (!entry) return;
    this.revoke();
    this.scrubbing = false;
    const abort = new AbortController();
    const generation = this.get().generation + 1;
    const request: PlaybackRequest = { generation, entry, signal: abort.signal, route, direction, automatic };
    const current = { request, abort, output: null } as NonNullable<typeof this.current>;
    this.current = current;
    this.queue(queue, index, {
      generation,
      direction,
      intent,
      route,
      album,
      target: entry,
      output: null,
      phase: 'preparing',
      duration: this.options.duration(entry.id),
      position: Math.max(0, at),
      error: null,
    });
    if (this.current !== current) return;
    try {
      this.options.selected(request);
    } catch (error) {
      console.warn('playback selection observer', error);
    }
    if (this.current !== current) return;
    let output: T;
    try {
      output = await this.options.prepare(request);
    } catch (error) {
      if (this.current === current) this.fail(String((error as Error)?.message || error));
      return;
    }
    if (this.current !== current) {
      output.stop();
      return;
    }
    current.output = output;
    this.state.set({
      route: output.route,
      duration: output.duration,
      position: Math.min(this.get().position, output.duration || Infinity),
      phase: 'paused',
    });
    if (this.current === current && this.get().intent) this.start();
    if (this.current === current && current.output) {
      try {
        this.options.ready(request, output);
      } catch (error) {
        console.warn('playback readiness observer', error);
      }
    }
  }
  private fail(error: string) {
    const position = this.time;
    this.run++;
    this.current?.output?.stop();
    if (this.current) this.current.output = null;
    this.state.set({ phase: 'error', output: null, intent: false, error, position });
  }
  private start() {
    const current = this.current,
      output = current?.output;
    const s = this.get();
    if (!output || !s.intent || this.scrubbing || s.phase === 'playing' || s.phase === 'buffering') return;
    const position = output.duration > 0 && s.position >= output.duration ? 0 : s.position;
    const run = ++this.run;
    this.state.set({ phase: 'buffering', position, output: null });
    if (this.current !== current || this.run !== run) return;
    try {
      output.start(position, (event) => {
        if (this.current !== current || run !== this.run) return;
        if (typeof event !== 'string') {
          this.fail(event.error);
        } else if (event === 'ended') {
          const endedRun = ++this.run;
          this.state.set({ phase: 'ended', position: output.duration, output: null });
          if (this.current === current && this.run === endedRun && this.get().phase === 'ended' && this.get().intent)
            void this.next(true);
        } else if (event === 'running' && this.get().phase !== 'playing') {
          this.state.set({ phase: 'playing', output: current.request.entry });
        } else if (event === 'buffering' && this.get().phase === 'playing') {
          this.state.set({ phase: 'buffering', position: this.time, output: null });
        }
      });
    } catch (error) {
      if (this.current === current && this.run === run) this.fail(String((error as Error)?.message || error));
    }
  }
  play() {
    const s = this.get();
    if (!s.target || (s.intent && s.phase !== 'ended')) return;
    if (!this.current || s.phase === 'error') {
      void this.select(s.index, true, s.position);
      return;
    }
    this.state.set({ intent: true });
    this.start();
  }
  pause() {
    const s = this.get();
    if (!s.intent) return;
    const position = this.time;
    if (s.phase === 'playing' || s.phase === 'buffering') {
      this.run++;
      this.current?.output?.pause();
    }
    this.state.set({ intent: false, position, output: null, phase: s.phase === 'preparing' ? 'preparing' : 'paused' });
  }
  seek(at: number, scrubbing = false) {
    const s = this.get();
    const current = this.current;
    if (!s.target || !Number.isFinite(at)) return;
    this.scrubbing = scrubbing;
    const position = Math.max(0, Math.min(s.duration || Infinity, at));
    if (s.phase === 'playing' || s.phase === 'buffering') {
      this.run++;
      // A committed seek can be one backend command. Beginning a drag pauses until it is committed.
      if (scrubbing) this.current?.output?.pause();
    }
    this.state.set({ position, phase: current?.output ? 'paused' : s.phase, output: null });
    if (this.current === current && !scrubbing) this.start();
  }
  /** Close the current resource without throwing away the selected entry or its position. */
  stop() {
    if (!this.current) return;
    const position = this.time;
    this.revoke();
    this.state.set({ intent: false, phase: 'paused', output: null, position });
  }
  restart(intent = this.get().intent, at = this.time, route = this.options.route()) {
    const { index } = this.get();
    return this.select(index, intent, at, 0, false, route);
  }

  private remember() {
    const key = this.get().target?.key;
    if (key !== undefined) this.history.push(key);
    if (this.history.length > 200) this.history.shift();
  }
  async next(automatic = false) {
    const s = this.get();
    if (!s.queue.length) return;
    if (automatic && s.mode === 'one') {
      this.state.set({ position: 0 });
      this.start();
      return;
    }
    let index = s.index + 1;
    if (s.mode === 'shuffle' && !s.album) {
      if (s.target) this.round.add(s.target.key);
      let candidates = s.queue.filter((e) => !this.round.has(e.key));
      if (!candidates.length) {
        this.round.clear();
        // Avoid an immediate repeat, but the previous round's last entry has
        // not been played in the new round yet.
        candidates = s.queue.filter((e) => e !== s.target);
      }
      const e = weightedPick(candidates, (e) => this.options.plays(e.id), this.options.random || Math.random);
      index = e ? s.queue.indexOf(e) : 0;
    } else if (index >= s.queue.length) {
      if (automatic && s.mode !== 'loop') {
        this.state.set({ intent: false });
        return;
      }
      index = 0;
    }
    this.remember();
    await this.select(index, true, 0, 1, automatic);
  }
  async previous(keepIntent = false) {
    const s = this.get();
    if (this.time > 3) return this.seek(0);
    if (s.mode === 'shuffle' && !s.album) {
      while (this.history.length) {
        const key = this.history.pop();
        const i = s.queue.findIndex((e) => e.key === key);
        if (i >= 0) return this.select(i, keepIntent ? s.intent : true, 0, -1);
      }
    }
    if (s.index > 0) await this.select(s.index - 1, keepIntent ? s.intent : true, 0, -1);
    else if (s.mode === 'loop' && s.queue.length > 1)
      await this.select(s.queue.length - 1, keepIntent ? s.intent : true, 0, -1);
    else this.seek(0);
  }
  async playAt(index: number) {
    if (index === this.get().index) return this.play();
    if (!this.get().queue[index]) return;
    this.remember();
    await this.select(index, true);
  }
}

export function weightedPick<T>(items: readonly T[], plays: (e: T) => number, random: () => number): T | undefined {
  const weights = items.map((e) => 1 / (1 + plays(e)) ** 0.75);
  let value = random() * weights.reduce((a, b) => a + b, 0);
  return items.find((_, i) => (value -= weights[i]) <= 0) ?? items.at(-1);
}
