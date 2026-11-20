// Folia's backgrounds (通用, 隱現, 空, 莫奈, 漫遊) drawn onto Cadenza's canvas. Upstream they are React layers over the
// visualizer; here each is a function of the frame: the same shaders and pictures, timed by the song (a pause holds
// them), fed by Cadenza's rhythm analysis for the bands, and coloured only by Cadenza's own look — its colours and the
// cover's — never by Folia's generated themes. The parts that are plain computation are vendored (see upstream.json);
// what upstream does with CSS and React (layers, blend modes, keyframe loops, springs) is done here the same way.
import {
  meshGradientFragmentShader,
  ditheringFragmentShader,
  imageDitheringFragmentShader,
  flutedGlassFragmentShader,
  paperTextureFragmentShader,
  halftoneDotsFragmentShader,
  lensDistortionFragmentShader,
  DitheringShapes,
  DitheringTypes,
  GlassDistortionShapes,
  GlassGridShapes,
  HalftoneDotsGrids,
  HalftoneDotsTypes,
} from '@paper-design/shaders';
import { PaperLayer, sizing, color, imageOf, noiseTexture } from './paper';
import {
  resolveLatentBroadbandEnergy,
  resolveLatentOnsetPulse,
  resolveLatentAudioSpeedTarget,
  resolveLatentShaderSpeed,
  resolveLatentShaderColors,
  MAX_SHADER_PIXELS,
} from './vendor/components/visualizer/backgrounds/latent/LatentBackground';
import {
  PARTICLE_COUNT,
  VERTEX_SHADER,
  FRAGMENT_SHADER,
} from './vendor/components/visualizer/backgrounds/sora/SoraBackground';
import {
  bakeBlurredCover,
  drawCover,
  COVER_CANVAS_WIDTH,
} from './vendor/components/visualizer/backgrounds/common/FluidBackground';
import {
  getShapeScaleKey,
  type BackgroundShape,
  type BackgroundParticle,
} from './vendor/components/visualizer/backgrounds/common/GeometricBackground';
import { buildMonetDriftTrack } from './vendor/components/visualizer/backgrounds/monet/monetBackgroundDrift';
import {
  NOMAND_PAPER_TEXTURE_SHAPE,
  NOMAND_LENS_SHAPE,
  getPaperTextureOverscan,
  getLensDistortionOverscan,
  resolveDaylightInversion,
  resolveHalftoneInversion,
} from './vendor/components/visualizer/backgrounds/nomand/nomandShaderAdjustments';
import {
  paintMonetBackground,
  MONET_BACKGROUND_WIDTH,
  MONET_BACKGROUND_HEIGHT,
} from './vendor/components/visualizer/monet/monetBackgroundPaint';
import { colorWithAlpha } from './vendor/utils/colorMix';
import type { MonetBackgroundRequest } from './monetWorker';
import {
  DEFAULT_LATENT_BACKGROUND_TUNING,
  DEFAULT_MONET_BACKGROUND_TUNING,
  DEFAULT_NOMAND_BACKGROUND_TUNING,
  type LatentBackgroundTuning,
  type MonetBackgroundTuning,
  type NomandBackgroundTuning,
} from './vendor/types';
import type { Theme } from './vendor/types';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Pic = CanvasImageSource & { width: number; height: number };
export type Bands = { bass: number; lowMid: number; mid: number; vocal: number; treble: number; power: number };

/** What a background draws from, one frame. */
export interface BgFrame {
  /** song time and the time since the last frame (s) */ t: number;
  dt: number;
  /** the area to cover (frame units) and device pixels per unit */ x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  playing: boolean;
  /** reduced motion or a still picture: nothing moves on its own */ still: boolean;
  /** Cadenza's look as Folia's four colours */ theme: Pick<
    Theme,
    'backgroundColor' | 'primaryColor' | 'accentColor' | 'secondaryColor'
  >;
  /** a light look (Folia's daylight) */ daylight: boolean;
  cover: Pic | null;
  coverKey: string;
  /** the cover's colours as Cadenza reads them (the now-playing page's ambient field) */ coverColors: string[];
  bands: Bands;
  seed: number;
}
type P = Record<string, number | string | boolean>;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const str = <T extends string>(v: unknown, d: T) => (typeof v === 'string' ? (v as T) : d);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** framer-motion's 'easeTowards' per frame at 60 fps, made frame-rate independent */
const ease = (cur: number, to: number, k: number, dt: number) => cur + (to - cur) * (1 - Math.pow(1 - k, dt * 60));

