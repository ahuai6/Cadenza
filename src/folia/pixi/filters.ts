// Pixi v8's filter API as Folia uses it: Filter over a GlProgram (GLSL 300 es, Pixi's uniform names),
// UniformGroup resources, and the built-in Blur, Noise, ColorMatrix and Alpha filters. The GPU work
// is in gl.ts; a blur runs on the Canvas2D filter instead (same Gaussian, see BlurFilter.sigma).
import type { Texture, TextureSource } from './texture';
import type { BLEND_MODES } from './container';

export type UniformValue = number | Float32Array | Int32Array | number[];
export interface UniformDef {
  value: UniformValue;
  type: string;
  size?: number;
}

export class UniformGroup {
  readonly uniforms: Record<string, UniformValue>;
  readonly types: Record<string, string>;
  constructor(defs: Record<string, UniformDef>) {
    this.uniforms = {};
    this.types = {};
    for (const [k, d] of Object.entries(defs)) {
      this.uniforms[k] = d.value;
      this.types[k] = d.type;
    }
  }
  update() {}
  destroy() {}
}

let programUid = 1;
export class GlProgram {
  readonly uid = programUid++;
  constructor(
    public readonly vertex: string,
    public readonly fragment: string,
    public readonly name = 'program',
  ) {}
  static from(options: { vertex: string; fragment: string; name?: string }) {
    return new GlProgram(options.vertex, options.fragment, options.name);
  }
  destroy() {}
}

export type FilterResource = UniformGroup | TextureSource | Texture | Record<string, UniformDef> | null;

export interface FilterOptions {
  glProgram?: GlProgram;
  gpuProgram?: unknown;
  resources?: Record<string, FilterResource>;
  padding?: number;
  resolution?: number | 'inherit';
  antialias?: 'on' | 'off' | 'inherit' | boolean;
  blendMode?: BLEND_MODES;
  blendRequired?: boolean;
  clipToViewport?: boolean;
}

export type FilterKind = 'gl' | 'blur' | 'none';

export class Filter {
  enabled = true;
  private paddingValue = 0;
  resolution: number | 'inherit';
  antialias: 'on' | 'off' | 'inherit' | boolean;
  blendMode: BLEND_MODES;
  blendRequired: boolean;
  clipToViewport = true;
  glProgram: GlProgram | null;
  resources: Record<string, FilterResource>;
  destroyed = false;
  /** How the stage renders it. */
  readonly kind: FilterKind = 'gl';
  constructor(options: FilterOptions = {}) {
    this.glProgram = options.glProgram ?? null;
    this.resources = { ...(options.resources ?? {}) };
    // A plain object of uniform definitions is Pixi's shorthand for a UniformGroup.
    for (const [k, v] of Object.entries(this.resources)) {
      if (v && typeof v === 'object' && !(v instanceof UniformGroup) && !('source' in v) && !('resource' in v)) {
        const vals = Object.values(v);
        if (vals.length && vals.every((x) => x && typeof x === 'object' && 'value' in x))
          this.resources[k] = new UniformGroup(v as Record<string, UniformDef>);
      }
    }
    this.paddingValue = options.padding ?? 0;
    this.resolution = options.resolution ?? 1;
    this.antialias = options.antialias ?? 'off';
    this.blendMode = options.blendMode ?? 'normal';
    this.blendRequired = options.blendRequired ?? false;
    if (options.clipToViewport !== undefined) this.clipToViewport = options.clipToViewport;
  }
  get padding() {
    return this.paddingValue;
  }
  set padding(v: number) {
    this.paddingValue = v;
  }
  /** Every uniform from the filter's groups, flattened (later groups win). */
  collectUniforms(out: Record<string, UniformValue> = {}): Record<string, UniformValue> {
    for (const r of Object.values(this.resources)) if (r instanceof UniformGroup) Object.assign(out, r.uniforms);
    return out;
  }
  destroy() {
    this.destroyed = true;
  }
  static from(options: FilterOptions & { gl?: { vertex: string; fragment: string; name?: string } }) {
    return new Filter({
      ...options,
      glProgram: options.glProgram ?? (options.gl ? GlProgram.from(options.gl) : undefined),
    });
  }
}

const NOOP_VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    gl_Position = vec4(position, 0.0, 1.0);
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;
/** Pixi's default filter vertex shader, for the built-in filters below. */
export const DEFAULT_FILTER_VERTEX = NOOP_VERTEX;

export interface BlurFilterOptions {
  strength?: number;
  strengthX?: number;
  strengthY?: number;
  quality?: number;
  kernelSize?: number;
  resolution?: number | 'inherit';
  antialias?: FilterOptions['antialias'];
  padding?: number;
}

