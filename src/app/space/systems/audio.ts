// The space's sound: the song heard in the rooms, and the rooms' own music between songs.
//
// One signal, many places it comes from. Every source (a speaker — later a radio, a group of speakers round a seat) is
// fed the same song; each is placed by the path the sound walks to the listener: through the doorways, darker and
// further with every door, as in games' portal propagation. The room the listener stands in rings (its own reverb).
// With headphones on, the song leaves Cadenza exactly as it always does and nothing here touches it.
//
// The module knows nothing of the building: it is given the sources, each room's reverb time, and a function that says
// which way sound walks between two points. A new scene brings its own.
import * as THREE from 'three';

/** Something the song sounds from. */
export interface SoundSource {
  /** the room it stands in */ room: string;
  /** where (world, metres) */ pos: THREE.Vector3;
  /** whether it sounds now (set here every tick: a speaker's lamp shows it) */ lit?: boolean;
  /** which part of the song it plays (a sound field's speaker): the left or right channel, the centre (their middle),
   *  a surround (their difference, a little late), or the lowest notes. None: the whole song */
  feed?: Feed;
  /** one of a sound field: while the listener is in its room it always sounds, with all the others of its field */
  field?: boolean;
  /** its loudness against an ordinary speaker (a field's six share the work) */
  level?: number;
}
export type Feed = 'L' | 'R' | 'C' | 'SL' | 'SR' | 'LFE';
/** The listener: where the head is, how it is turned, and in which room. */
export interface Listener {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  room: string;
}
export interface RoomAudioOptions {
  /** Cadenza's audio: the page's one context, where the song is sent, and whether the Hi-Fi output plays it (outside
   *  the page: then it can only be heard as it is, never in the room) */
  audio(): { ctx: AudioContext; route(node: AudioNode | null): void; hifi: boolean };
  /** every source the song can come from */
  sources: SoundSource[];
  /** the source the rooms' own music comes from (between songs) */
  ambientFrom: SoundSource;
  /** the rooms' own music (a loop), fetched and trimmed to loop without a seam */
  ambientUrl: string;
  /** each room's reverb time, seconds (RT60) */
  reverb: Record<string, number>;
  /** the way sound walks from the listener to a source: the points it passes (the two ends included; every point
   *  between is a doorway) */
  path(from: THREE.Vector3, fromRoom: string, to: THREE.Vector3, toRoom: string): THREE.Vector3[];
  /** how many sources sound at once (the strongest ones): 2 keeps a walk between rooms clean; a sound field round a
   *  seat asks for all of its speakers */
  voices?: number;
  /** the headphones were put on or taken off (by a call here, or because the Hi-Fi output took over) */
  onPhones?(on: boolean): void;
}

/** a source's chain: in → wall/air filter → gain → placed (HRTF) → dry; and a send to the reverb, by distance */
interface Chain {
  src: SoundSource;
  input: GainNode;
  lp: BiquadFilterNode;
  g: GainNode;
  pan: PannerNode;
  send: GainNode;
  gainNow: number;
}

const TICK = 0.1; // seconds between updates: every value glides to its target on its own time constant
const AMBIENT_BACK = 4000; // ms after a song stops before the rooms' own music returns
const ROOM_GAIN = 1.15; // the song in the room against the song in headphones

export class RoomAudio {
  /** headphones on: the song is heard as Cadenza plays it, not in the room */
  phones = true;
  private ctx: AudioContext | null = null;
  private ready = false;
  private master!: GainNode;
  private analyser!: AnalyserNode;
  private bins!: Uint8Array<ArrayBuffer>;
  private dry!: GainNode;
  private verbIn!: GainNode;
  private verbs: Record<string, { cv: ConvolverNode; g: GainNode }> = {};
  private direct!: GainNode;
  private directLP!: BiquadFilterNode;
  private scene!: GainNode;
  private songIn!: GainNode;
  private chains: Chain[] = [];
  private feeds: Partial<Record<Feed, AudioNode>> = {};
  private pool!: Chain;
  private amb!: GainNode;
  private ambBuf: AudioBuffer | null = null;
  private ambSrc: AudioBufferSourceNode | null = null;
  private ambOn = false;
  private ambAt = 0;
  private ambVol = 0.6;
  private ambWanted = true;
  private songSeen = false;
  private routed = false;
  private unrouteAt = 0;
  private acc = 0;
  private avg = 0;
  private lastHit = 0;
  private gone = false;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(private o: RoomAudioOptions) {}

