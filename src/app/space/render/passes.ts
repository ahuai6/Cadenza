// The cathedral's own render passes, after the scene is drawn: ink (outlines), the beams of light, the dream (exposure,
// haze, vignette) and the glass behind the HUD. Each takes what it needs when it is made — the scene, the camera, where
// the depth comes from — and knows nothing else of the world.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/** a full-screen triangle's vertex shader */
const FSV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
/** a material as the ink reads it: its side, its colour and map (the surface's identity), its depth bias */
type SurfaceMaterial = THREE.Material & { color?: THREE.Color; map?: THREE.Texture | null };

/** Ink: edges from depth, normals and material boundaries, drawn over the flat colour. It draws the scene once more
 *  into its own target (normals, a material id, depth) — the depth the dream and the beams read too. */
export class InkPass extends Pass {
  readonly rt: THREE.WebGLRenderTarget;
  readonly mat: THREE.ShaderMaterial;
  /** one outline material per surface material, kept as long as that material lives (a WeakMap: made once, never per
   *  frame — a cache that missed here once grew by a material per mesh per frame) */
  private ids = new WeakMap<THREE.Material, THREE.ShaderMaterial>();
  private swap: (THREE.Mesh | THREE.Material)[] = [];
  private q: FullScreenQuad;
  private clearCol = new THREE.Color();
  /** `skip`: what the ink leaves alone (text, light, glass): hidden while the outline target is drawn */
  constructor(
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private skip: () => THREE.Object3D[],
    ink: THREE.ColorRepresentation,
  ) {
    super();
    this.needsSwap = true;
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      depthTexture: new THREE.DepthTexture(2, 2),
      type: THREE.HalfFloatType,
    });
    // the boundary is between materials, not objects, so coplanar
    // pieces of one material (overlapping rug motifs, a sofa's arm meeting its back) never fight over a line
    // (decals lying flat on a floor, rugs and their motifs, stay out: a grazing outline there only crawls)
    this.idMat = (m: SurfaceMaterial) => {
      const hit = this.ids.get(m);
      if (hit) return hit;
      const side = m.side,
        bias = m.userData.bias || 0,
        tr = m.transparent || bias > 0 ? 1 : 0;
      // materials that only differ by a depth bias (decal clones) are the same surface; they share their source's colour
      const tag = (m.color ? m.color.getHexString() : m.uuid) + (m.map ? m.map.uuid : '');
      let hsh = 2166136261;
      for (let i = 0; i < tag.length; i++) hsh = Math.imul(hsh ^ tag.charCodeAt(i), 16777619);
      const im = new THREE.ShaderMaterial({
        side,
        uniforms: {
          bias: { value: bias * 2e-5 },
          tr: { value: tr },
          mid: { value: ((hsh >>> 0) % 1000003) / 1000003 },
        },
        vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; void main(){ vec3 n = normal; mat4 M = modelMatrix;\n#ifdef USE_INSTANCING\n n = mat3(instanceMatrix)*n; M = modelMatrix*instanceMatrix;\n#endif\n vN = normalize(normalMatrix*n); gl_Position = projectionMatrix*viewMatrix*M*vec4(position, 1.);\n#include <logdepthbuf_vertex>\n}`,
        fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float bias, tr, mid; varying vec3 vN; void main(){\n#include <logdepthbuf_fragment>\n#ifdef USE_LOGDEPTHBUF\n gl_FragDepth -= bias;\n#endif\n vec3 n = normalize(vN)*(gl_FrontFacing ? 1. : -1.); gl_FragColor = vec4(n*.5+.5, tr > .5 ? -1. : mid); }`,
      });
      this.ids.set(m, im);
      return im;
    };
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: FSV,
      uniforms: {
        tDiffuse: { value: null },
        tN: { value: this.rt.texture },
        tD: { value: this.rt.depthTexture },
        px: { value: new THREE.Vector2() },
        w: { value: 1 },
        two: { value: 1 },
        near: { value: 0.1 },
        far: { value: 300 },
        ink: { value: new THREE.Color(ink) },
      },
      fragmentShader: `uniform sampler2D tDiffuse, tN, tD; uniform vec2 px; uniform float w, two, near, far; uniform vec3 ink; varying vec2 vUv;
        float L(vec2 uv){ return exp2(texture2D(tD, uv).x*log2(far+1.)) - 1.; }
        vec3 N(vec2 uv){ return texture2D(tN, uv).xyz*2.-1.; }
        // material boundaries: two different surfaces always meet in a line, however flush and parallel they are (a plate on a wall, a relief)
        float I(vec2 uv, float id0){ float a = texture2D(tN, uv).a; return (a < 0. || id0 < 0.) ? 0. : step(.002, abs(a - id0)); }
        // depth edges from the second difference of 1/depth (zero on any plane, so slanted floors and walls never sparkle);
        // measured at 1 and 2 pixels and averaged, so thin or distant edges fade in smoothly instead of popping between frames
        float edgeAt(vec2 o, float i0, vec3 n0){ float lx = abs(1./L(vUv+vec2(o.x,0.)) + 1./L(vUv-vec2(o.x,0.)) - 2.*i0), ly = abs(1./L(vUv+vec2(0.,o.y)) + 1./L(vUv-vec2(0.,o.y)) - 2.*i0);
          float e = smoothstep(.06, .2, max(lx, ly)/i0);
          float nn = max(max(1.-dot(N(vUv+vec2(o.x,0.)), n0), 1.-dot(N(vUv-vec2(o.x,0.)), n0)), max(1.-dot(N(vUv+vec2(0.,o.y)), n0), 1.-dot(N(vUv-vec2(0.,o.y)), n0)));
          float id0 = texture2D(tN, vUv).a, ie = max(max(I(vUv+vec2(o.x,0.), id0), I(vUv-vec2(o.x,0.), id0)), max(I(vUv+vec2(0.,o.y), id0), I(vUv-vec2(0.,o.y), id0)));
          return max(max(e, smoothstep(.2, .45, nn)), ie); }
        void main(){ vec4 c = texture2D(tDiffuse, vUv); float d0 = L(vUv); vec3 n0 = N(vUv); float i0 = 1./d0;
          float e1 = edgeAt(px*w, i0, n0), e = two > .5 ? .6*e1 + .4*edgeAt(px*w*2., i0, n0) : e1;
          float fade = 1.-smoothstep(14., 40., d0)*.85;
          float grain = (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898,78.233)))*43758.5453)-.5)*.022;
          gl_FragColor = vec4(mix(c.rgb, ink, e*fade*.92)+grain, c.a); }`,
    });
    this.q = new FullScreenQuad(this.mat);
  }
  private idMat: (m: SurfaceMaterial) => THREE.ShaderMaterial;
  override setSize(w: number, h: number) {
    this.rt.setSize(w, h);
    this.mat.uniforms.px.value.set(1 / w, 1 / h);
  }
  override render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const scene = this.scene,
      camera = this.camera,
      bg = scene.background,
      hid = this.skip().filter((o) => o.visible);
    hid.forEach((o) => (o.visible = false));
    scene.background = null;
    const sw = this.swap;
    sw.length = 0;
    scene.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        sw.push(m, m.material);
        m.material = this.idMat(m.material as SurfaceMaterial);
      }
    });
    const cc = r.getClearColor(this.clearCol),
      ca = r.getClearAlpha();
    r.setClearColor(0x8080ff, 1);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    r.setClearColor(cc, ca);
    for (let k = 0; k < sw.length; k += 2) (sw[k] as THREE.Mesh).material = sw[k + 1] as THREE.Material;
    scene.background = bg;
    hid.forEach((o) => (o.visible = true));
    const u = this.mat.uniforms;
    u.tDiffuse.value = read.texture;
    u.near.value = camera.near;
    u.far.value = camera.far;
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.q.render(r);
  }
}

