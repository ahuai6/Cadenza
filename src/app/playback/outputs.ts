import type { AudioLike } from '../../engine';
import type { Track } from '../bridge';
import type { Output, PlaybackRequest } from './coordinator';
import * as native from './hifi';
import { PcmOutput, END_FADE_SECONDS } from './pcm-output';
import { decodeFile } from './pcm';
import { engine } from './stage';

const amplitude = (album: boolean, remaining: number) =>
  engine.muted
    ? 0
    : engine.volume * engine.balance * (album ? 1 : Math.min(1, Math.max(0, remaining / END_FADE_SECONDS)));

/** The next song, opened ahead and chained to the one playing so it follows without a gap. */
let ahead: { key: string; output: PcmOutput; album: boolean; after: PcmOutput | null } | null = null;
let opening: object | null = null;
const keyOf = (t: Track) => t.id + '|' + t.mediaRevision;

export function clearPreload(id?: string) {
  opening = null;
  if (!ahead || (id && ahead.output.id !== id)) return;
  ahead.after?.chain(null);
  ahead.output.stop();
  ahead = null;
}
export function keepPreload(track: Track | null, album: boolean) {
  if (ahead && (!track || ahead.key !== keyOf(track) || ahead.album !== album)) clearPreload();
}
export function preload(
  track: Track | null,
  route: PlaybackRequest['route'],
  current: PreparedOutput | null,
  album: boolean,
) {
  if (route === 'hifi') {
    clearPreload();
    void native.preload(track && track.id !== current?.id ? track.id : null);
    return;
  }
  keepPreload(track, album);
  const after = current instanceof PcmOutput ? current : null;
  if (ahead) {
    // the same next song, now after another stream (a seek replaced it)
    if (ahead.after !== after) {
      ahead.after?.chain(null);
      after?.chain(ahead.output);
      ahead.after = after;
    }
    return;
  }
  if (!track || track.id === current?.id) return;
  const token = (opening = {});
  void PcmOutput.open(track, 0, album).then(
    (output) => {
      if (opening !== token) return output.stop();
      opening = null;
      ahead = { key: keyOf(track), output, album, after };
      after?.chain(output);
    },
    () => {
      if (opening === token) opening = null;
    },
  );
}

export interface PreparedOutput extends Output {
  readonly id: string;
  readonly audio: AudioLike;
  readonly nativeSeq?: number;
  syncGain(): void;
}
export async function prepareOutput(
  request: PlaybackRequest,
  track: Track | null,
  album: boolean,
  at: number,
): Promise<PreparedOutput> {
  const {
    entry: { id },
    route,
    signal,
  } = request;
  const trackDuration = track?.duration || 0;
  const revision = track?.mediaRevision;
  if (route === 'hifi') {
    clearPreload();
    const info = await native.load(id, signal);
    if (signal.aborted) native.stop(info.seq);
    signal.throwIfAborted();
    const duration = info.dur || trackDuration;
    const syncGain = () =>
      native.gain(
        amplitude(album, duration > 0 ? duration - native.time() : Infinity),
        engine.muted || engine.volume <= 0 ? 0 : engine.balance,
      );
    return {
      id,
      route,
      duration,
      nativeSeq: info.seq,
      audio: { duration, load: (signal) => decodeFile(id, signal, revision) },
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
      running: () => native.joined(info.seq),
      syncGain,
    };
  }
  signal.throwIfAborted();
  if (!track) throw new Error('track unavailable');
  const candidate = ahead?.key === keyOf(track) && ahead.album === album ? ahead : null;
  if (candidate) {
    ahead = null;
    opening = null;
  } else clearPreload();
  const output = candidate?.output ?? (await PcmOutput.open(track, at, album, signal));
  if (signal.aborted) {
    output.stop();
    signal.throwIfAborted();
  }
  return output;
}
