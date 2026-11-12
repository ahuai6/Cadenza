// The lyrics in the air: each line of the song appears in front of you as it is sung — placed in the clear, near the
// middle of the view, never under the HUD, never over another line, never through anything solid — and, when the next
// is about to come, bleaches, tips over and falls to whatever is under it.
//
// The module knows nothing of the building. It is given the scene and the camera, what is solid, whether a point is
// inside a room, and the band of the screen the HUD leaves free. A new scene brings its own.
import * as THREE from 'three';

/** A line of the song, as the scene lyrics need it. */
export interface AirLine {
  t: number;
  end: number;
  sung: number;
  text: string;
  /** the harmony sung with it, shown as a smaller row under it from `t` */ harm: { text: string; t: number } | null;
  /** timed word by word: its sung units' times in order (else the line is shown whole) */ kar: boolean;
  times: number[];
}
export interface AirSong {
  playing: boolean;
  /** song time, seconds */ t: number;
  lines: AirLine[];
}
export interface AirLyricsOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** the face the glyphs are drawn in, for a sample of the text; and its loading */
  face(sample: string): { stack: string; w: number };
  loadFace(sample: string): Promise<void>;
  /** a key that changes when the chosen face does (the settings' font) */
  faceKey(): string;
  /** the face in use changed (its glyphs are redrawn here): whatever else is drawn in it follows */
  onFace?(): void;
  /** everything solid: what blocks the sight of a line, and what a falling glyph lands on */
  solids(): THREE.Object3D[];
  /** more that a line must not cross, though nothing lands on it (the wall of songs) */
  obstacles?(): THREE.Object3D[];
  /** is this point inside a room (a line is never placed in a wall or outside) */
  inside(p: THREE.Vector3): boolean;
  /** the band of the screen the HUD leaves free, in NDC (y up) */
  freeBand(): { yTop: number; yBot: number };
  /** how the visitor is moving (metres a second): a line is placed ahead of where they will be */
  velocity(): THREE.Vector3;
  /** reduced motion: a line leaving only fades */
  reduced(): boolean;
  /** where the very first line comes from (it flies in from there), if anywhere */
  origin?(): THREE.Vector3 | null;
  /** a line appeared at `pos` (the view may turn to it) */
  onSpawn?(pos: THREE.Vector3): void;
  /** things the ink pass must leave alone are told here as they come and go */
  unlisted: { add(o: THREE.Object3D): void; remove(os: Set<THREE.Object3D>): void };
  colours: { ink: THREE.ColorRepresentation; faded: THREE.ColorRepresentation; edge: THREE.ColorRepresentation };
}

interface Glyph {
  pivot: THREE.Group;
  card: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  m: THREE.MeshBasicMaterial;
  ek: { value: number };
  ch: string;
  /** its size against a main glyph's (a harmony is smaller) */ s: number;
  harm: boolean;
  // falling
  delay: number;
  dir: number;
  floor: number;
  vy: number;
  y: number;
  ang: number;
  av: number;
  roll: number;
  rv: number;
  landed: number;
}
/** A line in the air (or falling). */
export interface Flying {
  g: THREE.Group;
  glyphs: Glyph[];
  pos: THREE.Vector3;
  /** its index in the song's lines */ idx: number;
  /** when it appeared (ms) */ t0: number;
  from: THREE.Vector3 | null;
  falling: boolean;
  fallT: number;
  width: number;
  height: number;
  yaw: number;
  harmT: number | null;
  nMain: number;
  times: number[] | null;
}

/** character height in metres */
const CH = 0.72;
/** a row's height, and a harmony's size against the line's */
const ROW = CH * 1.16,
  HS = 0.56;
/** a glyph's texture, pixels a side (a line in the air is about 200 px tall on a 1080p screen) */
const GPX = 192;
/** glyph textures kept (least recently used let go) */
const GLYPHS_KEPT = 360;
/** seconds before the next line that the one in the air begins to leave */
const LEAVE_EARLY = 0.6;
/** how much of the view's width a line may take: tried widest first */
const SHARES = [0.84, 0.62, 0.46];
/** lines in the air, and falling, at most */
const MAX_AIR = 4,
  MAX_FALLING = 6;

