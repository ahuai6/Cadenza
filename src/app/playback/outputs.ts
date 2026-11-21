import type { AudioLike } from '../../engine';
import { mediaUrl } from '../bridge';
import type { Entry, Output, PlaybackRequest } from './coordinator';
import * as native from './hifi';
import { engine } from './stage';

let decoder: OfflineAudioContext | null = null;
// Chromium cannot cancel a decode after submission. Reserve one slot for the newest
// request when another decode is draining and keep unsubmitted work cancellable.
let decoding = 0;
const decodeWaiters: (() => void)[] = [];
export async function decodeFile(id: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (decoding < 2) decoding++;
  else
    await new Promise<void>((resolve, reject) => {
      const advance = () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      };
      const cancel = () => {
        const i = decodeWaiters.indexOf(advance);
        if (i >= 0) decodeWaiters.splice(i, 1);
        reject(signal?.reason);
      };
      decodeWaiters.push(advance);
      signal?.addEventListener('abort', cancel, { once: true });
    });
  try {
    signal?.throwIfAborted();
    const r = await fetch(mediaUrl(id), { signal });
    if (!r.ok) throw new Error('read');
    const bytes = await r.arrayBuffer();
    signal?.throwIfAborted();
    return await (decoder ||= new OfflineAudioContext(2, 1, 48000)).decodeAudioData(bytes);
  } finally {
    const next = decodeWaiters.shift();
    if (next) next();
    else decoding--;
  }
}

let ahead: { id: string; abort: AbortController; buffer: Promise<AudioBuffer> } | null = null;
export function clearPreload(id?: string) {
  if (!ahead || (id && ahead.id !== id)) return;
  ahead.abort.abort();
  ahead = null;
}
export function preload(entry: Entry | null, route: PlaybackRequest['route'], currentId: string) {
  if (route === 'hifi') {
    clearPreload();
    void native.preload(entry && entry.id !== currentId ? entry.id : null);
    return;
  }
  if (ahead && ahead.id === entry?.id) return;
  clearPreload();
  if (!entry || entry.id === currentId) return;
  const abort = new AbortController();
  const job = { id: entry.id, abort, buffer: decodeFile(entry.id, abort.signal) };
  ahead = job;
  void job.buffer.catch(() => {
    if (ahead === job) ahead = null;
  });
}

export interface PreparedOutput extends Output {
  readonly audio: AudioLike;
  readonly pcm?: AudioBuffer;
  readonly nativeSeq?: number;
  syncGain(): void;
}
export async function prepareOutput(
  request: PlaybackRequest,
  trackDuration: number,
  album: boolean,
): Promise<PreparedOutput> {
  const {
    entry: { id },
    route,
    signal,
  } = request;
  const amplitude = (remaining: number) =>
    engine.muted ? 0 : engine.volume * engine.balance * (album ? 1 : Math.min(1, Math.max(0, remaining / 1.6)));
  if (route === 'hifi') {
    clearPreload();
    const info = await native.load(id, signal);
    if (signal.aborted) native.stop(info.seq);
    signal.throwIfAborted();
    const duration = info.dur || trackDuration;
    const syncGain = () =>
      native.gain(
        amplitude(duration > 0 ? duration - native.time() : Infinity),
        engine.muted || engine.volume <= 0 ? 0 : engine.balance,
      );
    return {
      route,
      duration,
      nativeSeq: info.seq,
      audio: {
        duration,
        sampleRate: info.src.rate,
        numberOfChannels: Math.min(2, info.src.ch),
        length: Math.round(duration * info.src.rate),
        load: () => decodeFile(id),
      },
      start(at, notify) {
        native.start(info.seq, at, (event) => {
          // End or failure can revoke this resource. Do all of its gain work before notifying.
          if (event === 'running') syncGain();
          notify(event);
        });
        syncGain();
      },
      pause: () => native.pause(info.seq),
      stop: () => native.stop(info.seq),
      time: native.time,
      syncGain,
    };
  }
  const candidate = ahead?.id === id ? ahead : null;
  if (candidate) ahead = null;
  else clearPreload();
  const cancel = () => candidate?.abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let pcm: AudioBuffer;
  try {
    pcm = await (candidate ? candidate.buffer : decodeFile(id, signal));
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  const clock = engine.clock;
  let stopped = false;
  let started = false;
  const syncGain = () => clock.gain(amplitude(pcm.duration - clock.now(0)));
  const pause = () => {
    if (!started) return;
    started = false;
    clock.stop();
  };
  return {
    route,
    duration: pcm.duration,
    audio: pcm,
    pcm,
    syncGain,
    start(at, notify) {
      if (stopped) return;
      started = true;
      clock.start(at, pcm, 0, pcm.duration, notify, syncGain);
      syncGain();
    },
    pause,
    stop() {
      pause();
      stopped = true;
    },
    time: () => clock.now(0),
  };
}