  /** Whether the graph is built (after the first gesture: browsers start audio only then). */
  get started() {
    return this.ready;
  }

  /** Build the graph (once; call it on a gesture). Calling again only wakes the context. */
  async start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    const ctx = this.o.audio().ctx;
    this.ctx = ctx;
    ctx.resume?.();
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    this.verbIn = ctx.createGain();
    for (const room of Object.keys(this.o.reverb)) {
      const cv = ctx.createConvolver(),
        g = ctx.createGain();
      g.gain.value = 0;
      this.verbIn.connect(cv);
      cv.connect(g);
      g.connect(this.master);
      this.verbs[room] = { cv, g };
    }
    // the headphone path: straight to the output, with a filter that closes as they are taken off
    this.direct = ctx.createGain();
    this.directLP = ctx.createBiquadFilter();
    this.directLP.type = 'lowpass';
    this.directLP.frequency.value = 20000;
    this.direct.gain.value = 0;
    this.direct.connect(this.directLP);
    this.directLP.connect(this.master);
    // the song as heard in the room: into every source's chain
    this.scene = ctx.createGain();
    this.scene.gain.value = 0;
    this.chains = this.o.sources.map((s) => this.chain(ctx, s));
    this.chains.forEach((c) => (c.src.feed ? this.feed(ctx, c.src.feed) : this.scene).connect(c.input));
    // the rooms' own music has a chain of its own, at its source
    this.pool = this.chain(ctx, this.o.ambientFrom);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    this.amb.connect(this.pool.input);
    // the song comes in here when the room plays it (after Cadenza's own gain: volume, balance, fades)
    this.songIn = ctx.createGain();
    this.songIn.connect(this.direct);
    this.songIn.connect(this.scene);
    this.ready = true;
    this.routeSong();
    try {
      const data = await (await fetch(this.o.ambientUrl)).arrayBuffer();
      this.ambBuf = seamless(await ctx.decodeAudioData(data), ctx);
      // the rooms' responses, one at a time while the page is idle: the picture never waits on them
      const rooms = Object.keys(this.o.reverb);
      const later = (f: () => void) =>
        window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 600 }) : setTimeout(f, 200);
      const next = () => {
        const room = rooms.shift();
        if (!room || this.gone) return;
        this.verbs[room].cv.buffer = impulse(ctx, this.o.reverb[room]);
        later(next);
      };
      next();
    } catch {
      // (no ambient music, no reverb: the song still plays)
    }
  }

  /** Headphones on or off. Off, the clean sound is muffled away while the room fades in. With the Hi-Fi output they
   *  stay on (its sound never enters the page). */
  setPhones(on: boolean) {
    if (!on && this.o.audio().hifi) on = true;
    this.phones = on;
    this.o.onPhones?.(on);
    if (!this.ready || !this.ctx) return;
    const t = this.ctx.currentTime,
      f = this.directLP.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(on ? 20000 : 700, t + 0.6);
    this.routeSong();
  }

  /** The rooms' own music: whether it is wanted at all, and how loud. */
  setAmbient(on: boolean, volume: number) {
    this.ambWanted = on;
    this.ambVol = volume;
    if (this.ready && this.ambOn) this.ramp(this.amb.gain, volume, 0.4);
  }

  /** Every frame. The rooms' own music exists only between songs: the moment a song is asked for (`busy`: playing, or
   *  still being read) it fades and its source is stopped — nothing of it runs under a song — and it comes back, from a
   *  new source, a few seconds after the song stops. */
  ambientTick(now: number, busy: boolean) {
    if (!this.ready || !this.ambBuf || !this.ctx) return;
    if (busy) this.songSeen = true;
    if (busy || !this.ambWanted) {
      this.ambAt = 0;
      if (!this.ambOn) return;
      this.ambOn = false;
      this.ramp(this.amb.gain, 0, 0.45);
      const src = this.ambSrc;
      this.ambSrc = null;
      if (src) setTimeout(() => stopSource(src), 600);
      return;
    }
    if (this.ambOn) return;
    if (!this.ambAt) this.ambAt = now + (this.songSeen ? AMBIENT_BACK : 0);
    if (now < this.ambAt) return;
    this.ambOn = true;
    const src = this.ctx.createBufferSource();
    src.buffer = this.ambBuf;
    src.loop = true;
    src.connect(this.amb);
    src.start();
    this.ambSrc = src;
    this.ramp(this.amb.gain, this.ambVol, 3.5);
  }

  /** Every frame (it acts ten times a second): the listener placed, every source placed by the path its sound walks,
   *  the strongest few sounding, the listener's room ringing. */
  tick(dt: number, who: Listener, playing: boolean) {
    if (!this.ready || !this.ctx) return;
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    if (!this.phones && this.o.audio().hifi) this.setPhones(true);
    const ctx = this.ctx,
      t = ctx.currentTime,
      L = who.pos,
      lsn = ctx.listener;
    this.fwd.set(0, 0, -1).applyQuaternion(who.quat);
    this.up.set(0, 1, 0).applyQuaternion(who.quat);
    if (lsn.positionX) {
      const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.03);
      set(lsn.positionX, L.x);
      set(lsn.positionY, L.y);
      set(lsn.positionZ, L.z);
      set(lsn.forwardX, this.fwd.x);
      set(lsn.forwardY, this.fwd.y);
      set(lsn.forwardZ, this.fwd.z);
      set(lsn.upX, this.up.x);
      set(lsn.upY, this.up.y);
      set(lsn.upZ, this.up.z);
    } else {
      lsn.setPosition(L.x, L.y, L.z);
      lsn.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }
    // the song: of all the sources, only the strongest few sound — and in a room with a sound field, all of the field
    const gains = this.chains.map((c) => this.place(c, who, t) * (c.src.level ?? 1)),
      voices = this.o.voices ?? 2,
      inField = (i: number) => !!this.chains[i].src.field && this.chains[i].src.room === who.room,
      field = gains.map((_, i) => i).filter(inField),
      keep = [
        ...field,
        ...gains
          .map((v, i) => [v, i] as const)
          .filter(([, i]) => !inField(i))
          .sort((a, b) => b[0] - a[0])
          .slice(0, field.length ? 1 : voices)
          .map((x) => x[1]),
      ];
    this.chains.forEach((c, i) => {
      const v = keep.includes(i) ? gains[i] : 0;
      c.g.gain.setTargetAtTime(v, t, 0.35);
      c.src.lit = v > 0.02 && !this.phones && playing;
    });
    this.place(this.pool, who, t);
    this.pool.g.gain.setTargetAtTime(this.pool.gainNow, t, 0.35);
    for (const room of Object.keys(this.verbs))
      this.verbs[room].g.gain.setTargetAtTime(room === who.room ? 0.55 : 0, t, 0.6);
  }

  /** A low-end hit in what is sounding now (the rooms' own music has no rhythm analysis: the motes answer this). */
  hearAccent(now: number): boolean {
    if (!this.ready) return false;
    this.analyser.getByteFrequencyData(this.bins);
    let e = 0;
    for (let i = 1; i < 6; i++) e += this.bins[i];
    e /= 5;
    const hit = e > this.avg * 1.25 + 8 && e > 70 && now - this.lastHit > 450;
    this.avg = this.avg * 0.96 + e * 0.04;
    if (hit) this.lastHit = now;
    return hit;
  }

  /** Everything let go: the song back on its own path, the sources stopped, the graph disconnected. */
  dispose() {
    this.gone = true;
    clearTimeout(this.unrouteAt);
    try {
      if (this.routed) this.o.audio().route(null);
      if (this.ambSrc) stopSource(this.ambSrc);
      this.master?.disconnect();
      this.songIn?.disconnect();
    } catch {
      // (a context already closed)
    }
  }

  /** One source placed: where its sound comes from (the first point on its way: itself, or the doorway it comes
   *  through), how loud by the walked distance and the doors, how dark, how much of it rings. */
  private place(c: Chain, who: Listener, t: number): number {
    const path = this.o.path(who.pos, who.room, c.src.pos, c.src.room);
    let dist = 0;
    for (let i = 1; i < path.length; i++) dist += path[i].distanceTo(path[i - 1]);
    const doors = Math.max(0, path.length - 2) / 2, // (each doorway on the way is two points: its two sides)
      from = path[1],
      P = c.pan;
    if (P.positionX) {
      P.positionX.setTargetAtTime(from.x, t, 0.12);
      P.positionY.setTargetAtTime(from.y, t, 0.12);
      P.positionZ.setTargetAtTime(from.z, t, 0.12);
    } else P.setPosition(from.x, from.y, from.z);
    c.gainNow = (3 / (3 + Math.max(0, dist - 3) * 0.9)) * Math.pow(0.55, doors); // full within 3 m, then falls with the walk
    const open = doors === 0 ? 18000 : doors === 1 ? 2600 : 1100;
    c.lp.frequency.setTargetAtTime(Math.max(500, open * (1 - Math.min(0.6, dist / 80))), t, 0.25);
    c.send.gain.setTargetAtTime(0.18 + 0.55 * Math.min(1, dist / 16) + doors * 0.2, t, 0.3);
    return c.gainNow;
  }

  /** One part of the song, made once from the room's signal (a stereo upmix — nothing but the song's own two channels). */
  private feed(ctx: AudioContext, f: Feed): AudioNode {
    const have = this.feeds[f];
    if (have) return have;
    const split = ctx.createChannelSplitter(2),
      gain = (v: number) => {
        const g = ctx.createGain();
        g.gain.value = v;
        return g;
      };
    this.scene.connect(split);
    let out: AudioNode;
    if (f === 'L' || f === 'R') {
      out = gain(1);
      split.connect(out, f === 'L' ? 0 : 1);
    } else {
      // (the middle: both halves; the side: one less the other)
      const mid = gain(1),
        a = gain(0.5),
        b = gain(f === 'SL' || f === 'SR' ? -0.5 : 0.5);
      const first = f === 'SR' ? 1 : 0;
      split.connect(a, first);
      split.connect(b, 1 - first);
      a.connect(mid);
      b.connect(mid);
      if (f === 'C') out = mid;
      else if (f === 'LFE') {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 110;
        lp.Q.value = 0.6;
        const g = gain(1.6);
        mid.connect(lp);
        lp.connect(g);
        out = g;
      } else {
        // (the surrounds a few milliseconds late and a little dark, as the back of a room is)
        const d = ctx.createDelay(0.05),
          lp = ctx.createBiquadFilter();
        d.delayTime.value = f === 'SL' ? 0.013 : 0.017;
        lp.type = 'lowpass';
        lp.frequency.value = 7000;
        mid.connect(d);
        d.connect(lp);
        out = lp;
      }
    }
    this.feeds[f] = out;
    return out;
  }

  private chain(ctx: AudioContext, src: SoundSource): Chain {
    const input = ctx.createGain(),
      lp = ctx.createBiquadFilter(),
      g = ctx.createGain(),
      pan = ctx.createPanner(),
      send = ctx.createGain();
    lp.type = 'lowpass';
    lp.frequency.value = 18000;
    g.gain.value = 0;
    send.gain.value = 0;
    // (distance is worked out here, by the path: the panner only places the sound)
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'linear';
    pan.refDistance = 1;
    pan.maxDistance = 1e4;
    pan.rolloffFactor = 0;
    input.connect(lp);
    lp.connect(g);
    g.connect(pan);
    pan.connect(this.dry);
    g.connect(send);
    send.connect(this.verbIn);
    return { src, input, lp, g, pan, send, gainNow: 0 };
  }

  /** Where the song goes: with headphones, as Cadenza plays it (the engine's own path, given back a moment after the
   *  room has faded); without, into the room. */
  private routeSong() {
    if (!this.ready) return;
    const A = this.o.audio();
    if (this.phones) {
      this.ramp(this.direct.gain, 1, 0.6);
      this.ramp(this.scene.gain, 0, 0.6);
      if (this.routed) {
        clearTimeout(this.unrouteAt);
        this.unrouteAt = window.setTimeout(() => {
          if (!this.phones) return;
          A.route(null);
          this.routed = false;
        }, 700);
      }
      return;
    }
    clearTimeout(this.unrouteAt);
    if (!this.routed) {
      this.direct.gain.value = 1;
      this.scene.gain.value = 0;
      A.route(this.songIn);
      this.routed = true;
    }
    this.ramp(this.direct.gain, 0, 0.8);
    this.ramp(this.scene.gain, ROOM_GAIN, 0.8);
  }

  private ramp(p: AudioParam, v: number, sec: number) {
    const t = this.ctx!.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + sec);
  }
}