/** Pixi's two-pass Gaussian. Drawn with Canvas2D's blur at the same spread (see `sigmaX`). */
export class BlurFilter extends Filter {
  override readonly kind: FilterKind = 'blur';
  strengthX: number;
  strengthY: number;
  quality: number;
  kernelSize: number;
  repeatEdgePixels = false;
  private explicitPadding: number | null;
  constructor(options: BlurFilterOptions = {}) {
    super({ resolution: options.resolution, antialias: options.antialias });
    const s = options.strength ?? 8;
    this.strengthX = options.strengthX ?? s;
    this.strengthY = options.strengthY ?? s;
    this.quality = Math.max(1, options.quality ?? 4);
    this.kernelSize = options.kernelSize ?? 5;
    this.explicitPadding = options.padding ?? null;
  }
  get strength() {
    return this.strengthX;
  }
  set strength(v: number) {
    this.strengthX = this.strengthY = v;
  }
  get blur() {
    return this.strength;
  }
  set blur(v: number) {
    this.strength = v;
  }
  get blurX() {
    return this.strengthX;
  }
  set blurX(v: number) {
    this.strengthX = v;
  }
  get blurY() {
    return this.strengthY;
  }
  set blurY(v: number) {
    this.strengthY = v;
  }
  override get padding() {
    if (this.repeatEdgePixels) return 0;
    // (Pixi's BlurFilter.updatePadding: twice the larger strength)
    return this.explicitPadding ?? Math.max(Math.abs(this.strengthX), Math.abs(this.strengthY)) * 2;
  }
  override set padding(v: number) {
    this.explicitPadding = v;
  }
  private passCache: { key: string; list: Filter[] } | null = null;
  /**
   * Pixi 8's own blur as GL passes (BlurFilterPass, its "optimized" mode): horizontal then vertical, `quality` passes
   * each, the first at strength / sqrt(1 + 0.25 + …) and every next one at half the one before — the same programs
   * and weights, so a low quality shows Pixi's stepped look rather than a smooth Gaussian.
   */
  glPasses(): Filter[] {
    const q = Math.max(1, Math.round(this.quality));
    const key = `${this.strengthX}|${this.strengthY}|${q}|${this.kernelSize}`;
    if (this.passCache?.key === key) return this.passCache.list;
    const list: Filter[] = [];
    let sumsq = 1,
      c = 0.5;
    for (let i = 1; i < q; i += 1) {
      sumsq += c * c;
      c *= 0.5;
    }
    for (const [horizontal, strength] of [
      [true, Math.abs(this.strengthX)],
      [false, Math.abs(this.strengthY)],
    ] as [boolean, number][]) {
      if (!strength) continue;
      let u = strength / Math.sqrt(sumsq);
      for (let i = 0; i < q; i += 1) {
        list.push(
          new Filter({
            glProgram: blurProgram(horizontal, this.kernelSize),
            resources: { blurUniforms: new UniformGroup({ uStrength: { value: u, type: 'f32' } }) },
          }),
        );
        u *= 0.5;
      }
    }
    this.passCache = { key, list };
    return list;
  }
  /**
   * The Gaussian sigma (CSS px) of Pixi's blur: each of `quality` passes samples five taps at
   * strength/quality spacing with weights (0.153, 0.221, 0.250, 0.221, 0.153), whose variance is
   * 1.669·step²; `quality` passes add up to 1.669·strength²/quality.
   */
  sigma(strength: number) {
    const k = this.kernelSize === 5 ? 1.669 : this.kernelSize === 7 ? 3.2 : this.kernelSize === 9 ? 5.2 : 1.669;
    return Math.abs(strength) * Math.sqrt(k / this.quality);
  }
}

export interface NoiseFilterOptions extends FilterOptions {
  noise?: number;
  seed?: number;
}