/** A beam of light: an axis from `a` to `b` with a radius at each end, a strength, and whether it is a wide soft
 *  daylight column (no core). */
export interface BeamSegs {
  /** a 64 x 3 float texture: row 0 = a.xyz + radius, row 1 = b.xyz + radius, row 2 = strength, soft */
  tex: THREE.Texture;
  count: number;
}
/** Light beams as soft volumes: every beam integrated along each pixel's view ray, stopping at the scene's depth. */
export class ShaftsPass extends Pass {
  readonly mat: THREE.ShaderMaterial;
  private q: FullScreenQuad;
  constructor(
    private camera: THREE.PerspectiveCamera,
    private depth: () => THREE.Texture,
    private beams: () => BeamSegs,
    col: THREE.ColorRepresentation,
  ) {
    super();
    this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: FSV,
      uniforms: {
        tDiffuse: { value: null },
        tD: { value: null },
        segs: { value: null },
        nSeg: { value: 0 },
        far: { value: 160 },
        projInv: { value: new THREE.Matrix4() },
        camWorld: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() },
        col: { value: new THREE.Color(col) },
        colS: { value: new THREE.Color('#EEF3F2') },
        gain: { value: 0.06 },
        time: { value: 0 },
      },
      fragmentShader: `uniform sampler2D tDiffuse, tD, segs; uniform int nSeg; uniform float far, gain, time; uniform mat4 projInv, camWorld; uniform vec3 camPos, col, colS; varying vec2 vUv;
        void main(){ vec4 base = texture2D(tDiffuse, vUv);
          vec4 v = projInv*vec4(vUv*2.-1., 1., 1.); vec3 dir = normalize((camWorld*vec4(v.xyz/v.w, 0.)).xyz); vec3 fwd = normalize((camWorld*vec4(0.,0.,-1.,0.)).xyz);
          float L = (exp2(texture2D(tD, vUv).x*log2(far+1.)) - 1.)/max(.05, dot(dir, fwd));
          vec3 acc = vec3(0.); float accS = 0.;
          for (int i = 0; i < 64; i++) { if (i >= nSeg) break; vec4 a = texelFetch(segs, ivec2(i,0), 0), b = texelFetch(segs, ivec2(i,1), 0); vec2 kk = texelFetch(segs, ivec2(i,2), 0).xy; float k = kk.x;
            vec3 u = b.xyz-a.xyz, w0 = camPos-a.xyz; float bb = dot(dir,u), cc = dot(u,u), dd = dot(dir,w0), ee = dot(u,w0), den = max(cc-bb*bb, 1e-4);
            float tu = (ee-bb*dd)/den, t = clamp(tu, 0., 1.); vec3 q = a.xyz+u*t; float s = clamp(dot(q-camPos, dir), 0., L);
            vec3 p = camPos+dir*s; float r = mix(a.w, b.w, t), d = length(p-q), sn = sqrt(max(1.-bb*bb/cc, .03));
            float near = smoothstep(.8, 4., s);
            // a narrow bright core inside a faint wide halo; thickness no longer adds brightness, so every beam reads the same
            // (soft all across the opening's width: no thin bright thread down a wide window's shaft)
            float prof = kk.y > .5 ? .7*exp(-d*d/(r*r)*1.1) : .75*exp(-d*d/(r*r)*2.2) + .25*exp(-d*d/(r*r)*.8);
            // looking along a shaft — up it at the sun, or down it from the window — it fades: seen end on, its round edge
            // showed as a ring, like a mask over the sky
            float along = abs(bb)/sqrt(cc);
            prof *= smoothstep(.97, .82, along);
            vec3 sc = texelFetch(segs, ivec2(i,3), 0).rgb;
            // each beam breathes on its own slow, unrelated rhythm
            float fi = float(i), breathe = 1. + .09*sin(time*.21 + fi*1.71)*sin(time*.133 + fi*4.13) + .05*sin(time*.47 + fi*2.93);
            float add = k*breathe*prof*min(1.25/sn, 3.2)*smoothstep(0., .2, tu)*(1.-.35*t)*near; if (kk.y > .5) accS += add; else acc += add*sc; }   // fade softly past the window end (a hard cut there left a ring)
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)*.04;
          gl_FragColor = vec4(base.rgb + (col*acc + colS*accS)*gain*(1.+n), base.a); }`,
    });
    this.q = new FullScreenQuad(this.mat);
  }
  override render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const u = this.mat.uniforms,
      camera = this.camera,
      B = this.beams();
    u.time.value = performance.now() / 1000;
    u.tDiffuse.value = read.texture;
    u.tD.value = this.depth();
    u.segs.value = B.tex;
    u.nSeg.value = Math.min(64, B.count);
    u.far.value = camera.far;
    u.projInv.value.copy(camera.projectionMatrixInverse);
    u.camWorld.value.copy(camera.matrixWorld);
    u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.q.render(r);
  }
}

