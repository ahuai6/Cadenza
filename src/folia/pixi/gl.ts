// The GPU half of the stage: runs Pixi-style filter programs (GLSL 300 es with Pixi v8's uniform
// conventions) over a picture drawn by Canvas2D, and hands the result back as a canvas to draw.
// One WebGL2 context for the whole app; a chain of filters ping-pongs between two textures and the
// last pass lands on the context's own canvas, which the caller draws immediately.
//
// Conventions (as Pixi's FilterSystem sets them, with input textures exactly the frame's size):
//   uInputSize    = (w, h, 1/w, 1/h)          frame size in CSS px
//   uInputPixel   = (W, H, 1/W, 1/H)          frame size in device px
//   uInputClamp   = half-texel inset of [0,1]²
//   uOutputFrame  = (0, 0, w, h)
//   uOutputTexture= (w, h, ±1)                −1 flips onto the canvas (whose rows run the other way)
//   uGlobalFrame  = (x, y, w, h)              the frame on the stage
import {
  DEFAULT_FILTER_VERTEX,
  Filter,
  GlProgram,
  UniformGroup,
  type FilterResource,
  type UniformValue,
} from './filters';
import { Texture, TextureSource, type ImageLike } from './texture';

interface Uniform {
  loc: WebGLUniformLocation;
  type: number;
  size: number;
}
interface Program {
  prog: WebGLProgram;
  uniforms: Map<string, Uniform>;
  aPosition: number;
}
interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

type Src = ImageLike | OffscreenCanvas;

