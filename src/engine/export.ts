/* MP4 export: the session rendered frame by frame at the chosen size on its own canvas (nothing shared is touched: the
   preview can stay as it is), encoded with WebCodecs (H.265 where available, else H.264), the soundtrack rendered
   offline with the same fade, both muxed into an MP4 written through a positional sink (in memory in a browser,
   straight to the file on the desktop, so exports of several GB never sit in memory). A video backdrop or MV is
   decoded front to back with WebCodecs instead of seeking an element for every frame. */
import { drawFrame } from '../render/renderer';
import { ssDown, ssFactor } from './ssaa';
import { Engine } from './engine';
import type { Session } from './session';
import type { VideoSource } from './media';
import { withGfx } from '../render/gfx';
import { exportPcm } from './export-pcm';

export interface Sink {
  write(data: Uint8Array, pos: number): void | Promise<void>;
  close(): unknown;
  abort?(): unknown;
}
export interface ExportOptions {
  res?: number;
  fps?: number;
  quality?: string;
  codec?: 'auto' | 'avc' | 'hevc';
  captions?: boolean;
  audio?: boolean;
  sink?: Sink;
  onProgress?: (phase: string, i: number, n: number) => void;
  signal?: AbortSignal;
}
export interface ExportResult {
  ok: boolean;
  reason?: string;
  e?: string;
  w?: number;
  h?: number;
  codec?: string;
  mbps?: number;
  audio?: string;
  size?: number;
  sec?: number;
  result?: unknown;
  name?: string;
}

import { exportSize } from './size';
export { exportSize };
// bits per pixel per frame, per quality (60 fps frames are more alike: less per frame)
const XQ: Record<string, { b30: number; b60: number }> = {
  q1: { b30: 3, b60: 2 },
  q2: { b30: 4.5, b60: 3 },
  q3: { b30: 6, b60: 4 },
  q4: { b30: 8, b60: 5.4 },
  q5: { b30: 12, b60: 8 },
};
export function estimate(s: Session, o: { res?: number; fps?: number; quality?: string }, viewAspect: number) {
  const [w, h] = exportSize(s.style.aspect, o.res || 1080, viewAspect),
    fps = +(o.fps || 30),
    q = XQ[o.quality || 'q1'] || XQ.q1,
    mbps = (w * h * fps * (fps > 40 ? q.b60 : q.b30)) / 1e6;
  return { w, h, fps, mbps, mb: Math.round((mbps * s.dur) / 8), dur: s.dur, audio: !!s.audio };
}
export function blobSink(): Sink & { close(): { blob: Blob; size: number } } {
  const parts: { pos: number; data: Uint8Array }[] = [];
  return {
    write(data, pos) {
      const end = pos + data.byteLength;
      for (const p of parts)
        if (pos >= p.pos && end <= p.pos + p.data.byteLength) {
          p.data.set(data, pos - p.pos);
          return;
        }
      parts.push({ pos, data: new Uint8Array(data) });
    },
    close() {
      parts.sort((a, b) => a.pos - b.pos);
      const blob = new Blob(
        parts.map((p) => p.data as BlobPart),
        { type: 'video/mp4' },
      );
      return { blob, size: blob.size };
    },
  };
}
async function pickCodec(w: number, h: number, fps: number, quality: string, want: string) {
  const q = XQ[quality] || XQ.q1,
    bpp = fps > 40 ? q.b60 : q.b30;
  const HEVC = [
    'hvc1.1.6.H186.B0',
    'hvc1.1.6.H183.B0',
    'hvc1.1.6.H180.B0',
    'hvc1.1.6.H156.B0',
    'hvc1.1.6.H153.B0',
    'hvc1.1.6.L153.B0',
    'hev1.1.6.L153.B0',
  ];
  const AVC = ['avc1.64003E', 'avc1.64003D', 'avc1.64003C', 'avc1.640034', 'avc1.640033', 'avc1.4d0033', 'avc1.42e033'];
  const fams: [string, string[]][] =
    want === 'avc'
      ? [['avc', AVC]]
      : [
          ['hevc', HEVC],
          ['avc', AVC],
        ];
  for (const [mux, list] of fams)
    for (const scale of [1, 0.8, 0.64, 0.5, 0.4, 0.3, 0.2, 0.12, 0.07]) {
      const bitrate = Math.round(w * h * fps * bpp * scale);
      for (const codec of list) {
        const cfg: VideoEncoderConfig = {
          codec,
          width: w,
          height: h,
          bitrate,
          bitrateMode: 'variable',
          framerate: fps,
          latencyMode: 'quality',
        };
        try {
          const r = await VideoEncoder.isConfigSupported(cfg);
          if (r.supported) return { ...(r.config || cfg), mux } as VideoEncoderConfig & { mux: string };
        } catch {
          /* next */
        }
      }
    }
  return null;
}
async function pickAudio() {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [
    ['mp4a.40.2', 'aac'],
    ['opus', 'opus'],
  ]) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    try {
      const r = await AudioEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg: r.config || cfg, mux };
    } catch {
      /* next */
    }
  }
  return null;
}
const ych = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yres: (() => void)[] = [];
if (ych)
  ych.port1.onmessage = () => {
    yres.shift()?.();
  };