/** A scratch canvas at device pixels. */
function scratch(slot: { c?: HTMLCanvasElement }, w: number, h: number) {
  const c = (slot.c ||= document.createElement('canvas'));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}
/** Draws `pic` over the area, scaled by `s` about its middle (CSS `transform: scale(s)` on a full-size layer). */
function layer(
  g: Ctx,
  f: BgFrame,
  pic: Pic,
  s = 1,
  alpha = 1,
  op: GlobalCompositeOperation = 'source-over',
  filter = '',
) {
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = op;
  if (filter) g.filter = filter;
  const w = f.w * s,
    h = f.h * s;
  g.drawImage(pic, f.x + (f.w - w) / 2, f.y + (f.h - h) / 2, w, h);
  g.restore();
}
const fill = (g: Ctx, f: BgFrame, c: string, alpha = 1) => {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = c;
  g.fillRect(f.x, f.y, f.w, f.h);
  g.restore();
};

/* ---------------- 通用 (common): theme colour, the cover's colours under it, drifting shapes and a vignette ---------------- */
function rand(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** GeometricBackground's layout, from the song's seed (upstream reads Math.random once per song). */
function geometry(seed: number) {
  const r = rand(seed * 2654435761);
  const types = ['circle', 'square', 'triangle', 'cross'] as const;
  let slots = 0;
  const shapes: BackgroundShape[] = Array.from({ length: 15 }, (_, id) => {
    const iconSlot = slots < 6 && r() > 0.7 ? r() : null;
    if (iconSlot !== null) slots += 1;
    return {
      id,
      type: types[Math.floor(r() * 4)],
      iconSlot,
      initialX: r() * 100,
      initialY: r() * 100,
      size: 40 + r() * 100,
      duration: iconSlot !== null ? 20 + r() * 20 : 30 + r() * 30,
      delay: r() * 5,
      opacity: 0.11 + r() * 0.08,
      reverse: r() > 0.5,
      filled: r() < 0.3,
      initialRotation: r() * 360,
    };
  });
  const particles: BackgroundParticle[] = Array.from({ length: 20 }, (_, id) => ({
    id,
    size: r() * 4 + 1,
    left: r() * 100,
    top: r() * 100,
    opacity: r() * 0.3,
    duration: 15 + r() * 20,
    delay: r() * 10,
  }));
  return { shapes, particles };
}
/** A CSS keyframe loop's progress at time t: its first frame through the delay (fill-mode backwards), then 0..1 loops. */
const loop = (t: number, dur: number, delay: number) => (t < delay ? 0 : ((t - delay) / dur) % 1);
const common = {
  seed: NaN,
  geo: null as ReturnType<typeof geometry> | null,
  /** the band springs (framer useSpring, stiffness 300, damping 30) */
  springs: {} as Record<string, { x: number; v: number }>,
  cover: { key: '', baked: null as HTMLCanvasElement | null, out: {} as { c?: HTMLCanvasElement }, colours: '' },
};
function spring(key: string, to: number, dt: number) {
  const s = (common.springs[key] ||= { x: to, v: 0 });
  // (sub-stepped: the spring is stiff)
  const n = Math.max(1, Math.ceil(dt / 0.004));
  for (let i = 0; i < n; i++) {
    const h = dt / n,
      a = 300 * (to - s.x) - 30 * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
  return s.x;
}
const bandScale = (v: number) => 0.95 + clamp((v - 10) / 190, 0, 1) * 0.5;
const CLIP = {
  triangle: [
    [0.5, 0],
    [0, 1],
    [1, 1],
  ],
  cross: [
    [0.2, 0],
    [0, 0.2],
    [0.3, 0.5],
    [0, 0.8],
    [0.2, 1],
    [0.5, 0.7],
    [0.8, 1],
    [1, 0.8],
    [0.7, 0.5],
    [1, 0.2],
    [0.8, 0],
    [0.5, 0.3],
  ],
};
export function drawCommon(g: Ctx, f: BgFrame, p: P) {
  const useCover = bool(p.cover, false) && !!f.cover;
  if (useCover) {
    // FluidBackground: the theme ground at 0.8, the blurred cover (its overlay gradient baked in) over it
    fill(g, f, f.theme.backgroundColor, 0.8);
    const C = common.cover;
    const cw = COVER_CANVAS_WIDTH,
      ch = Math.max(1, Math.round((cw * f.h) / f.w));
    const ck = `${f.coverKey}|${cw}x${ch}`;
    if (C.key !== ck) {
      C.key = ck;
      C.baked = bakeBlurredCover(f.cover as unknown as ImageBitmap, cw, ch, f.w);
      C.colours = '';
    }
    const out = scratch(C.out, cw, ch);
    const colours = `${ck}|${f.theme.primaryColor}|${f.theme.secondaryColor}`;
    if (C.colours !== colours) {
      C.colours = colours;
      drawCover(out, C.baked, f.theme.primaryColor, f.theme.secondaryColor);
    }
    g.save();
    g.imageSmoothingEnabled = true;
    (g as CanvasRenderingContext2D).imageSmoothingQuality = 'high';
    g.drawImage(out, f.x, f.y, f.w, f.h);
    g.restore();
  }
  fill(g, f, f.theme.backgroundColor, useCover ? clamp(num(p.opacity, 0.75), 0, 1) : 1);
  if (f.still) return vignette(g, f, p);
  if (common.seed !== f.seed || !common.geo) {
    common.seed = f.seed;
    common.geo = geometry(f.seed);
  }
  const t = f.t;
  if (bool(p.shapes, true)) {
    const band = (k: string) =>
      k === 'default' ? f.bands.power : (f.bands as Record<string, number>)[k === 'lowMid' ? 'lowMid' : k];
    const scales: Record<string, number> = {};
    for (const k of ['bass', 'lowMid', 'mid', 'treble', 'default'])
      scales[k] = bandScale(spring(k, f.playing ? band(k) : 0, f.dt));
    // (sizes are CSS px on Folia's page; Cadenza's frame is 720 units tall, a 1080p page's 2/3)
    const unit = f.h / 1080;
    for (const s of common.geo.shapes) {
      const u = loop(t, s.duration, s.delay),
        dir = s.reverse ? -1 : 1,
        tri = u < 0.5 ? u * 2 : 2 - u * 2;
      const dx = (-15 + 30 * tri) * dir * unit,
        dy = (30 - 60 * tri) * dir * unit,
        rot = ((s.initialRotation + 360 * u) * Math.PI) / 180;
      const size = s.size * unit * scales[getShapeScaleKey(s)];
      const cx = f.x + (s.initialX / 100) * f.w + (s.size * unit) / 2 + dx,
        cy = f.y + (s.initialY / 100) * f.h + (s.size * unit) / 2 + dy;
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.globalAlpha = s.opacity;
      const half = size / 2;
      g.beginPath();
      if (s.type === 'circle') g.arc(0, 0, half, 0, Math.PI * 2);
      else if (s.type === 'square') g.rect(-half, -half, size, size);
      else
        CLIP[s.type].forEach(([px, py], i) =>
          i ? g.lineTo(-half + px * size, -half + py * size) : g.moveTo(-half + px * size, -half + py * size),
        );
      g.closePath();
      if ((s.type === 'circle' || s.type === 'square') && !s.filled) {
        g.strokeStyle = f.theme.secondaryColor;
        g.lineWidth = 1;
        g.stroke();
      } else {
        g.fillStyle = f.theme.secondaryColor;
        g.fill();
      }
      g.restore();
    }
    g.save();
    g.fillStyle = f.theme.accentColor;
    for (const q of common.geo.particles) {
      const u = loop(t, q.duration, q.delay),
        a = q.opacity * (u < 0.5 ? u * 2 : 2 - u * 2);
      if (a <= 0.002) continue;
      g.globalAlpha = a;
      g.beginPath();
      g.arc(
        f.x + (q.left / 100) * f.w + (q.size * unit) / 2,
        f.y + (q.top / 100) * f.h + (q.size * unit) / 2 - 100 * unit * u,
        (q.size * unit) / 2,
        0,
        Math.PI * 2,
      );
      g.fill();
    }
    g.restore();
  }
  vignette(g, f, p);
}
function vignette(g: Ctx, f: BgFrame, p: P) {
  if (!bool(p.vignette, true)) return;
  // radial-gradient(circle, transparent 40%, rgba(0,0,0,.6) 100%): a circle to the farthest corner
  const cx = f.x + f.w / 2,
    cy = f.y + f.h / 2,
    r = Math.hypot(f.w, f.h) / 2,
    gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  gr.addColorStop(0.4, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.save();
  g.fillStyle = gr;
  g.fillRect(f.x, f.y, f.w, f.h);
  g.restore();
}

/* ---------------- 隱現 (latent): the cover's colours as a mesh gradient, a warp dithering over it, both breathing with the music ---------------- */
const latent = {
  mesh: new PaperLayer(),
  dither: new PaperLayer(),
  meshFrame: 0,
  ditherFrame: 0,
  playing: 1,
  power: 0,
  bass: 0,
  midv: 0,
  beat: 0,
  prevEnergy: 0,
  onset: 0,
};
export function latentTuning(p: P): LatentBackgroundTuning {
  const d = DEFAULT_LATENT_BACKGROUND_TUNING;
  return {
    ...d,
    displayMode: str(p.display, d.displayMode),
    colorSource: str(p.colors, d.colorSource),
    enhancedBeatResponse: bool(p.beat, d.enhancedBeatResponse),
    meshSpeed: num(p.meshSpeed, d.meshSpeed),
    meshDistortion: num(p.meshDistortion, d.meshDistortion),
    meshSwirl: num(p.meshSwirl, d.meshSwirl),
    ditheringSize: num(p.ditheringSize, d.ditheringSize),
    ditheringOpacity: num(p.ditheringOpacity, d.ditheringOpacity),
    overlayEnabled: bool(p.overlay, d.overlayEnabled),
    overlayOpacity: num(p.overlayOpacity, d.overlayOpacity),
  };
}
export function drawLatent(g: Ctx, f: BgFrame, p: P) {
  const tu = latentTuning(p),
    L = latent,
    dt = f.dt;
  const cols = resolveLatentShaderColors(f.coverColors, f.theme as Theme, tu.colorSource);
  fill(g, f, f.theme.backgroundColor);
  const paused = !f.playing;
  // LatentBackground's frame loop, step for step
  L.playing = ease(L.playing, paused ? 0 : 1, 1 - Math.exp(-(dt * 1000) / 300), 1 / 60);
  const B = f.bands;
  const energy = paused ? 0 : resolveLatentBroadbandEnergy(B.bass, B.lowMid, B.mid, B.vocal, B.treble);
  L.power = ease(L.power, paused ? 0 : Math.min(1, B.power / 255), 0.12, dt);
  L.bass = ease(L.bass, paused ? 0 : Math.min(1, B.bass / 255), 0.16, dt);
  L.midv = ease(L.midv, paused ? 0 : Math.min(1, Math.max(B.mid, B.vocal) / 255), 0.13, dt);
  L.onset = tu.enhancedBeatResponse ? resolveLatentOnsetPulse(energy, L.prevEnergy, L.onset) : 0;
  L.prevEnergy = energy;
  const target = resolveLatentAudioSpeedTarget(energy, L.onset, tu.enhancedBeatResponse);
  L.beat = ease(L.beat, target, target > L.beat ? 0.42 : 0.14, dt);
  const speedOf = (base: number, audio: number) =>
    f.still
      ? 0
      : resolveLatentShaderSpeed(base, audio, L.beat, true) +
        (resolveLatentShaderSpeed(base, audio, L.beat, false) - resolveLatentShaderSpeed(base, audio, L.beat, true)) *
          L.playing;
  L.meshFrame += dt * 1000 * speedOf(tu.meshSpeed, tu.meshAudioSpeed);
  L.ditherFrame += dt * 1000 * speedOf(tu.ditheringSpeed, tu.ditheringAudioSpeed);
  const showMesh = tu.displayMode !== 'dithering',
    showDither = tu.displayMode !== 'mesh';
  const size = { w: Math.round(f.w), h: Math.round(f.h), maxPixels: MAX_SHADER_PIXELS };
  if (showMesh) {
    const pic = L.mesh.draw(
      meshGradientFragmentShader,
      {
        u_colors: cols.mesh.map(color),
        u_colorsCount: cols.mesh.length,
        u_distortion: tu.meshDistortion + L.power * 0.62,
        u_swirl: tu.meshSwirl + L.midv * 0.38,
        u_grainMixer: 0,
        u_grainOverlay: 0.01,
        ...sizing('object'),
      },
      { ...size, frameMs: L.meshFrame },
    );
    if (pic)
      layer(
        g,
        f,
        pic,
        1.025 + L.power * 0.018,
        1,
        'source-over',
        // (held still, Folia's loop never runs, so the layer keeps no filter)
        f.still ? '' : `saturate(${1.04 + L.midv * 0.34}) brightness(${0.94 + L.power * 0.16})`,
      );
  }
  if (showDither) {
    const pic = L.dither.draw(
      ditheringFragmentShader,
      {
        u_colorBack: color(cols.ditheringBack),
        u_colorFront: color(cols.ditheringFront),
        u_shape: DitheringShapes.warp,
        u_type: DitheringTypes['4x4'],
        u_pxSize: Math.max(0.5, tu.ditheringSize - L.bass * tu.ditheringSize * 0.34),
        ...sizing('pattern', { scale: 0.6 }),
      },
      { ...size, frameMs: L.ditherFrame },
    );
    if (pic)
      layer(
        g,
        f,
        pic,
        1.015 + L.bass * 0.025,
        showMesh ? Math.min(1, tu.ditheringOpacity + L.bass * 0.25) : 1,
        showMesh ? 'soft-light' : 'source-over',
      );
  }
  if (tu.overlayEnabled && tu.overlayOpacity > 0) fill(g, f, f.theme.backgroundColor, tu.overlayOpacity);
}

/* ---------------- 空 (sora): sparse drifting stars on black (or white in a light look) ---------------- */
const sora = {
  gl: null as WebGLRenderingContext | null,
  canvas: null as HTMLCanvasElement | null,
  prog: null as WebGLProgram | null,
  time: 0,
  failed: false,
};
function soraGl() {
  if (sora.gl || sora.failed) return sora.gl;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl', { alpha: false, depth: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no WebGL');
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(Array.from({ length: PARTICLE_COUNT }, (_, i) => i)),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, 'a_index');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    Object.assign(sora, { gl, canvas: c, prog });
  } catch (e) {
    console.warn('[sora] no starfield', e);
    sora.failed = true;
  }
  return sora.gl;
}
const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export function drawSora(g: Ctx, f: BgFrame, p: P) {
  fill(g, f, f.daylight ? '#ffffff' : '#000000');
  if (bool(p.blank, false)) return;
  const gl = soraGl();
  if (!gl) return;
  if (f.playing && !f.still) sora.time += f.dt;
  const c = sora.canvas!,
    w = Math.max(1, Math.round(f.w * f.px)),
    h = Math.max(1, Math.round(f.h * f.px));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  gl.viewport(0, 0, w, h);
  const bg = f.daylight ? 1 : 0;
  gl.clearColor(bg, bg, bg, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(sora.prog);
  const u = (n: string) => gl.getUniformLocation(sora.prog!, n);
  gl.uniform2f(u('u_resolution'), w, h);
  gl.uniform1f(u('u_time'), sora.time);
  gl.uniform3fv(u('u_particle_color'), rgb01(f.theme.primaryColor));
  gl.uniform3fv(u('u_particle_accent_color'), rgb01(f.theme.accentColor));
  gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
  layer(g, f, c);
}

/* ---------------- 莫奈 (monet): the cover made a poster (blurred, washed in the look's colours), drifting slowly ---------------- */
export function monetTuning(p: P): MonetBackgroundTuning {
  const d = DEFAULT_MONET_BACKGROUND_TUNING;
  return {
    ...d,
    backgroundLayout: str(p.layout, d.backgroundLayout),
    backgroundBlurPx: num(p.blur, d.backgroundBlurPx),
    backgroundOverlayOpacity: num(p.overlay, d.backgroundOverlayOpacity),
    backgroundGrayscale: num(p.grayscale, d.backgroundGrayscale),
    backgroundSaturation: num(p.saturation, d.backgroundSaturation),
    backgroundWash: num(p.wash, d.backgroundWash),
    backgroundDriftEnabled: bool(p.drift, d.backgroundDriftEnabled),
    backgroundDriftStrength: num(p.driftStrength, d.backgroundDriftStrength),
    backgroundStreaksEnabled: bool(p.streaks, d.backgroundStreaksEnabled),
    backgroundWashColorMode: 'theme',
  };
}
const monet = {
  key: '',
  pic: null as Pic | null,
  busy: '',
  worker: null as Worker | null | false,
  drift: { strength: -1, frames: [] as [number, number, number][], ms: 1 },
};
async function paintMonet(req: MonetBackgroundRequest): Promise<Pic | null> {
  if (monet.worker === null) {
    try {
      const W = (await import('./monetWorker.ts?worker&inline')).default;
      monet.worker = new W();
    } catch {
      monet.worker = false;
    }
  }
  if (monet.worker) {
    const w = monet.worker;
    return new Promise((res) => {
      w.onmessage = (ev: MessageEvent<{ picture?: ImageBitmap }>) => res(ev.data.picture ?? null);
      w.postMessage(req, [req.image]);
    });
  }
  const c = new OffscreenCanvas(MONET_BACKGROUND_WIDTH, MONET_BACKGROUND_HEIGHT);
  paintMonetBackground(c.getContext('2d')!, req.image, req.colors, req.tuning, req.blurPx);
  return c.transferToImageBitmap();
}
function driftAt(strength: number, t: number): [number, number, number] {
  const D = monet.drift;
  if (D.strength !== strength) {
    const track = buildMonetDriftTrack(strength);
    D.strength = strength;
    D.ms = track.durationMs;
    D.frames = track.keyframes.map((k) => {
      const m = String(k.transform).match(/translate3d\(([-\d.]+)%, ([-\d.]+)%, 0\) scale\(([-\d.]+)\)/)!;
      return [+m[1], +m[2], +m[3]];
    });
  }
  const n = D.frames.length - 1,
    u = (((t * 1000) % D.ms) / D.ms) * n,
    i = Math.floor(u),
    k = u - i,
    a = D.frames[i],
    b = D.frames[Math.min(n, i + 1)];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
/** CSS background-size: cover, at background-position (px, 50%) in the box */
function drawCovered(g: Ctx, pic: Pic, x: number, y: number, w: number, h: number, posX = 0.5) {
  const s = Math.max(w / pic.width, h / pic.height),
    dw = pic.width * s,
    dh = pic.height * s;
  g.drawImage(pic, x + (w - dw) * posX, y + (h - dh) / 2, dw, dh);
}
export function drawMonet(g: Ctx, f: BgFrame, p: P) {
  const tu = monetTuning(p),
    th = f.theme as Theme;
  const key = f.cover ? JSON.stringify([f.coverKey, th.backgroundColor, th.primaryColor, th.accentColor, tu]) : '';
  if (key !== monet.key && f.cover && monet.busy !== key) {
    monet.busy = key;
    void createImageBitmap(f.cover)
      .then((image) =>
        paintMonet({
          image,
          colors: { backgroundColor: th.backgroundColor, primaryColor: th.primaryColor, accentColor: th.accentColor },
          tuning: tu,
          blurPx: clamp(tu.backgroundBlurPx, 0, 60),
        }),
      )
      .then((pic) => {
        if (monet.busy !== key) return;
        monet.key = key;
        monet.pic = pic;
      })
      .catch(() => {});
  }
  const pic = f.cover && monet.key ? monet.pic : null;
  const bg = th.backgroundColor;
  const drift =
    tu.backgroundDriftEnabled && !f.still && tu.backgroundDriftStrength > 0
      ? driftAt(clamp(tu.backgroundDriftStrength, 0, 1), f.t)
      : null;
  const inDrift = (x: number, y: number, w: number, h: number, draw: () => void) => {
    g.save();
    if (drift) {
      g.translate(x + w / 2 + (drift[0] / 100) * w, y + h / 2 + (drift[1] / 100) * h);
      g.scale(drift[2], drift[2]);
      g.translate(-(x + w / 2), -(y + h / 2));
    }
    draw();
    g.restore();
  };
  const grad = (stops: [number, string][], x0: number, x1: number) => {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr;
    g.fillRect(f.x, f.y, f.w, f.h);
  };
  const readability = () =>
    grad(
      [
        [0, colorWithAlpha(bg, 0.18)],
        [0.34, colorWithAlpha(bg, 0.32)],
        [0.7, colorWithAlpha(bg, 0.66)],
        [1, colorWithAlpha(bg, 0.82)],
      ],
      f.x,
      f.x + f.w,
    );
  const fallback = () => {
    // linear-gradient(135deg, accent .22, bg .96 50%, primary .18) over the ground
    fill(g, f, bg);
    const len = (Math.abs(f.w) + Math.abs(f.h)) / Math.SQRT2 / 2,
      cx = f.x + f.w / 2,
      cy = f.y + f.h / 2,
      d = len / Math.SQRT2;
    const gr = g.createLinearGradient(cx - d, cy - d, cx + d, cy + d);
    gr.addColorStop(0, colorWithAlpha(th.accentColor, 0.22));
    gr.addColorStop(0.5, colorWithAlpha(bg, 0.96));
    gr.addColorStop(1, colorWithAlpha(th.primaryColor, 0.18));
    g.fillStyle = gr;
    g.fillRect(f.x, f.y, f.w, f.h);
  };
  g.save();
  if (tu.backgroundLayout === 'full-overlay') {
    fill(g, f, bg);
    if (pic) inDrift(f.x, f.y, f.w, f.h, () => drawCovered(g, pic, f.x, f.y, f.w, f.h));
    else fallback();
    readability();
  } else {
    fallback();
    if (pic) {
      // a pane over the left 60 %, faded out toward its right edge (the CSS mask)
      const pw = f.w * 0.6;
      const pane = (scratchPane.c ||= document.createElement('canvas'));
      const dw = Math.max(1, Math.round(pw * f.px)),
        dh = Math.max(1, Math.round(f.h * f.px));
      if (pane.width !== dw || pane.height !== dh) {
        pane.width = dw;
        pane.height = dh;
      }
      const q = pane.getContext('2d')!;
      q.setTransform(1, 0, 0, 1, 0, 0);
      q.clearRect(0, 0, dw, dh);
      q.save();
      q.globalAlpha = (f.daylight ? 0.7 : 0.3) + clamp(tu.backgroundOverlayOpacity, 0, 1) * 0.16;
      const sub: Ctx = q;
      if (drift) {
        q.translate(dw / 2 + (drift[0] / 100) * dw, dh / 2 + (drift[1] / 100) * dh);
        q.scale(drift[2], drift[2]);
        q.translate(-dw / 2, -dh / 2);
      }
      drawCovered(sub, pic, 0, 0, dw, dh, clamp(50 + tu.backgroundHalfPaneOffsetX, 10, 90) / 100);
      q.restore();
      q.globalCompositeOperation = 'destination-in';
      const m = q.createLinearGradient(0, 0, dw, 0);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(0.48, 'rgba(0,0,0,0.94)');
      m.addColorStop(0.74, 'rgba(0,0,0,0.46)');
      m.addColorStop(1, 'rgba(0,0,0,0)');
      q.fillStyle = m;
      q.fillRect(0, 0, dw, dh);
      q.globalCompositeOperation = 'source-over';
      g.drawImage(pane, f.x, f.y, pw, f.h);
    }
    grad(
      [
        [0, colorWithAlpha(bg, 0.14)],
        [0.28, colorWithAlpha(bg, 0.28)],
        [0.64, colorWithAlpha(bg, 0.62)],
        [1, colorWithAlpha(bg, 0.86)],
      ],
      f.x,
      f.x + f.w,
    );
    const r = Math.hypot(f.w, f.h) * 0.36,
      bx = f.x + f.w * 0.18,
      by = f.y + f.h * 0.34,
      bl = g.createRadialGradient(bx, by, 0, bx, by, r);
    bl.addColorStop(0, colorWithAlpha(th.accentColor, 0.18));
    bl.addColorStop(1, colorWithAlpha(th.accentColor, 0));
    g.fillStyle = bl;
    g.fillRect(f.x, f.y, f.w, f.h);
    readability();
  }
  g.restore();
}
const scratchPane: { c?: HTMLCanvasElement } = {};

/* ---------------- 漫遊 (nomand): the cover through one of Paper's image shaders ---------------- */
export function nomandTuning(p: P): NomandBackgroundTuning {
  const d = DEFAULT_NOMAND_BACKGROUND_TUNING;
  const out: NomandBackgroundTuning = { ...d };
  for (const k of Object.keys(d) as (keyof NomandBackgroundTuning)[]) {
    const v = p[k];
    if (v !== undefined && typeof v === typeof d[k]) (out as unknown as Record<string, unknown>)[k] = v;
  }
  out.imageSource = 'cover-derived';
  return out;
}
const nomandLayer = new PaperLayer();
export function drawNomand(g: Ctx, f: BgFrame, p: P) {
  const tu = nomandTuning(p),
    th = f.theme;
  fill(g, f, th.backgroundColor);
  const img = f.cover ? imageOf(f.cover, f.coverKey) : null;
  if (!img) return;
  const fit = (scale = 1) => sizing('object', { fit: 'cover', scale });
  let frag = imageDitheringFragmentShader,
    mip: string[] = [],
    u: Record<string, unknown>;
  switch (tu.effect) {
    case 'fluted-glass':
      frag = flutedGlassFragmentShader;
      mip = ['u_image'];
      u = {
        u_image: img,
        u_colorBack: color(th.backgroundColor),
        u_colorShadow: color(th.secondaryColor),
        u_colorHighlight: color(th.primaryColor),
        u_shadows: 0.25,
        u_size: tu.flutedGlassSize,
        u_angle: 0,
        u_distortion: tu.flutedGlassDistortion,
        u_shift: 0,
        u_blur: tu.flutedGlassBlur,
        u_edges: 0.25,
        u_stretch: 0,
        u_distortionShape: GlassDistortionShapes.prism,
        u_highlights: 0.1,
        u_shape: GlassGridShapes.lines,
        u_marginLeft: 0,
        u_marginRight: 0,
        u_marginTop: 0,
        u_marginBottom: 0,
        u_grainMixer: 0,
        u_grainOverlay: 0,
        ...fit(),
      };
      break;
    case 'paper-texture': {
      const noise = noiseTexture();
      if (!noise) return;
      frag = paperTextureFragmentShader;
      mip = ['u_image'];
      const S = NOMAND_PAPER_TEXTURE_SHAPE;
      u = {
        u_image: img,
        u_colorFront: color(th.accentColor),
        u_colorBack: color(th.backgroundColor),
        u_contrast: tu.paperTextureContrast,
        u_roughness: tu.paperTextureRoughness,
        u_fiber: tu.paperTextureFiber,
        u_fiberSize: S.fiberSize,
        u_crumples: S.crumples,
        u_crumpleSize: S.crumpleSize,
        u_foldCount: S.foldCount,
        u_folds: S.folds,
        u_fade: 0,
        u_drops: S.drops,
        u_seed: S.seed,
        u_noiseTexture: noise,
        ...fit(getPaperTextureOverscan(tu.paperTextureRoughness, tu.paperTextureFiber)),
      };
      break;
    }
    case 'halftone-dots':
      frag = halftoneDotsFragmentShader;
      u = {
        u_image: img,
        u_colorFront: color(th.accentColor),
        u_colorBack: color(th.backgroundColor),
        u_size: tu.halftoneDotsSize,
        u_radius: tu.halftoneDotsRadius,
        u_contrast: tu.halftoneDotsContrast,
        u_originalColors: tu.halftoneDotsOriginalColors,
        u_inverted: resolveHalftoneInversion(tu.halftoneDotsInverted, tu.halftoneDotsOriginalColors, f.daylight),
        u_grainMixer: 0.12,
        u_grainOverlay: 0.06,
        u_grainSize: 0.5,
        u_grid: HalftoneDotsGrids.hex,
        u_type: HalftoneDotsTypes.gooey,
        ...fit(),
      };
      break;
    case 'lens-distortion': {
      frag = lensDistortionFragmentShader;
      mip = ['u_image'];
      const S = NOMAND_LENS_SHAPE;
      u = {
        u_image: img,
        u_spread: tu.lensDistortionSpread,
        u_bias: 1,
        u_angle: 0,
        u_perspective: S.perspective,
        u_count: S.count,
        u_dispersion: tu.lensDistortionDispersion,
        u_dispersionShift: 0,
        u_dispersionColor: 0.6,
        u_focusCenter: S.focusCenter,
        u_focusEdges: S.focusEdges,
        u_swirl: S.swirl,
        u_noise: 0,
        u_noiseFrequency: 0.25,
        u_noiseOffset: 0,
        u_lensBulge: tu.lensDistortionBulge,
        u_lensCircle: S.lensCircle,
        u_grainMixer: 0,
        u_grainOverlay: 0,
        u_imageX: 0,
        u_imageY: 0,
        ...fit(getLensDistortionOverscan(tu.lensDistortionBulge, tu.lensDistortionSpread)),
      };
      break;
    }
    default:
      u = {
        u_image: img,
        u_colorFront: color(th.accentColor),
        u_colorBack: color(th.backgroundColor),
        u_colorHighlight: color(th.primaryColor),
        u_type: DitheringTypes[tu.ditheringType],
        u_pxSize: tu.size,
        u_colorSteps: tu.colorSteps,
        u_originalColors: tu.originalColors,
        u_inverted: resolveDaylightInversion(tu.inverted, tu.originalColors, f.daylight),
        ...fit(),
      };
  }
  const pic = nomandLayer.draw(frag, u, { w: Math.round(f.w), h: Math.round(f.h), frameMs: 0, mipmaps: mip });
  if (pic) layer(g, f, pic);
  if (tu.overlayEnabled && tu.overlayOpacity > 0) fill(g, f, th.backgroundColor, tu.overlayOpacity);
}
