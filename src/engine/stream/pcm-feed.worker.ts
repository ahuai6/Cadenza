// The standard output's reader: for each stream it reads the native decoder's PCM (or decodes in the browser), keeps
// at most AHEAD_SECONDS beyond what the audio thread has taken, and hands the samples straight to the processor over
// its own port. The page's main thread never carries audio. Samples stay at the song's own rate: the processor
// resamples continuously across songs. Messages are typed in protocol.ts.
import { ALL_FORMATS, AudioSampleSink, Input, UrlSource } from 'mediabunny';
import type { FeedCommand, FeedData, FeedReport, PcmSource } from './protocol';

/** seconds decoded ahead of playback: enough to ride out a slow disk, a few MB per song */
const AHEAD_SECONDS = 8;
/** the native decoder's largest block: 4096 stereo frames (decode.rs) */
const MAX_BLOCK_BYTES = 4096 * 2 * 4;
// "CPL2", rate, channels, source channels, bits (u32 each), length and first frame (u64 each)
const HEADER_BYTES = 36;

interface Stream {
  seg: number;
  abort: AbortController;
  rate: number;
  sent: number;
  consumed: number;
  wake: (() => void) | null;
  /** the first block carries the rate, first frame and length */
  opening: { first: number; length: number } | null;
}

const streams = new Map<number, Stream>();
let processor: MessagePort | null = null;

const report = (message: FeedReport) => (self as unknown as Worker).postMessage(message);
const deliver = (message: FeedData, transfer: Transferable[] = []) => processor?.postMessage(message, transfer);

self.onmessage = (event: MessageEvent<FeedCommand | { t: 'processor'; port: MessagePort }>) => {
  const c = event.data;
  if (c.t === 'processor') {
    processor = c.port;
    processor.onmessage = (e: MessageEvent<FeedData>) => {
      const d = e.data;
      const stream = streams.get(d.seg);
      if (!stream) return;
      if (d.t === 'consumed') {
        stream.consumed = d.frames;
        stream.wake?.();
      } else if (d.t === 'closed') close(d.seg);
    };
  } else if (c.t === 'open') void open(c.seg, c.source, c.at);
  else if (c.t === 'close') close(c.seg);
};

function close(seg: number) {
  const stream = streams.get(seg);
  if (!stream) return;
  streams.delete(seg);
  stream.abort.abort();
  stream.wake?.();
}

/** Wait until the audio thread has room for more of this stream. */
async function room(stream: Stream) {
  while (stream.sent - stream.consumed > AHEAD_SECONDS * stream.rate && !stream.abort.signal.aborted)
    await new Promise<void>((resolve) => (stream.wake = resolve));
  stream.wake = null;
}

async function send(stream: Stream, samples: Float32Array, eof: boolean) {
  if (stream.abort.signal.aborted) return;
  stream.sent += samples.length >> 1;
  const opening = stream.opening;
  stream.opening = null;
  deliver(
    {
      t: 'data',
      seg: stream.seg,
      samples,
      eof,
      ...(opening ? { rate: stream.rate, first: opening.first, length: opening.length } : {}),
    },
    [samples.buffer],
  );
  if (!eof) await room(stream);
}

function begin(stream: Stream, meta: Omit<Extract<FeedReport, { t: 'meta' }>, 't' | 'seg'>, firstFrame: number) {
  stream.rate = meta.srcRate;
  stream.opening = { first: firstFrame, length: Math.round(meta.length * meta.srcRate) };
  report({ t: 'meta', seg: stream.seg, ...meta });
}

async function open(seg: number, source: PcmSource, at: number) {
  const stream: Stream = {
    seg,
    abort: new AbortController(),
    rate: 0,
    sent: 0,
    consumed: 0,
    wake: null,
    opening: null,
  };
  streams.set(seg, stream);
  let delivered = false;
  try {
    if (source.native) {
      try {
        await nativeStream(stream, source.native, () => (delivered = true));
        return;
      } catch (error) {
        // a format the native core cannot read falls back to the browser, but never once audio has gone out
        if (delivered || stream.abort.signal.aborted || !source.browser) throw error;
      }
    }
    if (source.browser) await browserStream(stream, source.browser, at);
    else throw new Error('no audio source');
  } catch (error) {
    if (!stream.abort.signal.aborted) report({ t: 'error', seg, message: String((error as Error)?.message || error) });
  } finally {
    if (streams.get(seg) === stream) streams.delete(seg);
  }
}

