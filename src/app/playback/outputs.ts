import type { AudioLike } from '../../engine';
import { mediaUrl, type Track } from '../bridge';
import type { Output, PlaybackRequest } from './coordinator';
import * as native from './hifi';
import { MediaOutput } from './media-output';
import { decodeFile } from './pcm';
import { engine } from './stage';

const amplitude = (album: boolean, remaining: number) =>
  engine.muted ? 0 : engine.volume * engine.balance * (album ? 1 : Math.min(1, Math.max(0, remaining / 1.6)));

let ahead: { id: string; url: string; media: MediaOutput; album: boolean } | null = null;
export function clearPreload(id?: string) {
  if (!ahead || (id && ahead.id !== id)) return;
  ahead.media.close();
  ahead = null;
}
export function keepPreload(track: Track | null, album: boolean) {
  if (ahead && (!track || ahead.url !== mediaUrl(track.id, track.mediaRevision) || ahead.album !== album))
    clearPreload();
}
export function preload(track: Track | null, route: PlaybackRequest['route'], currentId: string, album: boolean) {
  if (route === 'hifi') {
    clearPreload();
    void native.preload(track && track.id !== currentId ? track.id : null);
    return;
  }
  keepPreload(track, album);
  if (ahead || !track || track.id === currentId) return;
  const url = mediaUrl(track.id, track.mediaRevision);
  const media = new MediaOutput(url, engine.clock, (remaining) => amplitude(album, remaining), !album);
  const job = (ahead = { id: track.id, url, media, album });
  void media.ready.catch(() => {
    if (ahead === job) clearPreload();
  });
}

export interface PreparedOutput extends Output {
  readonly audio: AudioLike;
  readonly nativeSeq?: number;
  syncGain(): void;
}
export async function prepareOutput(
  request: PlaybackRequest,
  track: Track | null,
  album: boolean,
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
      syncGain,
    };
  }
  signal.throwIfAborted();
  const url = mediaUrl(id, revision);
  const candidate = ahead?.url === url && ahead.album === album ? ahead : null;
  if (candidate) ahead = null;
  else clearPreload();
  const media =
    candidate?.media || new MediaOutput(url, engine.clock, (remaining) => amplitude(album, remaining), !album);
  const cancel = () => media.close();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await media.ready;
    signal.throwIfAborted();
  } catch (error) {
    media.close();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
  const duration = media.duration || trackDuration;
  return {
    route,
    duration,
    audio: { duration, load: (signal) => decodeFile(id, signal, revision) },
    start: (at, notify) => media.start(at, notify),
    pause: () => media.pause(),
    stop: cancel,
    time: media.time,
    syncGain: media.syncGain,
  };
}