/** The dream: the eye adjusts to the light in view (exposure), distance softens into the haze colour, the edges darken,
 *  and the whole breathes with the beat (`pulse`). */
export class DreamPass extends Pass {
  readonly mat: THREE.ShaderMaterial;
  /** how far the eye has stopped down (1: not at all) */ exposure = 1;
  /** the beat's lift of the exposure this frame (0..0.15) */ pulse = 0;
  /** the light in view, as last read */ lum = 0;
  private q: FullScreenQuad;
  /** `depth`: the scene's depth (the ink pass's); `light`: how much light is looked straight into (0: none) */
  constructor(
    private camera: THREE.PerspectiveCamera,
    private depth: () => THREE.Texture,
    private light: () => number,
    haze: THREE.ColorRepresentation,
  ) {
    super();
    this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: FSV,
      uniforms: {
        tDiffuse: { value: null },
        tD: { value: null },
        near: { value: 0.3 },
        far: { value: 160 },
        exposure: { value: 1 },
        aspect: { value: 1 },
        haze: { value: new THREE.Color(haze) },
        edge: { value: new THREE.Color('#9C8B74') },
      },
      fragmentShader: `uniform sampler2D tDiffuse, tD; uniform float near, far, exposure, aspect; uniform vec3 haze, edge; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb; float lum = dot(col, vec3(.2126, .7152, .0722));
          float d = exp2(texture2D(tD, vUv).x*log2(far+1.)) - 1.;
          float fog = smoothstep(16., 72., d)*.42; col = mix(col, mix(vec3(lum), col, .7), fog*.7); col = mix(col, haze, fog*.55);
          col *= exposure * .94;
          float v = smoothstep(.42, 1.08, length((vUv-.5)*vec2(aspect, 1.))); col = mix(col, col*edge/max(max(edge.r, edge.g), edge.b), v*.55);
          vec3 g = col/(1.+col*.12); float l2 = dot(g, vec3(.2126,.7152,.0722)); g = mix(g, g*vec3(1.04,1.,.93), smoothstep(.55, 1., l2)); g = mix(g, g*vec3(.97,.96,1.03), 1.-smoothstep(.15, .6, l2));
          g = mix(vec3(l2), g, 1.06); g = g*.965 + .02; gl_FragColor = vec4(g, c.a); }`,
    });
    this.q = new FullScreenQuad(this.mat);
  }
  override setSize(w: number, h: number) {
    this.mat.uniforms.aspect.value = w / h;
  }
  override render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const u = this.mat.uniforms;
    u.tDiffuse.value = read.texture;
    u.tD.value = this.depth();
    u.near.value = this.camera.near;
    u.far.value = this.camera.far;
    u.exposure.value = this.exposure * (1 + this.pulse);
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.q.render(r);
  }
  // the brighter the light in view, the harder the eye stops down: up to about 80% darker around a window seen straight on
  step(dt: number) {
    this.lum = this.light();
    const L = this.lum,
      goal = Math.max(0.2, 1 / (1 + 1.55 * Math.max(0, L - 0.55)));
    this.exposure += (goal - this.exposure) * (1 - Math.exp(-dt / (goal < this.exposure ? 0.7 : 1.4)));
  }
}

