// The GPU half of the stage: runs Pixi-style filter programs (GLSL 300 es with Pixi v8's uniform
// conventions) over a picture drawn by Canvas2D, and hands the result back as a canvas to draw.
// One WebGL2 context for the whole app; a chain of filters ping-pongs between two textures and the
// last pass lands on the context's own canvas, which the caller draws immediately.
//
// Conventions (as in Pixi's FilterSystem):
//   uInputSize / uInputPixel describe the allocated texture. uInputClamp bounds its valid frame.
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
import { webglDevice } from '../../core/webgl';

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
export interface FilterTarget {
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
  private targets = new Map<string, FilterTarget>();
  private input: WebGLTexture | null = null;
  private back: WebGLTexture | null = null;
  private extra = new Map<TextureSource, { tex: WebGLTexture; version: number; bytes: number }>();
  private extraBytes = 0;
  private readonly device = webglDevice();
  readonly generation = this.device?.generation;
  get lost() {
    return !this.device || this.device.lost || this.generation !== this.device.generation;
  }
  private sizes = new WeakMap<WebGLTexture, { width: number; height: number }>();
  private meshPrograms = new Map<number, Program | null>();

  constructor() {
    this.canvas =
      this.device?.canvas ??
      (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas'));
    const gl = (this.gl = this.device?.gl ?? null);
    if (!gl) return;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
  }

  get ok() {
    return !!this.gl && !this.lost && !this.gl.isContextLost();
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
      } else {
        console.warn(`[stage] ${gp.name}: ${gl.getProgramInfoLog(prog)}`);
        gl.deleteProgram(prog);
      }
    }
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    this.programs.set(gp.uid, out);
    if (this.programs.size > 128) {
      const oldest = this.programs.keys().next().value!;
      const entry = this.programs.get(oldest);
      if (entry) gl.deleteProgram(entry.prog);
      this.programs.delete(oldest);
    }
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
  target(slot: 'incoming' | 'ping' | 'pong', w: number, h: number, round = false): FilterTarget {
    const gl = this.gl!;
    if (round) {
      w = Math.ceil(w / 64) * 64;
      h = Math.ceil(h / 64) * 64;
    }
    const key = `${slot}:${w}x${h}`;
    const old = this.targets.get(key);
    if (old) {
      this.targets.delete(key);
      this.targets.set(key, old);
      return old;
    }
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const result = { tex, fbo, w, h };
    this.targets.set(key, result);
    let bytes = 0;
    for (const entry of this.targets.values()) bytes += entry.w * entry.h * 4;
    for (const [name, entry] of this.targets) {
      if (bytes <= 96 * 1024 * 1024 && this.targets.size <= 12) break;
      if (entry.w === w && entry.h === h) continue; // active inputs, never evict during a pass chain
      gl.deleteTexture(entry.tex);
      gl.deleteFramebuffer(entry.fbo);
      this.targets.delete(name);
      bytes -= entry.w * entry.h * 4;
    }
    return result;
  }
  private upload(tex: WebGLTexture | null, src: Src): WebGLTexture {
    const gl = this.gl!;
    const t = tex ?? this.texture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const image = src as TexImageSource;
    const width = 'videoWidth' in src ? Number(src.videoWidth) : src.width;
    const height = 'videoHeight' in src ? Number(src.videoHeight) : src.height;
    const size = this.sizes.get(t);
    if (size?.width === width && size.height === height)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      this.sizes.set(t, { width, height });
    }
    return t;
  }
  /** A texture resource a filter or shader binds (cover art, noise maps…), uploaded once per version. */
  sourceTexture(source: TextureSource): WebGLTexture | null {
    const gl = this.gl;
    if (!gl || !this.ok || !source.resource) return null;
    const hit = this.extra.get(source);
    if (hit) {
      this.extra.delete(source);
      if (hit.version === source.version) {
        this.extra.set(source, hit);
        return hit.tex;
      }
      this.extraBytes -= hit.bytes;
    }
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
    const size = this.sizes.get(tex);
    const bytes = (size?.width ?? 0) * (size?.height ?? 0) * 4;
    this.extra.set(source, { tex, version: source.version, bytes });
    this.extraBytes += bytes;
    while (this.extra.size > 1 && (this.extra.size > 64 || this.extraBytes > 64 * 1024 * 1024))
      this.releaseSource(this.extra.keys().next().value!);
    return tex;
  }
  releaseSource(source: TextureSource) {
    const hit = this.extra.get(source);
    if (!hit) return;
    this.gl?.deleteTexture(hit.tex);
    this.extraBytes -= hit.bytes;
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

  private meshBuf: { pos: WebGLBuffer; uv: WebGLBuffer; idx: WebGLBuffer; vao: WebGLVertexArrayObject } | null = null;
  /** Draws a mesh with its own program onto the whole (cleared) canvas, W×H device px; returns it to be drawn over. */
  mesh(W: number, H: number, m: MeshDraw): HTMLCanvasElement | OffscreenCanvas | null {
    const gl = this.gl;
    if (!gl || !this.ok) return null;
    const saved = this.programs;
    this.programs = this.meshPrograms;
    const p = this.program({ glProgram: m.glProgram } as unknown as Filter);
    this.programs = saved;
    if (!p) return null;
    const y = outputViewport(this.canvas, W, H);
    if (!this.meshBuf)
      this.meshBuf = {
        pos: gl.createBuffer()!,
        uv: gl.createBuffer()!,
        idx: gl.createBuffer()!,
        vao: gl.createVertexArray()!,
      };
    const B = this.meshBuf;
    gl.bindVertexArray(B.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, y, W, H);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, y, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(p.prog);
    const attr = (name: string, buf: WebGLBuffer, data: Float32Array) => {
      const loc = gl.getAttribLocation(p.prog, name);
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    };
    attr('aPosition', B.pos, m.positions);
    attr('aUV', B.uv, m.uvs);
    const idx = m.indices instanceof Uint16Array ? m.indices : new Uint16Array(m.indices);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, B.idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    const [a, b, c, d, tx, ty] = m.matrix;
    const std: Record<string, UniformValue> = {
      // device px → clip, y down
      uProjectionMatrix: [2 / W, 0, 0, 0, -2 / H, 0, -1, 1, 1],
      uWorldTransformMatrix: [a, b, 0, c, d, 0, tx, ty, 1],
      uTransformMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      uColor: [m.alpha, m.alpha, m.alpha, m.alpha],
    };
    for (const [k, v] of Object.entries(std)) {
      const u = p.uniforms.get(k);
      if (u) this.setUniform(u, v);
    }
    let unit = 0;
    for (const [k, r] of Object.entries(m.resources)) {
      if (r instanceof UniformGroup) {
        for (const [uk, uv] of Object.entries(r.uniforms)) {
          const u = p.uniforms.get(uk);
          if (u) this.setUniform(u, uv);
        }
        continue;
      }
      const source = resourceSource(r);
      const u = p.uniforms.get(k);
      if (!source || !u) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture(source));
      gl.uniform1i(u.loc, unit);
      unit += 1;
    }
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    return this.canvas;
  }

  /**
   * Runs `filters` (all GL kind) over `src` — a frame `w`×`h` CSS px drawn at `res` — and returns the
   * canvas holding the result (W×H device px, drawn right away by the caller), or null without a GPU.
   * `back` is the picture under the frame, for filters that read it (blendRequired).
   */
  run(
    src: Src | FilterTarget,
    w: number,
    h: number,
    res: number,
    filters: Filter[],
    frame: { x: number; y: number },
    back?: Src | null,
  ): HTMLCanvasElement | OffscreenCanvas | null {
    const gl = this.gl;
    if (!gl || !this.ok || !filters.length) return null;
    const W = Math.max(1, Math.round(w * res)),
      H = Math.max(1, Math.round(h * res));
    const y = outputViewport(this.canvas, W, H);
    gl.activeTexture(gl.TEXTURE0);
    let read = 'fbo' in src ? src.tex : (this.input = this.upload(this.input, src));
    let iw = 'fbo' in src ? src.w : W;
    let ih = 'fbo' in src ? src.h : H;
    // Backdrop-dependent filters sample both textures in the same coordinates.
    const round = !filters.some((filter) => filter.blendRequired);
    if (back) this.back = this.upload(this.back, back);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    for (let i = 0; i < filters.length; i += 1) {
      const f = filters[i];
      const last = i === filters.length - 1;
      const p = this.program(f) ?? this.program(COPY);
      let out: FilterTarget | null = null;
      if (!last) {
        const which = i % 2 === 0 ? 'ping' : 'pong';
        out = this.target(which, W, H, round);
      }
      if (!p) return null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
      const bottom = out ? 0 : y;
      gl.viewport(0, bottom, W, H);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, bottom, out?.w ?? W, out?.h ?? H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.scissor(0, bottom, W, H);
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
        uInputSize: [(iw * w) / W, (ih * h) / H, W / (iw * w), H / (ih * h)],
        uInputPixel: [iw, ih, 1 / iw, 1 / ih],
        uInputClamp: [0.5 / iw, 0.5 / ih, (W - 0.5) / iw, (H - 0.5) / ih],
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
      if (out) {
        read = out.tex;
        iw = out.w;
        ih = out.h;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    return this.canvas;
  }
}

function outputViewport(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number) {
  if (canvas.width < width) canvas.width = width;
  if (canvas.height < height) canvas.height = height;
  return canvas.height - height;
}

export interface MeshDraw {
  glProgram: import('./filters').GlProgram;
  resources: Record<string, FilterResource>;
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array | Uint16Array;
  /** stage CSS px → target device px, times the mesh's own transform (a, b, c, d, tx, ty) */
  matrix: [number, number, number, number, number, number];
  alpha: number;
}

export function drawMeshGl(
  runner: GlRunner,
  W: number,
  H: number,
  m: MeshDraw,
): HTMLCanvasElement | OffscreenCanvas | null {
  return runner.mesh(W, H, m);
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
  const device = webglDevice();
  if (!shared || (device && !device.lost && shared.generation !== device.generation)) shared = new GlRunner();
  return shared;
}