const NOISE_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uNoise;
uniform float uSeed;
float rand(vec2 co) {
    return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
    vec4 color = texture(uTexture, vTextureCoord);
    float randomValue = rand(gl_FragCoord.xy * uSeed);
    float diff = (randomValue - 0.5) * uNoise;
    if (color.a > 0.0) {
        color.rgb /= color.a;
    }
    color.r += diff;
    color.g += diff;
    color.b += diff;
    color.rgb *= color.a;
    finalColor = color;
}`;

export class NoiseFilter extends Filter {
  private group: UniformGroup;
  constructor(options: NoiseFilterOptions = {}) {
    const group = new UniformGroup({
      uNoise: { value: options.noise ?? 0.5, type: 'f32' },
      uSeed: { value: options.seed ?? Math.random(), type: 'f32' },
    });
    super({
      ...options,
      glProgram: GlProgram.from({ vertex: NOOP_VERTEX, fragment: NOISE_FRAGMENT, name: 'noise-filter' }),
      resources: { noiseUniforms: group },
    });
    this.group = group;
  }
  get noise() {
    return this.group.uniforms.uNoise as number;
  }
  set noise(v: number) {
    this.group.uniforms.uNoise = v;
  }
  get seed() {
    return this.group.uniforms.uSeed as number;
  }
  set seed(v: number) {
    this.group.uniforms.uSeed = v;
  }
}

const COLOR_MATRIX_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uColorMatrix[20];
uniform float uAlpha;
void main() {
    vec4 c = texture(uTexture, vTextureCoord);
    if (uAlpha == 0.0) {
        finalColor = c;
        return;
    }
    if (c.a > 0.0) {
        c.rgb /= c.a;
    }
    vec4 result;
    result.r = (uColorMatrix[0] * c.r) + (uColorMatrix[1] * c.g) + (uColorMatrix[2] * c.b) + (uColorMatrix[3] * c.a) + uColorMatrix[4];
    result.g = (uColorMatrix[5] * c.r) + (uColorMatrix[6] * c.g) + (uColorMatrix[7] * c.b) + (uColorMatrix[8] * c.a) + uColorMatrix[9];
    result.b = (uColorMatrix[10] * c.r) + (uColorMatrix[11] * c.g) + (uColorMatrix[12] * c.b) + (uColorMatrix[13] * c.a) + uColorMatrix[14];
    result.a = (uColorMatrix[15] * c.r) + (uColorMatrix[16] * c.g) + (uColorMatrix[17] * c.b) + (uColorMatrix[18] * c.a) + uColorMatrix[19];
    vec3 rgb = mix(c.rgb, result.rgb, uAlpha);
    rgb *= result.a;
    finalColor = vec4(rgb, result.a);
}`;