const yieldUI = () =>
  (globalThis as any).scheduler?.yield
    ? (globalThis as any).scheduler.yield()
    : new Promise<void>((r) => {
        yres.push(r);
        ych!.port2.postMessage(0);
      });
const slug = (s: string) =>
  (s || 'cadenza')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cadenza';

/** An export draws each frame in full quality whatever the live picture's mode (render/gfx.ts: withGfx), so the live
 *  picture keeps its mode meanwhile and a change of the setting during an export holds. */
export async function exportVideo(owner: Engine, source: Session, o: ExportOptions = {}): Promise<ExportResult> {
  const aspect = owner.viewAspect();
  const media = (v: VideoSource) =>
    v.ready && v.el
      ? {
          url: v.url,
          file: v.file,
          start: v.start,
          loop: v.loop,
          offset: v.offset,
          source: v,
          element: v.el,
        }
      : null;
  const videoInput = source.style.bgStyle === 'video' ? media(owner.video) : null;
  const mvInput = owner.mv.on ? media(owner.mv) : null;
  const mvLook = { ...owner.mvLook };
  const labels = { ...owner.labels };
  try {
    o.signal?.throwIfAborted();
    const s = await source.exportSnapshot(aspect, o.signal);
    return await renderVideo(s, aspect, videoInput, mvInput, mvLook, labels, o);
  } catch (error) {
    await Promise.resolve()
      .then(() => o.sink?.abort?.())
      .catch(() => {});
    if (o.signal?.aborted) return { ok: false, reason: 'x.cancelled' };
    return { ok: false, reason: 'x.fail', e: String((error as Error)?.message || error) };
  }
}