export class AirLyrics {
  /** every line in the air or falling, oldest first */
  readonly lines: Flying[] = [];
  /** 1 while no lyrics are out in the room, 0 while they are (what else shows the lyrics fades by it) */
  wallFade = 1;
  /** the glyphs' colours: the outline, and the fill from top to bottom (the scene's tint sets them) */
  readonly tint = {
    edge: { value: new THREE.Color() },
    top: { value: new THREE.Color('#6E5A49') },
    bottom: { value: new THREE.Color() },
  };
  private on = false;
  private lastIdx = -1;
  private lastPos: THREE.Vector3 | null = null;
  private faceNow: { stack: string; w: number };
  private faceFor = '';
  private gone = false;
  private glyphCache = new Map<string, THREE.CanvasTexture>();
  private advCache = new Map<string, number>();
  private advCtx = document.createElement('canvas').getContext('2d')!;
  private landed: { x: number; z: number; y: number }[] = [];
  private ray = new THREE.Raycaster();
  private down = new THREE.Raycaster();
  private readonly ink: THREE.Color;
  private readonly faded: THREE.Color;
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _q = new THREE.Vector3();

  constructor(private o: AirLyricsOptions) {
    this.faceNow = o.face('');
    this.ink = new THREE.Color(o.colours.ink);
    this.faded = new THREE.Color(o.colours.faded);
    this.tint.edge.value.set(o.colours.edge);
    this.tint.bottom.value.set(o.colours.ink);
  }

  /** The face in use (what else is drawn in the lyric face reads it). */
  get face() {
    return this.faceNow;
  }

  /** A new song: the next line to appear is its first. */
  reset() {
    this.lastIdx = -1;
  }