/** The glass behind the HUD's cards (every `.card` on the page): a mosaic of what is behind each, laid from the card's
 *  own corner in whole blocks, and the card's white frame drawn from the very same rounded shape. */
export class GlassPass extends Pass {
  readonly mat: THREE.ShaderMaterial;
  private rects = Array.from({ length: 12 }, () => new THREE.Vector4());
  private radii: number[] = new Array(12).fill(0);
  private q: FullScreenQuad;
  constructor(private pixelRatio: () => number) {
    super();
    this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      vertexShader: FSV,
      uniforms: {
        tDiffuse: { value: null },
        res: { value: new THREE.Vector2(1, 1) },
        rects: { value: this.rects },
        radii: { value: this.radii },
        n: { value: 0 },
        block: { value: 14 },
        lw: { value: 1.5 },
        tint: { value: new THREE.Color(0.98, 0.96, 0.92) },
      },
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform vec4 rects[12]; uniform float radii[12]; uniform int n; uniform float block, lw; uniform vec3 tint; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 p = vUv*res; float inside = 0., ring = 0.; vec4 own = vec4(0.);
          for (int i = 0; i < 12; i++) { if (i >= n) break; vec4 r = rects[i]; vec2 hs = r.zw*.5; float rad = min(radii[i], min(hs.x, hs.y)); vec2 q = abs(p-(r.xy+hs))-hs+rad;
            float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - rad, k = 1.-smoothstep(-1., 1., d); if (k > inside) { inside = k; own = r; }
            // the card's white frame, from the very same shape as its glass: it sits over the glass's edge like a mask
            ring = max(ring, 1. - smoothstep(lw*.5 - .7, lw*.5 + .7, abs(d - lw*.25))); }
          // the mosaic glass: each block shows the average of what is behind it
          // (the blocks are laid from the card's own corner and sized so whole blocks fill it exactly: no cut-off row at
          // its top or bottom, no column cut at its sides)
          if (inside > 0.) { vec2 bs = own.zw / max(vec2(1.), floor(own.zw/block + .5)), b = own.xy + (floor((p - own.xy)/bs) + .5)*bs; vec3 m = vec3(0.);
            for (int k = 0; k < 16; k++) { vec2 o = (vec2(float(k - (k/4)*4), float(k/4)) - 1.5)/4.*bs*1.6; m += texture2D(tDiffuse, (b+o)/res).rgb; }
            m = m/16.; m = mix(m, vec3(dot(m, vec3(.3,.55,.15))), .25); c.rgb = mix(c.rgb, m, inside); }
          c.rgb = mix(c.rgb, vec3(1.), ring * .82);
          gl_FragColor = c; }`,
    });
    this.q = new FullScreenQuad(this.mat);
  }
  override setSize(w: number, h: number) {
    this.mat.uniforms.res.value.set(w, h);
  }
  private collect() {
    const pr = this.pixelRatio();
    let n = 0;
    for (const el of document.querySelectorAll<HTMLElement>('.card')) {
      if (n >= 12 || el.hidden || (!el.offsetParent && getComputedStyle(el).position !== 'fixed')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || el.closest('[hidden]')) continue;
      // (its corner read again whenever its size changes: a radius in % or a pill depends on the size, and one read before
      // the styles had loaded stayed wrong)
      const sz = (r.width | 0) + 'x' + (r.height | 0);
      if (el.dataset.sz !== sz) {
        el.dataset.sz = sz;
        const cs = getComputedStyle(el),
          v = cs.borderTopLeftRadius;
        el.dataset.rad = String(
          v.endsWith('%') ? (parseFloat(v) / 100) * Math.min(r.width, r.height) : parseFloat(v) || 0,
        );
      }
      this.rects[n].set(r.left * pr, (innerHeight - r.bottom) * pr, r.width * pr, r.height * pr);
      this.radii[n] = +(el.dataset.rad || 0) * pr;
      n++;
    }
    this.mat.uniforms.n.value = n;
    this.mat.uniforms.block.value = 22 * pr;
    this.mat.uniforms.lw.value = 1.6 * pr;
  }
  override render(r: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    this.collect();
    this.mat.uniforms.tDiffuse.value = read.texture;
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.q.render(r);
  }
}
