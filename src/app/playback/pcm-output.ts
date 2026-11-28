import { balanceDb, PcmPlayer, type AudioLike, type PcmEvent, type PcmSourceSpec, type PcmTrack } from '../../engine';
import { mediaUrl, pcmUrl, type Track } from '../bridge';
import { settings } from '../state';
import type { OutputEvent } from './coordinator';
import { decodeFile } from './pcm';
import { engine } from './stage';

/** A song that does not play to the end of an album fades out over its last seconds (as the Hi-Fi output does). */
export const END_FADE_SECONDS = 1.6;

let player: PcmPlayer | null = null;
export const pcmPlayer = () => (player ||= new PcmPlayer(engine.clock));

/** Opus and raw AAC are read by the browser's decoders; everything else by the native core, falling back to the
 *  browser for a file it cannot read. */
function sourceOf(t: Track): PcmSourceSpec {
  const browserOnly = /opus/i.test(t.codec || '') || /^(opus|aac)$/i.test(t.ext || '');
  return {
    native: browserOnly ? undefined : (at) => pcmUrl(t.id, t.mediaRevision || '', at),
    browser: mediaUrl(t.id, t.mediaRevision),
  };
}

/** The volume balance of one song, applied to its own samples so it changes exactly where the song begins. */
export function balanceOf(t: Track) {
  return settings.get().volBalance !== false ? 10 ** (balanceDb(t.loudness) / 20) : 1;
}

/** The standard output of one song: a PCM stream, replaced by a new one on a seek. The next song can be chained to it,
 *  and then begins on the sample after this one's last. */
export class PcmOutput {
  readonly route = 'std' as const;
  private next: PcmOutput | null = null;
  /** a seek under way: the position asked for, until the stream read from there takes over */
  private seeking: { at: number; token: object } | null = null;
  private closed = false;

  private constructor(
    private readonly t: Track,
    private readonly source: PcmSourceSpec,
    private track: PcmTrack,
    readonly duration: number,
    private readonly fade: number,
  ) {
    // export and the workshop read the whole song explicitly; playback never holds it
    this.audio = { duration, load: (signal) => decodeFile(t.id, signal, t.mediaRevision) };
  }
  readonly audio: AudioLike;

  static async open(t: Track, at: number, album: boolean, signal?: AbortSignal) {
    const source = sourceOf(t);
    const fade = album ? 0 : END_FADE_SECONDS;
    const track = await pcmPlayer().open(source, at, { gain: balanceOf(t), fade });
    const abort = () => track.stop();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const meta = await track.meta;
      signal?.throwIfAborted();
      return new PcmOutput(t, source, track, meta.duration || t.duration || 0, fade);
    } catch (error) {
      track.stop();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  get id() {
    return this.t.id;
  }

  start(at: number, notify: (event: OutputEvent) => void) {
    if (this.closed) return notify({ error: 'output closed' });
    this.seeking = null;
    const track = this.track;
    const usable = track.status !== 'ended' && track.status !== 'stopped' && track.status !== 'failed';
    // chained: the processor began it right after the song before; the player now takes it over as it plays
    if (usable && track.chained && track.status === 'running') {
      track.chained = false;
      track.play(notify as (event: PcmEvent) => void, false);
      this.syncGain();
      return;
    }
    if (usable && Math.abs(at - track.time()) < 0.005) {
      track.play(notify as (event: PcmEvent) => void, at > 0);
      this.syncGain();
      return;
    }
    void this.seek(at, notify);
  }

  private async seek(at: number, notify: (event: OutputEvent) => void) {
    const token = {};
    this.seeking = { at, token };
    this.track.stop();
    let track: PcmTrack;
    try {
      track = await pcmPlayer().open(this.source, at, { gain: balanceOf(this.t), fade: this.fade });
      await track.meta;
    } catch (error) {
      if (this.seeking?.token === token) notify({ error: String((error as Error)?.message || error) });
      return;
    }
    if (this.seeking?.token !== token || this.closed) {
      track.stop();
      return;
    }
    // the new stream now tells the time itself: it stands at `at` until it starts, then follows what is heard
    this.track = track;
    this.seeking = null;
    track.chain(this.next?.track ?? null);
    track.play(notify as (event: PcmEvent) => void, at > 0);
    this.syncGain();
  }

  pause() {
    this.seeking = null;
    this.track.pause();
  }

  running = () => this.track.chained && this.track.status === 'running';

  stop() {
    this.closed = true;
    this.seeking = null;
    this.track.stop();
  }

  time = () => (this.seeking ? this.seeking.at : this.track.time());

  /** The page's volume on the shared gain; the song's own balance on its samples. */
  syncGain = () => {
    engine.clock.gain(engine.muted ? 0 : engine.volume);
    this.track.setGain(balanceOf(this.t));
  };

  /** Play `next` right after this song's last sample (null: stop at the end as before). */
  chain(next: PcmOutput | null) {
    this.next = next;
    this.track.chain(next?.track ?? null);
  }
}