async function nativeStream(stream: Stream, url: string, onAudio: () => void) {
  const response = await fetch(url, { signal: stream.abort.signal });
  if (!response.ok || !response.body) throw new Error('playback PCM ' + response.status);
  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
  let header = false;
  let complete = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (complete) throw new Error('audio after playback EOF');
      const bytes = pending.length ? concat(pending, value) : value;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let at = 0;
      if (!header) {
        if (bytes.length < HEADER_BYTES) {
          pending = bytes.slice();
          continue;
        }
        if (view.getUint32(0, false) !== 0x43504c32) throw new Error('invalid playback PCM header');
        const rate = view.getUint32(4, true),
          channels = view.getUint32(8, true);
        if (rate < 8000 || rate > 768000 || channels !== 2) throw new Error('unexpected playback PCM format');
        const length = Number(view.getBigUint64(20, true)),
          first = Number(view.getBigUint64(28, true));
        begin(
          stream,
          {
            length: length / rate,
            first: first / rate,
            srcRate: rate,
            srcChannels: view.getUint32(12, true),
            bits: view.getUint32(16, true),
            native: true,
          },
          first,
        );
        header = true;
        at = HEADER_BYTES;
      }
      while (at + 4 <= bytes.length) {
        const n = view.getUint32(at, true);
        if (!n) {
          complete = true;
          at += 4;
          await send(stream, new Float32Array(0), true);
          break;
        }
        if (n > MAX_BLOCK_BYTES || n % 8) throw new Error('invalid playback PCM block');
        if (at + 4 + n > bytes.length) break;
        const samples = new Float32Array(n / 4);
        new Uint8Array(samples.buffer).set(bytes.subarray(at + 4, at + 4 + n));
        at += 4 + n;
        onAudio();
        await send(stream, samples, false);
        if (stream.abort.signal.aborted) return;
      }
      pending = bytes.slice(at);
    }
  } finally {
    reader.releaseLock();
  }
  // the decoder stopped without its end marker: it failed part-way (or the request was cancelled)
  if (!complete && !stream.abort.signal.aborted) throw new Error('playback PCM ended early');
}

function concat(a: Uint8Array, b: Uint8Array) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
}

async function browserStream(stream: Stream, url: string, startSeconds: number) {
  const input = new Input({
    source: new UrlSource(url, { maxCacheSize: 4 * 1024 * 1024, getRetryDelay: () => null }),
    formats: ALL_FORMATS,
  });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track');
    const duration = await input.computeDuration();
    let rate = 0;
    // frames of the source still to drop: samples start on a packet boundary before the requested time
    let skip = 0;
    for await (const sample of new AudioSampleSink(track).samples(startSeconds)) {
      try {
        if (stream.abort.signal.aborted) return;
        if (!rate) {
          rate = sample.sampleRate;
          const first = Math.round(startSeconds * rate);
          begin(
            stream,
            {
              length: duration,
              first: first / rate,
              srcRate: rate,
              srcChannels: sample.numberOfChannels,
              bits: 0,
              native: false,
            },
            first,
          );
          skip = Math.max(0, first - Math.round(sample.timestamp * rate));
        }
        if (sample.sampleRate !== rate) throw new Error('audio format changed during playback');
        const frames = sample.numberOfFrames;
        const drop = Math.min(skip, frames);
        skip -= drop;
        if (drop === frames) continue;
        const planes = Array.from({ length: Math.min(sample.numberOfChannels, 2) }, (_, planeIndex) => {
          const plane = new Float32Array(frames);
          sample.copyTo(plane, { planeIndex, format: 'f32-planar' });
          return plane;
        });
        const left = planes[0],
          right = planes[1] ?? planes[0];
        const interleaved = new Float32Array((frames - drop) * 2);
        for (let i = drop; i < frames; i++) {
          interleaved[2 * (i - drop)] = left[i];
          interleaved[2 * (i - drop) + 1] = right[i];
        }
        await send(stream, interleaved, false);
      } finally {
        sample.close();
      }
    }
    if (stream.abort.signal.aborted) return;
    await send(stream, new Float32Array(0), true);
  } finally {
    input.dispose();
  }
}