  /** Every frame. `cur`: the index of the line being sung (-1: none). */
  tick(now: number, dt: number, song: AirSong, cur: number) {
    this.faceTick(song);
    if (song.playing && !this.on) {
      this.on = true;
      this.lastIdx = -1;
    }
    if (!song.playing && this.on) {
      this.on = false;
      this.lines.forEach((l) => this.fall(l));
    }
    this.wallFade += ((this.on ? 0 : 1) - this.wallFade) * Math.min(1, dt * 3);
    if (this.on) {
      const t = song.t,
        L = song.lines;
      // a line leaves a little before the next comes, or once it (and its harmony) is over
      for (const l of this.lines) {
        if (l.falling) continue;
        const next = L[l.idx + 1],
          mine = L[l.idx];
        if ((next && t >= next.t - LEAVE_EARLY) || (mine && t > Math.max(mine.end, mine.harm ? mine.sung : 0) + 0.4))
          this.fall(l);
      }
      if (cur >= 0 && cur !== this.lastIdx && L[cur]?.text.trim()) this.spawn(L[cur], cur);
    }
    const air = this.lines.filter((l) => !l.falling);
    while (air.length > MAX_AIR) this.fall(air.shift()!);
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (!l.falling) this.hover(l, now, song.t);
      else if (this.drop(l, now, dt)) {
        this.free(l);
        this.lines.splice(i, 1);
      }
    }
    const falling = this.lines.filter((l) => l.falling);
    while (falling.length > MAX_FALLING) {
      const l = falling.shift()!;
      this.free(l);
      this.lines.splice(this.lines.indexOf(l), 1);
    }
  }

  /** The height of the highest surface under a point (0: the floor). */
  restAt(x: number, y: number, z: number): number {
    this.down.set(this._a.set(x, y, z), DOWN);
    this.down.far = y + 1;
    const hit = this.down
      .intersectObjects(this.o.solids(), false)
      .find((h) => h.face && Math.abs(this._b.copy(h.face.normal).transformDirection(h.object.matrixWorld).y) > 0.5);
    return hit ? hit.point.y : 0;
  }

  dispose() {
    this.gone = true;
    for (const l of this.lines) this.free(l);
    this.lines.length = 0;
    this.glyphCache.forEach((t) => t.dispose());
    this.glyphCache.clear();
  }

  /* ---------- the face and the glyphs ---------- */

  /** The face follows the settings; the song's own text picks its fallbacks. A change redraws every glyph. */
  private faceTick(song: AirSong) {
    const sample = song.lines
        .map((L) => L.text + (L.harm ? L.harm.text : ''))
        .join('')
        .slice(0, 240),
      key = this.o.faceKey() + '|' + sample;
    if (key === this.faceFor) return;
    this.faceFor = key;
    const want = this.o.face(sample);
    this.o.loadFace(sample).then(() => {
      if (this.gone || this.faceFor !== key) return;
      this.faceNow = want;
      this.glyphCache.forEach((t) => t.dispose());
      this.glyphCache.clear();
      this.advCache.clear();
      for (const l of this.lines) for (const gl of l.glyphs) gl.m.map = this.glyphTex(gl.ch);
      this.o.onFace?.();
    });
  }

  /** One texture per character: its fill in the red channel and a ring round it in the green one, so the shader can
   *  shade the fill and edge the outline apart. */
  private glyphTex(ch: string): THREE.CanvasTexture {
    const hit = this.glyphCache.get(ch);
    if (hit) {
      this.glyphCache.delete(ch);
      this.glyphCache.set(ch, hit);
      return hit;
    }
    if (this.glyphCache.size >= GLYPHS_KEPT) {
      const [k, v] = this.glyphCache.entries().next().value!;
      v.dispose();
      this.glyphCache.delete(k);
    }
    const c = document.createElement('canvas');
    c.width = c.height = GPX;
    const g = c.getContext('2d')!,
      font = (px: number) => `${this.faceNow.w} ${px}px ${this.faceNow.stack}`;
    let px = Math.round(GPX * 0.7);
    g.font = font(px);
    while (px > GPX * 0.3 && g.measureText(ch).width > GPX * 0.8) {
      px -= 4;
      g.font = font(px);
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.miterLimit = 2;
    const y = GPX / 2 + px * 0.05;
    g.strokeStyle = '#0f0';
    g.lineWidth = Math.max(3, px * 0.075);
    g.strokeText(ch, GPX / 2, y);
    g.fillStyle = '#f00';
    g.fillText(ch, GPX / 2, y);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    this.glyphCache.set(ch, t);
    return t;
  }

  /** The fill runs top to bottom from a light tone to a deep one, with a soft sheen across its upper part and a bevel
   *  lit from the upper left (the glyph's own edges, read from its texture); a thin outline in the accent. Bleaching
   *  (`ek` to 0), all of it turns to the faded colour together. */
  private glyphMat(map: THREE.Texture): { m: THREE.MeshBasicMaterial; ek: { value: number } } {
    const m = new THREE.MeshBasicMaterial({
        map,
        color: this.ink.clone(),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false, // (drawn over the room from first to last: a glyph that ends up in a wall is still seen)
      }),
      ek = { value: 1 },
      T = this.tint;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uEdge = T.edge;
      sh.uniforms.uEdgeK = ek;
      sh.uniforms.uTop = T.top;
      sh.uniforms.uBot = T.bottom;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uEdge, uTop, uBot; uniform float uEdgeK;')
        .replace(
          '#include <map_fragment>',
          `
        vec4 gT = texture2D(map, vMapUv); float gF = gT.r / max(gT.r + gT.g, .001), dd = 2.4 / ${GPX}.;
        float eA = texture2D(map, vMapUv + vec2(-dd, dd)).r, eB = texture2D(map, vMapUv + vec2(dd, -dd)).r, hl = clamp(eB - eA, 0., 1.), sd = clamp(eA - eB, 0., 1.);
        float v = vMapUv.y; vec3 grad = mix(uBot, uTop, smoothstep(.22, .82, v));
        grad += vec3(.16) * smoothstep(.56, .68, v) * (1. - smoothstep(.68, .84, v));
        grad = grad + hl * .42 * (vec3(1.) - grad) - sd * .3 * grad;
        vec3 fillC = mix(diffuseColor.rgb, grad, uEdgeK), edgeC = uEdge + hl * .35 * (vec3(1.) - uEdge);
        diffuseColor = vec4(mix(mix(edgeC, fillC, 1. - uEdgeK), fillC, gF), diffuseColor.a * gT.a * mix(1., gF, 1. - uEdgeK));`,
        );
    };
    m.customProgramCacheKey = () => 'glyph';
    return { m, ek };
  }

  private glyph(ch: string, s: number, harm: boolean): Glyph {
    const { m, ek } = this.glyphMat(this.glyphTex(ch));
    const card = new THREE.Mesh(new THREE.PlaneGeometry(CH, CH), m);
    card.position.y = CH / 2;
    card.renderOrder = 6;
    this.o.unlisted.add(card);
    const pivot = new THREE.Group();
    pivot.scale.setScalar(s);
    pivot.add(card);
    return {
      pivot,
      card,
      m,
      ek,
      ch,
      s,
      harm,
      delay: 0,
      dir: 1,
      floor: 0,
      vy: 0,
      y: 0,
      ang: 0,
      av: 0,
      roll: 0,
      rv: 0,
      landed: 0,
    };
  }

  /** A line gone: out of the scene and the ink's list, its materials and cards freed (the glyphs' textures are kept). */
  private free(l: Flying) {
    this.o.scene.remove(l.g);
    this.o.unlisted.remove(new Set<THREE.Object3D>(l.glyphs.map((gl) => gl.card)));
    for (const gl of l.glyphs) {
      gl.m.dispose();
      gl.card.geometry.dispose();
    }
  }

  /* ---------- rows ---------- */

  /** Each character takes its own width (a Latin letter is narrow, a CJK character square), measured in the face. */
  private advOf(ch: string): number {
    let a = this.advCache.get(ch);
    if (a == null) {
      this.advCtx.font = `${this.faceNow.w} 92px ${this.faceNow.stack}`;
      a = (Math.max(ch === ' ' ? 26 : 30, this.advCtx.measureText(ch).width) / 128 + 0.05) * CH;
      this.advCache.set(ch, a);
    }
    return a;
  }
  private widthOf(cs: string[]): number {
    let w = 0;
    for (const ch of cs) w += this.advOf(ch);
    return w;
  }
  /** A text's rows: as many characters as fit across `share` of the view at the distance lines float at, broken at a
   *  space where there is one late enough. */
  private rowsOf(text: string, share: number): string[][] {
    const cam = this.o.camera,
      wide = 2 * 3.6 * Math.tan((cam.fov * Math.PI) / 360) * cam.aspect * share;
    const cs = [...text.trim()],
      rows: string[][] = [];
    let i = 0;
    while (i < cs.length) {
      let end = i,
        w = 0;
      while (end < cs.length && (w + this.advOf(cs[end]) <= wide || end === i)) {
        w += this.advOf(cs[end]);
        end++;
      }
      if (end < cs.length) {
        const sp = cs.lastIndexOf(' ', end);
        if (sp > i && this.widthOf(cs.slice(i, sp)) > wide * 0.5) end = sp;
      }
      rows.push(cs.slice(i, end));
      i = end;
      while (cs[i] === ' ') i++;
    }
    return rows.length ? rows : [[]];
  }

  /* ---------- where a line goes ---------- */

  /** Is `to` seen from `from` (nothing solid between)? */
  private seen(from: THREE.Vector3, to: THREE.Vector3): boolean {
    this._b.subVectors(to, from);
    const L = this._b.length();
    this.ray.set(from, this._b.multiplyScalar(1 / L));
    this.ray.far = L - 0.3;
    return this.ray.intersectObjects(this.o.solids(), false).length === 0;
  }
  /** Does anything cross the line's panel (a sofa's back, a vase, a wall)? Rays along its rows and up its ends. */
  private clearAt(p: THREE.Vector3, yaw: number, w: number, h: number): boolean {
    const sx = Math.cos(yaw),
      sz = -Math.sin(yaw),
      W = w / 2 + 0.15,
      H = h / 2 + 0.1,
      solid = [...this.o.solids(), ...(this.o.obstacles?.() ?? [])];
    const hit = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      this._a.set(ax, ay, az);
      this._b.set(bx - ax, by - ay, bz - az);
      const L = this._b.length();
      this.ray.set(this._a, this._b.multiplyScalar(1 / L));
      this.ray.far = L;
      return this.ray.intersectObjects(solid, false).length > 0;
    };
    for (const f of [-1, 0, 1]) {
      if (hit(p.x - sx * W, p.y + f * H, p.z - sz * W, p.x + sx * W, p.y + f * H, p.z + sz * W)) return false;
      if (hit(p.x + sx * W * f, p.y - H, p.z + sz * W * f, p.x + sx * W * f, p.y + H, p.z + sz * W * f)) return false;
    }
    return true;
  }
  /** A line's outline on the screen now: its four corners projected (NDC: x0, x1, y0, y1). */
  private screenRect(pos: THREE.Vector3, yaw: number, w: number, h: number): [number, number, number, number] {
    const sx = Math.cos(yaw),
      sz = -Math.sin(yaw);
    let x0 = 9,
      x1 = -9,
      y0 = 9,
      y1 = -9;
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        this._q.set(pos.x + (sx * a * w) / 2, pos.y + (b * h) / 2, pos.z + (sz * a * w) / 2).project(this.o.camera);
        x0 = Math.min(x0, this._q.x);
        x1 = Math.max(x1, this._q.x);
        y0 = Math.min(y0, this._q.y);
        y1 = Math.max(y1, this._q.y);
      }
    return [x0, x1, y0, y1];
  }

  /** Where to put a line: ahead of where the visitor will be in a moment (walking on, further off; backing away,
   *  nearer), near the middle of the view, at eye level, never under the HUD, never over another line, never through
   *  anything. `strict`: only a place that passes every test (null if none); else the best there is. */
  private place(width: number, height: number, strict: boolean): THREE.Vector3 | null {
    const camera = this.o.camera;
    camera.updateMatrixWorld(true); // (the view as it is right now, never as it was last frame)
    const cam = camera.getWorldPosition(new THREE.Vector3()),
      view = camera.getWorldDirection(new THREE.Vector3()),
      yaw = Math.atan2(-view.x, -view.z),
      pitch = Math.asin(Math.max(-1, Math.min(1, view.y)));
    const vel = this.o.velocity(),
      ahead = cam.clone().add(new THREE.Vector3(vel.x, 0, vel.z).multiplyScalar(0.9)),
      band = this.o.freeBand(),
      mid = (band.yTop + band.yBot) / 2;
    const cands: { p: THREE.Vector3; yaw: number; score: number; side: THREE.Vector3 }[] = [];
    for (let k = 0; k < 72; k++) {
      const a = yaw + Math.max(-0.9, Math.min(0.9, gauss() * 0.24)),
        el = Math.max(-0.3, Math.min(0.5, pitch * 0.6 + gauss() * 0.07)),
        d = 3.3 + Math.random() * 2.6;
      const dir = new THREE.Vector3(-Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)),
        p = ahead.clone().addScaledVector(dir, d);
      p.y = Math.max(0.9 + height / 2, Math.min(6, p.y));
      if (p.distanceTo(cam) < 2.2) continue; // (never in your face)
      const side = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(width / 2 + 0.3);
      if (!this.o.inside(p.clone().add(side)) || !this.o.inside(p.clone().sub(side)) || !this.o.inside(p)) continue;
      const toCam = Math.atan2(cam.x - p.x, cam.z - p.z),
        rect = this.screenRect(p, toCam, width, height);
      if (this._q.copy(p).project(camera).z > 1) continue;
      const fits = rect[0] > -0.92 && rect[1] < 0.92 && rect[2] > band.yBot && rect[3] < band.yTop,
        free = !this.lines.some((l) => !l.falling && overlaps(rect, this.screenRect(l.pos, l.yaw, l.width, l.height)));
      if (strict && (!fits || !free)) continue;
      const cx = (rect[0] + rect[1]) / 2,
        cy = (rect[2] + rect[3]) / 2;
      let score =
        -Math.abs(cx) * 2.2 -
        Math.abs(cy - mid) * 1.6 -
        Math.abs(p.y - cam.y) * 0.3 -
        (fits ? 0 : 20) -
        (free ? 0 : 30);
      if (this.lastPos && p.distanceTo(this.lastPos) < 0.6) score -= 5;
      cands.push({ p, yaw: toCam, score, side });
    }
    cands.sort((a, b) => b.score - a.score);
    // (the costly tests — rays through the room — only for the best few)
    for (const c of cands.slice(0, 24)) {
      const ok =
        this.seen(cam, c.p) &&
        this.seen(cam, c.p.clone().add(c.side)) &&
        this.seen(cam, c.p.clone().sub(c.side)) &&
        this.clearAt(c.p, c.yaw, width, height);
      if (ok) return c.p;
    }
    if (strict) return null;
    return cands[0]?.p || cam.clone().add(new THREE.Vector3(-Math.sin(yaw), 0.1, -Math.cos(yaw)).multiplyScalar(4));
  }

  /** A line appears: as wide as the room allows (one long row where it fits), narrower and taller where it does not. */
  private spawn(L: AirLine, idx: number) {
    let rows: string[][] = [],
      hrows: string[][] = [],
      width = 0,
      height = 0,
      pos: THREE.Vector3 | null = null;
    const size = (share: number) => {
      rows = this.rowsOf(L.text, share);
      hrows = L.harm ? this.rowsOf(L.harm.text, share / HS) : [];
      width = Math.max(...rows.map((r) => this.widthOf(r)), ...hrows.map((r) => this.widthOf(r) * HS));
      height = rows.length * ROW + hrows.length * ROW * HS + (hrows.length ? CH * 0.12 : 0);
    };
    for (const share of SHARES) {
      size(share);
      pos = this.place(width, height, true);
      if (pos) break;
    }
    if (!pos) {
      size(SHARES[SHARES.length - 1]);
      pos = this.place(width, height, false)!;
    }
    const g = new THREE.Group(),
      cam = this.o.camera.position;
    g.position.copy(pos);
    g.rotation.set(0, Math.atan2(cam.x - pos.x, cam.z - pos.z), 0); // (it turns to you once, then stays put)
    this.o.scene.add(g);
    const glyphs: Glyph[] = [];
    let y = height / 2;
    const lay = (row: string[], s: number, harm: boolean) => {
      let x = (-this.widthOf(row) * s) / 2;
      y -= ROW * s;
      const yy = y + ((ROW - CH) * s) / 2;
      for (const ch of row) {
        const a = this.advOf(ch) * s;
        if (ch !== ' ') {
          const gl = this.glyph(ch, s, harm);
          gl.pivot.position.set(x + a / 2, yy, 0);
          g.add(gl.pivot);
          glyphs.push(gl);
        }
        x += a;
      }
    };
    rows.forEach((r) => lay(r, 1, false));
    if (hrows.length) y -= CH * 0.12;
    hrows.forEach((r) => lay(r, HS, true));
    // (the first line of all may fly in from somewhere: the scene says from where)
    const from = this.lastIdx < 0 || this.lines.length === 0 ? (this.o.origin?.() ?? null) : null;
    this.lines.push({
      g,
      glyphs,
      pos,
      idx,
      t0: performance.now(),
      from,
      falling: false,
      fallT: 0,
      width,
      height,
      yaw: g.rotation.y,
      harmT: L.harm ? L.harm.t : null,
      nMain: glyphs.filter((x) => !x.harm).length,
      times: L.kar && L.times.length ? L.times : null,
    });
    this.lastPos = pos;
    this.lastIdx = idx;
    this.o.onSpawn?.(pos);
  }

  /* ---------- in the air, and falling ---------- */

  /** A line in the air: each glyph arrives a moment after the last (rises a little, unfolds from a slight tilt, settles
   *  with a soft overshoot). A line timed word by word darkens as each is sung; a line timed only as a whole is shown
   *  whole, never swept by a guess. Its harmony comes in when it is sung. */
  private hover(l: Flying, now: number, t: number) {
    const age = (now - l.t0) / 1000,
      hIn = l.harmT == null ? 0 : clamp01((t - l.harmT + 0.2) / 0.5);
    l.glyphs.forEach((gl, k) => {
      const kk = gl.harm ? k - l.nMain : k;
      let sung = 1;
      if (gl.harm) sung = hIn;
      else if (l.times) {
        const at = l.times[Math.min(l.times.length - 1, Math.floor((k * l.times.length) / l.nMain))];
        sung = clamp01((t - at + 0.06) / 0.18);
      }
      const v = gl.harm ? hIn : clamp01((age - kk * 0.045) / 0.55),
        ob = 1 + 2.2 * Math.pow(v - 1, 3) + 1.2 * Math.pow(v - 1, 2);
      gl.m.color.copy(this.ink);
      gl.m.opacity = (gl.harm ? 0.8 * hIn : 0.35 + 0.65 * sung) * Math.min(1, v * 2.2);
      gl.card.position.y = CH / 2 - (1 - ob) * 0.3;
      gl.card.rotation.set((1 - ob) * 0.5, 0, (1 - ob) * 0.25 * (kk % 2 ? 1 : -1));
      gl.card.scale.setScalar((l.from ? 0.6 : 0.82) + (l.from ? 0.4 : 0.18) * ob);
    });
    if (l.from) {
      const e = 1 - Math.pow(1 - Math.min(1, age / 0.9), 3);
      l.g.position.lerpVectors(l.from, l.pos, e);
      l.g.position.y += Math.sin(Math.PI * e) * 1.2; // (an arc)
    }
  }

  /** A line lets go. Where each glyph will come to rest is found now — one look straight down under its pivot, its
   *  middle and its tip; it lands on the highest surface found and lies flat there. No physics bodies: nothing can sink
   *  in, so nothing can jitter. */
  private fall(line: Flying) {
    if (line.falling) return;
    line.falling = true;
    line.fallT = performance.now();
    line.g.position.copy(line.pos);
    for (const gl of line.glyphs) {
      gl.card.position.y = CH / 2;
      gl.card.rotation.set(0, 0, 0);
      gl.card.scale.setScalar(1);
    }
    line.g.updateMatrixWorld(true);
    const fz = new THREE.Vector3(0, 0, 1).transformDirection(line.g.matrixWorld);
    line.glyphs.forEach((gl, k) => {
      gl.delay = k * 0.05 + Math.random() * 0.04;
      gl.dir = Math.random() < 0.5 ? 1 : -1;
      const ch = CH * gl.s,
        pw = gl.pivot.getWorldPosition(new THREE.Vector3()),
        tip = pw.clone().addScaledVector(fz, gl.dir * ch),
        mid = pw.clone().addScaledVector(fz, (gl.dir * ch) / 2);
      const rest = Math.max(
        this.restAt(pw.x, pw.y, pw.z),
        this.restAt(mid.x, pw.y, mid.z),
        this.restAt(tip.x, pw.y, tip.z),
      );
      // (stacked on glyphs already lying here)
      const near = this.landed.filter(
        (q) => Math.hypot(q.x - mid.x, q.z - mid.z) < ch * 0.7 && Math.abs(q.y - rest) < 0.1,
      ).length;
      gl.floor = rest + 0.02 + near * 0.012;
      this.landed.push({ x: mid.x, z: mid.z, y: gl.floor });
      if (this.landed.length > 60) this.landed.shift();
      gl.vy = 0.7 + Math.random() * 0.5;
      gl.y = line.pos.y + gl.pivot.position.y;
      gl.ang = 0;
      gl.av = 0;
      gl.roll = 0;
      gl.rv = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 2.2);
      gl.landed = 0;
    });
  }

  /** A falling line, one frame on: each glyph bleaches, tips over on its bottom edge, drops, bounces, lies flat and
   *  shrinks away. True once all of it is gone. */
  private drop(l: Flying, now: number, dt: number): boolean {
    const ft = (now - l.fallT) / 1000,
      still = this.o.reduced();
    let done = true;
    for (const gl of l.glyphs) {
      const t = ft - gl.delay;
      if (t < 0) {
        done = false;
        continue;
      }
      const bleach = Math.min(1, t / 0.3);
      gl.m.color.copy(this.ink).lerp(this.faded, bleach);
      gl.ek.value = 1 - bleach;
      if (gl.harm && gl.m.opacity < 0.01) continue;
      if (still) {
        gl.m.opacity = Math.max(0, 1 - t / 1.2);
        if (gl.m.opacity > 0) done = false;
        continue;
      }
      // a small lift as it lets go, then gravity with a little air drag; it pitches over and barrel-rolls as it falls
      if (t > 0.25 && !gl.landed) {
        const h = Math.min(dt, 1 / 30);
        gl.vy -= 12.5 * h;
        gl.vy *= 1 - 0.35 * h;
        gl.y += gl.vy * h;
        gl.av += 9 * h;
        gl.ang = Math.min(Math.PI / 2, gl.ang + gl.av * h);
        gl.roll += gl.rv * h;
        gl.rv *= 1 - 0.8 * h;
        if (gl.y <= gl.floor) {
          gl.y = gl.floor;
          gl.ang = Math.PI / 2;
          if (gl.vy < -1.6) {
            gl.vy *= -0.22;
            gl.rv *= 0.35;
          } else gl.landed = now;
        }
      }
      gl.pivot.position.y = gl.y - l.pos.y;
      gl.pivot.rotation.set(gl.ang * gl.dir, 0, gl.roll); // (the roll spins in the glyph's own plane: it still lands flat)
      if (gl.landed) {
        const s = 1 - Math.min(1, (now - gl.landed) / 1200);
        gl.card.scale.setScalar(Math.max(0.001, s));
        gl.m.opacity = s * (gl.harm ? 0.8 : 1);
        if (s > 0) done = false;
      } else done = false;
    }
    return done;
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const overlaps = (a: number[], b: number[], m = 0.06) =>
  a[0] < b[1] + m && b[0] < a[1] + m && a[2] < b[3] + m && b[2] < a[3] + m;
function gauss() {
  let u = 0,
    v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