const HEADER = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
/** Stands in for a pass whose program does not compile, so the chain still ends on the canvas. */
const COPY = new Filter({
  glProgram: GlProgram.from({
    vertex: DEFAULT_FILTER_VERTEX,
    fragment:
      'in vec2 vTextureCoord;\nout vec4 finalColor;\nuniform sampler2D uTexture;\nvoid main() { finalColor = texture(uTexture, vTextureCoord); }',
    name: 'copy',
  }),
});
const stripVersion = (s: string) => s.replace(/^\s*#version[^\n]*\n/, '');

export class GlRunner {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly gl: WebGL2RenderingContext | null;
  private programs = new Map<number, Program | null>();
  private quad: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private ping: Target | null = null;
  private pong: Target | null = null;
  private input: WebGLTexture | null = null;
  private back: WebGLTexture | null = null;
  private extra = new Map<TextureSource, { tex: WebGLTexture; version: number }>();
  lost = false;

  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = this.canvas.getContext('webgl2', {
        premultipliedAlpha: true,
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null;
    } catch {
      gl = null;
    }
    this.gl = gl;
    if (!gl) return;
    (this.canvas as HTMLCanvasElement).addEventListener?.('webglcontextlost', () => (this.lost = true));
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
  }

  get ok() {
    return !!this.gl && !this.lost;
  }

  private program(f: Filter): Program | null {
    const gp = f.glProgram;
    const gl = this.gl;
    if (!gp || !gl) return null;
    if (this.programs.has(gp.uid)) return this.programs.get(gp.uid)!;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, HEADER + stripVersion(src));
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn(`[stage] ${gp.name}: ${gl.getShaderInfoLog(s)}`);
        gl.deleteShader(s);
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, gp.vertex),
      fs = compile(gl.FRAGMENT_SHADER, gp.fragment);
    let out: Program | null = null;
    if (vs && fs) {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const uniforms = new Map<string, Uniform>();
        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
        for (let i = 0; i < n; i += 1) {
          const info = gl.getActiveUniform(prog, i);
          if (!info) continue;
          const name = info.name.replace(/\[0\]$/, '');
          const loc = gl.getUniformLocation(prog, info.name);
          if (loc) uniforms.set(name, { loc, type: info.type, size: info.size });
        }
        out = { prog, uniforms, aPosition: gl.getAttribLocation(prog, 'aPosition') };
      } else console.warn(`[stage] ${gp.name}: ${gl.getProgramInfoLog(prog)}`);
    }
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    this.programs.set(gp.uid, out);
    return out;
  }

  private texture(): WebGLTexture {
    const gl = this.gl!;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private target(old: Target | null, w: number, h: number): Target {
    const gl = this.gl!;
    if (old && old.w === w && old.h === h) return old;
    if (old) {
      gl.deleteTexture(old.tex);
      gl.deleteFramebuffer(old.fbo);
    }
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  private upload(tex: WebGLTexture | null, src: Src): WebGLTexture {
    const gl = this.gl!;
    const t = tex ?? this.texture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    return t;
  }
  /** A texture resource a filter or shader binds (cover art, noise maps…), uploaded once per version. */
  sourceTexture(source: TextureSource): WebGLTexture | null {
    const gl = this.gl;
    if (!gl || !source.resource) return null;
    const hit = this.extra.get(source);
    if (hit && hit.version === source.version) return hit.tex;
    const tex = this.upload(hit?.tex ?? null, source.resource);
    const wrap =
      source.style.addressMode === 'repeat'
        ? gl.REPEAT
        : source.style.addressMode === 'mirror-repeat'
          ? gl.MIRRORED_REPEAT
          : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    const filt = source.style.scaleMode === 'nearest' ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    this.extra.set(source, { tex, version: source.version });
    return tex;
  }
  releaseSource(source: TextureSource) {
    const hit = this.extra.get(source);
    if (hit && this.gl) this.gl.deleteTexture(hit.tex);
    this.extra.delete(source);
  }

  private setUniform(u: Uniform, v: UniformValue) {
    const gl = this.gl!;
    const arr = typeof v === 'number' ? [v] : v;
    switch (u.type) {
      case gl.FLOAT:
        gl.uniform1fv(u.loc, arr as Float32List);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(u.loc, arr as Float32List);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(u.loc, arr as Float32List);
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(u.loc, arr as Float32List);
        break;
      case gl.FLOAT_MAT2:
        gl.uniformMatrix2fv(u.loc, false, arr as Float32List);
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(u.loc, false, arr as Float32List);
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(u.loc, false, arr as Float32List);
        break;
      case gl.INT:
      case gl.BOOL:
        gl.uniform1iv(u.loc, Array.from(arr as ArrayLike<number>, Math.round));
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(u.loc, Array.from(arr as ArrayLike<number>, Math.round));
        break;
      case gl.INT_VEC3:
        gl.uniform3iv(u.loc, Array.from(arr as ArrayLike<number>, Math.round));
        break;
      case gl.INT_VEC4:
        gl.uniform4iv(u.loc, Array.from(arr as ArrayLike<number>, Math.round));
        break;
    }
  }

  /**
   * Runs `filters` (all GL kind) over `src` — a frame `w`×`h` CSS px drawn at `res` — and returns the
   * canvas holding the result (W×H device px, drawn right away by the caller), or null without a GPU.
   * `back` is the picture under the frame, for filters that read it (blendRequired).
   */
  run(
    src: Src,
    w: number,
    h: number,
    res: number,
    filters: Filter[],
    frame: { x: number; y: number },
    back?: Src | null,
  ): HTMLCanvasElement | OffscreenCanvas | null {
    const gl = this.gl;
    if (!gl || this.lost || !filters.length) return null;
    const W = Math.max(1, Math.round(w * res)),
      H = Math.max(1, Math.round(h * res));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    this.input = this.upload(this.input, src);
    if (back) this.back = this.upload(this.back, back);
    let read = this.input;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    for (let i = 0; i < filters.length; i += 1) {
      const f = filters[i];
      const last = i === filters.length - 1;
      const p = this.program(f) ?? this.program(COPY);
      let out: Target | null = null;
      if (!last) {
        const which = i % 2 === 0 ? 'ping' : 'pong';
        out = this.target(this[which], W, H);
        this[which] = out;
      }
      if (!p) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(p.prog);
      if (p.aPosition >= 0) {
        gl.enableVertexAttribArray(p.aPosition);
        gl.vertexAttribPointer(p.aPosition, 2, gl.FLOAT, false, 0, 0);
      }
      let unit = 0;
      const bindTex = (name: string, tex: WebGLTexture | null) => {
        const u = p.uniforms.get(name);
        if (!u || !tex) return;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(u.loc, unit);
        unit += 1;
      };
      bindTex('uTexture', read);
      if (f.blendRequired) bindTex('uBackTexture', this.back);
      const std: Record<string, UniformValue> = {
        uInputSize: [w, h, 1 / w, 1 / h],
        uInputPixel: [W, H, 1 / W, 1 / H],
        uInputClamp: [0.5 / W, 0.5 / H, 1 - 0.5 / W, 1 - 0.5 / H],
        uOutputFrame: [0, 0, w, h],
        uOutputTexture: [w, h, last ? -1 : 1, 0],
        uGlobalFrame: [frame.x, frame.y, w, h],
        uResolution: res,
      };
      for (const [k, v] of Object.entries(std)) {
        const u = p.uniforms.get(k);
        if (u) this.setUniform(u, v);
      }
      for (const [k, v] of Object.entries(f.collectUniforms())) {
        const u = p.uniforms.get(k);
        if (u) this.setUniform(u, v);
      }
      for (const [k, r] of Object.entries(f.resources)) {
        if (k === 'uBackTexture' && f.blendRequired) continue;
        const source = resourceSource(r);
        if (source) bindTex(k, this.sourceTexture(source));
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (out) read = out.tex;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.canvas;
  }
}

function resourceSource(r: FilterResource): TextureSource | null {
  if (!r || r instanceof UniformGroup) return null;
  if (r instanceof TextureSource) return r.resource ? r : null;
  if (r instanceof Texture) return r.source.resource ? r.source : null;
  return null;
}

let shared: GlRunner | null = null;
/** The app's one filter context, made on first use. */
export function glRunner(): GlRunner {
  if (!shared || shared.lost) shared = new GlRunner();
  return shared;
}