const IDENTITY_MATRIX = () => [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

/** Pixi's ColorMatrixFilter: a 5×4 matrix over straight colour, with its helper presets. */
export class ColorMatrixFilter extends Filter {
  private group: UniformGroup;
  constructor(options: FilterOptions = {}) {
    const group = new UniformGroup({
      uColorMatrix: { value: new Float32Array(IDENTITY_MATRIX()), type: 'f32', size: 20 },
      uAlpha: { value: 1, type: 'f32' },
    });
    super({
      ...options,
      glProgram: GlProgram.from({ vertex: NOOP_VERTEX, fragment: COLOR_MATRIX_FRAGMENT, name: 'color-matrix-filter' }),
      resources: { colorMatrixUniforms: group },
    });
    this.group = group;
  }
  get matrix(): number[] {
    return Array.from(this.group.uniforms.uColorMatrix as Float32Array);
  }
  set matrix(v: number[]) {
    this.group.uniforms.uColorMatrix = new Float32Array(v);
  }
  get alpha() {
    return this.group.uniforms.uAlpha as number;
  }
  set alpha(v: number) {
    this.group.uniforms.uAlpha = v;
  }
  private load(m: number[], multiply: boolean) {
    if (!multiply) {
      this.matrix = m;
      return;
    }
    const a = this.matrix,
      out = new Array<number>(20);
    for (let r = 0; r < 4; r += 1)
      for (let c = 0; c < 5; c += 1) {
        let v = c === 4 ? a[r * 5 + 4] : 0;
        for (let k = 0; k < 4; k += 1) v += m[r * 5 + k] * a[k * 5 + c];
        if (c === 4) v += m[r * 5 + 4];
        out[r * 5 + c] = v;
      }
    this.matrix = out;
  }
  reset() {
    this.matrix = IDENTITY_MATRIX();
  }
  brightness(b: number, multiply = false) {
    this.load([b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0], multiply);
  }
  contrast(amount: number, multiply = false) {
    const v = (amount || 0) + 1,
      o = -0.5 * (v - 1);
    this.load([v, 0, 0, 0, o, 0, v, 0, 0, o, 0, 0, v, 0, o, 0, 0, 0, 1, 0], multiply);
  }
  saturate(amount = 0, multiply = false) {
    const x = (amount * 2) / 3 + 1,
      y = (x - 1) * -0.5;
    this.load([x, y, y, 0, 0, y, x, y, 0, 0, y, y, x, 0, 0, 0, 0, 0, 1, 0], multiply);
  }
  desaturate() {
    this.saturate(-1);
  }
  greyscale(scale: number, multiply = false) {
    this.load(
      [scale, scale, scale, 0, 0, scale, scale, scale, 0, 0, scale, scale, scale, 0, 0, 0, 0, 0, 1, 0],
      multiply,
    );
  }
  negative(multiply = false) {
    this.load([-1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, -1, 1, 0, 0, 0, 0, 1, 0], multiply);
  }
  hue(rotation: number, multiply = false) {
    const r = (rotation / 180) * Math.PI,
      cos = Math.cos(r),
      sin = Math.sin(r),
      w = 1 / 3,
      sq = Math.sqrt(w);
    const a00 = cos + (1 - cos) * w,
      a01 = w * (1 - cos) - sq * sin,
      a02 = w * (1 - cos) + sq * sin,
      a10 = w * (1 - cos) + sq * sin,
      a11 = cos + w * (1 - cos),
      a12 = w * (1 - cos) - sq * sin,
      a20 = w * (1 - cos) - sq * sin,
      a21 = w * (1 - cos) + sq * sin,
      a22 = cos + w * (1 - cos);
    this.load([a00, a01, a02, 0, 0, a10, a11, a12, 0, 0, a20, a21, a22, 0, 0, 0, 0, 0, 1, 0], multiply);
  }
  tint(color: number, multiply = false) {
    const r = ((color >> 16) & 255) / 255,
      g = ((color >> 8) & 255) / 255,
      b = (color & 255) / 255;
    this.load([r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0], multiply);
  }
}

const ALPHA_FRAGMENT = `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uAlpha;
void main() {
    finalColor = texture(uTexture, vTextureCoord) * uAlpha;
}`;
export class AlphaFilter extends Filter {
  private group: UniformGroup;
  constructor(options: FilterOptions & { alpha?: number } = {}) {
    const group = new UniformGroup({ uAlpha: { value: options.alpha ?? 1, type: 'f32' } });
    super({
      ...options,
      glProgram: GlProgram.from({ vertex: NOOP_VERTEX, fragment: ALPHA_FRAGMENT, name: 'alpha-filter' }),
      resources: { alphaUniforms: group },
    });
    this.group = group;
  }
  get alpha() {
    return this.group.uniforms.uAlpha as number;
  }
  set alpha(v: number) {
    this.group.uniforms.uAlpha = v;
  }
}

/* Pixi 8's blur programs (filters/defaults/blur/gl), generated the same way. */
const GAUSSIAN_VALUES: Record<number, number[]> = {
  5: [0.153388, 0.221461, 0.250301],
  7: [0.071303, 0.131514, 0.189879, 0.214607],
  9: [0.028532, 0.067234, 0.124009, 0.179044, 0.20236],
  11: [0.0093, 0.028002, 0.065984, 0.121703, 0.175713, 0.198596],
  13: [0.002406, 0.009255, 0.027867, 0.065666, 0.121117, 0.174868, 0.197641],
  15: [0.000489, 0.002403, 0.009246, 0.02784, 0.065602, 0.120999, 0.174697, 0.197448],
};
const blurPrograms = new Map<string, GlProgram>();
function blurProgram(horizontal: boolean, kernelSize: number): GlProgram {
  const k = GAUSSIAN_VALUES[kernelSize] ? kernelSize : 5;
  const id = `${horizontal}|${k}`;
  const hit = blurPrograms.get(id);
  if (hit) return hit;
  const half = Math.ceil(k / 2);
  let loop = '';
  for (let i = 0; i < k; i += 1) {
    const o = `${i - (half - 1)}.0`;
    loop += horizontal
      ? `vBlurTexCoords[${i}] =  textureCoord + vec2(${o} * pixelStrength, 0.0);\n`
      : `vBlurTexCoords[${i}] =  textureCoord + vec2(0.0, ${o} * pixelStrength);\n`;
  }
  const vertex = `in vec2 aPosition;
uniform float uStrength;
out vec2 vBlurTexCoords[${k}];
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void) {
    gl_Position = filterVertexPosition();
    float pixelStrength = uInputSize.${horizontal ? 'z' : 'w'} * uStrength;
    vec2 textureCoord = filterTextureCoord();
    ${loop}
}`;
  const kernel = GAUSSIAN_VALUES[k];
  let sum = '';
  for (let i = 0; i < k; i += 1) {
    const v = i < kernel.length ? i : k - i - 1;
    sum += `${i === 0 ? 'finalColor = ' : '    + '}texture(uTexture, clamp(vBlurTexCoords[${i}], uInputClamp.xy, uInputClamp.zw)) * ${kernel[v]}\n`;
  }
  const fragment = `in vec2 vBlurTexCoords[${k}];
uniform sampler2D uTexture;
uniform vec4 uInputClamp;
out vec4 finalColor;
void main(void) {
    ${sum};
}`;
  const p = GlProgram.from({ vertex, fragment, name: `blur-pass-${horizontal ? 'x' : 'y'}-${k}` });
  blurPrograms.set(id, p);
  return p;
}
