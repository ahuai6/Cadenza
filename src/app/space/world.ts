// @ts-nocheck
// The cathedral (docs/SPACE.md): the scene, its render chain, input, the room audio and the scene lyrics, in one closure so
// a second mount or a dispose leaves nothing behind. Everything it shows comes through bind.ts (the library, the song
// playing, its lyrics); the rooms that show the library (the nave, the wall of songs, the playlists) rebuild when it
// changes. Not yet typed: the split into world/, render/, input/, audio/ and rooms/ continues with steps 4 to 6.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { InkPass, ShaftsPass, DreamPass, GlassPass } from './render/passes';
import { RoomAudio } from './systems/audio';
import { AirLyrics } from './systems/lyrics';
import { smooth } from './rigs/rig';
import { ShotRig } from './rigs/shots';
import { WalkRig } from './rigs/walk';
import type { SpaceBind, SpaceNow } from './bind';
import { navePage, navePages, letterSpan, NAVE_SLOTS, LIST_SLOTS } from './data';
import { CoverCache, CoverAtlas } from './covers';
import { ts } from './i18n';
import AMBIENT from './ambient.ogg?url';

export interface SpaceUi {
  openSettings(section?: string): void;
  closeSettings(): void;
  /** open what was clicked (an album, a playlist, a song) where you stand, or close it */ show(
    d: { kind: 'album' | 'playlist' | 'song'; key: string } | null,
  ): void;
  /** the graphics context was lost (a driver reset, memory): the shell builds the scene again */ lost(): void;
}
export function createWorld(
  bind: SpaceBind,
  ui: SpaceUi,
): { dispose(): void; takePointer(): void; closed(): void; pause(on: boolean): void } {
  const ac = new AbortController();
  let alive = true;
  const opt = (o) => ({ ...(typeof o === 'object' ? o : { capture: !!o }), signal: ac.signal });
  const onW = (t, f, o) => window.addEventListener(t, f, opt(o)),
    onD = (t, f, o) => document.addEventListener(t, f, opt(o));
  const SYS_RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const rnd = (s) => {
    const x = Math.sin(s * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const V2 = THREE.Vector2,
    V3 = THREE.Vector3;
  const EYE = 1.7;

  /* ---------- settings: Cadenza's own (the space's fields, the picture-quality mode), followed as they change ---------- */
  let S = bind.prefs();
  const RM = () => S.motion === 'reduced';

  /* ---------- the library, through bind.ts: songs by title (the crossing), albums sixteen to a page (the nave), playlists ---------- */
  let LIB = bind.library(),
    SONGS = LIB.songs,
    navePg = 0,
    ALBUMS = navePage(LIB, 0),
    listPg = 0,
    PLAYLISTS = LIB.playlists.slice(0, LIST_SLOTS);
  let songById = new Map(SONGS.map((s, i) => [s.id, i]));
  const covers = new CoverCache(512, 48),
    thumbs = new CoverCache(256, 96),
    atlas = new CoverAtlas(128);
  // the song playing, read from bind once a frame
  let NOW: SpaceNow = bind.now(),
    nowId = undefined,
    curLine = -1;

  /* ---------- palette: paper and shade make the space, ink makes the line, accents stay under 10% ---------- */
  const C = {
    wheat: '#E8DCC4',
    oat: '#D8C7A8',
    ivory: '#F5EEE0',
    taupe: '#BFAF97',
    ink: '#29241F',
    clay: '#D97757',
    kraft: '#C99A6E',
    olive: '#8C9A62',
    mist: '#8BA2BD',
    apricot: '#FFE3B8',
  };
  C.paper = C.wheat;
  const ROOM_COL = { nave: C.clay, dome: C.olive, lists: C.mist, settings: C.kraft, altar: C.clay };

  /* ---------- renderer: no tone mapping, so a flat colour stays the colour it was chosen as ---------- */
  const canvas = $('world');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,
  });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // soft edges on every cast shadow
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.wheat);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 160);

  /* ---------- light: a cool ambient paints the shade colour, one warm sun paints the light ---------- */
  const SUN_DIR = new V3(0.42, 1, 0.18).normalize(),
    SUN_M = new V3(-0.42, 1, 0.18).normalize(); // (the mirrored sun: light for the windows on the shaded side)
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const ambLight = new THREE.AmbientLight(lin(0.72, 0.68, 0.64), Math.PI);
  scene.add(ambLight); // a little lower: the room was too bright
  const sun = new THREE.DirectionalLight(lin(0.34, 0.31, 0.22), Math.PI);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.09;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(lin(0.12, 0.11, 0.1), Math.PI);
  fill.position.set(-0.6, 0.7, 0.9);
  scene.add(fill); // no shadow: gives round things a second tone

  // two-tone ramp (shade | a narrow middle | light)
  const ramp = new THREE.DataTexture(
    new Uint8Array([
      0, 0, 0, 255, 0, 0, 0, 255, 40, 40, 40, 255, 150, 150, 150, 255, 235, 235, 235, 255, 255, 255, 255, 255,
    ]),
    6,
    1,
  );
  ramp.minFilter = ramp.magFilter = THREE.LinearFilter;
  ramp.needsUpdate = true;
  const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, ...o });
  const flat = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
  // walls brighten from wheat at the floor to ivory under the vault: light comes from above
  const WASH_TOP = { value: new THREE.Color(C.ivory) }; // the colour the walls lighten toward under the vault (tinted by the cover)
  const skyWash = (m, y0 = 1, y1 = 18, k = 0.55) => {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.)).y;',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uWashTop, smoothstep(${y0.toFixed(1)}, ${y1.toFixed(1)}, vWY) * ${k.toFixed(2)});`,
        )
        .replace('#include <common>', '#include <common>\nuniform vec3 uWashTop;');
      sh.uniforms.uWashTop = WASH_TOP;
    };
    m.customProgramCacheKey = () => 'wash' + y0 + y1 + k;
    return m;
  };
  // a baked surface: no lighting at all, only a vertical gradient chosen by hand
  const BAKED = [];
  const skyBaked = (...a) => {
    const m = baked(...a);
    m.userData.sky = true;
    return m;
  };
  function baked(lo, hi, y0, y1, o) {
    const m = flat(lo, o),
      top = { value: new THREE.Color(hi) };
    m.userData.top = top;
    BAKED.push(m);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTop = top;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.)).y;',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWY; uniform vec3 uTop;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTop, smoothstep(${y0.toFixed(1)}, ${y1.toFixed(1)}, vWY));`,
        );
    };
    m.customProgramCacheKey = () => 'baked' + lo + hi + y0 + y1;
    return m;
  }
  const MAT = {
    paper: skyWash(toon(C.wheat)),
    oat: toon(C.oat),
    ivory: toon(C.ivory),
    taupe: toon(C.taupe),
    clay: toon(C.clay),
    kraft: toon(C.kraft),
    olive: toon(C.olive),
    mist: toon(C.mist),
    ink: flat(C.ink),
    dome: baked('#D2C2A6', '#EFE5D2', 14, 30, { side: THREE.BackSide, shadowSide: THREE.DoubleSide }),
    vault: baked('#D4C5AA', '#E2D5BC', 14, 21, {}),
    tunnel: baked('#CDBEA2', '#D9CBB0', 0, 8, {}),
    floor: toon(C.oat),
  };
  const roomMat = { nave: MAT.clay, dome: MAT.olive, lists: MAT.mist, settings: MAT.kraft, altar: MAT.clay };

  /* ---------- canvases: covers, text, glass compositions ---------- */
  const mk = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  };
  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const textTex = (w, h, draw) => {
    const c = mk(w, h);
    draw(c.getContext('2d'), w, h);
    return tex(c);
  };
  const MORANDI = [
    ['#c9b8a8', '#9aa597', '#e6ddd0'],
    ['#a9b4bc', '#d3c4b4', '#7d8a93'],
    ['#b99a8d', '#e4d8c8', '#8e9a8a'],
    ['#cfc2ae', '#a39486', '#e9e2d6'],
    ['#9fa8a0', '#c7b5a6', '#dcd3c3'],
    ['#b3a3ab', '#d8cdbf', '#8f8a7d'],
    ['#c4a99a', '#a9b0a3', '#ece4d8'],
    ['#a7a49a', '#d6c2b4', '#80878a'],
  ];
  const labelTex = (title, sub, w = 512) =>
    textTex(w, 140, (g, W, h) => {
      g.fillStyle = C.ink;
      g.font = '500 46px "Noto Serif TC", serif';
      g.fillText(title, 8, 56);
      g.fillStyle = '#7a6f63';
      g.font = 'italic 400 30px "Source Serif 4", serif';
      g.fillText(sub, 8, 108);
    });
  // (the lyrics' face is the settings' lyric font: the one the lyrics in the air use)
  // a line on the sanctuary's paper: one row when it fits, smaller if a little long, two rows (broken at a space where it can) if longer
  const lyricTex = (t) =>
    textTex(1600, 180, (g, w, h) => {
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = C.ink;
      const maxW = w - 80;
      const fits = (px) => {
        g.font = `${air.face.w} ${px}px ${air.face.stack}`;
        return g.measureText(t).width <= maxW;
      };
      for (const px of [108, 96, 86])
        if (fits(px)) {
          g.fillText(t, w / 2, h / 2);
          return;
        }
      const cs = [...t],
        mid = cs.length / 2;
      let cut = Math.round(mid);
      for (let d = 0; d < cs.length / 3; d++) {
        if (cs[Math.round(mid + d)] === ' ') {
          cut = Math.round(mid + d);
          break;
        }
        if (cs[Math.round(mid - d)] === ' ') {
          cut = Math.round(mid - d);
          break;
        }
      }
      const rows = [cs.slice(0, cut).join('').trim(), cs.slice(cut).join('').trim()];
      let px = 74;
      g.font = `${air.face.w} ${px}px ${air.face.stack}`;
      while (px > 30 && Math.max(...rows.map((r) => g.measureText(r).width)) > maxW) {
        px -= 4;
        g.font = `${air.face.w} ${px}px ${air.face.stack}`;
      }
      g.fillText(rows[0], w / 2, h / 2 - px * 0.55);
      g.fillText(rows[1], w / 2, h / 2 + px * 0.55);
    });
  const titleTex = (zh, en) =>
    textTex(1024, 260, (g, w, h) => {
      g.textAlign = 'center';
      g.fillStyle = C.ink;
      g.font = '700 132px "Noto Serif TC", serif';
      g.fillText(zh, w / 2, 140);
      g.fillStyle = '#7a6f63';
      g.font = 'italic 400 56px "Source Serif 4", serif';
      g.fillText(en, w / 2, 222);
    });
  // a window is a small composition of flat shapes, never leaded glass
  function glassTex(seed, cols) {
    const W = 256,
      H = 512,
      c = mk(W, H),
      g = c.getContext('2d');
    g.fillStyle = '#FBF1DF';
    g.fillRect(0, 0, W, H);
    const pick = (k) => cols[Math.floor(rnd(seed * 7 + k) * cols.length)];
    for (let k = 0; k < 5; k++) {
      const kind = Math.floor(rnd(seed * 3 + k * 11) * 4),
        x = rnd(seed + k * 5.1) * W,
        y = 60 + rnd(seed * 2 + k * 3.7) * (H - 60),
        r = 50 + rnd(seed + k) * 90;
      g.fillStyle = pick(k);
      g.beginPath();
      if (kind === 0) g.arc(x, y, r, 0, 7);
      else if (kind === 1) {
        g.arc(x, y, r, Math.PI, 0);
        g.closePath();
      } else if (kind === 2) {
        g.moveTo(x, y);
        g.arc(x, y, r * 1.3, 0, Math.PI / 2);
        g.closePath();
      } else g.rect(x - r / 2, y - r / 2, r, r * 1.4);
      g.fill();
    }
    // the wooden frame: a border, a centre mullion and two transoms, cut out of the glass (its alpha marks the wood)
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000';
    g.lineWidth = 14;
    g.strokeRect(7, 7, W - 14, H - 14);
    g.fillRect(W / 2 - 7, 0, 14, H);
    for (const y of [H * 0.36, H * 0.68]) g.fillRect(0, y - 6, W, 12);
    g.globalCompositeOperation = 'source-over';
    return tex(c);
  }
  function roseTex() {
    const N = 1024,
      c = mk(N, N),
      g = c.getContext('2d'),
      m = N / 2;
    g.fillStyle = '#FBF1DF';
    g.fillRect(0, 0, N, N);
    const cols = [C.clay, C.kraft, C.olive, C.mist, '#FBF1DF'];
    for (let s = 0; s < 12; s++) {
      const a0 = (s / 12) * Math.PI * 2;
      g.fillStyle = cols[s % 4];
      g.beginPath();
      g.moveTo(m, m);
      g.arc(m, m, 500, a0, a0 + Math.PI / 12);
      g.closePath();
      g.fill();
    }
    for (const [r, k] of [
      [330, 4],
      [250, 2],
      [170, 0],
      [90, 4],
      [40, 1],
    ]) {
      g.fillStyle = cols[k];
      g.beginPath();
      g.arc(m, m, r, 0, 7);
      g.fill();
    }
    for (let s = 0; s < 6; s++) {
      const a = (s / 6) * Math.PI * 2;
      g.fillStyle = cols[(s + 1) % 4];
      g.beginPath();
      g.arc(m + Math.cos(a) * 250, m + Math.sin(a) * 250, 62, 0, 7);
      g.fill();
    }
    // the rose's tracery: spokes and two rings of wood
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = '#000';
    g.lineWidth = 18;
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(m + Math.cos(a) * 95, m + Math.sin(a) * 95);
      g.lineTo(m + Math.cos(a) * 505, m + Math.sin(a) * 505);
      g.stroke();
    }
    for (const r of [95, 335, 505]) {
      g.beginPath();
      g.arc(m, m, r, 0, 7);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    return tex(c);
  }

  const softTex = (rgb, a0) =>
    textTex(256, 256, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, `rgba(${rgb},${a0})`);
      r.addColorStop(0.55, `rgba(${rgb},${a0 * 0.45})`);
      r.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    });
  const GLOW = softTex('255,227,184', 1),
    BLOB = softTex('110,92,70', 1);
  const boxUV = (g) => g;
  // a pointed arch outline from (-w/2,0) up over the apex to (w/2,0): two circular arcs meeting at the apex
  function archPts(w, h, n = 14) {
    const W = w / 2,
      r = Math.min(h, W * 1.55),
      s = h - r,
      c = (r * r - W * W) / (2 * W),
      R = c + W,
      pts = [new V2(-W, 0)];
    if (s > 0.001) pts.push(new V2(-W, s));
    const a1 = Math.atan2(r, -c);
    for (let i = 1; i <= n; i++) {
      const t = Math.PI + ((a1 - Math.PI) * i) / n;
      pts.push(new V2(c + R * Math.cos(t), s + R * Math.sin(t)));
    }
    for (let i = pts.length - 2; i >= 0; i--) pts.push(new V2(-pts[i].x, pts[i].y));
    return pts;
  }
  // a solid arch band (for ribs, tunnels, niche frames): outer arch, then the inner arch walked back
  function bandShape(w, h, t) {
    const o = archPts(w + 2 * t, h + t),
      i = archPts(w, h).reverse();
    return new THREE.Shape(o.concat(i));
  }
  // a wall panel in its own plane: x along, y up, thickness centred on z; inner face is -z
  function panelGeo(W, H, t, door, wins = [], circles = []) {
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2, 0);
    if (door) for (const q of archPts(door.w, door.h)) sh.lineTo(q.x + (door.x || 0), q.y);
    sh.lineTo(W / 2, 0);
    sh.lineTo(W / 2, H);
    sh.lineTo(-W / 2, H);
    for (const w of wins) sh.holes.push(new THREE.Path(archPts(w.w, w.h).map((q) => new V2(q.x + w.x, q.y + w.y))));
    for (const c of circles) {
      const p = new THREE.Path();
      p.absarc(c.x, c.y, c.r, 0, Math.PI * 2, true);
      sh.holes.push(p);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 20 });
    g.translate(0, 0, -t / 2);
    return boxUV(g);
  }
  const world = new THREE.Group();
  scene.add(world);
  const noLine = []; // things the ink pass leaves alone (text, light)
  const mesh = (geo, mat, parent = world, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.1) =>
    new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01));
  const cyl = (r0, r1, h, n = 32) => new THREE.CylinderGeometry(r0, r1, h, n);
  const extrude = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 });
  // one rule for everything lying on something else: pull it toward the eye by a fixed fraction of its distance.
  // (with a logarithmic depth buffer, polygon offset does nothing, so the bias goes into the written depth itself)
  const biasDepth = (m, k) => {
    const prev = m.onBeforeCompile,
      key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh, r) => {
      prev && prev.call(m, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <logdepthbuf_fragment>',
        `#include <logdepthbuf_fragment>\n  gl_FragDepth -= ${(k * 2e-5).toFixed(6)};`,
      );
    };
    m.customProgramCacheKey = () => key() + '|bias' + k;
    m.userData.bias = k;
    return m;
  };
  const DEC = new Map();
  const decal = (m, k) => {
    const key = m.uuid + k;
    if (!DEC.has(key)) DEC.set(key, biasDepth(m.clone(), k));
    return DEC.get(key);
  };
  const soft = (parent, tex, w, h, x, y, z, rx, ry, opacity, additive) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      flat('#fff', {
        map: tex,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    biasDepth(m.material, 8);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.renderOrder = 2;
    parent.add(m);
    noLine.push(m);
    return m;
  };
  const glassList = [];
  // glass lit from behind: brighter than white, hotter in the middle, and much hotter when seen straight on
  // resting brightness falls with the window's size (a big rose glows softly); seen straight on, any window flares
  const glassBase = (size) => Math.max(0.95, Math.min(1.45, 1.75 - 0.12 * size));
  const glassFlare = (size) => Math.max(0.3, Math.min(1, 1.25 - 0.12 * size));
  const glassMat = (map, size = 3) =>
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: map },
        warm: { value: new THREE.Color(C.apricot) },
        base: { value: glassBase(size) },
        flare: { value: glassFlare(size) },
      },
      vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv; varying vec3 vW, vN; void main(){ vUv = uv; vW = (modelMatrix*vec4(position,1.)).xyz; vN = normalize(mat3(modelMatrix)*vec3(0.,0.,1.)); gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.);\n#include <logdepthbuf_vertex>\n}`,
      fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform sampler2D map; uniform vec3 warm; uniform float base, flare; varying vec2 vUv; varying vec3 vW, vN; void main(){\n#include <logdepthbuf_fragment>\n float f = abs(dot(normalize(cameraPosition-vW), vN)); vec4 tx = texture2D(map, vUv); vec3 c = tx.rgb;
      c = mix(mix(c, vec3(1.), .3), warm, .2) * (base + 2.8*flare*pow(f, 4.)) + warm * pow(f, 8.) * smoothstep(.75, .1, length(vUv-vec2(.5,.45))) * 1.6 * flare;
      // the frame (where the texture is clear): dark wood, a little lit, never fully burnt out by the glare
      c = mix(c, vec3(.26, .19, .13) * (.6 + .4 * base), (1. - tx.a) * .9); gl_FragColor = vec4(c, 1.); }`,
    });
  const glares = [];
  const glare = (parent, x, y, z, size) => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: GLOW,
        color: new THREE.Color(1.6, 1.3, 0.9),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    s.scale.setScalar(size);
    s.position.set(x, y, z);
    s.renderOrder = 7;
    parent.add(s);
    noLine.push(s);
    glares.push(s);
    return s;
  };
  function glassIn(panel, w, cols, seed, focal) {
    const pts = archPts(w.w, w.h),
      g = new THREE.ShapeGeometry(new THREE.Shape(pts), 20),
      uv = g.attributes.uv,
      p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w.w / 2) / w.w, p.getY(i) / w.h);
    const m = new THREE.Mesh(g, glassMat(glassTex(seed, cols), Math.max(w.w, w.h)));
    m.position.set(w.x, w.y, 0);
    m.userData.outline = pts;
    m.userData.focal = focal;
    panel.add(m);
    glassList.push(m);
    // the window glows on the wall around it, on the inside only
    soft(
      panel,
      GLOW,
      w.w * 2.6,
      w.h * 1.7,
      w.x,
      w.y + w.h * 0.5,
      -T / 2 - 0.03,
      0,
      Math.PI,
      0.55 * glassFlare(Math.max(w.w, w.h)) + 0.2,
      true,
    );
    m.userData.size = Math.max(w.w, w.h);
    m.userData.glare = glare(panel, w.x, w.y + w.h * 0.5, -T / 2 - 0.35, Math.max(w.w, w.h) * 1.6);
    return m;
  }
  // a relief where a window would only look into another room: a raised arch (or ring) with a flat flower of colour inside
  function relief(parent, w, cols, z, ry = 0) {
    const g = new THREE.Group();
    g.position.set(w.x, w.y, z);
    g.rotation.y = ry;
    parent.add(g);
    const lay = (shape, mat, d, zz) => {
      const m = mesh(extrude(shape, d), mat, g, false);
      m.position.z = zz;
      return m;
    };
    const circ = (r, x = 0, y = 0) => {
      const s = new THREE.Shape();
      s.absarc(x, y, r, 0, Math.PI * 2, false);
      return s;
    };
    if (w.r) {
      lay(circ(w.r + 0.25), MAT.oat, 0.08, 0);
      lay(circ(w.r - 0.05), MAT.ivory, 0.04, 0.08);
    } else {
      lay(new THREE.Shape(archPts(w.w + 0.5, w.h + 0.3)), MAT.oat, 0.08, 0).position.y = -0.15;
      const inner = new THREE.Shape(archPts(w.w - 0.1, w.h - 0.2));
      lay(inner, MAT.ivory, 0.04, 0.08).position.y = 0.1;
    }
    const cy = w.r ? 0 : w.h * 0.52,
      R = Math.min(w.r || w.w / 2, w.h ? w.h / 3 : 9) * 0.78,
      mats = cols.map((k) => MAT[k]);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      lay(
        circ(R * 0.21, Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62),
        mats[k % 2],
        0.03,
        0.12 + (k % 2) * 0.012,
      );
    } // petals never touch, and alternate in depth
    lay(circ(R * 0.34, 0, cy), MAT.ivory, 0.03, 0.12);
    lay(circ(R * 0.18, 0, cy), mats[2 % mats.length], 0.03, 0.15);
    if (!w.r) for (const s of [-1, 1]) lay(circ(0.16, s * (w.w / 2 - 0.35), 0.55), mats[1], 0.03, 0.12);
    return g;
  }
  const label = (parent, texture, w, h, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      flat('#fff', { map: texture, transparent: true, depthWrite: false }),
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    parent.add(m);
    noLine.push(m);
    return m;
  };

  /* ---------- the plan: a Latin cross of closed rooms joined by doorways ---------- */
  const T = 0.9;
  const NAVE = { w: 12, z0: 0, z1: -49, h: 14, bay: 6 };
  const CROSS = { c: new V3(0, 0, NAVE.z1 - T - 14), r: 14, h: 15 };
  const LISTS = { c: new V3(-(14 + T + 3 + T + 7), 0, CROSS.c.z), r: 7, h: 11 };
  const SETS = { c: new V3(14 + T + 3 + T + 7, 0, CROSS.c.z), r: 7, h: 11 };
  const SANCT = { c: new V3(0, 0, CROSS.c.z - (14 + T + 3 + T + 8)), r: 8, h: 13 };
  const DOOR = { w: 5, h: 8 };
  {
    const f = mesh(new THREE.PlaneGeometry(90, 120), MAT.floor, world, false);
    f.rotation.x = -Math.PI / 2;
    f.position.set(0, 0, -55);
  }

  // the nave: two plain walls with high windows, a vault, the albums in one even row
  const albumSlots = [];
  {
    const L = -NAVE.z1,
      zc = NAVE.z1 / 2;
    for (const side of [-1, 1]) {
      const wins = [],
        ry = (side * Math.PI) / 2;
      for (let b = 0; b < 8; b++) {
        const z = -0.5 - NAVE.bay / 2 - b * NAVE.bay;
        wins.push({ x: side > 0 ? -(z - zc) : z - zc, y: 8.6, w: 2.4, h: 4.8, z });
      }
      const wall = mesh(panelGeo(L + 2 * T, NAVE.h, T, null, wins), MAT.paper);
      wall.position.set(side * (NAVE.w / 2 + T / 2), 0, zc);
      wall.rotation.y = ry;
      wins.forEach((w, k) => glassIn(wall, w, [C.clay, C.kraft, C.apricot, C.mist], k * 3 + side));
      for (let b = 0; b < 8; b++)
        albumSlots.push({ x: side * (NAVE.w / 2 - 0.02), z: -0.5 - NAVE.bay / 2 - b * NAVE.bay, ry: -ry, side });
    }
    for (const side of [-1, 1])
      for (const [dep, y0, hh, m] of [
        [0.26, 13.48, 0.28, MAT.oat],
        [0.48, 13.76, 0.22, MAT.ivory],
      ]) {
        const b = mesh(new THREE.BoxGeometry(dep + 0.1, hh, L - 0.02), m, world, false);
        b.position.set(side * (NAVE.w / 2 - dep / 2 + 0.05), y0 + hh / 2, zc);
      } // the same cornice along the nave
    {
      const v = mesh(extrude(bandShape(NAVE.w, 7, 0.5), L + 1), MAT.vault);
      v.position.set(0, NAVE.h, NAVE.z1 - 0.5);
      v.receiveShadow = false;
    }
    const west = mesh(panelGeo(NAVE.w + 2 * T + 0.4, NAVE.h + 8, T, null, [], [{ x: 0, y: 15.2, r: 3.1 }]), MAT.paper);
    west.position.set(0, 0, T / 2);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(3.1, 64), glassMat(roseTex(), 7.5));
    rose.position.set(0, 15.2, 0);
    west.add(rose);
    rose.userData.size = 7.5;
    glassList.push(rose);
    rose.userData.noBeam = true;
    rose.castShadow = true;
    /* (no sun through it: a sliver of it slipped past the vault onto the side wall as a thin streak) */ rose.material.uniforms.base.value = 0.74;
    rose.material.uniforms.flare.value = 0.12; // the rose is read for its pattern: it glows, it never burns
    soft(west, GLOW, 9, 9, 0, 15.2, -T / 2 - 0.03, 0, Math.PI, 0.18, true);
    mesh(extrude(new THREE.Shape(archPts(4.4, 7)), 0.08), MAT.oat).position.set(0, 0, -0.04);
    const east = mesh(panelGeo(NAVE.w + 2 * T + 0.4, NAVE.h + 8, T, { w: 6, h: 10.5 }, [], []), MAT.paper);
    east.position.set(0, 0, NAVE.z1 - T / 2);
    east.rotation.y = Math.PI;
    relief(east, { x: 0, y: 13, r: 1.3 }, ['olive', 'kraft', 'clay'], T / 2);
    relief(east, { x: 0, y: 13, r: 1.3 }, ['mist', 'kraft', 'clay'], -T / 2, Math.PI);
  }

  // an octagonal room: eight plain panels and a faceted dome with an oculus; nothing else is architecture
  const VEST_DIRS = [
    ['settings', new V3(1, 0, 0)],
    ['lists', new V3(-1, 0, 0)],
    ['altar', new V3(0, 0, -1)],
  ];
  const DIRS = Array.from({ length: 8 }, (_, i) => new V3(Math.sin((i * Math.PI) / 4), 0, Math.cos((i * Math.PI) / 4)));
  const domes = [];
  function octRoom(R, o) {
    const g = new THREE.Group();
    g.position.copy(R.c);
    world.add(g);
    const r = R.r,
      h = R.h,
      side = 2 * (r + T) * Math.tan(Math.PI / 8) + 0.05,
      panels = [];
    for (let i = 0; i < 8; i++) {
      if (o.skip?.includes(i)) {
        panels.push(null);
        continue;
      }
      const door = o.doors?.includes(i) ? DOOR : null,
        all = o.wins?.[i] || [],
        wins = all.filter((w) => !w.deco);
      const p = mesh(panelGeo(side, h, T, door, wins), MAT.paper, g);
      p.position.copy(DIRS[i]).multiplyScalar(r + T / 2);
      p.rotation.y = (i * Math.PI) / 4;
      panels.push(p);
      wins.forEach((w, k) => glassIn(p, w, o.glass, i * 5 + k + r, o.focal));
      all.filter((w) => w.deco).forEach((w) => relief(p, w, ['olive', 'kraft', 'clay'], -T / 2, Math.PI));
    }
    const rc = r / Math.cos(Math.PI / 8);
    const th0 = Math.asin(o.oculus / rc),
      dome = mesh(
        new THREE.SphereGeometry(rc, 8, 18, Math.PI / 8 + Math.PI / 2, Math.PI * 2, th0, Math.PI / 2 - th0),
        MAT.dome,
        g,
      );
    dome.position.y = h - 0.05;
    dome.receiveShadow = false; // no self-shadow ripples: the dome is lit by its own wash
    const top = h + rc * Math.cos(th0);
    const sky = new THREE.Mesh(
      new THREE.CircleGeometry(o.oculus + 0.4, 40),
      flat('#FFF6E6', { side: THREE.DoubleSide }),
    );
    sky.rotation.x = Math.PI / 2;
    sky.position.y = top + 1.2;
    g.add(sky);
    noLine.push(sky);
    cornice(g, r, h);
    domes.push({ c: R.c, r: o.oculus, y: top, focal: o.focal, sky, g });
    return { g, panels, top };
  }
  // a stepped cornice where the walls meet the dome: an octagonal ring in two tiers, one piece so no faces are shared
  function octRing(apIn, apOut, y, hgt, mat, g) {
    const ring = (ap) =>
      Array.from({ length: 8 }, (_, j) => {
        const a = Math.PI / 8 + (j * Math.PI) / 4,
          R = ap / Math.cos(Math.PI / 8);
        return new V2(Math.sin(a) * R, -Math.cos(a) * R);
      });
    const sh = new THREE.Shape(ring(apOut));
    sh.holes.push(new THREE.Path(ring(apIn).reverse()));
    const m = mesh(new THREE.ExtrudeGeometry(sh, { depth: hgt, bevelEnabled: false }), mat, g, false);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return m;
  }
  const cornice = (g, r, h) => {
    octRing(r - 0.26, r + 0.12, h - 0.78, 0.42, MAT.oat, g);
    octRing(r - 0.5, r + 0.12, h - 0.36, 0.34, MAT.ivory, g);
  };
  function vestibule(from, dir, len) {
    const v = mesh(extrude(bandShape(DOOR.w, DOOR.h, 0.5), len), MAT.tunnel);
    v.receiveShadow = false;
    v.position.copy(from);
    v.rotation.y = Math.atan2(dir.x, dir.z);
    return v;
  }
  const tall = (x) => ({ x, y: 7.2, w: 2.2, h: 5.6 });
  const over = { x: 0, y: 9.4, w: 2.2, h: 3.8, deco: true }; // above a doorway there is only the next room: an ornament, not glass
  const crossing = octRoom(CROSS, {
    skip: [0],
    doors: [2, 4, 6],
    wins: { 1: [tall(0)], 2: [over], 3: [tall(0)], 4: [over], 5: [tall(0)], 6: [over], 7: [tall(0)] },
    oculus: 3.2,
    glass: [C.olive, C.kraft, C.apricot, C.clay],
    focal: new V3(CROSS.c.x, 0, CROSS.c.z),
  });
  const lists = octRoom(LISTS, {
    doors: [2],
    wins: Object.fromEntries([0, 1, 3, 4, 5, 7].map((i) => [i, [{ x: 0, y: 6.8, w: 1.6, h: 3.2 }]])),
    oculus: 2,
    glass: [C.mist, C.apricot, C.olive],
    focal: new V3(LISTS.c.x + 0.1, 0, LISTS.c.z + 0.6),
  });
  const sets = octRoom(SETS, {
    doors: [6],
    wins: Object.fromEntries([0, 1, 2, 3, 4, 5, 7].map((i) => [i, [{ x: 0, y: 6.6, w: 1.6, h: 3.2 }]])),
    oculus: 2,
    glass: [C.kraft, C.apricot, C.clay],
    focal: new V3(SETS.c.x + 0.6, 0, SETS.c.z),
  });
  const sanct = octRoom(SANCT, {
    doors: [0],
    wins: Object.fromEntries([1, 2, 3, 5, 6, 7].map((i) => [i, [{ x: 0, y: 5.8, w: 1.5, h: 6 }]])),
    oculus: 1.9,
    glass: [C.clay, C.kraft, C.apricot, C.mist],
    focal: new V3(SANCT.c.x, 0, SANCT.c.z - 5.4),
  });
  // every oculus is a clear-sky panel: a soft blue disc that washes the vault around it a cool white
  for (const d of domes) {
    const skyTex = textTex(256, 256, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, '#5AA2EA');
      r.addColorStop(0.65, '#82BCF2');
      r.addColorStop(1, '#B9DCF8');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    });
    d.sky.material = flat('#fff', { map: skyTex, side: THREE.DoubleSide });
    d.sky.material.color.setRGB(1.05, 1.05, 1.08);
    d.blue = true;
    d.g.children
      .filter((m) => m.material === MAT.dome)
      .forEach((m) => {
        m.material = skyBaked('#D2C2A6', '#D7E6F0', d.y - 12, d.y, {
          side: THREE.BackSide,
          shadowSide: THREE.DoubleSide,
        });
      }); // the sky panel lights the vault around it a cool white
  }
  for (const [R, d] of [
    [SETS, new V3(1, 0, 0)],
    [LISTS, new V3(-1, 0, 0)],
    [SANCT, new V3(0, 0, -1)],
  ])
    vestibule(CROSS.c.clone().addScaledVector(d, CROSS.r + T), d, 3);

  /* ---------- branches: ink stems, flat leaves and berries (now in vases, and two hanging in the sanctuary) ---------- */
  const leafShape = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.2, 0.15, 0.42, 0);
    s.quadraticCurveTo(0.2, -0.15, 0, 0);
    return s;
  })();
  const leafGeo = new THREE.ShapeGeometry(leafShape, 8),
    berryGeo = new THREE.CircleGeometry(0.07, 16);
  const leafMats = [
    toon(C.olive, { side: THREE.DoubleSide }),
    toon(C.kraft, { side: THREE.DoubleSide }),
    toon(C.clay, { side: THREE.DoubleSide }),
    toon('#AEB98E', { side: THREE.DoubleSide }),
  ];
  const branches = [];
  function branch(seed, len, density = 2.2) {
    const g = new THREE.Group(),
      pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new V3(-len / 2 + t * len, (Math.sin(t * 3.2 + seed) * 0.25 * len) / 4, 0));
    }
    const stem = new THREE.CatmullRomCurve3(pts);
    mesh(new THREE.TubeGeometry(stem, 48, 0.026, 6), MAT.ink, g);
    const n = Math.round(len * density);
    for (let k = 0; k < n; k++) {
      const t = 0.1 + (0.88 * k) / n,
        p = stem.getPointAt(t),
        up = k % 2 ? 1 : -1,
        ang = up * (0.5 + rnd(seed * 9 + k) * 0.7);
      if (rnd(seed + k * 3.3) < 0.25) {
        const tip = p.clone().add(new V3(Math.cos(ang) * 0.4, Math.sin(ang) * 0.4, 0));
        mesh(new THREE.TubeGeometry(new THREE.LineCurve3(p.clone(), tip), 2, 0.015, 5), MAT.ink, g);
        for (let b = 0; b < 3; b++) {
          const be = mesh(berryGeo, MAT.clay, g);
          be.position.copy(tip).add(new V3((b - 1) * 0.1, (b % 2) * 0.1, 0.01));
        }
      } else {
        const lf = mesh(leafGeo, leafMats[Math.floor(rnd(seed * 4 + k) * leafMats.length)], g);
        lf.position.copy(p);
        lf.rotation.z = ang;
        lf.scale.setScalar(0.75 + rnd(seed + k) * 0.6);
      }
    }
    g.traverse((o) => {
      if (o.isMesh) o.userData.thin = true;
    }); // twigs and leaves are not somewhere to land
    branches.push({ g, seed });
    return g;
  }

  /* ---------- furniture and ornaments: rounded geometry, the same flat colour and ink ---------- */
  const sofas = [];
  const blob = (x, z, w, d) => {
    soft(world, BLOB, w, d, x, 0.012, z, -Math.PI / 2, 0, 0.3, false);
    soft(world, BLOB, w * 0.55, d * 0.55, x, 0.012, z, -Math.PI / 2, 0, 0.35, false);
  }; // two layers: a wide soft shade and a tighter contact
  const furniture = [];
  const put = (g, x, z, ry = 0) => {
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    world.add(g);
    furniture.push(g);
    return g;
  };
  // a sofa faces +z in its own frame; `look` is the yaw a seated visitor should face
  function sofa(len, mat, x, z, ry) {
    const g = new THREE.Group();
    mesh(rbox(len, 0.44, 0.95, 0.14), mat, g).position.set(0, 0.22, 0);
    mesh(rbox(len, 0.5, 0.26, 0.12), mat, g).position.set(0, 0.62, -0.36);
    for (const s of [-1, 1]) mesh(rbox(0.24, 0.58, 0.95, 0.1), mat, g).position.set(s * (len / 2 - 0.12), 0.3, 0);
    for (let k = 0; k < Math.round(len / 0.8); k++) {
      const c = mesh(rbox(len / Math.round(len / 0.8) - 0.06, 0.12, 0.7, 0.05), MAT.ivory, g);
      c.position.set(-len / 2 + ((k + 0.5) * len) / Math.round(len / 0.8), 0.5, 0.08);
    }
    put(g, x, z, ry);
    blob(x, z, len + 1, 1.8);
    g.traverse((o) => {
      if (o.isMesh) {
        o.userData = { kind: 'sofa', i: sofas.length };
      }
    });
    sofas.push({
      g,
      seat: new V3(x, 1.15, z).add(new V3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.1)),
      yaw: ry + Math.PI,
    });
    return g;
  }
  function armchair(mat, x, z, ry) {
    const g = new THREE.Group();
    mesh(rbox(1, 0.44, 0.9, 0.14), mat, g).position.y = 0.22;
    const back = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.62, 24, 1, true, Math.PI * 0.65, Math.PI * 0.7), mat, g);
    back.position.set(0, 0.62, 0.1);
    back.material = mat.clone();
    back.material.side = THREE.DoubleSide;
    mesh(rbox(0.86, 0.12, 0.66, 0.05), MAT.ivory, g).position.set(0, 0.5, 0.1);
    put(g, x, z, ry);
    blob(x, z, 1.6, 1.5);
    g.traverse((o) => {
      if (o.isMesh) o.userData = { kind: 'sofa', i: sofas.length };
    });
    sofas.push({ g, seat: new V3(x, 1.15, z), yaw: ry + Math.PI });
    return g;
  }
  function ringSofa(x, z, r) {
    const g = new THREE.Group();
    const t = mesh(new THREE.TorusGeometry(r, 0.5, 16, 72), MAT.olive, g);
    t.rotation.x = Math.PI / 2;
    t.scale.set(1, 1, 0.55);
    t.position.y = 0.3;
    const c = mesh(new THREE.TorusGeometry(r, 0.34, 12, 72), MAT.ivory, g);
    c.rotation.x = Math.PI / 2;
    c.scale.set(1, 1, 0.4);
    c.position.y = 0.52;
    put(g, x, z);
    g.traverse((o) => {
      if (o.isMesh) o.userData = { kind: 'sofa', i: sofas.length, ring: true };
    });
    sofas.push({ g, ring: { x, z, r }, seat: new V3(x, 1.15, z + r), yaw: 0 });
    return g;
  }
  function table(x, z) {
    const g = new THREE.Group();
    mesh(cyl(0.42, 0.42, 0.05), MAT.ivory, g).position.y = 0.58;
    mesh(cyl(0.025, 0.025, 0.56, 8), MAT.ink, g).position.y = 0.29;
    mesh(cyl(0.2, 0.22, 0.03), MAT.ink, g).position.y = 0.015;
    put(g, x, z);
    blob(x, z, 1.2, 1.2);
    return g;
  }
  const VASES = [
    [
      [0, 0],
      [0.18, 0.02],
      [0.24, 0.2],
      [0.2, 0.5],
      [0.08, 0.7],
      [0.07, 0.95],
      [0.11, 1.0],
    ],
    [
      [0, 0],
      [0.16, 0.02],
      [0.34, 0.25],
      [0.36, 0.42],
      [0.22, 0.62],
      [0.14, 0.7],
      [0.16, 0.74],
    ],
    [
      [0, 0],
      [0.22, 0.02],
      [0.4, 0.16],
      [0.46, 0.3],
      [0.44, 0.34],
    ],
  ];
  function vase(kind, mat, x, z, y = 0, stems = 3, s = 1) {
    const g = new THREE.Group(),
      prof = VASES[kind];
    mesh(
      new THREE.LatheGeometry(
        prof.map(([a, b]) => new V2(a * s, b * s)),
        40,
      ),
      mat,
      g,
    ).material = mat.clone();
    g.children[0].material.side = THREE.DoubleSide;
    const top = prof.at(-1)[1] * s;
    for (let k = 0; k < stems; k++) {
      const len = 1.4 + rnd(x + k) * 1.1,
        b = branch(x * 3 + z + k * 7, len, 2.6),
        hold = new THREE.Group();
      b.position.x = len / 2;
      hold.add(b); // the stem starts inside the neck
      hold.rotation.set(0, k * 1.9, Math.PI / 2 - (k - (stems - 1) / 2) * 0.22);
      hold.position.y = top - 0.12 * s;
      hold.scale.setScalar(0.9);
      g.add(hold);
    }
    g.position.y = y;
    put(g, x, z);
    if (!y) blob(x, z, 0.9 * s + 0.3, 0.9 * s + 0.3);
    g.position.y = y;
    return g;
  }
  function rugRound(x, z, rings) {
    const g = new THREE.Group();
    rings.forEach(([r, m], k) => {
      const d = mesh(new THREE.CircleGeometry(r, 64), decal(m, k + 1), g, false);
      d.rotation.x = -Math.PI / 2;
      d.position.y = 0.003;
    });
    put(g, x, z);
    return g;
  }
  function rugRect(x, z, w, d, base, edge, ry = 0) {
    const g = new THREE.Group();
    const rr = (W, D) => {
      const s = new THREE.Shape(),
        r = Math.min(0.5, W / 4, D / 4);
      s.moveTo(-W / 2 + r, -D / 2);
      s.lineTo(W / 2 - r, -D / 2);
      s.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r);
      s.lineTo(W / 2, D / 2 - r);
      s.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2);
      s.lineTo(-W / 2 + r, D / 2);
      s.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r);
      s.lineTo(-W / 2, -D / 2 + r);
      s.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2);
      return new THREE.ShapeGeometry(s, 6);
    };
    const a = mesh(rr(w, d), decal(edge, 1), g, false);
    a.rotation.x = -Math.PI / 2;
    a.position.y = 0.003;
    const b = mesh(rr(w - 0.5, d - 0.5), decal(base, 2), g, false);
    b.rotation.x = -Math.PI / 2;
    b.position.y = 0.003;
    put(g, x, z, ry);
    return g;
  }
  // ornaments for their own sake
  const ORN = {
    sphereCube: (m1, m2) => {
      const g = new THREE.Group();
      mesh(rbox(0.8, 0.8, 0.8, 0.04), m1, g).position.y = 0.4;
      mesh(new THREE.SphereGeometry(0.42, 32, 16), m2, g).position.y = 1.22;
      return g;
    },
    halfArch: (m1) => {
      const g = new THREE.Group();
      const a = mesh(extrude(new THREE.Shape(archPts(1.3, 2.1)), 0.24), m1, g);
      a.position.z = -0.12;
      return g;
    },
    discs: (m1, m2) => {
      const g = new THREE.Group();
      [
        [0.6, m1],
        [0.45, m2],
        [0.3, m1],
      ].forEach(([r, m], k) => (mesh(cyl(r, r, 0.22), m, g).position.y = 0.11 + k * 0.24));
      return g;
    },
    cone: (m1) => {
      const g = new THREE.Group();
      mesh(cyl(0, 0.55, 1.6), m1, g).position.y = 0.8;
      return g;
    },
    ring: (m1) => {
      const g = new THREE.Group();
      mesh(new THREE.TorusGeometry(0.62, 0.12, 16, 48), m1, g).position.y = 0.8;
      mesh(rbox(0.5, 0.18, 0.3, 0.04), MAT.ink, g).position.y = 0.09;
      return g;
    },
    quarter: (m1) => {
      const g = new THREE.Group();
      const q = mesh(new THREE.CylinderGeometry(1, 1, 0.3, 32, 1, false, 0, Math.PI / 2), m1, g);
      q.rotation.x = Math.PI / 2;
      q.position.set(-0.5, 0, 0);
      return g;
    },
  };
  const ornament = (kind, x, z, ry, ...m) => {
    const g = ORN[kind](...m);
    put(g, x, z, ry);
    blob(x, z, 1.6, 1.6);
    return g;
  };

  // nave: one runner, two pairs of sofas back to back facing the walls, vases beside them, ornaments at both ends
  rugRect(0, -25, 4.2, 32, MAT.kraft, MAT.clay);
  for (let k = 0; k < 8; k++) {
    const h = mesh(new THREE.CircleGeometry(0.55, 32, 0, Math.PI), decal(MAT.ivory, 3), world, false);
    h.rotation.set(-Math.PI / 2, 0, k < 4 ? 0 : Math.PI);
    h.position.set(-1.35 + (k % 4) * 0.9, 0.003, k < 4 ? -9.6 : -40.4);
  }
  for (const z of [-17, -33]) {
    sofa(3, MAT.clay, -0.62, z, -Math.PI / 2);
    sofa(3, MAT.olive, 0.62, z, Math.PI / 2);
  }
  vase(0, MAT.ivory, -1.6, -21.5, 0, 3);
  vase(1, MAT.kraft, 1.6, -28.5, 0, 2);
  vase(2, MAT.clay, 0, -25, 0, 3, 0.8);
  ornament('sphereCube', -3.4, -4.5, 0.3, MAT.kraft, MAT.clay);
  ornament('halfArch', 3.5, -5, -0.5, MAT.mist);
  ornament('cone', -3.6, -45.5, 0, MAT.olive);
  ornament('discs', 3.6, -45, 0, MAT.clay, MAT.ivory);
  // crossing: a round rug and a ring sofa at the centre, ornaments between the four aisles
  rugRound(CROSS.c.x, CROSS.c.z, [
    [3.6, MAT.olive],
    [3.0, MAT.oat],
    [2.2, MAT.kraft],
  ]);
  ringSofa(CROSS.c.x, CROSS.c.z, 2.45);
  for (const [a, m] of [
    [Math.PI / 4, MAT.clay],
    [(Math.PI * 5) / 4, MAT.mist],
  ]) {
    const dx = -Math.sin(a),
      dz = -Math.cos(a);
    sofa(2.6, m, CROSS.c.x + dx * 5.6, CROSS.c.z + dz * 5.6, Math.atan2(dx, dz));
  }
  table(CROSS.c.x - Math.sin((Math.PI * 3) / 4) * 5.4, CROSS.c.z - Math.cos((Math.PI * 3) / 4) * 5.4);
  vase(
    1,
    MAT.ivory,
    CROSS.c.x - Math.sin((Math.PI * 3) / 4) * 5.4,
    CROSS.c.z - Math.cos((Math.PI * 3) / 4) * 5.4,
    0.6,
    2,
    0.55,
  );
  const ripples = [0, 1, 2].map((k) => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 96),
      flat(C.ivory, { transparent: true, opacity: 0, depthWrite: false }),
    );
    biasDepth(m.material, 9);
    m.rotation.x = -Math.PI / 2;
    m.position.set(CROSS.c.x, 0.004, CROSS.c.z);
    m.renderOrder = 2;
    world.add(m);
    noLine.push(m);
    return m;
  });
  // the beat rings: the light under the dome sends a ring across the floor on every event of the rhythm, as the effect
  // lyrics' beat rings do (the same events, weights and travel: bigger on downbeats, warmer and wider on strong accents)
  const RINGS = Array.from({ length: 8 }, () => new THREE.Vector4());
  const beatFloor = (() => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          R: { value: RINGS },
          n: { value: 0 },
          col: { value: new THREE.Color(C.clay) },
          hot: { value: new THREE.Color(C.apricot) },
          glow: { value: 0 },
        },
        vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.);\n#include <logdepthbuf_vertex>\n}`,
        fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform vec4 R[8]; uniform int n; uniform vec3 col, hot; uniform float glow; varying vec2 vP;
        void main(){\n#include <logdepthbuf_fragment>\n gl_FragDepth -= 1.8e-4; float d = length(vP); vec3 c = vec3(0.); float a = 0.;
          for (int i = 0; i < 8; i++) { if (i >= n) break; vec4 r = R[i]; float x = d - r.x, w = r.y, k = r.z;
            // a wide faint falloff, a tighter glow and a fine core, as the effect lyrics' rings are drawn
            float v = .16*exp(-x*x/(w*w*30.)) + .34*exp(-x*x/(w*w*4.)) + .75*exp(-x*x/(w*w*.35)); vec3 cc = mix(col, hot, r.w*.6); c += cc*v*k; a += v*k; }
          // the light's own swell on a strong beat
          a += glow * .5 * exp(-d*d/5.); c += mix(col, hot, .7) * glow * .5 * exp(-d*d/5.);
          a = clamp(a, 0., .9); gl_FragColor = vec4(c / max(a, .001), a); }`,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(CROSS.c.x, 0.006, CROSS.c.z);
    m.renderOrder = 2;
    world.add(m);
    noLine.push(m);
    return m;
  })();
  const lightPools = [];
  const pool = (f, r) => {
    const a = soft(world, GLOW, r * 2, r * 2, f.x, 0.02, f.z, -Math.PI / 2, 0, 0.55, true),
      b = soft(world, GLOW, r * 4.4, r * 4.4, f.x, 0.02, f.z, -Math.PI / 2, 0, 0.35, true);
    lightPools.push(a, b);
  };
  pool(new V3(CROSS.c.x, 0, CROSS.c.z), 2.1);
  const focusLight = new THREE.PointLight(lin(1, 0.86, 0.62), 9, 9, 1.4);
  focusLight.position.set(CROSS.c.x, 0.9, CROSS.c.z);
  scene.add(focusLight);
  for (let k = 0; k < 9; k++) {
    const a = rnd(k * 3.1) * Math.PI * 2,
      r = 3.5 + rnd(k * 7.7) * 1.4,
      x = CROSS.c.x + Math.cos(a) * r,
      z = CROSS.c.z + Math.sin(a) * r,
      lf = mesh(leafGeo, decal(leafMats[k % leafMats.length], 4), world, false);
    lf.rotation.set(-Math.PI / 2, 0, rnd(k) * 6.3);
    lf.scale.setScalar(0.9 + rnd(k * 2) * 0.6);
    lf.position.set(x, 0.004, z);
    soft(world, BLOB, 0.3, 0.3, x + 0.03, 0.005, z, -Math.PI / 2, 0, 0.22, false);
  }
  {
    const p = mesh(new THREE.PlaneGeometry(0.42, 0.58), decal(MAT.ivory, 5), world, false);
    p.rotation.set(-Math.PI / 2, 0, 0.5);
    p.position.set(CROSS.c.x + 3.3, 0.005, CROSS.c.z + 2.1);
    const q = mesh(new THREE.PlaneGeometry(0.42, 0.58), decal(MAT.ivory, 6), world, false);
    q.rotation.set(-Math.PI / 2, 0, 0.9);
    q.position.set(CROSS.c.x + 3.45, 0.006, CROSS.c.z + 2.25);
    soft(world, BLOB, 1.2, 1.2, CROSS.c.x + 3.4, 0.005, CROSS.c.z + 2.2, -Math.PI / 2, 0, 0.3, false);
  }
  // ornaments flank the two doors on the main axis, just inside the room, out of the song wall's way
  [
    ['ring', MAT.clay, Math.PI - 0.3],
    ['discs', MAT.olive, Math.PI + 0.3, MAT.ivory],
    ['quarter', MAT.mist, -0.3],
    ['sphereCube', MAT.ivory, 0.3, MAT.kraft],
  ].forEach(([k, m1, a, m2]) =>
    ornament(k, CROSS.c.x - Math.sin(a) * 12.2, CROSS.c.z - Math.cos(a) * 12.2, a + Math.PI, m1, m2),
  );
  // north chapel: a reading corner under the light
  rugRound(LISTS.c.x + 0.4, LISTS.c.z, [
    [2.8, MAT.mist],
    [2.2, MAT.oat],
  ]);
  armchair(MAT.mist, LISTS.c.x + 1.2, LISTS.c.z + 1.3, Math.PI * 0.8);
  table(LISTS.c.x + 0.1, LISTS.c.z + 0.6);
  vase(0, MAT.clay, LISTS.c.x + 0.1, LISTS.c.z + 0.6, 0.6, 2, 0.55);
  vase(1, MAT.ivory, LISTS.c.x - 3.6, LISTS.c.z + 3.4, 0, 3);
  ornament('cone', LISTS.c.x - 3.4, LISTS.c.z - 3.6, 0, MAT.kraft);
  // south chapel: a rug inside the arc of plinths
  rugRound(SETS.c.x + 0.6, SETS.c.z, [
    [2.6, MAT.kraft],
    [2.0, MAT.oat],
  ]);
  vase(2, MAT.olive, SETS.c.x - 3.8, SETS.c.z + 3.6, 0, 3, 1.1);
  ornament('halfArch', SETS.c.x - 3.6, SETS.c.z - 3.8, 1.2, MAT.clay);
  // sanctuary: a listening room — a long sofa on a rug facing the clay arch
  rugRect(SANCT.c.x, SANCT.c.z - 0.3, 6.4, 4.6, MAT.clay, MAT.ivory);
  sofa(4, MAT.olive, SANCT.c.x, SANCT.c.z + 0.9, Math.PI);
  table(SANCT.c.x + 2.9, SANCT.c.z + 0.9);
  vase(1, MAT.ivory, SANCT.c.x + 2.9, SANCT.c.z + 0.9, 0.6, 2, 0.55);
  vase(0, MAT.kraft, SANCT.c.x - 4.2, SANCT.c.z - 4.4, 0, 3, 1.2);
  ornament('sphereCube', SANCT.c.x + 4.3, SANCT.c.z - 4.2, -0.6, MAT.mist, MAT.ivory);

  /* ---------- on the walls: sconces that glow (and swell with the beat), hangings, prints and shelves, so no wall is bare ---------- */
  // a point on a room's wall: panel i of an octagonal room (along it, at a height, just off its face), facing into the room
  const onWall = (R, i, along, y, off = 0.05) => {
    const th = (i * Math.PI) / 4,
      n = DIRS[i];
    return {
      x: R.c.x + n.x * (R.r - off) + Math.cos(th) * along,
      y,
      z: R.c.z + n.z * (R.r - off) - Math.sin(th) * along,
      ry: th + Math.PI,
    };
  };
  const atCorner = (R, i, y) => {
    const a = ((i + 0.5) * Math.PI) / 4,
      rc = R.r / Math.cos(Math.PI / 8) - 0.32;
    return { x: R.c.x + Math.sin(a) * rc, y, z: R.c.z + Math.cos(a) * rc, ry: a + Math.PI };
  };
  const hang = (g, w) => {
    g.position.set(w.x, w.y, w.z);
    g.rotation.y = w.ry;
    world.add(g);
    return g;
  };
  const sconces = [];
  const BULB = new THREE.Color(1.7, 1.38, 0.98);
  function sconce(w) {
    const g = hang(new THREE.Group(), w);
    mesh(rbox(0.2, 0.42, 0.05, 0.03), MAT.ivory, g).position.z = 0.025;
    const arm = mesh(cyl(0.016, 0.016, 0.2, 8), MAT.ink, g);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, -0.04, 0.14);
    mesh(cyl(0.1, 0.055, 0.12, 20), MAT.kraft, g).position.set(0, 0.02, 0.24);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), flat(BULB.clone()));
    bulb.position.set(0, 0.1, 0.24);
    g.add(bulb);
    noLine.push(bulb);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: GLOW,
        color: new THREE.Color(1.3, 1.05, 0.78),
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.scale.setScalar(0.9);
    halo.position.copy(bulb.position);
    g.add(halo);
    noLine.push(halo);
    const wash = soft(g, GLOW, 1.5, 2.3, 0, 0.35, 0.012, 0, 0, 0.28, true);
    sconces.push({ bulb, halo, wash, ph: rnd(w.x * 3.1 + w.z) * 6.28 });
    return g;
  }
  // the sconces breathe a little on their own (a flame's slow unevenness), and brighten with each beat
  function sconceTick(now, push, sw) {
    const t = now / 1000;
    for (const s of sconces) {
      const f = 1 + 0.05 * Math.sin(t * 1.7 + s.ph) * Math.sin(t * 2.9 + s.ph * 2) + 0.55 * push + 0.25 * sw;
      s.halo.material.opacity = Math.min(1, 0.5 * f);
      s.wash.material.opacity = Math.min(0.8, 0.26 * f);
      s.bulb.material.color.copy(BULB).multiplyScalar(f);
    }
  }
  // a hanging: a cloth from an ink rod, one colour with a simple flat motif and a fringe
  const clothTex = (base, mark, kind, seed) =>
    textTex(128, 384, (g, w, h) => {
      g.fillStyle = base;
      g.fillRect(0, 0, w, h - 18);
      g.fillStyle = mark;
      if (kind === 0) {
        g.beginPath();
        g.arc(w / 2, h * 0.36, w * 0.3, 0, 7);
        g.fill();
        g.fillRect(w * 0.2, h * 0.66, w * 0.6, 10);
      } else if (kind === 1) {
        g.beginPath();
        g.moveTo(w * 0.2, h * 0.7);
        g.lineTo(w * 0.2, h * 0.32);
        g.arc(w / 2, h * 0.32, w * 0.3, Math.PI, 0);
        g.lineTo(w * 0.8, h * 0.7);
        g.closePath();
        g.fill();
      } else {
        for (let k = 0; k < 4; k++) {
          g.beginPath();
          g.arc(w / 2, h * (0.18 + k * 0.16), w * (0.1 + 0.04 * ((k + seed) % 2)), 0, 7);
          g.fill();
        }
      }
      for (let x = 4; x < w; x += 9) g.fillRect(x, h - 18, 3, 16);
    });
  function hanging(w, cw, chh, base, mark, kind, seed = 0) {
    const g = hang(new THREE.Group(), w);
    const rod = mesh(cyl(0.025, 0.025, cw + 0.3, 8), MAT.ink, g);
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 0, 0.09);
    for (const sx of [-1, 1])
      mesh(new THREE.SphereGeometry(0.045, 12, 8), MAT.ink, g).position.set(sx * (cw / 2 + 0.15), 0, 0.09);
    const c = mesh(
      new THREE.PlaneGeometry(cw, chh),
      toon('#fff', {
        map: clothTex(base, mark, kind, seed),
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.5,
      }),
      g,
    );
    c.position.set(0, -chh / 2 - 0.02, 0.07);
    return g;
  }
  // a framed print: an ink frame, an ivory mount, a small composition of flat shapes
  function print(w, pw, ph, cols, seed) {
    const g = hang(new THREE.Group(), w);
    mesh(box(pw + 0.12, ph + 0.12, 0.05), MAT.ink, g).position.z = 0.025;
    mesh(box(pw + 0.02, ph + 0.02, 0.055), MAT.ivory, g).position.z = 0.03;
    const art = textTex(256, Math.round((256 * ph) / pw), (q, W, H) => {
      q.fillStyle = '#EFE6D6';
      q.fillRect(0, 0, W, H);
      const pick = (k) => cols[Math.floor(rnd(seed * 7 + k) * cols.length)];
      for (let k = 0; k < 4; k++) {
        const kind = Math.floor(rnd(seed * 3 + k * 11) * 3),
          x = W * (0.2 + 0.6 * rnd(seed + k * 5.1)),
          y = H * (0.2 + 0.6 * rnd(seed * 2 + k * 3.7)),
          r = W * (0.12 + 0.16 * rnd(seed + k));
        q.fillStyle = pick(k);
        q.beginPath();
        if (kind === 0) q.arc(x, y, r, 0, 7);
        else if (kind === 1) {
          q.arc(x, y, r, Math.PI, 0);
          q.closePath();
        } else q.rect(x - r / 2, y - r, r, r * 2);
        q.fill();
      }
    });
    const a = mesh(new THREE.PlaneGeometry(pw - 0.16, ph - 0.16), flat('#fff', { map: art }), g, false);
    a.position.z = 0.06;
    return g;
  }
  // a shelf with books and a small pot
  function shelf(w, len, seed) {
    const g = hang(new THREE.Group(), w);
    mesh(rbox(len, 0.06, 0.3, 0.02), MAT.oat, g).position.z = 0.15;
    for (const sx of [-1, 1]) {
      const b = mesh(box(0.04, 0.16, 0.2), MAT.ink, g);
      b.position.set(sx * (len / 2 - 0.2), -0.1, 0.1);
    }
    let x = -len / 2 + 0.12;
    const BK = [MAT.clay, MAT.olive, MAT.mist, MAT.kraft, MAT.ivory, MAT.taupe];
    while (x < len * 0.15) {
      const bw = 0.05 + rnd(seed + x * 9) * 0.05,
        bh = 0.2 + rnd(seed * 2 + x * 7) * 0.14,
        b = mesh(box(bw, bh, 0.2), BK[Math.floor(rnd(seed + x * 13) * BK.length)], g);
      b.position.set(x + bw / 2, 0.03 + bh / 2, 0.14);
      if (rnd(seed + x) < 0.2) b.rotation.z = 0.12;
      x += bw + 0.008;
    }
    const pot = mesh(
      new THREE.LatheGeometry(
        VASES[0].map(([a, b]) => new V2(a * 0.32, b * 0.32)),
        24,
      ),
      MAT.clay,
      g,
    );
    pot.position.set(len * 0.3, 0.03, 0.15);
    pot.material = MAT.clay;
    return g;
  }
  // the nave: a sconce between every two bays, and a hanging between the high windows
  for (const side of [-1, 1])
    for (let b = 1; b < 8; b++) {
      const z = -0.5 - b * NAVE.bay,
        x = side * (NAVE.w / 2 - 0.03),
        ry = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      sconce({ x, y: 3.5, z, ry });
      hanging(
        { x, y: 7.6, z, ry },
        0.8,
        3.2,
        [C.clay, C.olive, C.mist, C.kraft][(b + (side > 0 ? 1 : 0)) % 4],
        C.ivory,
        b % 3,
        b,
      );
    }
  // the crossing: a sconce at every corner, over the wall of songs
  for (let i = 0; i < 8; i++) sconce(atCorner(CROSS, i, 4.9));
  // the chapels: sconces at the corners; prints, hangings and shelves on the free walls
  for (const R of [LISTS, SETS, SANCT]) for (let i = 0; i < 8; i++) sconce(atCorner(R, i, 3.3));
  print(onWall(SANCT, 3, 0, 2.7), 1.3, 1.7, [C.clay, C.olive, C.mist, C.kraft], 3);
  print(onWall(SANCT, 5, 0, 2.7), 1.3, 1.7, [C.mist, C.kraft, C.clay, C.olive], 7);
  shelf(onWall(SANCT, 2, -0.4, 1.5), 1.9, 2);
  shelf(onWall(SANCT, 6, 0.4, 1.5), 1.9, 5);
  shelf(onWall(SANCT, 2, -0.4, 2.35), 1.5, 9);
  print(onWall(SETS, 0, 0, 2.5), 1.5, 1.2, [C.kraft, C.clay, C.olive], 11);
  print(onWall(SETS, 4, 0, 2.5), 1.5, 1.2, [C.olive, C.mist, C.clay], 13);

  /* ---------- baked occlusion: walls meet the floor in a soft shade; small things sit in their own ---------- */
  const AO_EDGE = textTex(64, 128, (g, w, h) => {
    const l = g.createLinearGradient(0, 0, 0, h);
    l.addColorStop(0, 'rgba(96,78,58,.55)');
    l.addColorStop(0.35, 'rgba(96,78,58,.2)');
    l.addColorStop(1, 'rgba(96,78,58,0)');
    g.fillStyle = l;
    g.fillRect(0, 0, w, h);
  });
  const aoStrip = (x, z, len, ry) => {
    const m = soft(world, AO_EDGE, len, 1.1, x, 0.006, z, -Math.PI / 2, 0, 0.8, false);
    m.rotation.set(-Math.PI / 2, 0, ry);
    return m;
  };
  // wall-to-floor shade from the true distance to the nearest wall, one map for the whole floor: corners come out round, never as triangles
  {
    const segs2 = [],
      W = 90,
      H = 120,
      X0 = -45,
      Z0 = 5,
      RES = 0.15,
      nx = Math.round(W / RES),
      nz = Math.round(H / RES);
    const seg = (ax, az, bx, bz) => segs2.push([ax, az, bx, bz]);
    seg(-6, 0, -6, -49);
    seg(6, 0, 6, -49);
    seg(-6, 0, 6, 0);
    seg(-6, -49, -3, -49);
    seg(3, -49, 6, -49);
    for (const [R, doors, gapW] of [
      [CROSS, [2, 4, 6, 0], [5, 5, 5, 6]],
      [LISTS, [2], [5]],
      [SETS, [6], [5]],
      [SANCT, [0], [5]],
    ]) {
      const rc = R.r / Math.cos(Math.PI / 8);
      for (let k = 0; k < 8; k++) {
        const a0 = (k * Math.PI) / 4 - Math.PI / 8,
          a1 = (k * Math.PI) / 4 + Math.PI / 8,
          ax = R.c.x + Math.sin(a0) * rc,
          az = R.c.z + Math.cos(a0) * rc,
          bx = R.c.x + Math.sin(a1) * rc,
          bz = R.c.z + Math.cos(a1) * rc;
        const di = doors.indexOf(k);
        if (di < 0) {
          seg(ax, az, bx, bz);
          continue;
        }
        const L = Math.hypot(bx - ax, bz - az),
          g = gapW[di] / 2 / L;
        seg(ax, az, ax + (bx - ax) * (0.5 - g), az + (bz - az) * (0.5 - g));
        seg(ax + (bx - ax) * (0.5 + g), az + (bz - az) * (0.5 + g), bx, bz);
      }
    }
    for (const [, d] of VEST_DIRS)
      for (const s of [-1, 1]) {
        const lat = new V3(d.z, 0, -d.x).multiplyScalar(2.5 * s),
          a = CROSS.c
            .clone()
            .addScaledVector(d, CROSS.r + T)
            .add(lat),
          b = CROSS.c
            .clone()
            .addScaledVector(d, CROSS.r + T + 3)
            .add(lat);
        seg(a.x, a.z, b.x, b.z);
      }
    const data = new Uint8Array(nx * nz * 4);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = X0 + (i + 0.5) * RES,
          z = Z0 - (j + 0.5) * RES;
        let d = 1e9;
        for (const [ax, az, bx, bz] of segs2) {
          const vx = bx - ax,
            vz = bz - az,
            t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))),
            dx = x - ax - vx * t,
            dz = z - az - vz * t,
            q = dx * dx + dz * dz;
          if (q < d) d = q;
        }
        const v = Math.round(255 * (1 - 0.3 * Math.exp(-Math.sqrt(d) / 0.55))),
          o = (j * nx + i) * 4;
        data[o] = data[o + 1] = data[o + 2] = v;
        data[o + 3] = 255;
      }
    const tex = new THREE.DataTexture(data, nx, nz);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    MAT.floor.onBeforeCompile = (sh) => {
      sh.uniforms.aoFloor = { value: tex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFloor;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvec4 fw = modelMatrix * vec4(transformed, 1.); vFloor = vec2((fw.x - (' +
            X0.toFixed(1) +
            ')) / ' +
            W.toFixed(1) +
            ', (' +
            Z0.toFixed(1) +
            ' - fw.z) / ' +
            H.toFixed(1) +
            ');',
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFloor; uniform sampler2D aoFloor;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\ndiffuseColor.rgb *= texture2D(aoFloor, vFloor).r;',
        );
    };
    MAT.floor.customProgramCacheKey = () => 'floorAO';
  }
  // albums in the nave
  /* ---------- albums in the nave: one even row, thin ink frames ---------- */
  let renderErrors = 0;
  // the line's captions under the room, as the effect lyrics show them: each kind its own size and strength, Latin text
  // spaced and lower-cased; a line's block rises in a moment after the line begins and fades before it ends
  let capKey = '',
    capEl = null;
  const LAT = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;
  function capTick() {
    const t = NOW.t,
      L = NOW.lines;
    let k = -1;
    for (let i = 0; i < L.length; i++) {
      if (L[i].t <= t) k = i;
      else break;
    }
    const line = k >= 0 ? L[k] : null,
      parts = line && t < line.end - 0.15 ? bind.captions(line) : [],
      key = parts.length ? nowId + ':' + k : '';
    if (key === capKey) return;
    capKey = key;
    const box = $('subs');
    if (!box) return;
    if (capEl) {
      const old = capEl;
      old.classList.add('out');
      setTimeout(() => old.remove(), 360);
      capEl = null;
    }
    if (!key) return;
    const el = document.createElement('div');
    el.className = 'cb in';
    el.style.fontFamily = bind.capFace(parts.map((p) => p.s).join(''));
    for (const p of parts) {
      const d = document.createElement('div'),
        lat = LAT.test(p.s);
      d.className = `cap ${p.kind}${lat ? ' lat' : ''}`;
      d.textContent = lat ? p.s.toLowerCase() : p.s;
      el.append(d);
    }
    box.append(el);
    capEl = el;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('in')));
  }
  let fakeNow = null,
    fakeBeats = null,
    paused = false,
    barW = ''; // (tests: a song without the player; a steady beat without an analysis)
  let lastRailKey = '',
    bowlDirty = true; // the wall is laid out again when it moves, its hover changes or it is rebuilt
  let shadowDirty = true; // the shadow map is redrawn only when something that casts a shadow has changed
  const pickables = [],
    albumMeshes = [];
  const unpick = (objs) => {
    for (const o of objs) {
      const k = pickables.indexOf(o);
      if (k >= 0) pickables.splice(k, 1);
    }
  };
  // a room's part rebuilt: its geometry is its own; materials only when made for it (the shared MAT ones stay), their
  // textures only when drawn for it (covers belong to the cover caches)
  const freeGroup = (g) => {
    g.parent?.remove(g);
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      const k = noLine.indexOf(o);
      if (k >= 0) noLine.splice(k, 1);
      const m = o.material;
      if (m.userData.own) {
        if (m.userData.ownMap) m.map?.dispose();
        m.dispose();
      }
    });
  };
  const own = (m, map = false) => {
    m.material.userData.own = true;
    m.material.userData.ownMap = map;
    return m;
  };
  const albumSub = (a) => [a.artist, a.year].filter(Boolean).join(', ');
  function buildNave() {
    shadowDirty = true;
    albumMeshes.forEach((m) => {
      unpick([m.art]);
      freeGroup(m.g);
    });
    albumMeshes.length = 0;
    albumSlots.forEach((s, i) => {
      const a = ALBUMS[i];
      if (!a) return;
      const g = new THREE.Group();
      g.position.set(s.x, EYE + 0.45, s.z);
      g.rotation.y = s.ry;
      world.add(g);
      mesh(box(2.1, 2.1, 0.06), MAT.ink, g).position.z = 0.03;
      mesh(box(1.98, 1.98, 0.07), MAT.ivory, g).position.z = 0.035;
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6, 1.6),
        flat('#fff', { map: thumbs.get(bind.cover(a.cover), a.key) }),
      );
      own(art);
      art.position.z = 0.075;
      g.add(art);
      const pl = own(label(g, labelTex(a.title, albumSub(a)), 1.6, 0.44, 0, -1.4, 0.02), true);
      art.userData = { kind: 'album', i };
      pickables.push(art);
      albumMeshes.push({ g, art, pl, s });
    });
  }
  function setNavePage(pg) {
    const n = navePages(LIB);
    pg = ((pg % n) + n) % n;
    if (pg === navePg && albumMeshes.length) return;
    navePg = pg;
    ALBUMS = navePage(LIB, pg);
    buildNave();
  }
  buildNave();
  sofas.forEach((s) =>
    s.g.traverse((o) => {
      if (o.isMesh) pickables.push(o);
    }),
  );

  /* ---------- the wall of all songs: covers ride a fixed rail; size never changes, only opacity ---------- */
  // close along the wall (its face is at 14 m), a little clear of it; the doorways keep their gaps
  const PER = 40,
    BOWL_R = 12.5,
    GAP = 0.74,
    ARC = Math.PI / 2 - GAP,
    TIER_H = 1.42,
    COVER = 1.02;
  // per-instance opacity for instanced, unlit materials
  const fading = (m) => {
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float iAlpha; varying float vA;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = iAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vA;')
        .replace(
          '#include <opaque_fragment>',
          'diffuseColor.rgb = mix(vec3(.86,.80,.71), diffuseColor.rgb, smoothstep(.35, 1., vA));\nif (vA < .35 && vA / .35 < fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))))) discard;\n#include <opaque_fragment>',
        );
    };
    m.customProgramCacheKey = () => 'fading';
    return m;
  };
  // the same, for covers drawn from an atlas: each instance carries its cell's offset
  const fadingAtlas = (m) => {
    const base = fading(m),
      inner = base.onBeforeCompile;
    base.onBeforeCompile = (sh, r) => {
      inner(sh, r);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 iCell;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv / ${CoverAtlas.GRID.toFixed(1)} + iCell;\n#endif`,
        );
    };
    base.customProgramCacheKey = () => 'fadingAtlas';
    return base;
  };
  const bowlGeo = new THREE.BoxGeometry(COVER, COVER, 0.04);
  const withAlpha = (geo, n) => {
    const g = geo.clone();
    g.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
    return g;
  };
  // covers on the rail carry their own ink border (the ink pass cannot see opacity, so the rail stays out of it)
  let TIERS = 1,
    bowl = [],
    ledges = null;
  const sideMat = fading(flat(C.ink));
  // the wall is rebuilt whole when the library changes: one instanced mesh per atlas of covers, one for the ledges
  function buildBowl() {
    for (const im of [...bowl, ledges].filter(Boolean)) {
      world.remove(im);
      unpick([im]);
      const k = noLine.indexOf(im);
      if (k >= 0) noLine.splice(k, 1);
      im.geometry.dispose();
      (Array.isArray(im.material) ? im.material : [im.material]).forEach((m) => m !== sideMat && m.dispose());
    }
    TIERS = Math.max(1, Math.ceil(SONGS.length / PER));
    const at = SONGS.map((sg) => atlas.cell(bind.cover(sg.cover), sg.albumKey || sg.id)),
      byPage = atlas.pages.map(() => []);
    at.forEach((c, i) => byPage[c.page].push(i));
    bowl = byPage.map((ids, pg) => {
      const geo = withAlpha(bowlGeo, ids.length),
        cells = new Float32Array(ids.length * 2);
      ids.forEach((i, j) => cells.set(CoverAtlas.uv(at[i].cell), j * 2));
      geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cells, 2));
      // (the cover on its face only: its edges and back are ink, never the picture stretched over them)
      const front = fadingAtlas(flat('#fff', { map: atlas.pages[pg].tex })),
        edge = sideMat;
      const im = new THREE.InstancedMesh(geo, [edge, edge, edge, edge, front, edge], ids.length);
      im.userData = { kind: 'bowl', ids };
      im.castShadow = false;
      im.frustumCulled = false;
      im.renderOrder = 1;
      world.add(im);
      pickables.push(im);
      noLine.push(im);
      return im;
    });
    ledges = new THREE.InstancedMesh(
      withAlpha(new THREE.BoxGeometry(COVER + 0.1, 0.035, 0.08), SONGS.length),
      fading(flat(C.ink)),
      SONGS.length,
    );
    ledges.frustumCulled = false;
    ledges.renderOrder = 1;
    world.add(ledges);
    noLine.push(ledges);
    labelCache.forEach((t) => t.dispose());
    labelCache.clear();
    signCache.forEach((t) => t.dispose());
    signCache.clear();
    if (typeof pools !== 'undefined') pools.forEach((p) => (p.tier = -1));
    hoverSong = chosenSong = -1;
    bowlDirty = true;
    tierGoal = Math.min(tierGoal, TIERS - 1);
    tierAt = Math.min(tierAt, TIERS - 1);
  }
  // the rail: tierAt follows tierGoal on a critically damped spring; the goal snaps to a whole tier once the wheel rests
  let tierAt = 2,
    tierVel = 0,
    tierGoal = 2,
    wheelRest = 0;
  const labelCache = new Map(),
    signCache = new Map();
  const songLabel = (i) => {
    if (!labelCache.has(i)) {
      if (labelCache.size > 320) {
        const [k, t] = labelCache.entries().next().value;
        t.dispose();
        labelCache.delete(k);
      }
      const s = SONGS[i];
      labelCache.set(
        i,
        textTex(480, 88, (g, w, h) => {
          g.fillStyle = '#29241F';
          g.font = '500 34px "Noto Serif TC", serif';
          g.textAlign = 'center';
          g.fillText(s.title, w / 2, 38);
          g.fillStyle = '#7a6f63';
          g.font = 'italic 400 24px "Source Serif 4", serif';
          g.fillText(s.artist, w / 2, 74);
        }),
      );
    }
    return labelCache.get(i);
  };
  // a tier's plaque, beside its first cover: its number and the letters of the index it covers (A – C, #)
  const tierLabel = (t) => {
    if (!signCache.has(t)) {
      signCache.set(
        t,
        textTex(400, 220, (g, w, h) => {
          g.textAlign = 'center';
          g.fillStyle = '#7a6f63';
          g.font = '500 40px "Noto Sans TC", sans-serif';
          g.fillText(ts('tier', { n: t + 1 }), w / 2, 62);
          g.fillStyle = '#C4603F';
          g.font = '600 96px "Noto Sans TC", sans-serif';
          g.fillText(letterSpan(SONGS.slice(t * PER, (t + 1) * PER)), w / 2, 168);
        }),
      );
    }
    return signCache.get(t);
  };
  // two sets of labels: the tier leaving and the tier arriving cross-fade, each riding with its own covers
  const hiCovers = new CoverCache(320, 120);
  const mkPool = () => ({
    tier: -1,
    arts: Array.from({ length: PER }, () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(COVER * 0.945, COVER * 0.945),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      m.renderOrder = 2;
      m.matrixAutoUpdate = false;
      m.visible = false;
      world.add(m);
      noLine.push(m);
      return m;
    }),
    labels: Array.from({ length: PER }, () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.2, 0.22),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      m.renderOrder = 3;
      world.add(m);
      return m;
    }),
    sign: (() => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 0.6),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
      );
      m.renderOrder = 3;
      world.add(m);
      return m;
    })(),
  });
  const pools = [mkPool(), mkPool()];
  const labelPool = pools.flatMap((p) => p.labels),
    tierSign = pools[1].sign;
  noLine.push(pools[0].sign);
  function fillPool(p, t) {
    if (p.tier === t) return;
    p.tier = t;
    p.labels.forEach((m, k) => {
      const i = t * PER + k;
      m.visible = !!SONGS[i] && t >= 0 && t < TIERS;
      if (m.visible) {
        m.material.map = songLabel(i);
        m.material.needsUpdate = true;
      }
    });
    // the tiers in view also show their covers at full resolution over the wall's small ones (each as soon as it is in)
    p.arts.forEach((m, k) => {
      const sg = SONGS[t * PER + k];
      m.userData.tex = sg && t >= 0 && t < TIERS ? hiCovers.get(bind.cover(sg.cover), sg.albumKey || sg.id) : null;
      if (m.material.map !== m.userData.tex) {
        m.material.map = m.userData.tex;
        m.material.needsUpdate = true;
      }
      m.visible = false;
    });
    p.sign.visible = t >= 0 && t < TIERS;
    if (p.sign.visible) {
      p.sign.material.map = tierLabel(t);
      p.sign.material.needsUpdate = true;
    }
  }
  let labelsFor = -1;
  const dummy = new THREE.Object3D(),
    eyeAt = new V3(CROSS.c.x, EYE, CROSS.c.z);
  const songAngle = (i) => {
    const t = Math.floor(i / PER),
      k = i % PER,
      arc = Math.floor(k / 10),
      j = k % 10;
    return (arc * Math.PI) / 2 + GAP / 2 + ((j + 0.5) / 10) * ARC + (t % 2 ? 0.02 : -0.02);
  };
  // one continuous rail: height, radius and tilt are all smooth functions of rel, so nothing ever jumps
  function songPose(i, s, out) {
    const t = Math.floor(i / PER),
      rel = t - s,
      a = songAngle(i),
      ar = Math.abs(rel),
      rho = BOWL_R - (0.7 * ar * ar) / (1 + 0.5 * ar),
      y = EYE + rel * TIER_H;
    out.set(CROSS.c.x - Math.sin(a) * rho, y, CROSS.c.z - Math.cos(a) * rho);
    return { rel, a };
  }
  const sm = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const railAlpha = (rel, y) => (1 - sm(2.3, 3.3, Math.abs(rel))) * sm(-0.15, 0.35, y);
  let hoverSong = -1,
    chosenSong = -1;
  const _artZ = new THREE.Matrix4().makeTranslation(0, 0, 0.03);
  buildBowl();
  const tmp = new V3();
  // a cover's place on the rail, lifted toward you when it is pointed at or chosen (eased in and out, never a jump; it grows
  // as it comes, so its outline on screen only ever widens and the pointer at its edge never slips off it and back)
  const lifts = new Map();
  function liftTick(dt) {
    let moving = false;
    for (const i of [hoverSong, chosenSong]) if (i >= 0 && !lifts.has(i)) lifts.set(i, 0);
    lifts.forEach((p, i) => {
      const want = i === hoverSong || i === chosenSong ? 1 : 0,
        q = want ? Math.min(1, p + dt / 0.22) : Math.max(0, p - dt / 0.3);
      if (q !== p) moving = true;
      if (!want && q <= 0) lifts.delete(i);
      else lifts.set(i, q);
    });
    return moving;
  }
  function coverAt(i) {
    const { rel } = songPose(i, tierAt, tmp),
      a = railAlpha(rel, tmp.y),
      l = sstep(0, 1, lifts.get(i) || 0);
    dummy.position.copy(tmp);
    dummy.lookAt(eyeAt);
    if (l) dummy.position.addScaledVector(_lift.subVectors(camera.position, tmp).normalize(), 0.24 * l);
    dummy.scale.setScalar(a > 0.003 ? 1 + 0.08 * l : 0);
    dummy.updateMatrix();
    return a;
  }
  const _lift = new V3();
  function layoutBowl() {
    let n = 0;
    const la = ledges.geometry.attributes.iAlpha;
    bowl.forEach((im) => {
      const al = im.geometry.attributes.iAlpha;
      im.userData.ids.forEach((i, j) => {
        const a = coverAt(i);
        im.setMatrixAt(j, dummy.matrix);
        al.setX(j, a);
        dummy.position.copy(tmp);
        dummy.position.y -= COVER / 2 + 0.05;
        dummy.lookAt(eyeAt.x, dummy.position.y, eyeAt.z);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        ledges.setMatrixAt(n, dummy.matrix);
        la.setX(n++, a);
      });
      im.instanceMatrix.needsUpdate = true;
      al.needsUpdate = true;
    });
    ledges.instanceMatrix.needsUpdate = true;
    la.needsUpdate = true;
    const lo = Math.max(0, Math.min(TIERS - 1, Math.floor(tierAt))),
      hi = Math.min(TIERS - 1, lo + 1);
    // keep each pool on its tier: the pool already showing lo or hi keeps it
    if (pools[1].tier === lo || pools[0].tier === hi) {
      fillPool(pools[1], lo);
      fillPool(pools[0], hi);
    } else {
      fillPool(pools[0], lo);
      fillPool(pools[1], hi);
    }
    labelsFor = Math.round(tierAt);
    pools.forEach((p) => {
      if (p.tier < 0) return;
      const fade = Math.max(0, 1 - Math.abs(p.tier - tierAt) * 1.6);
      p.arts.forEach((m, k) => {
        const i = p.tier * PER + k,
          tx = m.userData.tex;
        if (!SONGS[i] || !tx) {
          m.visible = false;
          return;
        }
        const a = coverAt(i);
        m.matrix.copy(dummy.matrix).multiply(_artZ);
        m.matrixWorldNeedsUpdate = true;
        m.material.opacity = Math.min(1, a * 1.4);
        m.visible = !!tx.userData.loaded && a > 0.02;
      });
      p.labels.forEach((m, k) => {
        const i = p.tier * PER + k;
        if (!SONGS[i]) return;
        const { rel } = songPose(i, tierAt, tmp);
        m.position.copy(tmp);
        m.position.y -= 0.72;
        m.lookAt(CROSS.c.x, m.position.y, CROSS.c.z);
        m.material.opacity = fade * railAlpha(rel, tmp.y + 0.72);
      });
      const d = p.tier - tierAt,
        ad = Math.abs(d),
        a = GAP / 2 - 0.1,
        rho = BOWL_R - (0.7 * ad * ad) / (1 + 0.5 * ad);
      p.sign.position.set(CROSS.c.x - Math.sin(a) * rho, EYE + d * TIER_H, CROSS.c.z - Math.cos(a) * rho);
      p.sign.lookAt(eyeAt.x, p.sign.position.y, eyeAt.z);
      p.sign.material.opacity = fade;
    });
  }
  function stepRail(dt, now) {
    if (wheelRest && now - wheelRest > 180) {
      tierGoal = Math.max(0, Math.min(TIERS - 1, Math.round(tierGoal)));
      wheelRest = 0;
    }
    if (RM()) {
      tierAt += (tierGoal - tierAt) * Math.min(1, dt * 14);
      tierVel = 0;
      return;
    }
    const w = 15,
      h = dt / 4;
    for (let k = 0; k < 4; k++) {
      tierVel += (-w * w * (tierAt - tierGoal) - 2 * w * tierVel) * h;
      tierAt += tierVel * h;
    }
    // draw the neighbouring tiers' labels ahead of time, a few per frame
    for (let q = 0, t0 = Math.round(tierGoal); q < 4; q++) {
      const t = t0 + [-1, 1, -2, 2][warm.k % 4],
        i = t * PER + (Math.floor(warm.k / 4) % PER);
      warm.k++;
      if (t >= 0 && t < TIERS && SONGS[i]) songLabel(i);
    }
  }
  const warm = { k: 0 };
  noLine.push(...labelPool, tierSign);

  /* ---------- north chapel: one large playlist arch faces the door, the rest are smaller ---------- */
  const listMeshes = [];
  // a playlist's collage is its first four songs' covers
  const collageOf = (pl) =>
    thumbs.collage(
      pl.ids
        .slice(0, 4)
        .map((id) => SONGS[songById.get(id)])
        .filter(Boolean)
        .map((sg) => ({ url: bind.cover(sg.cover), key: sg.albumKey || sg.id })),
      pl.id,
    );
  function buildLists() {
    shadowDirty = true;
    listMeshes.forEach((L) => {
      unpick([L.im]);
      freeGroup(L.grp);
    });
    listMeshes.length = 0;
    [6, 7, 5, 0, 4, 1, 3].forEach((pi, k) => {
      const p = lists.panels[pi],
        pl = PLAYLISTS[k];
      if (!p || !pl) return;
      const big = k === 0,
        aw = big ? 3.8 : 2.5,
        ah = big ? 5.4 : 3.7,
        art = big ? 2.5 : 1.6;
      const grp = new THREE.Group();
      grp.position.set(0, 0, -T / 2 - 0.02);
      grp.rotation.y = Math.PI;
      p.add(grp);
      mesh(
        extrude(new THREE.Shape(archPts(aw, ah)), 0.08),
        big ? MAT.mist : k % 2 ? listTone[0] : listTone[1],
        grp,
      ).position.y = 0.35;
      const im = own(new THREE.Mesh(new THREE.PlaneGeometry(art, art), flat('#fff', { map: collageOf(pl) })));
      im.position.set(0, 0.35 + ah * 0.5, 0.1);
      grp.add(im);
      mesh(box(art + 0.1, art + 0.1, 0.04), MAT.ink, grp).position.set(0, 0.35 + ah * 0.5, 0.07);
      const plq = own(
        label(
          grp,
          labelTex(pl.name, pl.note),
          big ? 2.2 : 1.7,
          big ? 0.6 : 0.46,
          0,
          0.35 + ah * 0.5 - art / 2 - 0.5,
          0.1,
        ),
        true,
      );
      im.userData = { kind: 'playlist', i: k };
      pickables.push(im);
      listMeshes.push({ grp, plq, im, panel: pi });
    });
  }
  const listTone = [toon('#B2C0CF'), toon('#C9D2DA')];
  const listPages = () => Math.max(1, Math.ceil(LIB.playlists.length / LIST_SLOTS));
  function setListPage(pg) {
    const n = listPages();
    pg = ((pg % n) + n) % n;
    if (pg === listPg && listMeshes.length) return;
    listPg = pg;
    PLAYLISTS = LIB.playlists.slice(pg * LIST_SLOTS, (pg + 1) * LIST_SLOTS);
    buildLists();
  }
  buildLists();

  /* ---------- south chapel: each kind of setting is a small geometric sculpture on a plinth ---------- */
  const SECTIONS = [
    ['look', ts('g.look'), 'Appearance'],
    ['light', ts('g.light'), 'Light & Picture'],
    ['motion', ts('g.guide'), 'Moving around'],
    ['lyrics', ts('g.lyrics'), 'Lyrics'],
    ['audio', ts('g.audio'), 'Sound · Hi-Fi'],
  ];
  // which part of the settings page each sculpture opens
  const SECTION_OF = { look: 'look', light: 'light', motion: 'guide', lyrics: 'lyrics', audio: 'audio' };
  function sculpture(key) {
    const g = new THREE.Group();
    if (key === 'look')
      [
        [C.clay, -0.22, 0],
        [C.olive, 0.2, 0.08],
        [C.mist, 0, 0.34],
      ].forEach(([c, x, y], i) => {
        const d = mesh(cyl(0.3, 0.3, 0.06, 40), toon(c), g);
        d.rotation.x = Math.PI / 2;
        d.position.set(x, 0.45 + y, i * 0.07);
      });
    if (key === 'light') {
      const d = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 40, 1, false, -Math.PI / 2, Math.PI), MAT.kraft, g);
      d.rotation.x = Math.PI / 2;
      d.position.y = 0.1;
      for (let k = 0; k < 5; k++) {
        const a = ((k + 0.5) / 5) * Math.PI,
          r = mesh(box(0.04, 0.3, 0.04), MAT.ink, g);
        r.position.set(Math.cos(a) * 0.62, 0.1 + Math.sin(a) * 0.62, 0);
        r.rotation.z = a - Math.PI / 2;
      }
    }
    if (key === 'motion')
      [
        [C.clay, 0],
        [C.mist, 0.2],
      ].forEach(([c, x], i) => {
        const t = mesh(new THREE.TorusGeometry(0.38 - i * 0.1, 0.05, 10, 40, Math.PI), toon(c), g);
        t.position.set(x - 0.1, 0.1, i * 0.1);
      });
    if (key === 'lyrics')
      [
        [0.9, C.ink],
        [0.6, C.clay],
        [0.75, C.ink],
      ].forEach(([w, c], i) =>
        mesh(box(w, 0.12, 0.12), c === C.ink ? MAT.ink : toon(c), g).position.set((w - 0.9) / 2, 0.15 + i * 0.26, 0),
      );
    if (key === 'audio')
      [0.18, 0.32, 0.46].forEach((r, i) => {
        const t = mesh(new THREE.TorusGeometry(r, 0.04, 10, 48), i === 1 ? MAT.olive : MAT.ink, g);
        t.position.y = 0.55;
      });
    return g;
  }
  const stations = [];
  // five plinths on an arc in the middle of the chapel, all turned to the door
  SECTIONS.forEach(([key, zh, en], k) => {
    const th = (k - 2) * 0.52,
      R = 2.7,
      x = SETS.c.x + 0.6 + Math.cos(th) * R,
      z = SETS.c.z + Math.sin(th) * R;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = Math.atan2(SETS.c.x - 3.4 - x, SETS.c.z - z);
    world.add(grp); // each turned to where you stand coming in
    mesh(cyl(0.5, 0.5, 1.0, 40), MAT.ivory, grp).position.y = 0.5;
    blob(x, z, 1.5, 1.5);
    const sc = sculpture(key);
    sc.position.y = 1.0;
    grp.add(sc);
    const title = label(grp, titleTex(zh, en), 1.7, 0.44, 0, 2.55, 0);
    grp.traverse((o) => {
      if (o.isMesh && !noLine.includes(o)) {
        o.userData = { kind: 'setting', key };
        pickables.push(o);
      }
    });
    stations.push({ key, grp, sc, title });
  });

  /* ---------- the sanctuary: a clay arch, the cover on it, the words in ink on paper ---------- */
  const altarArt = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), flat('#fff', { map: covers.get(null, 'none') }));
  const lyricMeshes = [];
  {
    const p = sanct.panels[4],
      rer = new THREE.Group();
    rer.position.set(0, 0, -T / 2 - 0.02);
    rer.rotation.y = Math.PI;
    p.add(rer);
    mesh(extrude(new THREE.Shape(archPts(6.2, 11)), 0.1), MAT.clay, rer).position.y = 0.4;
    mesh(box(3.3, 3.3, 0.05), MAT.ink, rer).position.set(0, 7.3, 0.14);
    altarArt.position.set(0, 7.3, 0.17);
    rer.add(altarArt);
    mesh(box(5.2, 3.6, 0.05), MAT.paper, rer).position.set(0, 3.2, 0.14);
    for (let k = 0; k < 9; k++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(5.4, 0.6),
        flat('#fff', { transparent: true, depthWrite: false, opacity: 0 }),
      );
      m.visible = false;
      m.position.set(0, 3.2, 0.2);
      m.renderOrder = 6;
      rer.add(m);
      noLine.push(m);
      lyricMeshes.push({ m, y: 3.2, o: 0, idx: -1 });
    }
  }
  // the song's lines as textures, drawn once each while the song lasts
  const lineTex = new Map();
  const lineTexOf = (i) => {
    let t = lineTex.get(i);
    if (!t) {
      t = lyricTex(NOW.lines[i]?.text || '');
      lineTex.set(i, t);
    }
    return t;
  };
  // the wall shows the line being sung and three either side; a card leaving fades before it takes a new line
  function wallTick(dt) {
    const n = NOW.lines.length,
      cur = curLine,
      want = new Set();
    for (let d = -3; d <= 3; d++) {
      const i = cur + d;
      if (cur >= 0 && i >= 0 && i < n) want.add(i);
    }
    lyricMeshes.forEach((L) => {
      if (L.idx >= 0 && !want.has(L.idx) && L.o < 0.01) {
        L.idx = -1;
        L.m.visible = false;
      }
    });
    for (const i of want)
      if (!lyricMeshes.some((L) => L.idx === i)) {
        const L = lyricMeshes.find((x) => x.idx < 0);
        if (!L) break;
        L.idx = i;
        L.m.material.map = lineTexOf(i);
        L.m.material.needsUpdate = true;
        L.o = 0;
        L.y = 3.2 - (i - cur) * 0.78 * (L.base || 1) - 0.3;
      }
    lyricMeshes.forEach((L) => {
      if (L.idx < 0) return;
      const d = L.idx - cur,
        b = L.base || 1,
        inWin = want.has(L.idx);
      const ty = 3.2 - d * 0.78 * b,
        to = !inWin ? 0 : d === 0 ? 1 : Math.max(0, 0.4 - Math.abs(d) * 0.16),
        q = Math.min(1, dt * 5);
      L.y += (ty - L.y) * q;
      L.o += (to - L.o) * q;
      L.m.position.y = L.y;
      L.m.scale.setScalar((d === 0 ? 1 : 0.8) * b);
      L.m.material.opacity = L.o * (1 - sstep(0.95, 1.4, Math.abs(L.y - 3.2))) * air.wallFade;
      L.m.visible = L.m.material.opacity > 0.003 && Math.abs(L.y - 3.2) < 1.7;
    });
  }
  // the line being sung at t (shown a moment early, as the lyrics fly off the wall ahead of the voice)
  const lineAt = (t) => {
    const L = NOW.lines;
    let k = -1;
    for (let i = 0; i < L.length; i++) {
      if (L[i].t <= t + 0.35) k = i;
      else break;
    }
    return k;
  };

  /* ---------- light beams: soft volumes, no sheets. Each beam is an axis with two radii (plus a strength);
     a post pass integrates every beam along each pixel's view ray, stopping at the scene's depth ---------- */
  const beams = new THREE.Group();
  scene.add(beams);
  const segs = [];
  // strength per room: the crossing pours hardest, the sanctuary keeps its words readable
  const beamK = () => 1; // one brightness for every beam in the building
  function prism(pts0, toFloor, sunlit, k = 1) {
    const c = pts0.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / pts0.length),
      q = pts0.map(toFloor),
      qc = q.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / q.length);
    const ra = Math.max(...pts0.map((p) => p.distanceTo(c))),
      rb = Math.max(...q.map((p) => p.distanceTo(qc)));
    segs.push([c.clone(), qc, ra * 0.8, Math.max(0.4, rb * 0.8), k]);
    if (sunlit) {
      const bb = new THREE.Box3().setFromPoints(q),
        sz = bb.getSize(new V3()),
        ce = bb.getCenter(new V3());
      soft(beams, GLOW, sz.x * 1.6 + 1.4, sz.z * 1.6 + 1.4, ce.x, 0.02, ce.z, -Math.PI / 2, 0, 0.85, true).renderOrder =
        3;
    }
  }
  function buildBeams() {
    world.updateMatrixWorld(true);
    const n = new V3(),
      up = new V3(0, 1, 0),
      seen = new Set();
    glassList.forEach((m) => {
      if (m.userData.noBeam) return;
      n.set(0, 0, 1).transformDirection(m.matrixWorld);
      const pts = m.userData.outline.map((p) => m.localToWorld(new V3(p.x, p.y, 0))),
        f = m.userData.focal;
      if (f) {
        // not physical: every window of the room pours toward one point on the floor
        const c = pts.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / pts.length),
          d = new V3(c.x - f.x, 0, c.z - f.z).normalize(),
          u = new V3().crossVectors(up, d).normalize(),
          w = new V3().crossVectors(up, n).normalize();
        // each window lands on its own spot of a small lit area around the focus, a little toward its own side, never all on one point
        const spread = f.distanceTo(new V3(CROSS.c.x, 0, CROSS.c.z)) < 1 ? 1.25 : 0.55,
          land = f
            .clone()
            .addScaledVector(d, spread * (0.8 + 0.4 * rnd(c.x * 3.1 + c.z)))
            .addScaledVector(u, (rnd(c.z * 1.7 + c.x) - 0.5) * spread * 0.8);
        prism(
          pts,
          (p) => {
            const o = p.clone().sub(c);
            return land
              .clone()
              .addScaledVector(u, o.dot(w) * 0.45)
              .addScaledVector(d, o.y * 0.32)
              .setY(0);
          },
          false,
          beamK(f),
        );
        if (!seen.has(f)) {
          seen.add(f);
          if (f.distanceTo(new V3(CROSS.c.x, 0, CROSS.c.z)) > 1) pool(f, 0.9);
        }
      } else {
        const sd = n.dot(SUN_DIR) >= 0.2 ? SUN_DIR : n.dot(SUN_M) >= 0.2 ? SUN_M : null;
        if (sd) prism(pts, (p) => p.clone().addScaledVector(sd, -p.y / sd.y), true, beamK(null));
      }
    });
    domes.forEach((d) => {
      const c = new V3(d.c.x, d.y, d.c.z),
        f = d.focal || new V3(d.c.x, 0, d.c.z);
      // under the clear-sky panel the light spreads out wide and soft, like daylight, instead of a column
      prism(
        Array.from(
          { length: 24 },
          (_, k) =>
            new V3(d.c.x + Math.cos((k / 24) * Math.PI * 2) * d.r, d.y, d.c.z + Math.sin((k / 24) * Math.PI * 2) * d.r),
        ),
        (p) => f.clone().add(new V3((p.x - c.x) * (d.blue ? 2.4 : 0.6), 0, (p.z - c.z) * (d.blue ? 2.4 : 0.6))),
        false,
        beamK(f) * (d.blue ? 0.38 : 0.8),
      );
      if (d.blue) {
        const s = segs[segs.length - 1];
        s[2] *= 1.6;
        s[3] *= 1.7;
        s[5] = 1;
      }
    }); // the sky panel: one wide, coreless, daylight-white column
    buildMotes();
  }

  function segTex() {
    if (segTex.t) return segTex.t;
    const data = new Float32Array(64 * 3 * 4);
    segs.slice(0, 64).forEach((s, k) => {
      data.set([s[0].x, s[0].y, s[0].z, s[2]], k * 4);
      data.set([s[1].x, s[1].y, s[1].z, s[3]], (64 + k) * 4);
      data.set([s[4], s[5] || 0, 0, 0], (128 + k) * 4);
    });
    const t = new THREE.DataTexture(data, 64, 3, THREE.RGBAFormat, THREE.FloatType);
    t.needsUpdate = true;
    segTex.t = t;
    return t;
  }

  /* ---------- motes: always there, barely visible; lit up when they drift through a beam; kicked by accents ---------- */
  let motes;
  function buildMotes() {
    const vols = [
      [0, -24, 5.4, 23.5, 0, 16],
      [CROSS.c.x, CROSS.c.z, 12.5, 12.5, 0, 20],
      [SETS.c.x, SETS.c.z, 6.2, 6.2, 0, 11],
      [LISTS.c.x, LISTS.c.z, 6.2, 6.2, 0, 11],
      [SANCT.c.x, SANCT.c.z, 7, 7, 0, 13],
    ];
    const per = [1500, 1800, 900, 900, 1100],
      N = per.reduce((a, b) => a + b),
      pos = new Float32Array(N * 3),
      seed = new Float32Array(N),
      dir = new Float32Array(N * 3),
      yr = new Float32Array(N * 2);
    let i = 0;
    vols.forEach((v, vi) => {
      for (let k = 0; k < per[vi]; k++, i++) {
        const r = rnd(i * 1.37);
        // a fifth of the motes are seeded inside beams so beams carry some dust without crowding the light
        let x = v[0] + (rnd(i * 1.1) * 2 - 1) * v[2],
          y = 0.3 + rnd(i * 2.7) * (v[5] - 0.3),
          z = v[1] + (rnd(i * 3.9) * 2 - 1) * v[3];
        if (r < 0.2 && segs.length) {
          const s = segs[Math.floor(rnd(i * 5.1) * segs.length)],
            t = rnd(i * 6.7),
            p = s[0].clone().lerp(s[1], t),
            rr = (s[2] + (s[3] - s[2]) * t) * 0.7;
          x = p.x + (rnd(i * 7.3) - 0.5) * rr * 2;
          y = Math.max(0.3, p.y + (rnd(i * 8.1) - 0.5) * rr);
          z = p.z + (rnd(i * 9.7) - 0.5) * rr * 2;
        }
        pos.set([x, y, z], i * 3);
        seed[i] = rnd(i * 5.3);
        const a = rnd(i * 4.4) * Math.PI * 2,
          b = rnd(i * 2.2) * 2 - 1;
        dir.set([Math.cos(a) * Math.sqrt(1 - b * b), b, Math.sin(a) * Math.sqrt(1 - b * b)], i * 3);
        yr.set([0.2, v[5]], i * 2);
      }
    });
    const st = segTex();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('dir', new THREE.BufferAttribute(dir, 3));
    geo.setAttribute('yr', new THREE.BufferAttribute(yr, 2));
    motes = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          segs: { value: st },
          nSeg: { value: Math.min(64, segs.length) },
          time: { value: 0 },
          px: { value: 1 },
          accent: { value: 0 },
          still: { value: 0 },
          col: { value: new THREE.Color(C.apricot) },
          keep: { value: 1 },
        },
        vertexShader: `#include <common>
  #include <logdepthbuf_pars_vertex>
  uniform sampler2D segs; uniform int nSeg; uniform float time, px, accent, still, keep; attribute float seed; attribute vec3 dir; attribute vec2 yr; varying float vB;
        void main(){ vec3 p = position; float T = time*(1.-still);
          p += vec3(sin(T*.11+seed*40.)*.55 + sin(T*.031+seed*9.)*.3, 0., cos(T*.09+seed*23.)*.55 + cos(T*.027+seed*5.)*.3);
          p.y = yr.x + mod(position.y - yr.x + T*.03*(.4+seed) + sin(T*.07+seed*13.)*.25, yr.y - yr.x);
          float inb = 0.;
          for (int i = 0; i < 64; i++) { if (i >= nSeg) break; vec4 a = texelFetch(segs, ivec2(i, 0), 0), b = texelFetch(segs, ivec2(i, 1), 0); vec3 ab = b.xyz-a.xyz; float t = clamp(dot(p-a.xyz, ab)/dot(ab, ab), 0., 1.);
            float r = mix(a.w, b.w, t); inb = max(inb, 1.-smoothstep(r*.3, r, length(p-(a.xyz+ab*t)))); }
          vec4 mv = modelViewMatrix*vec4(p, 1.); float dz = -mv.z;
          vB = (.08 + inb*.72)*(1.+accent*.25)*smoothstep(.6, 2., dz)*(1.-smoothstep(26., 48., dz));
          gl_PointSize = fract(seed*7.31) > keep ? 0. : px*(1.1+seed*1.3)*(1.+inb*1.1)*5./max(.5, dz); gl_Position = projectionMatrix*mv;
  #include <logdepthbuf_vertex>
  }`,
        fragmentShader: `#include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 col; varying float vB; void main(){
  #include <logdepthbuf_fragment>
   float d = length(gl_PointCoord-.5); if (vB < .004 || d > .5) discard; gl_FragColor = vec4(col*vB*smoothstep(.5, .05, d)*1.6, 1.); }`,
      }),
    );
    motes.frustumCulled = false;
    motes.renderOrder = 5;
    scene.add(motes);
    noLine.push(motes);
  }

  /* ---------- ink: edges from depth and normals, drawn over the flat colour ---------- */
  /* ---------- the dream: the eye adjusts to the light, the edges darken, distance softens into wheat ---------- */
  // how much light you are looking straight into: windows and skylights of the room you stand in, 25 m at most,
  // weighted by how close the centre of view is to them and how squarely they face you (the same terms the glass shader uses)
  let LIGHTS = null;
  const _lv = new V3(),
    _lf = new V3(),
    _ld = new V3();
  function lightsBuild() {
    LIGHTS = [];
    world.updateMatrixWorld(true);
    const n = new V3();
    glassList.forEach((m) => {
      const p = m.getWorldPosition(new V3()),
        size = m.userData.size || 3;
      n.set(0, 0, 1).transformDirection(m.matrixWorld);
      const inward = n.clone().multiplyScalar(m.userData.inward || -1);
      if (m.userData.outline) {
        const c = m.userData.outline
          .reduce((a, q) => a.add(new V3(q.x, q.y, 0)), new V3())
          .multiplyScalar(1 / m.userData.outline.length);
        p.copy(m.localToWorld(c));
      }
      const r =
        regionAt(p.clone().addScaledVector(inward, 1.4).setY(Math.min(p.y, 6))) ||
        regionAt(p.clone().addScaledVector(inward, 1.4));
      LIGHTS.push({ p, n, size, base: glassBase(size), flare: glassFlare(size), room: r ? r.room : null, glass: true });
    });
    domes.forEach((d) => {
      const r = regionAt(new V3(d.c.x, EYE, d.c.z));
      LIGHTS.push({
        p: new V3(d.c.x, d.y + 1, d.c.z),
        n: new V3(0, 1, 0),
        size: d.r * 2.4,
        base: 1.6,
        room: r ? r.room : null,
      });
    });
  }
  function lightInView() {
    if (!LIGHTS) lightsBuild();
    camera.updateMatrixWorld(true);
    const cam = camera.getWorldPosition(_lv),
      fwd = camera.getWorldDirection(_lf);
    let I = 0;
    const check = lightFrame++ % 8 === 0; // (whether a wall hides it: looked again a few times a second)
    for (const L of LIGHTS) {
      _ld.subVectors(L.p, cam);
      const dist = _ld.length();
      if (dist < 0.5) continue;
      _ld.multiplyScalar(1 / dist);
      const ang = Math.acos(Math.max(-1, Math.min(1, fwd.dot(_ld)))),
        half = Math.atan(L.size / 2 / dist),
        w = 1 - sstep(half * 0.5, half * 1.6 + 0.06, ang);
      if (w <= 0) {
        L.vis = null;
        continue;
      }
      if (check || L.vis == null) {
        sightRay.set(cam, _ld);
        sightRay.far = dist - 0.45;
        L.vis = sightRay.intersectObjects(solids(), false).length === 0;
      }
      if (!L.vis) continue;
      const f = Math.abs(_ld.dot(L.n)),
        bright = L.glass ? L.base * (0.7 + 1.2 * f * L.flare) : L.base * (0.6 + 0.4 * f);
      I = Math.max(I, w * bright);
    }
    return I;
  }
  let lightFrame = 0;
  const composer = new EffectComposer(
    renderer,
    new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }),
  );
  composer.addPass(new RenderPass(scene, camera));
  const ink = new InkPass(scene, camera, () => noLine, C.ink);
  composer.addPass(ink);
  const shafts = new ShaftsPass(
    camera,
    () => ink.rt.depthTexture,
    () => ({ tex: segTex(), count: segs.length }),
    C.apricot,
  );
  composer.addPass(shafts);
  const dream = new DreamPass(camera, () => ink.rt.depthTexture, lightInView, C.wheat);
  composer.addPass(dream);
  const glow = new UnrealBloomPass(new V2(4, 4), 0.32, 0.7, 1.1);
  composer.addPass(glow);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  const uiGlass = new GlassPass(() => renderer.getPixelRatio());
  composer.addPass(uiGlass);

  function fitSun(size) {
    const center = new V3(0, 10, -50);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(SUN_DIR, 140);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse,
      mn = new V3(1e9, 1e9, 1e9),
      mx = new V3(-1e9, -1e9, -1e9);
    for (const x of [-38, 38])
      for (const y of [-1, 32])
        for (const z of [3, -103]) {
          const p = new V3(x, y, z).applyMatrix4(inv);
          mn.min(p);
          mx.max(p);
        }
    Object.assign(cam, { left: mn.x, right: mx.x, bottom: mn.y, top: mx.y, near: -mx.z - 2, far: -mn.z + 2 });
    cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    renderer.shadowMap.needsUpdate = true;
    shadowDirty = true;
  }
  /* ---------- rooms, doors and routes ---------- */
  const octIn = (p, R, m) => {
    const dx = p.x - R.c.x,
      dz = p.z - R.c.z;
    for (const d of DIRS) if (dx * d.x + dz * d.z > R.r - m) return false;
    return true;
  };
  const VEST = [
    ['settings', new V3(1, 0, 0)],
    ['lists', new V3(-1, 0, 0)],
    ['altar', new V3(0, 0, -1)],
  ];
  // each region: which room it belongs to, and how high you may float there
  function regionAt(p) {
    if (Math.abs(p.x) < NAVE.w / 2 - 0.6 && p.z < -0.6 && p.z > NAVE.z1 + 0.6) return { room: 'nave', top: 19 };
    // every doorway reaches 1.5 m into both rooms, so the walkable areas always overlap
    if (Math.abs(p.x) < 2.4 && p.z <= NAVE.z1 + 1.5 && p.z > NAVE.z1 - T - 1.5)
      return { room: p.z > NAVE.z1 - T / 2 ? 'nave' : 'dome', top: 9.2, door: true };
    if (octIn(p, CROSS, 0.7)) return { room: 'dome', top: 24 };
    for (const [room, d] of VEST) {
      const rx = p.x - CROSS.c.x,
        rz = p.z - CROSS.c.z,
        along = rx * d.x + rz * d.z,
        lat = Math.abs(rx * d.z - rz * d.x);
      if (along > CROSS.r - 1.5 && along < CROSS.r + 2 * T + 3 + 1.5 && lat < DOOR.w / 2 - 0.5)
        return { room: along < CROSS.r + T + 1.5 ? 'dome' : room, top: 6.8, door: true };
    }
    if (octIn(p, LISTS, 0.6)) return { room: 'lists', top: 15 };
    if (octIn(p, SETS, 0.6)) return { room: 'settings', top: 15 };
    if (octIn(p, SANCT, 0.6)) return { room: 'altar', top: 17 };
    return null;
  }
  const PLACES = {
    nave: {
      pos: new V3(0, EYE, -4),
      yaw: 0,
      pitch: 0.05,
      sign: ['The Gallery', `${ts('room.nave')} · ${ts('room.nave.sub')}`],
    },
    dome: {
      pos: new V3(CROSS.c.x, EYE, CROSS.c.z + 11.2),
      yaw: 0,
      pitch: 0.03,
      sign: ['The Atrium', `${ts('room.dome')} · ${ts('room.dome.sub')}`],
    },
    lists: {
      pos: new V3(LISTS.c.x + 4.2, EYE, LISTS.c.z),
      yaw: Math.PI / 2,
      pitch: 0.02,
      sign: ['The Collection', `${ts('room.lists')} · ${ts('room.lists.sub')}`],
    },
    altar: {
      pos: new V3(SANCT.c.x, EYE, SANCT.c.z + 5.2),
      yaw: 0,
      pitch: 0.1,
      sign: ['The Listening Room', `${ts('room.altar')} · ${ts('room.altar.sub')}`],
    },
    settings: {
      pos: new V3(SETS.c.x - 4.2, EYE, SETS.c.z),
      yaw: -Math.PI / 2,
      pitch: -0.04,
      sign: ['The Studio', `${ts('room.settings')} · ${ts('room.settings.sub')}`],
    },
  };
  // the way through the building: every room hangs off the crossing; each link is the line through its doorways
  const at = (d, s) => new V3(CROSS.c.x + d.x * s, EYE, CROSS.c.z + d.z * s);
  const LINKS = {
    nave: [new V3(0, EYE, NAVE.z1 + 4), new V3(0, EYE, NAVE.z1 - T / 2), new V3(0, EYE, NAVE.z1 - T - 3)],
  };
  for (const [room, d] of VEST)
    LINKS[room] = [10.5, CROSS.r + T / 2, CROSS.r + T + 1.5, CROSS.r + T + 3 + T / 2, CROSS.r + 2 * T + 3 + 2.5]
      .map((s) => at(d, s))
      .reverse();
  function route(from, to) {
    if (from === to) return [];
    const out = from === 'dome' ? [] : [...LINKS[from]];
    if (to !== 'dome') out.push(...[...LINKS[to]].reverse());
    return out;
  }

  /* ---------- walking, looking, flying ---------- */
  // (rigs/walk.ts walks; this scene's part is where one may stand, the way through its doorways, and the veil that
  // stands in for a flight under reduced motion)
  const walk = new WalkRig({
    start: { pos: PLACES.nave.pos, yaw: 0, pitch: 0.05 },
    eye: EYE,
    region: regionAt,
    route: (to) => route(room, regionAt(to)?.room || room),
    speed: () => S.walk,
    sensitivity: () => S.look,
    onWalk: () => hideCards(),
  });
  const veiled = (arrive) => {
    $('veil').style.opacity = 1;
    setTimeout(() => {
      arrive();
      $('veil').style.opacity = 0;
    }, 360);
  };
  const me = walk.pose;
  // the view is the rig's in use: walking, unless a set of shots has it (the rooms, one framing each)
  const shots = new ShotRig({ shots: Object.values(PLACES), reduced: () => RM() });
  let rig = walk;
  const keys = new Set();
  let looking = false,
    locked = false,
    place = 'nave',
    room = 'nave';
  const sstep = smooth;
  function fly(pos, yaw, pitch, dur, out = false) {
    if (RM()) veiled(() => walk.put(pos, yaw, pitch));
    else walk.fly(pos, yaw, pitch, dur, out);
  }
  function setPlace(p, go = true) {
    place = p;
    Object.keys(PLACES).forEach((k) => $('go-' + k).setAttribute('aria-pressed', String(k === p)));
    const P = PLACES[p];
    if (go) {
      fly(P.pos, P.yaw, P.pitch);
      return;
    } // the sign changes on arrival, not on departure
    // the room's name only as you come in: it fades in, stays a moment, and fades away
    const s = $('sign');
    s.style.opacity = 0;
    clearTimeout(setPlace.t);
    clearTimeout(setPlace.t2);
    setPlace.t = setTimeout(() => {
      s.innerHTML = `<i>${P.sign[0]}</i><b>${P.sign[1]}</b><u style="background:${ROOM_COL[p]}"></u>`;
      s.style.opacity = 1;
      setPlace.t2 = setTimeout(() => {
        s.style.opacity = 0;
      }, 2800);
    }, 300);
  }
  function onRoom(r) {
    room = r;
    setPlace(r, false);
    if (r !== 'settings') ui.closeSettings();
  }

  function sit(i) {
    const s = sofas[i];
    if (!s) return;
    if (s.ring) {
      const a = Math.atan2(me.pos.x - s.ring.x, me.pos.z - s.ring.z);
      s.seat.set(s.ring.x + Math.sin(a) * s.ring.r, 1.15, s.ring.z + Math.cos(a) * s.ring.r);
      s.yaw = a + Math.PI;
    }
    /* the nearest point of the ring, facing out */ hideCards();
    ui.closeSettings();
    if (RM()) fly(s.seat.clone(), s.yaw, -0.04);
    else walk.sit(s.seat, s.yaw);
    walk.seated = true;
  }
  function hideCards() {
    $('focus').hidden = true;
    $('f-list').hidden = true;
  }
  // what you click opens where you stand: the view never moves for it (the card closes when you walk away from it)
  let shownAt = null;
  function show(d, at) {
    hideCards();
    ui.closeSettings();
    ui.show(d);
    shownAt = at && me.pos.distanceTo(at) <= REACH + 3 ? at.clone() : null;
    setTimeout(freePointer, 0);
  } // (one found by search, far off: open until closed)
  function focusAlbum(i) {
    const m = albumMeshes[i];
    if (!m) return;
    chosenSong = -1;
    show({ kind: 'album', key: ALBUMS[i].key }, m.g.getWorldPosition(new V3()));
  }
  function focusSong(i) {
    chosenSong = i;
    tierGoal = Math.floor(i / PER);
    const at = new V3();
    songPose(i, tierGoal, at);
    show({ kind: 'song', key: SONGS[i].id }, room === 'dome' ? at : null);
  }
  function focusList(k) {
    const L = listMeshes[k],
      pl = PLAYLISTS[k];
    if (!L || !pl) return;
    chosenSong = -1;
    show({ kind: 'playlist', key: pl.id }, L.grp.getWorldPosition(new V3()));
  }
  let onPlay = null;
  function showFocus(eye, title, meta, fn) {
    setTimeout(freePointer, 0);
    $('f-play').textContent = ts('play');
    $('f-eye').textContent = eye;
    $('f-title').textContent = title;
    $('f-meta').textContent = meta;
    onPlay = fn;
    $('f-list').hidden = true;
    $('focus').hidden = false;
  }
  let playing = false,
    songT = 0;
  // Cadenza plays; the scene follows (the card, the cover, the lyrics change when the player says so, in frame())
  function play(ids, index) {
    bind.play(ids, index);
    hideCards();
  } // (you stay where you are: the lyrics come to you)

  /* ---------- the settings: the sculptures open the settings page at their part (the page is SpaceShell's) ---------- */
  function openLedger(key) {
    hideCards();
    ui.show(null);
    freePointer();
    ui.openSettings(SECTION_OF[key]);
  }
  let shadowSize = 0;
  // Cadenza's picture-quality modes: as designed; optimised (no second ink scale, half the motes, softer bloom);
  // lite (no beams' volumes, no bloom, no glass behind the HUD, a quarter of the motes, at most 75 % resolution)
  function quality() {
    const q = S.gfx,
      lite = q === 'lite',
      opt = q === 'optimized';
    shafts.enabled = !lite;
    glow.enabled = !lite && S.dream !== false;
    uiGlass.enabled = !lite;
    ink.mat.uniforms.two && (ink.mat.uniforms.two.value = lite || opt ? 0 : 1);
    glow.resolution?.set(innerWidth * (opt ? 0.5 : 1), innerHeight * (opt ? 0.5 : 1));
    if (motes) motes.material.uniforms.keep.value = lite ? 0.25 : opt ? 0.5 : 1;
  }
  function apply() {
    quality();
    if (!S.immersive && document.pointerLockElement === canvas && !looking) document.exitPointerLock?.();
    beams.visible = !!S.beams;
    updateAmbient();
    dream.enabled = S.dream !== false;
    glow.enabled = S.dream !== false && S.gfx !== 'lite';
    ink.mat.uniforms.w.value = { thin: 0.8, mid: 1.2, bold: 1.8 }[S.line] || 1.2;
    const size = { high: 4096, mid: 2048, low: 1024 }[S.shadow] || 4096;
    if (size !== shadowSize) {
      shadowSize = size;
      fitSun(size);
    }
    const pr = Math.min(1.5, devicePixelRatio || 1) * (+S.res || 1) * (S.gfx === 'lite' ? 0.75 : 1);
    if (Math.abs(renderer.getPixelRatio() - pr) > 0.001) {
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
      resize();
    }
    const ls = { s: 0.8, m: 1, l: 1.2 }[S.lyric] || 1;
    lyricMeshes.forEach((L) => (L.base = ls));
  }

  /* ---------- input ---------- */
  const ray = new THREE.Raycaster(),
    ndc = new V2();
  function pickAt(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, (-(y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects([...pickables, ...occluders], false)[0];
    if (!h || !h.object.userData.kind) return null;
    const back = h.point.clone().addScaledVector(ray.ray.direction, -0.6),
      rr = regionAt(back);
    if (!rr || rr.room !== room) return null; // only what is in your own room
    // one reach for everything, as in a game: within it a thing lights up and answers; further, it tells you to come closer
    const far = h.distance > REACH;
    if (h.object.userData.kind === 'bowl') return { kind: 'song', i: h.object.userData.ids[h.instanceId], far };
    return { ...h.object.userData, far };
  }
  const REACH = 6;
  const occluders = [];
  world.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.castShadow && !o.userData.kind) occluders.push(o);
  }); // walls stop the pointer like they stop the eye
  const immersive = () => !!S.immersive;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2 && !immersive()) {
      looking = true;
      canvas.setPointerCapture(e.pointerId);
      canvas.requestPointerLock?.();
      $('tip').hidden = true;
      return;
    }
    if (e.button === 0 && immersive() && !locked) {
      canvas.requestPointerLock?.();
      return;
    }
    if (e.button === 0) {
      const h = locked ? pickAt(innerWidth / 2, innerHeight / 2) : pickAt(e.clientX, e.clientY);
      if (!h) return;
      if (h.far) {
        reachHint(locked ? innerWidth / 2 : e.clientX, locked ? innerHeight / 2 : e.clientY);
        return;
      }
      if (h.kind === 'album') focusAlbum(h.i);
      else if (h.kind === 'song') focusSong(h.i);
      else if (h.kind === 'playlist') focusList(h.i);
      else if (h.kind === 'setting') openLedger(h.key);
      else if (h.kind === 'sofa') sit(h.i);
    }
  });
  onW('pointerup', (e) => {
    if (e.button === 2 && looking) {
      looking = false;
      if (!immersive()) document.exitPointerLock?.();
    }
  });
  let lockAt = 0,
    relock = false;
  // cards with buttons need the pointer: let it out, and take it back when the card is done
  function freePointer() {
    if (locked && immersive()) {
      relock = true;
      document.exitPointerLock?.();
    }
  }
  function takePointer() {
    if (relock) {
      relock = false;
      canvas.requestPointerLock?.();
    }
  }
  onD('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    lockAt = performance.now();
    $('reticle').hidden = !(locked && immersive());
    if (!locked) {
      $('tip').hidden = true;
      $('reticle').classList.remove('hot');
    }
  });
  // too far to reach: the tip says so, briefly
  function reachHint(x, y) {
    const tip = $('tip');
    tip.innerHTML = `${ts('reach')}`;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.hidden = false;
    tip.classList.add('far');
    clearTimeout(reachHint.t);
    reachHint.t = setTimeout(() => {
      tip.classList.remove('far');
    }, 900);
  }
  // with the view locked, the reticle is the pointer: it lights up over anything you can use and names it
  function reticleHover() {
    if (!locked) return;
    const h = pickAt(innerWidth / 2, innerHeight / 2),
      r = $('reticle'),
      tip = $('tip');
    r.classList.toggle('hot', !!h && !h.far);
    r.classList.toggle('far', !!h && h.far);
    hoverSong = h && h.kind === 'song' && !h.far ? h.i : -1;
    if (h) {
      const t = tipText(h);
      tip.innerHTML = `${t[0]}<small>${h.far ? ts('reach') : t[1]}</small>`;
      tip.style.left = innerWidth / 2 + 'px';
      tip.style.top = innerHeight / 2 + 'px';
      tip.hidden = false;
    } else tip.hidden = true;
  }
  const tipText = (h) =>
    h.kind === 'sofa'
      ? [ts('tip.sit'), ts('tip.sitSub')]
      : h.kind === 'song'
        ? [SONGS[h.i]?.title || '', SONGS[h.i]?.artist || '']
        : h.kind === 'album'
          ? [ALBUMS[h.i]?.title || '', ALBUMS[h.i]?.artist || '']
          : h.kind === 'playlist'
            ? [PLAYLISTS[h.i]?.name || '', PLAYLISTS[h.i]?.note || '']
            : [SECTIONS.find((s) => s[0] === h.key)[1], ts('tip.settings')];
  canvas.addEventListener('pointermove', (e) => {
    if (looking || locked) {
      // pointer lock sometimes reports one huge jump (on lock, unlock or focus): drop those, they are what 'reset' the view
      if (performance.now() - lockAt < 120 || Math.abs(e.movementX) > 160 || Math.abs(e.movementY) > 160) return;
      rig.look(e.movementX, e.movementY);
      return;
    }
    hoverAt = [e.clientX, e.clientY]; // (looked up once a frame, not on every move: a fast mouse sends hundreds)
  });
  let hoverAt = null;
  function hoverTick() {
    if (!hoverAt) return;
    const [x, y] = hoverAt;
    hoverAt = null;
    const h = pickAt(x, y);
    canvas.classList.toggle('hot', !!h && !h.far);
    hoverSong = h && h.kind === 'song' && !h.far ? h.i : -1;
    const tip = $('tip');
    if (h) {
      const t = tipText(h);
      tip.innerHTML = `${t[0]}<small>${h.far ? ts('reach') : t[1]}</small>`;
      tip.classList.toggle('far', !!h.far);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      tip.hidden = false;
    } else tip.hidden = true;
  }
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      if (room === 'dome' && octIn(me.pos, CROSS, 1)) {
        tierGoal = Math.max(-0.35, Math.min(TIERS - 0.65, tierGoal + d / 110));
        wheelRest = performance.now();
      } else walk.push(-d * 0.02);
    },
    { passive: false },
  );
  const typing = () =>
    document.activeElement &&
    /INPUT|TEXTAREA/.test(document.activeElement.tagName) &&
    !['checkbox', 'range'].includes(document.activeElement.type);
  onW('keydown', (e) => {
    if (e.key === '/' && !typing()) {
      e.preventDefault();
      $('q').focus();
      return;
    }
    if (typing()) {
      if (e.key === 'Escape') {
        $('q').blur();
        $('results').hidden = true;
      }
      return;
    }
    if (e.key === 'Escape') {
      hideCards();
      ui.closeSettings();
    }
    if (e.key === ',') {
      e.preventDefault();
      hideCards();
      freePointer();
      ui.openSettings();
      return;
    }
    if (e.key === 'Alt' && locked) {
      e.preventDefault();
      document.exitPointerLock?.();
      return;
    }
    if (e.code === 'KeyR') {
      walk.stand();
      return;
    }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'nave') {
      e.preventDefault();
      hideCards();
      setNavePage(navePg + (e.code === 'PageDown' ? 1 : -1));
      return;
    }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'lists') {
      e.preventDefault();
      hideCards();
      setListPage(listPg + (e.code === 'PageDown' ? 1 : -1));
      return;
    }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'dome') {
      e.preventDefault();
      tierGoal = Math.max(0, Math.min(TIERS - 1, Math.round(tierGoal) + (e.code === 'PageDown' ? 1 : -1)));
      return;
    }
    if (e.code === 'Space' && !(locked && immersive())) {
      e.preventDefault();
      togglePlay();
      return;
    }
    keys.add(e.code);
    if (['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  onW('keyup', (e) => keys.delete(e.code));
  onW('blur', () => keys.clear());
  function togglePlay() {
    bind.toggle();
  }

  $('mini').onclick = () => bind.mini();
  $('rest').onclick = () => bind.rest();
  // the progress line: press or drag to move through the song (the song follows when let go; the line follows the hand)
  let seeking = null;
  {
    const bar = $('p-seek'),
      at = (e) => {
        const r = bar.getBoundingClientRect();
        return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      };
    bar.addEventListener('pointerdown', (e) => {
      if (!NOW.dur) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('drag');
      seeking = at(e);
    });
    bar.addEventListener('pointermove', (e) => {
      if (seeking != null) seeking = at(e);
    });
    const up = (e) => {
      if (seeking == null) return;
      const u = seeking;
      seeking = null;
      bar.classList.remove('drag');
      if (e.type === 'pointerup') bind.seek(u * NOW.dur);
    };
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        bind.seek(NOW.t + (e.key === 'ArrowRight' ? 5 : -5));
      }
    });
  }
  $('pp').onclick = togglePlay;
  Object.keys(PLACES).forEach(
    (k) =>
      ($('go-' + k).onclick = () => {
        hideCards();
        setPlace(k);
      }),
  );
  $('f-close').onclick = () => {
    hideCards();
    takePointer();
  };
  $('f-play').onclick = () => {
    onPlay && onPlay();
    takePointer();
  };
  canvas.addEventListener(
    'webglcontextlost',
    (e) => {
      e.preventDefault();
      alive = false;
      setTimeout(() => ui.lost(), 0);
    },
    { signal: ac.signal },
  );
  $('cfg').onclick = () => {
    hideCards();
    freePointer();
    ui.openSettings();
  };
  $('q').addEventListener('input', () => {
    const q = $('q').value.trim(),
      ul = $('results');
    ul.innerHTML = '';
    if (!q) {
      ul.hidden = true;
      return;
    }
    const ql = q.toLowerCase(),
      has = (x) => x.t.toLowerCase().includes(ql) || x.s.toLowerCase().includes(ql);
    const hits = [
      ...LIB.playlists.map((p, j) => ({
        t: p.name,
        s: `${ts('kind.list')} · ${p.note}`,
        go: () => {
          setListPage(Math.floor(j / LIST_SLOTS));
          focusList(j % LIST_SLOTS);
        },
      })),
      ...LIB.albums.map((a, j) => ({
        t: a.title,
        s: `${ts('kind.album')} · ${a.artist}`,
        go: () => {
          setNavePage(Math.floor(j / NAVE_SLOTS));
          focusAlbum(j % NAVE_SLOTS);
        },
      })),
      ...SONGS.map((s, i) => ({ t: s.title, s: `${ts('kind.song')} · ${s.artist}`, go: () => focusSong(i) })),
    ]
      .filter(has)
      .slice(0, 8);
    hits.forEach((h) => {
      const li = document.createElement('li'),
        b = document.createElement('button');
      b.textContent = h.t;
      const sm = document.createElement('small');
      sm.textContent = h.s;
      b.append(sm);
      b.onclick = () => {
        ul.hidden = true;
        $('q').value = '';
        $('q').blur();
        h.go();
      };
      li.append(b);
      ul.append(li);
    });
    ul.hidden = !hits.length;
  });
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const b = $('results').querySelector('button');
      if (b) b.click();
    }
  });

  /* ---------- speakers: one per room, the crossing's is the pool of light itself ---------- */
  const SPEAKERS = [
    { room: 'nave', pos: new V3(-4.7, 1.1, -24.5), ry: Math.PI / 2 },
    { room: 'dome', pos: new V3(CROSS.c.x, 0.6, CROSS.c.z), pool: true },
    { room: 'lists', pos: new V3(LISTS.c.x - 2.1, 1.1, LISTS.c.z - 5.2), ry: Math.PI * 0.12 },
    { room: 'settings', pos: new V3(SETS.c.x + 3.4, 1.1, SETS.c.z + 3.4), ry: -Math.PI * 0.75 },
    { room: 'altar', pos: new V3(SANCT.c.x + 4.4, 1.1, SANCT.c.z - 1.5), ry: -Math.PI / 2 },
  ];
  SPEAKERS.forEach((s) => {
    if (s.pool) return;
    const g = new THREE.Group();
    g.position.set(s.pos.x, 0, s.pos.z);
    g.rotation.y = s.ry;
    world.add(g);
    furniture.push(g);
    mesh(cyl(0.05, 0.07, 0.7, 12), MAT.ink, g).position.y = 0.35;
    mesh(cyl(0.28, 0.32, 0.04, 24), MAT.ink, g).position.y = 0.02;
    mesh(rbox(0.62, 0.9, 0.5, 0.12), MAT.oat, g).position.y = 1.15;
    for (const [y, r] of [
      [1.35, 0.17],
      [0.98, 0.1],
    ]) {
      const ring = mesh(new THREE.TorusGeometry(r, 0.025, 8, 32), MAT.ink, g);
      ring.position.set(0, y, 0.26);
      const cone = mesh(new THREE.CircleGeometry(r - 0.02, 32), MAT.taupe, g, false);
      cone.position.set(0, y, 0.252);
    }
    s.led = new THREE.Mesh(new THREE.CircleGeometry(0.025, 12), flat(new THREE.Color(2.2, 1.4, 0.7)));
    s.led.position.set(0.2, 1.52, 0.252);
    g.add(s.led);
    noLine.push(s.led);
    blob(s.pos.x, s.pos.z, 1.1, 1.1);
  });

  /* ---------- the song in the rooms, and the rooms' own music (systems/audio.ts): this scene's part is its speakers,
     its rooms' reverb times, and the way sound walks through its doorways ---------- */
  const doorOf = (r) =>
    r === 'nave' ? new V3(0, EYE, NAVE.z1 - T / 2) : at(VEST.find((v) => v[0] === r)[1], CROSS.r + T + 3 + T / 2); // the room's own doorway
  const crossDoorOf = (r) =>
    r === 'nave' ? new V3(0, EYE, NAVE.z1 - T / 2) : at(VEST.find((v) => v[0] === r)[1], CROSS.r + T / 2); // the crossing's doorway toward it
  function soundPath(L, Lroom, S, Sroom) {
    if (Lroom === Sroom) return [L, S];
    if (Lroom === 'dome') return [L, crossDoorOf(Sroom), doorOf(Sroom), S];
    if (Sroom === 'dome') return [L, doorOf(Lroom), crossDoorOf(Lroom), S];
    return [L, doorOf(Lroom), crossDoorOf(Lroom), crossDoorOf(Sroom), doorOf(Sroom), S];
  }
  const sound = new RoomAudio({
    audio: () => bind.audio(),
    sources: SPEAKERS,
    ambientFrom: SPEAKERS[1],
    ambientUrl: AMBIENT,
    reverb: { nave: 3.2, dome: 4.5, lists: 1.8, settings: 1.8, altar: 2.4 },
    path: soundPath,
    onPhones: (on) => {
      const b = $('hp');
      b.setAttribute('aria-pressed', String(on));
      b.textContent = ts(on ? 'phones.on' : 'phones.off');
      b.title = ts(on ? 'phones.onHelp' : 'phones.offHelp');
    },
  });
  function initAudio() {
    sound.start();
  }
  function updateAmbient() {
    sound.setAmbient(S.music !== false, +(S.musicVol ?? 0.6));
  }
  $('hp').onclick = () => {
    initAudio();
    if (sound.phones && bind.audio().hifi) {
      showFocus(ts('hifi.eye'), ts('hifi.title'), ts('hifi.body'), async () => {
        hideCards();
        await bind.audio().useStandard();
      });
      $('f-play').textContent = ts('hifi.use');
      return;
    }
    sound.setPhones(!sound.phones);
  };
  onW('pointerdown', initAudio);
  onW('keydown', initAudio);
  const _listener = { pos: camera.position, quat: camera.quaternion, room: 'nave' };
  function audioTick(dt) {
    _listener.room = room;
    sound.tick(dt, _listener, playing);
    SPEAKERS.forEach((s) => {
      if (s.led) s.led.visible = !!s.lit;
    });
  }

  /* ---------- the lyrics in the air (systems/lyrics.ts): this scene's part is what is solid here, the HUD's free band,
     the first line peeling off the sanctuary's paper, and the view turning to follow a line ---------- */
  // everything solid in the building: what blocks a sight line and what a falling glyph lands on (gathered once, on first use)
  let landables = null;
  function solids() {
    if (!landables) {
      landables = [];
      world.traverse((o) => {
        if (o.isMesh && !o.isInstancedMesh && !o.userData.thin && !noLine.includes(o) && !glassList.includes(o))
          landables.push(o);
      });
    }
    return landables;
  }
  const sightRay = new THREE.Raycaster();
  // the band of the screen the HUD leaves free (in NDC): under the places and the room's sign, over the subtitles and the player
  function freeBand() {
    const H = innerHeight || 1;
    let top = innerHeight * 0.1,
      bot = innerHeight * 0.86;
    for (const el of document.querySelectorAll('.hud.top, #sign')) {
      const r = el.getBoundingClientRect();
      if (r.height > 1 && r.bottom < H * 0.5) top = Math.max(top, r.bottom + 14);
    }
    const pl = document.querySelector('.hud.player');
    if (pl) {
      const r = pl.getBoundingClientRect();
      if (r.height > 1) bot = Math.min(bot, r.top - 74);
    } // (the subtitles sit just over the player)
    return { yTop: 1 - (2 * top) / H, yBot: 1 - (2 * bot) / H };
  }
  const air = new AirLyrics({
    scene,
    camera,
    face: (sample) => bind.face(sample),
    loadFace: (sample) => bind.loadFace(sample),
    faceKey: () => S.font,
    // (the sanctuary's paper is drawn in the same face: its lines are redrawn)
    onFace: () => {
      lineTex.forEach((t) => t.dispose());
      lineTex.clear();
      lyricMeshes.forEach((L) => {
        L.idx = -1;
        L.m.visible = false;
      });
    },
    solids,
    obstacles: () => bowl,
    inside: (p) => !!regionAt(p),
    freeBand,
    velocity: () => me.vel,
    reduced: RM,
    origin: () => (room === 'altar' ? lyricMeshes[0].m.getWorldPosition(new V3()) : null),
    onSpawn: (pos) => {
      // (the view turns to follow a line, if asked to)
      if (S.follow) walk.follow(Math.atan2(-(pos.x - camera.position.x), -(pos.z - camera.position.z)));
    },
    unlisted: {
      add: (o) => noLine.push(o),
      remove: (gone) => {
        for (let i = noLine.length - 1; i >= 0; i--) if (gone.has(noLine[i])) noLine.splice(i, 1);
      },
    },
    colours: { ink: C.ink, faded: C.ivory, edge: C.clay },
  });
  const _song = { playing: false, t: 0, lines: [] };
  function lyricsTick(now, dt) {
    _song.playing = playing;
    _song.t = NOW.t;
    _song.lines = NOW.lines;
    air.tick(now, dt, _song, curLine);
  }

  /* ---------- the frame ---------- */
  function resize() {
    const w = innerWidth,
      h = innerHeight,
      pr = renderer.getPixelRatio();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (motes) motes.material.uniforms.px.value = (pr * h) / 800;
  }
  onW('resize', resize);
  let frameN = 0,
    last = performance.now(),
    accent = 0,
    motion = 0,
    swell = 0,
    lastClock = null,
    beatPush = 0,
    ringsOn = 0;
  // the scene's colour: the whole atmosphere takes the cover's colour — walls, floor, vaults, the shade, the air and its
  // haze, the beams, their pools, the windows' glow and the motes — kept light (a pale, airy version of the colour), so
  // the cathedral changes its mood with every song and stays readable. The furniture's accents keep their own colours.
  // About two seconds to move to a new song's colour; with no song (or no colour) it returns to the wheat house tones.
  let tintBase = null;
  const tintNow = new THREE.Color(),
    tintGoal = new THREE.Color();
  let tintAmt = 0,
    tintAmtGoal = 0,
    tintSig = '';
  const _hsl = { h: 0, s: 0, l: 0 },
    _a = new THREE.Color(),
    _b = new THREE.Color();
  // a tone of the colour at a given lightness and a share of its saturation (so a vivid cover still gives a calm room)
  const tone = (out, src, l, sMul, sMin = 0.18, sMax = 0.62) => {
    src.getHSL(_hsl);
    return out.setHSL(_hsl.h, Math.min(sMax, Math.max(sMin, _hsl.s * sMul)) * Math.min(1, _hsl.s * 4), l);
  };
  function tintTick(dt) {
    if (!tintBase) {
      tintBase = {
        surf: [MAT.paper, MAT.floor, MAT.oat, MAT.ivory, MAT.taupe].map((m) => [m, m.color.clone()]),
        baked: BAKED.map((m) => [m, m.color.clone(), m.userData.top.value.clone(), !m.userData.sky]),
        wash: WASH_TOP.value.clone(),
        amb: ambLight.color.clone(),
        haze: dream.mat.uniforms.haze.value.clone(),
        bg: scene.background.clone(),
        beam: shafts.mat.uniforms.col.value.clone(),
        mote: motes ? motes.material.uniforms.col.value.clone() : null,
        glass: glassList.map((m) => [m, m.material.uniforms?.warm?.value.clone()]).filter((x) => x[1]),
        glare: glares.map((g) => [g, g.material.color.clone()]),
      };
    }
    const rgb = bind.tint();
    if (rgb) {
      tintGoal.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
      tintAmtGoal = 1;
    } else tintAmtGoal = 0;
    const k = Math.max(0, Math.min(1, dt / 0.7));
    tintNow.lerp(tintGoal, k);
    tintAmt += (tintAmtGoal - tintAmt) * k;
    if (!tintBase.mote && motes) {
      tintBase.mote = motes.material.uniforms.col.value.clone();
      tintSig = '';
    }
    const sig = tintNow.getHexString() + tintAmt.toFixed(3) + S.fxTint;
    if (sig === tintSig) return;
    tintSig = sig;
    const A = tintAmt * Math.max(0, Math.min(1, S.fxTint)),
      B = tintBase; // (the settings' colour knob scales it all)
    // surfaces: a pale tone of the colour, strongly (the walls carry the room's mood)
    B.surf.forEach(([m, base], i) => {
      tone(_a, tintNow, i === 0 ? 0.74 : i === 1 ? 0.66 : 0.8, i === 1 ? 0.55 : 0.7);
      m.color.copy(base).lerp(_a, A * (i === 0 ? 0.62 : 0.5));
    });
    B.baked.forEach(([m, lo, top, tintTop]) => {
      tone(_a, tintNow, 0.7, 0.6);
      m.color.copy(lo).lerp(_a, A * 0.55);
      if (tintTop) {
        tone(_b, tintNow, 0.86, 0.55);
        m.userData.top.value.copy(top).lerp(_b, A * 0.55);
      }
    });
    tone(_a, tintNow, 0.9, 0.6);
    WASH_TOP.value.copy(B.wash).lerp(_a, A * 0.6);
    // the shade and the air
    tone(_a, tintNow, 0.5, 0.7);
    ambLight.color.copy(B.amb).lerp(_a.multiplyScalar(1.3), A * 0.45);
    tone(_a, tintNow, 0.8, 0.6);
    dream.mat.uniforms.haze.value.copy(B.haze).lerp(_a, A * 0.65);
    scene.background.copy(B.bg).lerp(_a, A * 0.65);
    // the light itself: beams, pools, the windows' glow, the dust in the air
    tone(_a, tintNow, 0.8, 1.1, 0.3, 0.85);
    shafts.mat.uniforms.col.value.copy(B.beam).lerp(_a, A * 0.85);
    lightPools.forEach((m) => m.material.color.set('#fff').lerp(_a, A * 0.7));
    if (B.mote) motes.material.uniforms.col.value.copy(B.mote).lerp(_a, A * 0.85);
    B.glass.forEach(([m, w]) => m.material.uniforms.warm.value.copy(w).lerp(_a, A * 0.6));
    B.glare.forEach(([g, c]) => g.material.color.copy(c).lerp(_b.copy(_a).multiplyScalar(1.5), A * 0.6));
    // the accents: the lyrics' outline and the beat rings take a deep tone of the colour (clay with none)
    tone(_a, tintNow, 0.5, 1.2, 0.38, 0.8);
    air.tint.edge.value.set(C.clay).lerp(_a, A);
    tone(_b, tintNow, 0.44, 0.9, 0.3, 0.7);
    air.tint.top.value.set('#6E5A49').lerp(_b, A);
    tone(_b, tintNow, 0.12, 0.7, 0.2, 0.5);
    air.tint.bottom.value.set(C.ink).lerp(_b, A * 0.8);
    beatFloor.material.uniforms.col.value.set(C.clay).lerp(_a, A);
    tone(_b, tintNow, 0.78, 1, 0.3, 0.85);
    beatFloor.material.uniforms.hot.value.set(C.apricot).lerp(_b, A * 0.8);
  }
  const gp = new V3(),
    gd = new V3(),
    camDir = new V3();
  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    frameN++;
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now; // (the first frame can be stamped before the loop began)
    NOW = fakeNow ? { ...fakeNow, t: ((performance.now() - fakeNow.t0) / 1000) * (fakeNow.rate || 1) } : bind.now();
    songT = NOW.t;
    {
      const u = seeking != null ? seeking : NOW.dur ? Math.min(1, NOW.t / NOW.dur) : 0,
        w = (u * 100).toFixed(2);
      if (w !== barW) {
        barW = w;
        $('p-bar').style.width = w + '%';
        $('p-seek').setAttribute('aria-valuenow', String(Math.round(u * 100)));
      }
    }
    if (NOW.playing !== playing) {
      playing = NOW.playing;
      $('pp').textContent = playing ? '❚❚' : '▶';
      $('pp').setAttribute('aria-label', ts(playing ? 'pause' : 'play'));
    }
    sound.ambientTick(now, !!NOW.busy);
    if (paused) return; // (the small window, or the window down in the taskbar: nothing of the scene is worked out or drawn)
    if (NOW.id !== nowId) {
      nowId = NOW.id;
      $('p-title').textContent = NOW.title || ts('nothing');
      $('p-sub').textContent = [NOW.artist, NOW.album].filter(Boolean).join(' · ');
      altarArt.material.map = covers.get(NOW.coverFull, NOW.id || 'none');
      altarArt.material.needsUpdate = true;
      lineTex.forEach((t) => t.dispose());
      lineTex.clear();
      lyricMeshes.forEach((L) => {
        L.idx = -1;
        L.m.visible = false;
      });
      air.reset();
    }
    curLine = lineAt(NOW.t);
    capTick();
    const afloat = locked && immersive();
    walk.steer({
      forward: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
      right: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
      up:
        (keys.has('KeyE') || (afloat && keys.has('Space')) ? 1 : 0) -
        (keys.has('KeyQ') || (afloat && (keys.has('ShiftLeft') || keys.has('ShiftRight'))) ? 1 : 0),
    });
    rig.step(now, dt);
    const reg = regionAt(me.pos);
    if (reg && !reg.door && reg.room !== room) onRoom(reg.room);
    if (shownAt && me.pos.distanceTo(shownAt) > REACH + 3) {
      shownAt = null;
      chosenSong = -1;
      ui.show(null);
    }
    const bob = RM() ? 0 : Math.sin((now / 1000) * 0.7) * 0.02;
    const view = rig.pose;
    camera.position.set(view.pos.x, view.pos.y + bob, view.pos.z);
    camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
    stepRail(dt, now);
    const railKey = hoverSong + ':' + chosenSong;
    if (liftTick(dt) || (frameN % 15 === 0 && room === 'dome')) bowlDirty = true;
    if (Math.abs(tierGoal - tierAt) > 0.001 || Math.abs(tierVel) > 0.001 || railKey !== lastRailKey || bowlDirty) {
      lastRailKey = railKey;
      bowlDirty = false;
      layoutBowl();
    }
    // only the living things move with the music: branches sway, the beams breathe
    // everything stays still; only the motes answer the music
    const R = playing && NOW.id ? bind.rhythm(NOW.t) : null,
      P = bind.prefs();
    // the beams: always lit; an accent lifts them (up within ~80 ms, back over ~half a second), nothing else moves them
    const swellIn = R && P.beatBeams && !RM() ? R.dip * S.fxBeat : 0;
    swell = swellIn > swell ? swell + (swellIn - swell) * Math.min(1, dt / 0.03) : swell * Math.exp(-dt / 0.22);
    // the scene breathes with every event: at most 4 % brighter, deeper on the heavy ones (well under a flash's 10 %)
    // the beat itself (as the effect lyrics' woofer pushes): a quick push on every event, its weight from the rhythm
    let push = 0,
      nR = 0;
    const live = (!!R || !!fakeBeats) && !RM();
    if (live) {
      const bl = fakeBeats ? fakeBeats.bl : bind.beatLen(NOW.t),
        Lr = 1.6 * bl;
      const evs = fakeBeats
        ? Array.from({ length: 4 }, (_, k) => {
            const t = (Math.floor(NOW.t / bl) - k) * bl,
              n = Math.round(t / bl);
            return { t, w: n % 4 ? 0.5 : 1.2, strong: n % 8 === 0 };
          })
        : bind.beats(NOW.t - Lr, NOW.t);
      for (const e of evs) {
        const dtE = NOW.t - e.t;
        if (dtE < 0) continue;
        push = Math.max(push, e.w * Math.min(1, dtE / 0.03) * Math.exp(-dtE / 0.16));
        const u = dtE / Lr;
        if (u >= 1 || nR >= 8) continue;
        const r = 1 - Math.pow(1 - u, 2.5),
          al = Math.pow(1 - u, 1.25) * Math.min(1, u * 20) * e.w;
        RINGS[nR++].set(
          2.3 + r * 9.6 * (0.8 + 0.2 * e.w),
          (0.05 + 0.07 * e.w) * (1 - 0.35 * u) * (e.strong ? 1.5 : 1),
          al * 0.7 * S.fxBeat,
          e.strong ? 1 : 0,
        );
      }
      push *= S.fxBeat;
    }
    beatFloor.material.uniforms.n.value = nR;
    beatFloor.material.uniforms.glow.value = live ? push * 0.8 : 0;
    beatFloor.visible = nR > 0 || push > 0.01;
    // the scene breathes with every beat: brighter on each push, deeper on the accents (the scene pulse setting)
    dream.pulse = live && P.pulse ? Math.min(0.15, 0.1 * push + 0.05 * swell) * S.fxPulse : 0;
    beatPush = live ? push : 0;
    tintTick(dt);
    // the clear-sky panels brighten with the accents as the beams do
    for (const d of domes) if (d.sky?.material?.color) d.sky.material.color.setScalar(1.05 * (1 + 0.35 * swell));
    shafts.mat.uniforms.gain.value =
      0.145 * (S.beams ? 1 : 0) * S.fxBeams * (1 + 0.9 * swell + (P.beatBeams ? 0.35 * beatPush : 0));
    // the floor of the crossing: ripples spread out every 8 s; pools follow the beat and breathe on their own phase
    lightPools.forEach((m, k) => {
      const t = now / 1000,
        j = Math.floor(k / 2);
      m.material.opacity = Math.min(
        1,
        (k % 2 ? 0.3 : 0.55) *
          (1 + 0.8 * swell + 0.9 * beatPush) *
          (1 + 0.08 * Math.sin(t * 0.19 + j * 2.3) * Math.sin(t * 0.29 + j * 5.1)),
      );
    });
    focusLight.intensity = 9 * (1 + 1.2 * beatPush + 0.6 * swell);
    // with no rhythm (nothing playing) the slow ripples every 8 s; with the music, its beat rings instead
    ripples.forEach((m, k) => {
      const u = (now / 1000 / 8 + k / 3) % 1;
      m.scale.setScalar(3.1 + u * 2.6);
      m.material.opacity = Math.sin(Math.PI * u) * 0.55 * (1 - Math.min(1, ringsOn));
    });
    ringsOn += ((live ? 1 : 0) - ringsOn) * Math.min(1, dt * 2);
    sconceTick(now, beatPush, swell);
    // accents slow the dust down (like the effect lyrics' slow-motion on heavy beats), then it eases back to speed
    if (R) {
      const step = lastClock == null ? 0 : R.clock - lastClock;
      lastClock = R.clock;
      motion += Math.max(0, Math.min(dt * 1.5, step));
      accent = RM() ? 0 : R.dip;
    } else {
      lastClock = null;
      if (!playing && sound.hearAccent(now)) accent = 1;
      accent = RM() ? 0 : accent * Math.exp(-dt / 1.1);
      motion += dt * (1 - 0.85 * accent);
    }
    if (motes) {
      const u = motes.material.uniforms;
      u.time.value = motion;
      u.accent.value = accent;
      u.still.value = RM() ? 1 : 0;
    }
    // windows glare when you face them
    glares.forEach((g) => {
      g.getWorldPosition(gp);
      g.parent.getWorldDirection(gd);
      const f = Math.max(0, -gd.dot(camDir.set(0, 0, -1).applyQuaternion(camera.quaternion))),
        dist = gp.distanceTo(camera.position);
      g.material.opacity = Math.pow(f, 6) * 0.75 * Math.min(1, dist / 6);
    });
    hoverTick();
    dream.step(dt);
    audioTick(dt);
    lyricsTick(now, dt);
    if (locked && immersive() && frameN % 4 === 0) reticleHover();
    wallTick(dt);
    if (shadowDirty) {
      shadowDirty = false;
      renderer.shadowMap.needsUpdate = true;
    }
    atlas.flush(now);
    // one bad frame (a texture the GPU refuses, say) must not stop the picture: it is reported, the next frame tries again
    try {
      composer.render();
      renderErrors = 0;
    } catch (e) {
      if (renderErrors++ < 3) console.error('[space] frame', e);
    }
  }
  window.__cad = {
    fakeNow: (o) => {
      fakeNow = o ? { ...o, t0: performance.now() } : null;
    },
    fakeBeats: (bl) => {
      fakeBeats = bl ? { bl } : null;
    },
    tint: () => [tintAmt, tintNow.getHexString(), MAT.paper.color.getHexString(), JSON.stringify(bind.tint())],
    scene: () => scene,
    lights: () => {
      if (!LIGHTS) lightsBuild();
      return LIGHTS.map((L) => [L.room, +L.p.x.toFixed(1), +L.p.y.toFixed(1), +L.p.z.toFixed(1), +L.size.toFixed(1)]);
    },
    faceLight: (k) => {
      const L = LIGHTS[k],
        d = L.p.clone().sub(me.pos);
      me.yaw = Math.atan2(-d.x, -d.z);
      me.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    },
    exp: () => [dream.exposure, dream.lum],
    overlaps: () => {
      world.updateMatrixWorld(true);
      const bx = furniture.map((g) => {
          const b = new THREE.Box3();
          g.traverse((o) => {
            if (o.isMesh && !o.userData.thin && !noLine.includes(o)) b.expandByObject(o);
          });
          return b.expandByScalar(-0.04);
        }),
        out = [];
      for (let i = 0; i < bx.length; i++)
        for (let j = i + 1; j < bx.length; j++)
          if (bx[i].max.y > 0.05 && bx[j].max.y > 0.05 && bx[i].intersectsBox(bx[j]))
            out.push([
              i,
              j,
              bx[i]
                .getCenter(new V3())
                .toArray()
                .map((v) => +v.toFixed(1)),
              bx[j]
                .getCenter(new V3())
                .toArray()
                .map((v) => +v.toFixed(1)),
            ]);
      return out;
    },
    rest: (x, y, z) => air.restAt(x, y, z),
    hits: (x, y) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, (-(y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray
        .intersectObjects(scene.children, true)
        .slice(0, 6)
        .map((h) => [
          h.object.type,
          h.object.geometry?.type,
          h.object.material?.type,
          h.object.material?.color?.getHexString?.() || '',
          +h.distance.toFixed(2),
          h.point
            .toArray()
            .map((v) => +v.toFixed(2))
            .join(','),
          h.object.material?.transparent ? 'T' : '',
          h.object.material?.blending,
        ]);
    },
    pick: (x, y) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, (-(y - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects([...pickables, ...occluders], false)[0];
      return h ? [h.object.userData.kind || '-', +h.distance.toFixed(2), JSON.stringify(pickAt(x, y))] : null;
    },
    C: () => [SANCT.c.x, SANCT.c.z, CROSS.c.x, CROSS.c.z],
    camera: () => camera,
    sitAt: () => {
      const s = sofas.find((x) => Math.abs(x.seat.z - (SANCT.c.z + 0.9)) < 0.5);
      if (s) {
        me.pos.copy(s.seat);
        me.yaw = s.yaw;
        me.pitch = -0.04;
        walk.seated = true;
        walk.halt();
      }
    },
    sound: () => sound,
    // (the view: 'walk', or the rooms as a set of shots — `shot` goes to one)
    rig: (name, shot) => {
      rig = name === 'shots' ? shots : walk;
      if (shot != null) shots.go(shot);
      return rig;
    },
    lyr: () => air,
    room: () => room,
    regionAt: (x, y, z) => regionAt(new V3(x, y, z)),
    LINKS,
    CROSS,
    NAVE,
    wheel: (d) => {
      tierGoal = Math.max(-0.35, Math.min(TIERS - 0.65, tierGoal + d / 110));
      wheelRest = performance.now();
    },
    rail: () => [tierAt, tierGoal],
    setRail: (v) => {
      tierAt = tierGoal = v;
      tierVel = 0;
      wheelRest = 0;
    },
    stand: (x, z, yaw, pitch = 0) => {
      me.pos.set(x, EYE, z);
      me.yaw = yaw;
      me.pitch = pitch;
      walk.halt();
    },
    go: (k) => {
      const P = PLACES[k];
      me.pos.copy(P.pos);
      me.yaw = P.yaw;
      me.pitch = P.pitch;
      walk.halt();
    },
    fly: (k) => setPlace(k),
    look: (y, p) => {
      me.yaw = y;
      me.pitch = p;
    },
    set: (k, v) => {
      S[k] = v;
      apply();
    },
  };
  const start = () => {
    apply();
    buildBeams();
    resize();
    layoutBowl();
    setPlace(room, false);
    $('loading').style.opacity = 0;
    setTimeout(() => ($('loading').hidden = true), 800);
    requestAnimationFrame(frame);
  };
  stations.forEach((s) => {
    const sec = SECTIONS.find((x) => x[0] === s.key);
    s.title.material.map = titleTex(sec[1], sec[2]);
    s.title.material.needsUpdate = true;
  });
  start();
  const offPrefs = bind.onPrefs((p) => {
    S = p;
    apply();
  });
  // a changed library rebuilds the rooms that show it (gathered by bind.ts)
  const offLibrary = bind.onLibrary((l) => {
    LIB = l;
    SONGS = l.songs;
    songById = new Map(SONGS.map((sg, i) => [sg.id, i]));
    listPg = Math.min(listPg, Math.max(1, Math.ceil(l.playlists.length / LIST_SLOTS)) - 1);
    PLAYLISTS = l.playlists.slice(listPg * LIST_SLOTS, (listPg + 1) * LIST_SLOTS);
    navePg = Math.min(navePg, navePages(l) - 1);
    ALBUMS = navePage(l, navePg);
    hideCards();
    buildNave();
    buildBowl();
    buildLists();
    layoutBowl();
  });

  return {
    pause: (on) => {
      paused = on;
    },
    takePointer: () => takePointer(),
    closed: () => {
      shownAt = null;
      chosenSong = -1;
      takePointer();
    },
    dispose() {
      alive = false;
      ac.abort();
      offLibrary();
      offPrefs();
      covers.dispose();
      thumbs.dispose();
      hiCovers.dispose();
      atlas.dispose();
      sound.dispose();
      air.dispose();
      composer.dispose?.();
      renderer.dispose();
      delete window.__cad;
    },
  };
}