function stopSource(src: AudioBufferSourceNode) {
  try {
    src.stop();
    src.disconnect();
  } catch {
    // (already stopped)
  }
}

/** A room's response for a reverb time: noise that darkens as it decays, with a few early reflections. */
function impulse(ctx: AudioContext, rt: number): AudioBuffer {
  const sr = ctx.sampleRate,
    n = Math.floor(sr * rt * 1.1),
    ir = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0,
      seed = 1 + c * 7;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      const w = (seed / 2147483647) * 2 - 1,
        t = i / sr,
        k = Math.min(0.92, 0.25 + (t / rt) * 0.7); // (the tail darkens as it decays)
      lp = lp * k + w * (1 - k);
      d[i] = lp * Math.exp((-6.9 * t) / rt) * (t < 0.004 ? t / 0.004 : 1);
    }
    const early: [number, number][] = [
      [11, 0.5],
      [19, 0.38],
      [29, 0.3],
      [43, 0.22],
      [61, 0.16],
    ];
    for (const [ms, a] of early) d[Math.floor((sr * (ms + c * 3)) / 1000)] += a * (c ? -1 : 1);
  }
  return ir;
}

/** A recording made to loop without a seam: its silent ends trimmed, its last 25 ms crossed into its first. */
function seamless(ab: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const chs = Array.from({ length: ab.numberOfChannels }, (_, c) => ab.getChannelData(c));
  let a = 0,
    b = ab.length - 1;
  const loud = (i: number) => chs.some((d) => Math.abs(d[i]) > 1e-5);
  while (a < b && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  const L = b - a + 1,
    X = Math.min(Math.round(ab.sampleRate * 0.025), L >> 4),
    out = ctx.createBuffer(chs.length, L - X, ab.sampleRate);
  chs.forEach((d, c) => {
    const o = out.getChannelData(c);
    for (let i = 0; i < L - X; i++) o[i] = d[a + i];
    for (let i = 0; i < X; i++) {
      const u = i / X;
      o[i] = d[a + i] * Math.sin((u * Math.PI) / 2) + d[a + L - X + i] * Math.cos((u * Math.PI) / 2);
    }
  });
  return out;
}