type Clip = {
  url: string;
  file: Blob | null;
  start: string;
  loop: boolean;
  offset: number;
  source: VideoSource;
  element: HTMLVideoElement;
};
async function renderVideo(
  s: Session,
  aspect: number,
  videoInput: Clip | null,
  mvInput: Clip | null,
  mvLook: Engine['mvLook'],
  labels: Engine['labels'],
  o: ExportOptions,
): Promise<ExportResult> {
  const [w, h] = exportSize(s.style.aspect, o.res || 1080, aspect),
    fps = +(o.fps || 30),
    sink = o.sink || blobSink(),
    prog = o.onProgress || (() => {}),
    sig = o.signal;
  if (typeof VideoEncoder === 'undefined') return { ok: false, reason: 'x.noenc' };
  const { Output, Mp4OutputFormat, StreamTarget, EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacket } =
    await import('mediabunny');
  const cfg = await pickCodec(w, h, fps, o.quality || 'q1', o.codec || 'auto');
  if (!cfg) return { ok: false, reason: 'x.nosize' };
  // the plan is made for the export's own aspect if the preview fills a different one
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const c = cnv.getContext('2d')!;
  const N = ssFactor(s.style.aa, w, h),
    big = N > 1 ? document.createElement('canvas') : null;
  if (big) {
    big.width = w * N;
    big.height = h * N;
  }
  let audio = s.audio;
  if (audio && audio.load && o.audio !== false) {
    audio = await audio.load(sig);
  }
  if (sig?.aborted) return { ok: false, reason: 'x.cancelled' };
  const ac = audio && (audio as AudioBuffer).getChannelData && o.audio !== false ? await pickAudio() : null;
  // the muxer (Mediabunny) writes through a stream to the sink; each packet it is handed is queued in order, and the
  // encoders wait while too many are still being written, so a slow disk holds the export back instead of memory
  let queued = 0,
    chain: Promise<unknown> = Promise.resolve(),
    sinkErr: unknown = null;
  const target = new StreamTarget(
    new WritableStream({ write: (c) => sink.write(new Uint8Array(c.data), c.position) }),
    { chunked: true, chunkSize: 2 ** 24 },
  );
  const out = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const vsrc = new EncodedVideoPacketSource(cfg.mux as 'avc' | 'hevc');
  out.addVideoTrack(vsrc, { frameRate: fps });
  const asrc = ac ? new EncodedAudioPacketSource(ac.mux as 'aac' | 'opus') : null;
  if (asrc) out.addAudioTrack(asrc);
  const put = (add: () => Promise<void>) => {
    if (sig?.aborted || sinkErr) return;
    queued++;
    chain = chain.then(add).then(
      () => {
        queued--;
      },
      (e) => {
        sinkErr ??= e;
        queued--;
      },
    );
  };
  let encErr: unknown = null;
  const total = Math.max(1, Math.ceil(s.dur * fps)),
    endUs = Math.round(s.dur * 1_000_000),
    t0 = performance.now();
  await out.start();
  const enc = new VideoEncoder({
    output: (ch, meta) => put(() => vsrc.add(EncodedPacket.fromEncodedChunk(ch), meta)),
    error: (e) => {
      encErr = e;
    },
  });
  const vids: [VideoSource, FrameSource | null][] = [];
  const urls: string[] = [];
  const engine = new Engine(cnv, { audioContext: () => new AudioContext(), manual: true });
  engine.session = s;
  engine.mvLook = mvLook;
  engine.labels = labels;
  let audioEncoder: AudioEncoder | null = null;
  try {
    if (ac) {
      prog('audio', 0, 0);
      const sr = 48000,
        n = Math.ceil(s.dur * sr),
        step = 4800,
        pcm = await exportPcm(audio as AudioBuffer, sr, n, s.audioStart, s.musicEnd, s.spec.fade !== false);
      const aenc = (audioEncoder = new AudioEncoder({
        output: (ch, meta) => put(() => asrc!.add(EncodedPacket.fromEncodedChunk(ch), meta)),
        error: (e) => {
          encErr = e;
        },
      }));
      aenc.configure(ac.cfg as AudioEncoderConfig);
      for (let i = 0; i < n; i += step) {
        if (sig?.aborted || encErr || sinkErr) break;
        const k = Math.min(step, n - i),
          data = pcm(i, k);
        const ad = new AudioData({
          format: 'f32-planar',
          sampleRate: 48000,
          numberOfFrames: k,
          numberOfChannels: 2,
          timestamp: Math.round((i / 48000) * 1e6),
          data,
        });
        try {
          aenc.encode(ad);
        } finally {
          ad.close();
        }
        while (aenc.encodeQueueSize > 12 || queued > 24) {
          if (sig?.aborted || encErr || sinkErr) break;
          await new Promise((r) => setTimeout(r, 5));
        }
      }
      if (!sig?.aborted && !encErr && !sinkErr) await aenc.flush();
      aenc.close();
      audioEncoder = null;
    }
    enc.configure(cfg);
    for (const [v, input] of [
      [engine.video, videoInput],
      [engine.mv, mvInput],
    ] as const)
      if (input && !sig?.aborted) {
        prog('video', 0, 0);
        const unchanged = () => input.file || (input.source.el === input.element && input.source.url === input.url);
        if (!unchanged()) throw new Error('export video source changed');
        const url = input.file ? URL.createObjectURL(input.file) : input.url;
        if (input.file) urls.push(url);
        if (!(await v.open(url, input.file)) || !unchanged()) throw new Error('export video source unavailable');
        Object.assign(v, { start: input.start, loop: input.loop, offset: input.offset });
        if (v === engine.mv) engine.mv.setOn(true);
        let fs: FrameSource | null = null;
        try {
          if (input.file && input.file.size <= 64 * 1048576) fs = await openFrameSource(input.file);
        } catch {
          fs = null;
        }
        vids.push([v, fs]);
      }
    const mvK = engine.mv.k;
    if (engine.mv.on) engine.mv.k = 1;
    prog('render', 0, total);
    for (let i = 0; i < total; i++) {
      if (sig?.aborted || encErr || sinkErr) break;
      const t = i / fps;
      for (const [v, fs] of vids) {
        const x = v.timeAt(t, s.audioStart);
        if (fs) {
          try {
            v.exportFrame = await fs.frameAt(x);
          } catch {
            v.exportFrame = null;
          }
        }
        if (!fs || !v.exportFrame) {
          v.exportFrame = null;
          await v.seek(x);
        }
      }
      const f = engine.frameAt(t, { offline: true, px: (h * N) / s.plan.H })!;
      f.media = {
        ...f.media,
        video: s.style.bgStyle === 'video' ? engine.video.drawable() : null,
        mv:
          engine.mv.on && engine.mv.endK(t, s.audioStart) > 0
            ? { ...(engine.mv.drawable() || { frame: null, w: 16, h: 9 }), k: engine.mv.endK(t, s.audioStart) }
            : null,
      };
      const tg = big ? big.getContext('2d')! : c;
      tg.setTransform(1, 0, 0, 1, 0, 0);
      withGfx('default', () =>
        drawFrame(tg, f, { sig: s.sig, captions: o.captions !== false, captionBottom: s.plan.H * 0.915 }),
      );
      if (big) ssDown(big, cnv, N);
      const timestamp = Math.round((i * 1e6) / fps);
      const next = Math.min(endUs, Math.round(((i + 1) * 1e6) / fps));
      const vf = new VideoFrame(cnv, { timestamp, duration: Math.max(1, next - timestamp) });
      try {
        enc.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      } finally {
        vf.close();
      }
      while (!sig?.aborted && !encErr && !sinkErr && enc.encodeQueueSize > 6)
        await new Promise((r) => setTimeout(r, 2));
      while (!sig?.aborted && !encErr && !sinkErr && queued > 24) await new Promise((r) => setTimeout(r, 5));
      if (i % 3 === 0) prog('render', i + 1, total);
      await yieldUI();
    }
    engine.mv.k = mvK;
    for (const [v, fs] of vids) {
      v.exportFrame = null;
      fs?.close();
    }
    if (!sig?.aborted && !encErr && !sinkErr) {
      await enc.flush();
      await chain;
      if (sinkErr) throw sinkErr;
      if (sig?.aborted) {
        await out.cancel();
        await sink.abort?.();
        return { ok: false, reason: 'x.cancelled' };
      }
      await out.finalize();
      if (sig?.aborted) {
        await sink.abort?.();
        return { ok: false, reason: 'x.cancelled' };
      }
      const result = (await sink.close()) as any;
      prog('done', total, total);
      return {
        ok: true,
        w,
        h,
        codec: cfg.mux === 'hevc' ? 'H.265' : 'H.264',
        mbps: Math.round((cfg.bitrate || 0) / 1e6),
        audio: ac ? (ac.mux === 'aac' ? 'x.aac' : 'x.opus') : 'x.silent',
        size: result?.size || 0,
        sec: (performance.now() - t0) / 1000,
        result,
        name: `${slug(s.spec.song.title)}-${w}x${h}.mp4`,
      };
    }
    try {
      if (enc.state === 'configured') enc.reset();
      await chain;
      await out.cancel();
      await sink.abort?.();
    } catch {
      /* ignore */
    }
    return encErr
      ? { ok: false, reason: 'x.encfail', e: String((encErr as Error).message || encErr) }
      : sinkErr
        ? { ok: false, reason: 'x.fail', e: String((sinkErr as Error).message || sinkErr) }
        : { ok: false, reason: 'x.cancelled' };
  } catch (e) {
    try {
      await out.cancel();
    } catch {
      /* ignore */
    }
    try {
      await sink.abort?.();
    } catch {
      /* ignore */
    }
    return { ok: false, reason: 'x.fail', e: String((e as Error).message || e) };
  } finally {
    for (const [v, fs] of vids) {
      v.exportFrame = null;
      fs?.close();
    }
    try {
      enc.close();
    } catch {
      /* ignore */
    }
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    engine.destroy();
    for (const url of urls) URL.revokeObjectURL(url);
    cnv.width = cnv.height = 1;
    if (big) big.width = big.height = 1;
  }
}

/* ---- a clip decoded front to back with WebCodecs: for each time, the newest frame at or before it ---- */
interface FrameSource {
  frameAt(x: number): Promise<{ cv: HTMLCanvasElement; displayWidth: number; displayHeight: number }>;
  close(): void;
}
export async function openFrameSource(file: Blob): Promise<FrameSource | null> {
  if (typeof VideoDecoder === 'undefined') return null;
  const { createFile, DataStream, Endianness, MP4BoxBuffer } = await import('mp4box'),
    buf = await file.arrayBuffer();
  const got: any = await new Promise((res) => {
    const mp: any = createFile();
    let track: any = null;
    const samples: any[] = [];
    mp.onError = () => res(null);
    mp.onReady = (info: any) => {
      track = info.videoTracks[0];
      if (!track) {
        res(null);
        return;
      }
      mp.setExtractionOptions(track.id, undefined, { nbSamples: 1e9 });
      mp.start();
    };
    mp.onSamples = (_id: number, _u: unknown, sm: any[]) => {
      for (const x of sm) samples.push(x);
      if (track && samples.length >= track.nb_samples) res({ mp, track, samples });
    };
    mp.appendBuffer(MP4BoxBuffer.fromArrayBuffer(buf, 0));
    mp.flush();
    setTimeout(() => res(track && samples.length ? { mp, track, samples } : null), 8000);
  });
  if (!got) return null;
  const { mp, track, samples } = got,
    m = track.matrix || [65536, 0, 0, 0, 65536, 0];
  if (m[0] !== 65536 || m[1] !== 0 || m[3] !== 0 || m[4] !== 65536) return null; // rotated: the element path handles it
  const trak = mp.getTrackById(track.id);
  let desc: Uint8Array | undefined,
    nal: { len: number; hevc: boolean } | null = null;
  for (const en of trak.mdia.minf.stbl.stsd.entries) {
    const bx = en.avcC || en.hvcC || en.vpcC || en.av1C;
    if (bx) {
      const ds = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      bx.write(ds);
      desc = new Uint8Array(ds.buffer, 8);
      if (en.avcC) nal = { len: (en.avcC.lengthSizeMinusOne & 3) + 1, hevc: false };
      else if (en.hvcC) nal = { len: (en.hvcC.lengthSizeMinusOne & 3) + 1, hevc: true };
    }
  }
  const irap = (d: Uint8Array) => {
    if (!nal) return null;
    let o2 = 0,
      seen = false;
    while (o2 + nal.len <= d.length) {
      let n = 0;
      for (let k = 0; k < nal.len; k++) n = n * 256 + d[o2 + k];
      o2 += nal.len;
      if (n <= 0 || o2 + n > d.length) break;
      const ty = nal.hevc ? (d[o2] >> 1) & 63 : d[o2] & 31;
      seen = true;
      if (nal.hevc ? ty >= 16 && ty <= 21 : ty === 5) return true;
      o2 += n;
    }
    return seen ? false : null;
  };
  const cfg: VideoDecoderConfig = {
    codec: track.codec,
    codedWidth: track.video.width,
    codedHeight: track.video.height,
    ...(desc ? { description: desc } : {}),
  };
  try {
    if (!(await VideoDecoder.isConfigSupported(cfg)).supported) return null;
  } catch {
    return null;
  }
  let mediaStart = 0,
    lead = 0;
  const el = trak.edts && trak.edts.elst && trak.edts.elst.entries;
  if (el && el.length)
    for (const en of el) {
      if (en.media_time < 0) lead += en.segment_duration / mp.moov.mvhd.timescale;
      else {
        mediaStart = en.media_time / track.timescale;
        break;
      }
    }
  const chunks = samples.map((x: any) => ({
    key: x.is_sync && irap(x.data) !== false,
    ts: Math.round((x.cts / x.timescale - mediaStart + lead) * 1e6),
    dur: Math.round((x.duration / x.timescale) * 1e6),
    data: x.data,
  }));
  if (!chunks.length || !chunks[0].key) return null;
  let dec: VideoDecoder | null = null,
    frames: { timestamp: number; cv: HTMLCanvasElement; displayWidth: number; displayHeight: number }[] = [],
    next = 0,
    err: unknown = null,
    wake: (() => void) | null = null,
    flushed = false;
  const pool: HTMLCanvasElement[] = [],
    vw = track.video.width,
    vh = track.video.height;
  const take = () => {
    const cv = pool.pop() || document.createElement('canvas');
    if (cv.width !== vw || cv.height !== vh) {
      cv.width = vw;
      cv.height = vh;
    }
    return cv;
  };
  const out = (fr: VideoFrame) => {
    try {
      const cv = take();
      cv.getContext('2d')!.drawImage(fr, 0, 0, vw, vh);
      frames.push({
        timestamp: fr.timestamp,
        cv,
        displayWidth: fr.displayWidth || vw,
        displayHeight: fr.displayHeight || vh,
      });
      frames.sort((a, b) => a.timestamp - b.timestamp);
    } finally {
      fr.close();
    }
    if (wake) {
      wake();
      wake = null;
    }
  };
  const reset = (i: number) => {
    if (dec) {
      try {
        dec.close();
      } catch {
        /* ignore */
      }
    }
    for (const f of frames) pool.push(f.cv);
    frames = [];
    flushed = false;
    dec = new VideoDecoder({
      output: out,
      error: (e) => {
        err = e;
        if (wake) {
          wake();
          wake = null;
        }
      },
    });
    dec.configure(cfg);
    next = i;
  };
  const feed = (n: number) => {
    while (n-- > 0 && next < chunks.length && dec!.decodeQueueSize < 12 && frames.length < 6) {
      const k = chunks[next++];
      dec!.decode(
        new EncodedVideoChunk({ type: k.key ? 'key' : 'delta', timestamp: k.ts, duration: k.dur, data: k.data }),
      );
    }
  };
  const keyBefore = (us: number) => {
    let k = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].key && chunks[i].ts <= us) k = i;
      if (chunks[i].ts > us + 2e6) break;
    }
    return k;
  };
  return {
    async frameAt(x) {
      const us = Math.round(x * 1e6),
        t0 = performance.now();
      if (
        !dec ||
        (frames.length && us < frames[0].timestamp - 1000) ||
        (next < chunks.length && chunks[next].ts > us + 4e6)
      )
        reset(keyBefore(us));
      if (!frames.length && next > 0 && chunks[next - 1].ts < us - 4e6) reset(keyBefore(us));
      for (let guard = 0; guard < 4000; guard++) {
        if (err) throw err;
        if (performance.now() - t0 > 4000) throw new Error('decoder stalled');
        while (frames.length >= 2 && frames[1].timestamp <= us) pool.push(frames.shift()!.cv);
        if (frames.length >= 2) break;
        if (frames.length === 1 && frames[0].timestamp > us) break;
        if (next < chunks.length) feed(6);
        else if (!flushed) {
          flushed = true;
          await dec!.flush();
          continue;
        } else break;
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 30);
        });
      }
      if (next < chunks.length) feed(6);
      if (!frames.length) throw new Error('no frame');
      return frames[0];
    },
    close() {
      frames = [];
      pool.length = 0;
      try {
        dec?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
