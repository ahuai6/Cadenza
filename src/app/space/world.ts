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
import * as PL from './plan';
import { wallShape, slab, wallPanels, doorTube, bendRound, alongRound, standFlat, floorShape } from './shapes';
import AMBIENT from './ambient.ogg?url';

export interface SpaceUi {
  openSettings(section?: string): void;
  closeSettings(): void;
  /** open what was clicked (an album, a playlist, a song) where you stand, or close it */ show(
    d: { kind: 'album' | 'playlist' | 'song'; key: string } | null,
  ): void;
  /** the graphics context was lost (a driver reset, memory): the shell builds the scene again */ lost(): void;
  /** what can be done with what the reticle is on, as a menu at (x, y) (the pointer is let out for it) */ menu(
    d: { kind: 'album' | 'playlist' | 'song'; key: string },
    x: number,
    y: number,
  ): void;
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
  // (dusk with a light interface, midnight with a dark one — docs/SPACE.md: the same colours, at midnight darker and
  // cooler; the lamps keep their warmth)
  const NIGHT = !!S.night;
  const C = NIGHT
    ? {
        wheat: '#2A2F45',
        oat: '#343A52',
        ivory: '#474E68',
        taupe: '#3D4259',
        ink: '#0C0E17',
        clay: '#A9604B',
        kraft: '#94775D',
        olive: '#67765A',
        mist: '#62799B',
        apricot: '#FFD9A8',
        text: '#EAE4D8',
        sub: '#A6A1B8',
        sky0: '#1B2447',
        sky1: '#060A1A',
        ceil0: '#23283A',
        ceil1: '#2E3449',
        beam: '#A9BEE6',
        // (each room's own colour, docs/SPACE.md 第 3 節: the atrium a sky blue-grey, the ring apricot, the collection
        // room sage, the listening room dusk violet, the studio sand)
        walls: { atrium: '#2B3347', gallery: '#3A3142', lists: '#2B3838', listening: '#2F2C48', settings: '#3A3530' },
      }
    : {
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
        text: '#29241F',
        sub: '#7a6f63',
        sky0: '#F3C9A0',
        sky1: '#8EA5C8',
        ceil0: '#D4C5AA',
        ceil1: '#E2D5BC',
        beam: '#FFE3B8',
        walls: { atrium: '#D9DEE0', gallery: '#EDD5BD', lists: '#D3DAC6', listening: '#D3CFDF', settings: '#E8DABF' },
      };
  C.paper = C.wheat;
  const ROOM_COL = { gallery: C.clay, atrium: C.olive, lists: C.mist, settings: C.kraft, listening: C.clay };

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
  scene.background = new THREE.Color(NIGHT ? '#151a2b' : C.wheat);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 160);

  /* ---------- light: a cool ambient paints the shade colour, one warm sun paints the light ---------- */
  // the one sun (at midnight, the moon): the shadows, every shaft of light through a window or a well and the patch it
  // lights on the floor all come from this one direction — no second, mirrored sun for the windows on the shaded side
  const SUN_DIR = new V3(0.42, 1, 0.18).normalize();
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const ambLight = new THREE.AmbientLight(NIGHT ? lin(0.5, 0.52, 0.66) : lin(0.72, 0.68, 0.64), Math.PI);
  scene.add(ambLight); // a little lower: the room was too bright
  // (at dusk a low warm sun; at midnight the moon: cool and faint)
  const sun = new THREE.DirectionalLight(NIGHT ? lin(0.16, 0.19, 0.27) : lin(0.38, 0.31, 0.2), Math.PI);
  sun.castShadow = true;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.09;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(NIGHT ? lin(0.06, 0.07, 0.1) : lin(0.12, 0.11, 0.1), Math.PI);
  // (the sky's own light, from the side away from the sun: the shade of round things turns toward it, never a second sun)
  fill.position.set(-SUN_DIR.x, 0.75, -SUN_DIR.z);
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
    atrium: baked('#D2C2A6', '#EFE5D2', 14, 30, { side: THREE.BackSide, shadowSide: THREE.DoubleSide }),
    vault: baked('#D4C5AA', '#E2D5BC', 14, 21, {}),
    tunnel: baked('#CDBEA2', '#D9CBB0', 0, 8, {}),
    floor: toon(C.oat),
  };
  const roomMat = { gallery: MAT.clay, atrium: MAT.olive, lists: MAT.mist, settings: MAT.kraft, listening: MAT.clay };

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
  // text set in a width: the size it is drawn at shrinks until it fits (down to `min`); still too long, it ends in an
  // ellipsis — never cut off at the edge of its texture (a long album title once lost its last letters)
  const fitText = (g, text, maxW, font, px, min) => {
    let p = px;
    g.font = font(p);
    while (p > min && g.measureText(text).width > maxW) g.font = font((p -= 2));
    let t = text;
    if (g.measureText(t).width > maxW) {
      const cs = [...t];
      while (cs.length > 1 && g.measureText(cs.join('') + '…').width > maxW) cs.pop();
      t = cs.join('').trimEnd() + '…';
    }
    return t;
  };
  const labelTex = (title, sub, w = 512) =>
    textTex(w, 140, (g, W, h) => {
      g.fillStyle = C.text;
      g.fillText(
        fitText(g, title, W - 20, (p) => `500 ${p}px "Noto Serif TC", serif`, 46, 30),
        8,
        56,
      );
      g.fillStyle = C.sub;
      g.fillText(
        fitText(g, sub, W - 20, (p) => `italic 400 ${p}px "Source Serif 4", serif`, 30, 22),
        8,
        108,
      );
    });
  // (the lyrics' face is the settings' lyric font: the one the lyrics in the air use)
  // a line on the sanctuary's paper: one row when it fits, smaller if a little long, two rows (broken at a space where it can) if longer
  const lyricTex = (t) =>
    textTex(1600, 180, (g, w, h) => {
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = C.text;
      // (a wide margin, and a little room on what the canvas measures: a face's own glyphs can run past its advance)
      const maxW = (w - 200) * 0.94;
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
      g.fillStyle = C.text;
      g.font = '700 132px "Noto Serif TC", serif';
      g.fillText(zh, w / 2, 140);
      g.fillStyle = C.sub;
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
  const DUSK = softTex('255,150,90', 0.9),
    GLOW = softTex('255,227,184', 1),
    BLOB = softTex('110,92,70', 1);
  const boxUV = (g) => g;
  // a pointed arch outline from (-w/2,0) up over the apex to (w/2,0): two circular arcs meeting at the apex
  // (a round arch: a semicircle on straight sides — docs/SPACE.md, no pointed arches)
  function archPts(w, h, n = 14) {
    const W = w / 2,
      r = Math.min(h, W),
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
        // (what is all but clear is not drawn at all: a square of next to nothing still showed its edges on some GPUs)
        alphaTest: 0.01,
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

  /* ---------- the plan (plan.ts): a round atrium open to the sky, a ring gallery round it, three rooms off the ring;
     every wall drawn flat and stood up or bent round (shapes.ts), every doorway round ---------- */
  const T = PL.T;
  const v3 = (p, y = 0) => new V3(p.x, y, p.z);
  const CROSS = { c: v3(PL.A), r: PL.ATRIUM.r, h: PL.ATRIUM.h };
  const LISTS = { c: v3(PL.centre('lists')), ...PL.ROOMS.lists };
  const SETS = { c: v3(PL.centre('settings')), ...PL.ROOMS.settings };
  const SANCT = { c: v3(PL.centre('listening')), ...PL.ROOMS.listening };
  // (where each round wall's flat drawing begins: a way with no doorway or window on it)
  const SEAM = 0.3;
  const MAT_CEIL = baked(C.ceil0, C.ceil1, 0, 12, { side: THREE.DoubleSide });
  {
    const b = PL.bounds(8),
      f = mesh(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0), MAT.floor, world, false);
    f.rotation.x = -Math.PI / 2;
    f.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  }
  // a round wall about c: its doorways and windows at compass ways
  // (a room's walls: its own colour, lightening toward the ceiling as every wall does)
  const WALL = {};
  const wallMat = (room) => (WALL[room] ||= skyWash(toon(C.walls[room])));
  function roundWall(c, r, h, doors, wins = [], mat = MAT.paper) {
    const U = (th) => alongRound(th, r, SEAM),
      // (drawn in panels: a doorway's arc never joined to corners metres away — see wallPanels)
      g = wallPanels(
        Math.PI * 2 * r,
        h,
        doors.map(U),
        wins.map((w) => ({ u: U(w.th), y: w.y, r: w.r })),
        T,
        1.1,
      );
    bendRound(g, r, c.x, c.z, SEAM);
    return mesh(g, mat);
  }
  // a flat ring (or a disc with a round hole) under a ceiling
  function ringRoof(c, r0, r1, y) {
    const s = new THREE.Shape();
    s.absarc(c.x, c.z, r1, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(c.x, c.z, r0, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return mesh(floorShape(s, y), MAT_CEIL);
  }
  // the sky over every open roof: a dome far out, its colour from the horizon up
  const skyMat = baked(C.sky0, C.sky1, 0, 60, { side: THREE.BackSide, fog: false });
  skyMat.userData.sky = true;
  {
    const s = new THREE.Mesh(new THREE.SphereGeometry(110, 48, 24), skyMat);
    s.position.set(CROSS.c.x, 0, CROSS.c.z);
    world.add(s);
    noLine.push(s);
  }
  const domes = [];
  const deg = Math.PI / 180;
  const RING_WINS = [
    { th: Math.PI, y: 3.3, r: 2.3 },
    { th: 22.5 * deg, y: 5.3, r: 0.8 },
    { th: 67.5 * deg, y: 5.3, r: 0.8 },
    { th: 112.5 * deg, y: 5.3, r: 0.8, sun: true },
    { th: 157.5 * deg, y: 5.3, r: 0.8, sun: true },
    { th: 256 * deg, y: 3.0, r: 0.85, dusk: true },
    { th: 284 * deg, y: 3.0, r: 0.85, dusk: true },
  ];
  // (one clear-sky picture for every skylight: blue in the middle, paler at its rim)
  let skyTexOnce = null;
  const skyPanelTex = () =>
    (skyTexOnce ||= textTex(256, 256, (g, w, h) => {
      // (dusk: warm in the middle, cooling to its rim; midnight: deep blue with stars)
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      const stops = NIGHT ? ['#1C2A5A', '#121B3E', '#0A1028'] : ['#F6B98C', '#E9B3A0', '#9FB3D6'];
      stops.forEach((c, k) => r.addColorStop(k / 2, c));
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
      if (NIGHT)
        for (let k = 0; k < 90; k++) {
          g.fillStyle = `rgba(255,248,230,${0.35 + rnd(k * 1.3) * 0.6})`;
          g.beginPath();
          g.arc(rnd(k * 2.1) * w, rnd(k * 3.7) * h, 0.6 + rnd(k * 5.3) * 1.3, 0, 7);
          g.fill();
        }
    }));
  // an open circle in a roof: a round shaft up through the roof's thickness, the far sky beyond it — seen through a
  // well, as the windows are seen through their walls, never a picture of sky laid just above the hole (its edge showed
  // as a circle)
  const skylight = (c, r, y) => {
    const depth = r > 4 ? 2.4 : 1.2,
      shaft = mesh(new THREE.CylinderGeometry(r, r, depth, r > 4 ? 72 : 36, 1, true), MAT_CEIL);
    shaft.position.set(c.x, y + depth / 2, c.z);
    // (the shaft's rim on the roof, seen from inside the well: a ring as wide as the roof is thick)
    {
      const s = new THREE.Shape();
      s.absarc(c.x, c.z, r + 0.6, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(c.x, c.z, r, 0, Math.PI * 2, true);
      s.holes.push(hole);
      mesh(floorShape(s, y + depth, false), MAT_CEIL);
    }
    domes.push({ c: c.clone(), r, y, sky: null });
  };
  // far out in the sky: the sun (high, where the light through the windows and the wells comes from) — at midnight, the
  // moon — and, low in the west, a setting sun seen only through the ring's two western windows (dusk only)
  {
    const disc = (dir, dist, size, col, glow, glowSize) => {
      const p = new V3(CROSS.c.x, 0, CROSS.c.z).addScaledVector(dir, dist),
        g = new THREE.Group();
      g.position.copy(p);
      g.lookAt(CROSS.c.x, p.y * 0.2, CROSS.c.z);
      const d = new THREE.Mesh(
        new THREE.CircleGeometry(size, 48),
        flat(col, { fog: false, transparent: true, depthWrite: false }),
      );
      const h = new THREE.Mesh(
        new THREE.PlaneGeometry(glowSize, glowSize * 0.75),
        flat(glow, { map: GLOW, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      h.position.z = -0.5;
      g.add(h, d);
      world.add(g);
      noLine.push(d, h);
      return g;
    };
    const sun = SUN_DIR.clone();
    disc(sun, 96, NIGHT ? 3.2 : 4.2, NIGHT ? '#E9E6DA' : '#FFF4DE', NIGHT ? '#8A93B8' : '#FFD9A6', NIGHT ? 26 : 40);
    if (!NIGHT) {
      const west = new V3(-1, Math.tan((4 * Math.PI) / 180), 0).normalize();
      disc(west, 96, 5.5, '#FFB067', '#FF8A4C', 70);
    }
    if (NIGHT) {
      // (the night sky's stars, far out over the roof: what the wells and the windows look into)
      const pts = [];
      for (let k = 0; k < 500; k++) {
        const az = rnd(k * 1.31) * Math.PI * 2,
          el = 0.08 + rnd(k * 2.77) * 1.4,
          R = 100;
        pts.push(
          CROSS.c.x + Math.cos(el) * Math.sin(az) * R,
          Math.sin(el) * R,
          CROSS.c.z - Math.cos(el) * Math.cos(az) * R,
        );
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const st = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: '#FFF6E2',
          size: 0.5,
          sizeAttenuation: true,
          fog: false,
          transparent: true,
          opacity: 0.85,
        }),
      );
      world.add(st);
      noLine.push(st);
    }
  }
  // the atrium: one round wall, a doorway each way, round windows between them onto the ring; open to the sky
  {
    const wins = [];
    for (let q = 1; q < 8; q += 2)
      for (const o of [-0.27, 0, 0.27]) wins.push({ th: (q * Math.PI) / 4 + o, y: 4.3, r: 0.95 });
    roundWall(CROSS.c, PL.ATRIUM.r, PL.ATRIUM.h, PL.ATRIUM_DOORS, wins, wallMat('atrium'));
    ringRoof(CROSS.c, PL.ATRIUM.oculus, PL.ATRIUM.r + T, PL.ATRIUM.h);
    skylight(CROSS.c, PL.ATRIUM.oculus, PL.ATRIUM.h);
  }
  // the ring: its outer wall (a doorway to each room, a great round window to the south), its low ceiling
  // (the great window to the south looks away from the sun; high over the albums, two windows face the sun and pour it
  // in, two more just let the sky in; low, either side of the studio's door, two look west at the setting sun)
  roundWall(CROSS.c, PL.RING.r1, PL.RING.h, PL.RING_DOORS, RING_WINS, wallMat('gallery'));
  ringRoof(CROSS.c, PL.ATRIUM.r + T / 2, PL.RING.r1 + T, PL.RING.h);
  // the rooms off the ring, each through a short round passage: only its lining, a little narrower than the doorways it
  // joins, from the middle of the ring's wall to the middle of the room's — the two ends cut to each wall's own curve.
  // (It was a block with the doorway through it, its ends inside both walls: its lining and theirs lay on each other and
  // flickered, and against a round room's wall its flat end's corners came through.)
  for (const id of ['lists', 'settings', 'listening']) {
    const R = PL.ROOMS[id],
      P = (al, la) => v3(PL.at(R.th, al, la));
    {
      const ringMid = (la) => Math.sqrt((PL.RING.r1 + T / 2) ** 2 - la * la),
        alC = PL.ROOM_IN + (R.kind === 'rect' ? 0 : R.r),
        roomMid = (la) =>
          R.kind === 'rect' ? PL.ROOM_IN - T / 2 : alC - Math.sqrt(Math.max(0, (R.r + T / 2) ** 2 - la * la));
      const b0 = roomMid(0),
        g = doorTube(1);
      // (z 0 → the room's wall, 1 → the ring's: each end moved onto its wall's middle at its own distance across)
      const Pp = g.attributes.position;
      for (let i = 0; i < Pp.count; i++) {
        const x = Pp.getX(i),
          z = Pp.getZ(i);
        Pp.setZ(i, b0 - (z < 0.5 ? roomMid(x) : ringMid(x)));
      }
      Pp.needsUpdate = true;
      mesh(standFlat(g, P(b0, 0), P(b0, 1)), wallMat('gallery'));
    }
    const c = v3(PL.centre(id));
    if (R.kind === 'rect') {
      const n0 = PL.ROOM_IN,
        n1 = n0 + R.d,
        hw = R.w / 2,
        wall = (p0, p1, len, doors) => mesh(standFlat(slab(wallShape(len, R.h, doors), T), p0, p1), wallMat(id));
      // (each wall runs on past its corner by its thickness, so the corners are solid)
      wall(P(n0, -hw), P(n0, hw), R.w + T, [hw]);
      wall(P(n0, hw), P(n1, hw), R.d + T, []);
      wall(P(n1, hw), P(n1, -hw), R.w + T, []);
      wall(P(n1, -hw), P(n0, -hw), R.d + T, []);
      const cs = new THREE.Shape(
        [P(n0 - T, -hw - T), P(n1 + T, -hw - T), P(n1 + T, hw + T), P(n0 - T, hw + T)].map((p) => new V2(p.x, p.z)),
      );
      const hole = new THREE.Path();
      hole.absarc(c.x, c.z, 1.6, 0, Math.PI * 2, true);
      cs.holes.push(hole);
      mesh(floorShape(cs, R.h), MAT_CEIL);
    } else {
      roundWall(c, R.r, R.h, [PL.norm(R.th + Math.PI)], [], wallMat(id));
      ringRoof(c, 1.6, R.r + T, R.h);
    }
    skylight(c, 1.6, R.h);
  }
  const albumSlots = PL.ALBUM_SLOTS.map((s) => ({ x: s.x, z: s.z, ry: s.ry, side: 1 }));

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
  // a single chair (docs/SPACE.md, 單人沙發): a low rounded shell — seat and arms in one — a loose seat cushion on it,
  // a soft capsule leaning against its back. Faces +z in its own frame.
  function armchair(mat, x, z, ry) {
    const g = new THREE.Group();
    // (the shell: a base, and arms and back rising from it, all with soft round edges)
    mesh(rbox(1.08, 0.36, 0.96, 0.16), mat, g).position.y = 0.18;
    for (const s of [-1, 1]) mesh(rbox(0.2, 0.6, 0.96, 0.1), mat, g).position.set(s * 0.44, 0.3, 0);
    mesh(rbox(1.08, 0.72, 0.2, 0.1), mat, g).position.set(0, 0.36, -0.38);
    // (the seat cushion: loose, a little dished)
    const seat = mesh(rbox(0.68, 0.14, 0.74, 0.07), MAT.ivory, g);
    seat.position.set(0, 0.43, 0.06);
    seat.scale.set(1, 0.9, 1);
    // (the back cushion: a capsule lying across, leaning back)
    const back = mesh(new THREE.CapsuleGeometry(0.15, 0.5, 8, 16), MAT.ivory, g);
    back.rotation.set(-0.35, 0, Math.PI / 2);
    back.position.set(0, 0.68, -0.22);
    put(g, x, z, ry);
    blob(x, z, 1.6, 1.5);
    g.traverse((o) => {
      if (o.isMesh) o.userData = { kind: 'sofa', i: sofas.length };
    });
    sofas.push({ g, seat: new V3(x, 1.05, z), yaw: ry + Math.PI });
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
  // three slender vases (docs/SPACE.md, 枝葉花瓶): a tall one, a bottle, a low round one
  const VASES = [
    [
      [0, 0],
      [0.13, 0.02],
      [0.17, 0.22],
      [0.15, 0.62],
      [0.07, 0.92],
      [0.065, 1.08],
      [0.085, 1.14],
    ],
    [
      [0, 0],
      [0.15, 0.02],
      [0.25, 0.18],
      [0.25, 0.38],
      [0.1, 0.58],
      [0.065, 0.84],
      [0.085, 0.9],
    ],
    [
      [0, 0],
      [0.22, 0.02],
      [0.4, 0.16],
      [0.46, 0.3],
      [0.44, 0.34],
    ],
  ];
  // (the branches move, very slightly, by themselves: never with the beat, never enough to catch the eye)
  const swaying = [];
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
      swaying.push({ o: hold, x0: hold.rotation.x, ph: rnd(x * 7 + z * 3 + k) * 6.28 });
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

  // a point in a room off the ring, in its own frame: `al` out from the atrium's centre, `la` to the right
  const inRoom = (id, al, la = 0) => PL.at(PL.ROOMS[id].th, al, la);
  // the ring: a single chair in each quarter by the atrium wall, turned to the albums, a vase either side of it
  [MAT.clay, MAT.olive, MAT.mist, MAT.kraft].forEach((m, k) => {
    const th = ((2 * k + 1) * Math.PI) / 4,
      p = PL.at(th, PL.RING.r0 + 1.4);
    armchair(m, p.x, p.z, Math.PI - th);
    for (const s of [-1, 1]) {
      const q = PL.at(th + s * 0.17, PL.RING.r0 + 0.9);
      vase(k % 3, s < 0 ? MAT.ivory : MAT.kraft, q.x, q.z, 0, 2 + (k % 2), 0.8);
    }
  });
  // either side of the great window to the south: an ornament on the floor
  {
    const a = PL.at(Math.PI - 0.16, PL.RING.r1 - 1.3),
      b = PL.at(Math.PI + 0.16, PL.RING.r1 - 1.3);
    ornament('sphereCube', a.x, a.z, 0.3, MAT.kraft, MAT.clay);
    ornament('halfArch', b.x, b.z, -0.4, MAT.mist);
  }
  // the atrium: a shallow round pool at the centre with the sky in it, a ring sofa round its rim, ornaments by the
  // doorways
  rugRound(CROSS.c.x, CROSS.c.z, [
    [3.6, MAT.oat],
    [3.05, MAT.ivory],
    [2.15, toon('#AFC6D0')],
    [1.2, toon('#BFD3DB')],
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
  // (and under each room's skylight, a smaller one)
  for (const R of [LISTS, SETS, SANCT]) pool(new V3(R.c.x, 0, R.c.z), 1.3);
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
  // the collection room: a reading corner under its skylight
  {
    const r = inRoom('lists', PL.ROOM_IN + 5, 1.6);
    rugRound(r.x, r.z, [
      [2.8, MAT.mist],
      [2.2, MAT.oat],
    ]);
    const ch = inRoom('lists', PL.ROOM_IN + 4.2, 2.8),
      tb = inRoom('lists', PL.ROOM_IN + 5, 1.6);
    armchair(MAT.mist, ch.x, ch.z, Math.PI * 0.75);
    table(tb.x, tb.z);
    vase(0, MAT.clay, tb.x, tb.z, 0.6, 2, 0.55);
    const v = inRoom('lists', PL.ROOM_IN + 1.2, -5.2),
      o = inRoom('lists', PL.ROOM_IN + 1.2, 5.2);
    vase(1, MAT.ivory, v.x, v.z, 0, 3);
    ornament('cone', o.x, o.z, 0, MAT.kraft);
  }
  // the studio: a rug inside the arc of plinths, a vase and an ornament by the door
  {
    const r = inRoom('settings', PL.ROOM_IN + 5.6);
    rugRound(r.x, r.z, [
      [2.6, MAT.kraft],
      [2.0, MAT.oat],
    ]);
    const v = inRoom('settings', PL.ROOM_IN + 1.2, -5.2),
      o = inRoom('settings', PL.ROOM_IN + 1.2, 5.2);
    vase(2, MAT.olive, v.x, v.z, 0, 3, 1.1);
    ornament('halfArch', o.x, o.z, 1.2, MAT.clay);
  }
  // the listening room: a round sunken floor and, in its middle, one long sofa square to the front — the way the sound
  // field faces (its centre sculpture straight ahead, the two surrounds behind the shoulders) — a low table before it
  // and a single chair either side, turned in a little: a living room, not a stage
  {
    const c = SANCT.c,
      th = PL.ROOMS.listening.th,
      f = { x: Math.sin(th), z: -Math.cos(th) },
      at = (fwd, side) => ({ x: c.x + f.x * fwd - f.z * side, z: c.z + f.z * fwd + f.x * side });
    rugRound(c.x, c.z, [
      [4.7, MAT.oat],
      [4.4, MAT.clay],
      [3.9, MAT.ivory],
    ]);
    {
      const p = at(-0.9, 0);
      sofa(3.4, MAT.olive, p.x, p.z, Math.atan2(f.x, f.z));
    }
    for (const [side, m] of [
      [-1, MAT.mist],
      [1, MAT.kraft],
    ]) {
      const p = at(0.5, side * 2.9),
        // (facing across the sofa's front, turned a little toward the front of the room)
        a = Math.atan2(c.x + f.x * 1.6 - p.x, c.z + f.z * 1.6 - p.z);
      armchair(m, p.x, p.z, a);
    }
    {
      const p = at(0.8, 0);
      table(p.x, p.z);
    }
    // (between the sound field's sculptures)
    for (const [a, k] of [
      [1.25, 0],
      [-1.5, 2],
    ]) {
      const x = c.x + Math.sin(a + Math.PI / 2) * 5.8,
        z = c.z - Math.cos(a + Math.PI / 2) * 5.8;
      vase(k, MAT.kraft, x, z, 0, 3, 1.15);
    }
  }

  /* ---------- on the walls: sconces that glow (and swell with the beat), hangings, prints and shelves, so no wall is bare ---------- */
  // a point on the inside of a round wall about c (at compass way th, a height, just off its face), facing in
  const onArc = (c, r, th, y, off = 0.05) => ({
    x: c.x + Math.sin(th) * (r - off),
    y,
    z: c.z - Math.cos(th) * (r - off),
    ry: -th,
  });
  // a point on one of a room's flat walls ('far', 'left', 'right' as you come in), `along` it from its middle
  const onFlat = (id, wall, along, y, off = 0.05) => {
    const R = PL.ROOMS[id],
      th = R.th,
      f = (x, z) => Math.atan2(x, z);
    if (wall === 'far') {
      const p = PL.at(th, PL.ROOM_IN + R.d - off, along);
      return { ...p, y, ry: f(-Math.sin(th), Math.cos(th)) };
    }
    const s = wall === 'right' ? 1 : -1,
      p = PL.at(th, PL.ROOM_IN + R.d / 2 + along, s * (R.w / 2 - off));
    return { ...p, y, ry: f(-s * Math.cos(th), -s * Math.sin(th)) };
  };
  const hang = (g, w) => {
    g.position.set(w.x, w.y, w.z);
    g.rotation.y = w.ry;
    world.add(g);
    return g;
  };
  const sconces = [];
  const BULB = new THREE.Color(1.7, 1.38, 0.98);
  // a sconce (docs/SPACE.md, 壁燈): a half disc standing out from the wall like a shallow dish, its light thrown up the
  // wall in a soft fan; the lamp itself only a warm line along the dish's rim, never looked into
  const FAN = textTex(128, 128, (g, w, h) => {
    // (a glow brightest at the dish — a quarter of the way up its square, not on its edge, where it was cut off in a
    // straight line — fading to nothing well inside the square on every side, so no edge of the square is ever seen)
    const cy = h * 0.75,
      r = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, w * 0.42);
    r.addColorStop(0, 'rgba(255,236,205,.95)');
    r.addColorStop(0.4, 'rgba(255,226,190,.35)');
    r.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
  function sconce(w) {
    const g = hang(new THREE.Group(), w);
    // (the dish: a half disc, flat side to the wall, a little thicker at its rim than a plate)
    const dish = mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.09, 32, 1, false, -Math.PI / 2, Math.PI), MAT.ivory, g);
    dish.position.set(0, 0, 0.005);
    const bulb = new THREE.Mesh(
      new THREE.CylinderGeometry(0.255, 0.255, 0.012, 32, 1, false, -Math.PI / 2, Math.PI),
      flat(BULB.clone()),
    );
    bulb.position.set(0, 0.05, 0.01);
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
    halo.scale.set(1.1, 0.55, 1);
    halo.position.set(0, 0.1, 0.12);
    g.add(halo);
    noLine.push(halo);
    // (the glow's middle on the dish: a quarter of the way up the square)
    const wash = soft(g, FAN, 2.6, 2.6, 0, 0.63, 0.012, 0, 0, 0.36, true);
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
  // the ring: a sconce between every two albums, and either side of each doorway
  for (let q = 1; q < 8; q += 2)
    for (const o of [-15, 0, 15]) sconce(onArc(CROSS.c, PL.RING.r1, (q * Math.PI) / 4 + (o * Math.PI) / 180, 3.2));
  // the atrium: sconces high on its wall, above the songs, between the round windows
  for (let q = 1; q < 8; q += 2)
    for (const o of [-0.135, 0.135]) sconce(onArc(CROSS.c, PL.ATRIUM.r, (q * Math.PI) / 4 + o, 7.4));
  // the rooms: sconces on their walls; prints and shelves on the free ones
  // (in the collection room clear of the playlists' arches: two on each side wall, near its ends)
  for (const w of ['left', 'right']) for (const a of [-4.3, 4.3]) sconce(onFlat('lists', w, a, 3.3));
  for (const w of ['left', 'right']) for (const a of [-2.6, 2.6]) sconce(onFlat('settings', w, a, 3.3));
  for (const a of [-4.6, 4.6]) sconce(onFlat('settings', 'far', a, 3.3));
  // (the listening room's round wall: never on the far side, where the song's picture is, nor by the doorway)
  for (const a of [-135, -90, -45, 45, 90, 135])
    sconce(onArc(SANCT.c, SANCT.r, PL.ROOMS.listening.th + (a * Math.PI) / 180, 3.3));
  print(onFlat('settings', 'left', 0, 2.5), 1.5, 1.2, [C.kraft, C.clay, C.olive], 11);
  print(onFlat('settings', 'right', 0, 2.5), 1.5, 1.2, [C.olive, C.mist, C.clay], 13);
  {
    const back = PL.ROOMS.listening.th + Math.PI;
    print(onArc(SANCT.c, SANCT.r, back + 0.45, 2.7), 1.3, 1.7, [C.clay, C.olive, C.mist, C.kraft], 3);
    print(onArc(SANCT.c, SANCT.r, back - 0.45, 2.7), 1.3, 1.7, [C.mist, C.kraft, C.clay, C.olive], 7);
    shelf(onArc(SANCT.c, SANCT.r, back + 1.35, 1.5), 1.9, 2);
    shelf(onArc(SANCT.c, SANCT.r, back - 1.35, 1.5), 1.9, 5);
  }

  // midnight: small stars on the walls, each glowing and fading at its own slow pace (like luminous paint, not a window)
  let wallStars = null;
  if (NIGHT) {
    const pts = [],
      seeds = [],
      add = (x, y, z) => {
        pts.push(x, y, z);
        seeds.push(rnd(pts.length * 0.37));
      };
    // (on the inside of each round wall, a little off its face; never in a doorway or a window)
    const onRound = (c, r, h, n, k0, inward) => {
      for (let k = 0; k < n; k++) {
        const th = rnd(k0 + k * 1.7) * Math.PI * 2,
          y = 0.9 + rnd(k0 + k * 3.1) * (h - 1.4),
          rr = r + (inward ? -0.04 : 0.04),
          p = { x: c.x + Math.sin(th) * rr, z: c.z - Math.cos(th) * rr };
        const lat = Math.min(...[...PL.ATRIUM_DOORS, ...PL.RING_DOORS].map((d) => Math.abs(PL.turn(th, d)))) * r;
        if (y < PL.DOOR_TOP + 0.3 && lat < PL.DOOR_HALF + 1.2) continue;
        if (r === PL.RING.r1 && RING_WINS.some((w) => Math.hypot(Math.abs(PL.turn(th, w.th)) * r, y - w.y) < w.r + 0.4))
          continue;
        add(p.x, y, p.z);
      }
    };
    onRound(CROSS.c, PL.ATRIUM.r, PL.ATRIUM.h, 520, 11, true);
    onRound(CROSS.c, PL.RING.r0, PL.RING.h, 380, 29, false);
    onRound(CROSS.c, PL.RING.r1, PL.RING.h, 520, 47, true);
    onRound(SANCT.c, PL.ROOMS.listening.r, PL.ROOMS.listening.h, 160, 71, true);
    for (const id of ['lists', 'settings'])
      for (const w of ['left', 'right', 'far'])
        for (let k = 0; k < 70; k++) {
          const half = w === 'far' ? PL.ROOMS[id].w / 2 : PL.ROOMS[id].d / 2,
            q = onFlat(
              id,
              w,
              (rnd(k * 2.3 + w.length) * 2 - 1) * (half - 0.3),
              0.9 + rnd(k * 4.1 + id.length) * 6,
              0.04,
            );
          add(q.x, q.y, q.z);
        }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    wallStars = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { time: { value: 0 }, px: { value: 1 } },
        vertexShader: `#include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float time, px; attribute float seed; varying float vA;
  void main(){ vec4 mv = modelViewMatrix*vec4(position, 1.); float dz = -mv.z;
    vA = (.35 + .65*(.5 + .5*sin(time*(.25 + seed*.6) + seed*40.)))*(1. - smoothstep(18., 40., dz));
    gl_PointSize = px*(1.2 + fract(seed*13.7)*1.6)*6./max(1., dz); gl_Position = projectionMatrix*mv;
  #include <logdepthbuf_vertex>
  }`,
        fragmentShader: `#include <common>
  #include <logdepthbuf_pars_fragment>
  varying float vA; void main(){
  #include <logdepthbuf_fragment>
   float d = length(gl_PointCoord-.5); if (d > .5) discard; gl_FragColor = vec4(vec3(1., .94, .82)*vA*smoothstep(.5, .1, d), 1.); }`,
      }),
    );
    wallStars.frustumCulled = false;
    wallStars.renderOrder = 5;
    scene.add(wallStars);
    noLine.push(wallStars);
  }

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
  // (each wall segment shades only the floor within a couple of metres of it: the map is filled segment by segment)
  {
    const B = PL.bounds(8),
      W = B.x1 - B.x0,
      H = B.z1 - B.z0,
      X0 = B.x0,
      Z0 = B.z1,
      RES = 0.15,
      nx = Math.round(W / RES),
      nz = Math.round(H / RES),
      REACH = 2.6;
    const dist = new Float32Array(nx * nz).fill(1e9);
    for (const [ax, az, bx, bz] of PL.wallSegments(Math.PI / 64)) {
      const vx = bx - ax,
        vz = bz - az,
        L2 = vx * vx + vz * vz || 1e-9,
        i0 = Math.max(0, Math.floor((Math.min(ax, bx) - REACH - X0) / RES)),
        i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + REACH - X0) / RES)),
        j0 = Math.max(0, Math.floor((Z0 - Math.max(az, bz) - REACH) / RES)),
        j1 = Math.min(nz - 1, Math.ceil((Z0 - Math.min(az, bz) + REACH) / RES));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = X0 + (i + 0.5) * RES,
            z = Z0 - (j + 0.5) * RES,
            t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)),
            dx = x - ax - vx * t,
            dz = z - az - vz * t,
            q = dx * dx + dz * dz,
            o = j * nx + i;
          if (q < dist[o]) dist[o] = q;
        }
    }
    const data = new Uint8Array(nx * nz * 4);
    for (let o = 0; o < nx * nz; o++) {
      const v = Math.round(255 * (1 - 0.3 * Math.exp(-Math.sqrt(dist[o]) / 0.55)));
      data[o * 4] = data[o * 4 + 1] = data[o * 4 + 2] = v;
      data[o * 4 + 3] = 255;
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
            X0.toFixed(3) +
            ')) / ' +
            W.toFixed(3) +
            ', (' +
            Z0.toFixed(3) +
            ' - fw.z) / ' +
            H.toFixed(3) +
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
  /* ---------- albums in the gallery: one even row, thin ink frames ---------- */
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
          g.fillStyle = C.text;
          g.font = '500 34px "Noto Serif TC", serif';
          g.textAlign = 'center';
          g.fillText(s.title, w / 2, 38);
          g.fillStyle = C.sub;
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
          g.fillStyle = C.sub;
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
    // the large one on the far wall facing the door, two either side of it, two on each side wall
    const spots = [
      onFlat('lists', 'far', 0, 0, 0.02),
      onFlat('lists', 'far', -3.9, 0, 0.02),
      onFlat('lists', 'far', 3.9, 0, 0.02),
      onFlat('lists', 'left', 2.3, 0, 0.02),
      onFlat('lists', 'right', 2.3, 0, 0.02),
      onFlat('lists', 'left', -2.3, 0, 0.02),
      onFlat('lists', 'right', -2.3, 0, 0.02),
    ];
    spots.forEach((w, k) => {
      const pl = PLAYLISTS[k];
      if (!pl) return;
      const big = k === 0,
        aw = big ? 3.8 : 2.5,
        ah = big ? 5.4 : 3.7,
        art = big ? 2.5 : 1.6;
      const grp = new THREE.Group();
      grp.position.set(w.x, 0, w.z);
      grp.rotation.y = w.ry;
      world.add(grp);
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
      listMeshes.push({ grp, plq, im, panel: k });
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
    // (in the room's own frame: out from the atrium is deeper in, the arc bulging away from the door)
    const th = (k - 2) * 0.52,
      R = 2.7,
      mid = PL.ROOM_IN + PL.ROOMS.settings.d / 2,
      p = inRoom('settings', mid + 0.6 + Math.cos(th) * R, Math.sin(th) * R),
      door = inRoom('settings', mid - 3.4),
      x = p.x,
      z = p.z;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    grp.rotation.y = Math.atan2(door.x - x, door.z - z);
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
    // (on the far wall, at the height of a person sitting: the song's picture is a window in the wall, not a thing raised up)
    // (stood off the round wall: flat things laid on a curved wall had their ends buried in it, the wall cutting their
    // edges into a ragged line — the lines' board read as torn paper)
    const w = onArc(SANCT.c, SANCT.r, PL.ROOMS.listening.th, 0, 0.42),
      rer = new THREE.Group();
    rer.position.set(w.x, 0, w.z);
    rer.rotation.y = w.ry;
    // (drawn as before, at seven tenths: the room is low)
    rer.scale.setScalar(0.7);
    world.add(rer);
    {
      // (the arch deep enough to reach back into the wall)
      const arch = mesh(extrude(new THREE.Shape(archPts(6.2, 10)), 0.7), MAT.clay, rer);
      arch.position.set(0, 0.4, -0.6);
    }
    mesh(box(3.3, 3.3, 0.05), MAT.ink, rer).position.set(0, 7.3, 0.14);
    altarArt.position.set(0, 7.3, 0.17);
    rer.add(altarArt);
    // the lines' board: a plain rounded panel, wider than the lines on it (not a sheet of paper with ragged ink edges)
    {
      const W = 6.0,
        H = 3.8,
        r = 0.32,
        sh = new THREE.Shape();
      sh.moveTo(-W / 2 + r, -H / 2);
      sh.lineTo(W / 2 - r, -H / 2);
      sh.absarc(W / 2 - r, -H / 2 + r, r, -Math.PI / 2, 0, false);
      sh.lineTo(W / 2, H / 2 - r);
      sh.absarc(W / 2 - r, H / 2 - r, r, 0, Math.PI / 2, false);
      sh.lineTo(-W / 2 + r, H / 2);
      sh.absarc(-W / 2 + r, H / 2 - r, r, Math.PI / 2, Math.PI, false);
      sh.lineTo(-W / 2, -H / 2 + r);
      sh.absarc(-W / 2 + r, -H / 2 + r, r, Math.PI, Math.PI * 1.5, false);
      const board = mesh(extrude(sh, 0.05), MAT.ivory, rer);
      board.position.set(0, 3.2, 0.12);
      // (no ink round it: the hand-drawn line wavered along its edge and made it read as torn paper)
      noLine.push(board);
    }
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
        const sd = n.dot(SUN_DIR) >= 0.2 ? SUN_DIR : null;
        if (sd) prism(pts, (p) => p.clone().addScaledVector(sd, -p.y / sd.y), true, beamK(null));
      }
    });
    // the ring's sunlit windows: a shaft of sun through each, down onto the floor
    for (const w of RING_WINS.filter((x) => x.sun)) {
      const r = PL.RING.r1,
        pts = Array.from({ length: 20 }, (_, k) => {
          const a = (k / 20) * Math.PI * 2,
            th = w.th + (Math.cos(a) * w.r) / r;
          return new V3(CROSS.c.x + Math.sin(th) * r, w.y + Math.sin(a) * w.r, CROSS.c.z - Math.cos(th) * r);
        });
      prism(pts, (p) => p.clone().addScaledVector(SUN_DIR, -p.y / SUN_DIR.y), true, beamK(null));
    }
    // each well in a roof: the sun through it, slanting as the shadows do, onto the patch of floor the sun really lights
    // (what is seen through both the well's mouth and its top: the mouth's circle carried down the sun's way, drawn in by
    // half the shift the well's depth makes). It once fell straight down onto the middle of the room, wherever the sun was.
    domes.forEach((d) => {
      const depth = d.r > 4 ? 2.4 : 1.2,
        k = SUN_DIR.x / SUN_DIR.y,
        q = SUN_DIR.z / SUN_DIR.y,
        shift = depth * Math.hypot(k, q),
        rr = Math.max(0.3, d.r - shift / 2),
        top = new V3(d.c.x - k * depth * 0.5, d.y, d.c.z - q * depth * 0.5);
      const pts = Array.from(
        { length: 28 },
        (_, j) =>
          new V3(top.x + Math.cos((j / 28) * Math.PI * 2) * rr, d.y, top.z + Math.sin((j / 28) * Math.PI * 2) * rr),
      );
      prism(
        pts,
        (p) => p.clone().addScaledVector(SUN_DIR, -p.y / SUN_DIR.y),
        true,
        beamK(null) * (d.r > 4 ? 0.8 : 0.6),
      );
      d.land = new V3(top.x - k * d.y, 0, top.z - q * d.y);
    });
    // dusk: the setting sun low through the two western windows, across the ring onto its inner wall, warm
    if (!NIGHT)
      for (const w of RING_WINS.filter((x) => x.dusk)) {
        const r = PL.RING.r1,
          c = new V3(CROSS.c.x + Math.sin(w.th) * r, w.y, CROSS.c.z - Math.cos(w.th) * r),
          dir = new V3(1, -Math.tan((4 * Math.PI) / 180), 0).normalize();
        // (where the ray meets the inner wall: the first crossing of the circle r0 ahead of it)
        const ox = c.x - CROSS.c.x,
          oz = c.z - CROSS.c.z,
          bq = ox * dir.x + oz * dir.z,
          cq = ox * ox + oz * oz - PL.RING.r0 ** 2,
          disc = bq * bq - cq;
        if (disc < 0) continue;
        const t = -bq - Math.sqrt(disc);
        if (t <= 0) continue;
        const hit = c.clone().addScaledVector(dir, t),
          n = new V3(hit.x - CROSS.c.x, 0, hit.z - CROSS.c.z).normalize();
        segs.push([c.clone(), hit.clone(), w.r * 0.8, w.r * 1.1, 0.55]);
        const glow = soft(
          world,
          DUSK,
          w.r * 4.2,
          w.r * 3,
          hit.x + n.x * 0.05,
          hit.y,
          hit.z + n.z * 0.05,
          0,
          0,
          0.75,
          true,
        );
        glow.rotation.set(0, Math.atan2(n.x, n.z), 0);
      }
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
    // (boxes: centre x, z, half-widths, floor, top — the ring as the box round it, the atrium inside it counted twice)
    const vols = [
      [CROSS.c.x, CROSS.c.z, PL.RING.r1, PL.RING.r1, 0, PL.RING.h],
      [CROSS.c.x, CROSS.c.z, 12.5, 12.5, 0, 18],
      [SETS.c.x, SETS.c.z, 5.4, 5.4, 0, 7.4],
      [LISTS.c.x, LISTS.c.z, 5.4, 5.4, 0, 7.4],
      [SANCT.c.x, SANCT.c.z, 6.2, 6.2, 0, 7.4],
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
          col: { value: new THREE.Color(C.beam) },
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
    C.beam,
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
    const B = PL.bounds(2),
      center = new V3((B.x0 + B.x1) / 2, 8, (B.z0 + B.z1) / 2);
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
    for (const x of [B.x0, B.x1])
      for (const y of [-1, 16])
        for (const z of [B.z1, B.z0]) {
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
  /* ---------- rooms, doors and routes (plan.ts) ---------- */
  const regionAt = (p) => PL.regionAt({ x: p.x, z: p.z });
  const SIGNS = {
    gallery: ['The Gallery', `${ts('room.gallery')} · ${ts('room.gallery.sub')}`],
    atrium: ['The Atrium', `${ts('room.atrium')} · ${ts('room.atrium.sub')}`],
    lists: ['The Collection', `${ts('room.lists')} · ${ts('room.lists.sub')}`],
    listening: ['The Listening Room', `${ts('room.listening')} · ${ts('room.listening.sub')}`],
    settings: ['The Studio', `${ts('room.settings')} · ${ts('room.settings.sub')}`],
  };
  const PLACES = Object.fromEntries(
    Object.entries(PL.PLACES).map(([k, P]) => [k, { pos: v3(P.at, EYE), yaw: P.yaw, pitch: P.pitch, sign: SIGNS[k] }]),
  );
  // the way through the building, as plan.ts lays it: out through the doorways and round the ring
  const route = (from, to, target) =>
    PL.route(from, to, { x: me.pos.x, z: me.pos.z }, target && { x: target.x, z: target.z }).map((p) => v3(p, EYE));
  // (each room's own doorway, and the doorway of the room it opens from, at ear height: where sound comes through)
  const doorOf = (r) =>
    r === 'gallery' || r === 'atrium'
      ? v3(PL.at(Math.PI, PL.ATRIUM.r + T / 2), EYE)
      : v3(PL.at(PL.ROOMS[r].th, PL.ROOM_IN - T / 2), EYE);
  const crossDoorOf = (r) =>
    r === 'gallery' || r === 'atrium'
      ? v3(PL.at(Math.PI, PL.ATRIUM.r + T / 2), EYE)
      : v3(PL.at(PL.ROOMS[r].th, PL.RING.r1 + T / 2), EYE);
  const inAtrium = (p, m = 0) => Math.hypot(p.x - CROSS.c.x, p.z - CROSS.c.z) < PL.ATRIUM.r - m;

  /* ---------- walking, looking, flying ---------- */
  // (rigs/walk.ts walks; this scene's part is where one may stand, the way through its doorways, and the veil that
  // stands in for a flight under reduced motion)
  const walk = new WalkRig({
    start: { pos: PLACES.gallery.pos, yaw: 0, pitch: 0.05 },
    eye: EYE,
    region: regionAt,
    route: (to) => route(room, regionAt(to)?.room || room, to),
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
    place = 'gallery',
    room = 'gallery';
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
    show({ kind: 'song', key: SONGS[i].id }, room === 'atrium' ? at : null);
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
    // immersive, the view held: the right button opens what can be done with what the reticle is on, where it is
    if (e.button === 2 && locked) {
      menuAt(innerWidth / 2, innerHeight / 2);
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
      else if (h.kind === 'radio') radioTake();
    }
  });
  // what can be done with the thing at (x, y), as a menu there: the library's own commands (an album, a song, a playlist)
  function menuAt(x, y) {
    const h = pickAt(x, y);
    if (!h) return false;
    if (h.far) {
      reachHint(x, y);
      return false;
    }
    const d =
      h.kind === 'album'
        ? ALBUMS[h.i] && { kind: 'album', key: ALBUMS[h.i].key }
        : h.kind === 'song'
          ? SONGS[h.i] && { kind: 'song', key: SONGS[h.i].id }
          : h.kind === 'playlist'
            ? PLAYLISTS[h.i] && { kind: 'playlist', key: PLAYLISTS[h.i].id }
            : null;
    if (!d) return false;
    $('tip').hidden = true;
    freePointer();
    ui.menu(d, x, y);
    return true;
  }
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
    h.kind === 'radio'
      ? [ts('radio'), ts(radio.held ? 'radio.drop' : 'radio.take')]
      : h.kind === 'sofa'
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
      if (room === 'atrium' && inAtrium(me.pos, 1)) {
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
    if (e.code === 'KeyG' && radio.held) {
      radioTake(false);
      return;
    }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'gallery') {
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
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'atrium') {
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
  // (each speaker turned to the middle of its room)
  const speakerAt = (room, p, c) => ({ room, pos: v3(p, 1.1), ry: Math.atan2(c.x - p.x, c.z - p.z) });
  const SPEAKERS = [
    speakerAt('gallery', PL.at(Math.PI + 0.26, PL.RING.r1 - 1.3), CROSS.c),
    { room: 'atrium', pos: new V3(CROSS.c.x, 0.6, CROSS.c.z), pool: true },
    speakerAt('lists', inRoom('lists', PL.ROOM_IN + PL.ROOMS.lists.d - 1.2, -4.8), LISTS.c),
    speakerAt('settings', inRoom('settings', PL.ROOM_IN + PL.ROOMS.settings.d - 1.2, 4.8), SETS.c),
  ];
  // the listening room's sound field (docs/SPACE.md, 六聲道): six sculptures round the chairs, as a 5.1 room is laid
  // out about a listener facing the song's picture — the centre ahead, left and right a little either side, the two
  // surrounds behind the shoulders, the low notes on the floor to one side. Each plays its own part of the song.
  const FIELD = [
    ['C', 0],
    ['L', -30],
    ['R', 30],
    ['SL', -110],
    ['SR', 110],
    ['LFE', -62],
  ].map(([feed, deg]) => {
    const th = PL.ROOMS.listening.th + (deg * Math.PI) / 180,
      r = feed === 'LFE' ? 4.9 : 5.5,
      p = { x: SANCT.c.x + Math.sin(th) * r, z: SANCT.c.z - Math.cos(th) * r };
    return {
      room: 'listening',
      pos: v3(p, feed === 'LFE' ? 0.4 : 1.35),
      ry: Math.atan2(SANCT.c.x - p.x, SANCT.c.z - p.z),
      feed,
      field: true,
      level: feed === 'LFE' ? 0.6 : 0.45,
    };
  });
  SPEAKERS.push(...FIELD);
  // (each sculpture: a slender stem and a sphere for the five; a low wide drum for the lowest notes; a ring of light
  // round its middle that shows while it sounds)
  FIELD.forEach((s) => {
    const g = new THREE.Group();
    g.position.set(s.pos.x, 0, s.pos.z);
    g.rotation.y = s.ry;
    world.add(g);
    furniture.push(g);
    const lo = s.feed === 'LFE';
    if (lo) {
      mesh(rbox(0.9, 0.62, 0.9, 0.3), MAT.taupe, g).position.y = 0.31;
      mesh(new THREE.CircleGeometry(0.26, 32), MAT.ink, g, false).position.set(0, 0.34, 0.452);
    } else {
      mesh(cyl(0.05, 0.08, 1.1, 16), MAT.ink, g).position.y = 0.55;
      mesh(cyl(0.22, 0.26, 0.05, 32), MAT.ink, g).position.y = 0.025;
      mesh(new THREE.SphereGeometry(0.27, 32, 20), MAT.ivory, g).position.y = 1.35;
      mesh(new THREE.CircleGeometry(0.13, 28), MAT.taupe, g, false).position.set(0, 1.35, 0.272);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(lo ? 0.47 : 0.29, 0.012, 8, 48),
      flat(new THREE.Color(2.0, 1.45, 0.85)),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = lo ? 0.64 : 1.35;
    g.add(ring);
    noLine.push(ring);
    s.led = ring;
    blob(s.pos.x, s.pos.z, lo ? 1.3 : 0.8, lo ? 1.3 : 0.8);
  });
  SPEAKERS.forEach((s) => {
    if (s.pool || s.field) return;
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

  /* ---------- the radio (docs/SPACE.md, 收音機): by the atrium's pool; picked up, the song comes from your hand; put
     down, it plays where it was left. It is one more source of the song, moving with whoever holds it ---------- */
  const radio = (() => {
    const g = new THREE.Group(),
      m = MAT.mist;
    mesh(rbox(0.46, 0.27, 0.15, 0.05), m, g).position.y = 0.135;
    // (the grille: a disc of fine rings; the dial: a small knob; the handle: a half ring over the top)
    const grille = mesh(new THREE.CircleGeometry(0.085, 32), MAT.taupe, g, false);
    grille.position.set(-0.1, 0.14, 0.077);
    const rim = mesh(new THREE.TorusGeometry(0.088, 0.012, 8, 32), MAT.ink, g);
    rim.position.set(-0.1, 0.14, 0.078);
    mesh(cyl(0.035, 0.035, 0.03, 20), MAT.ivory, g).rotation.x = Math.PI / 2;
    g.children.at(-1).position.set(0.12, 0.15, 0.08);
    const handle = mesh(new THREE.TorusGeometry(0.15, 0.016, 8, 24, Math.PI), MAT.ink, g);
    handle.position.set(0, 0.27, 0);
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.012, 12), flat(new THREE.Color(2.2, 1.4, 0.7)));
    led.position.set(0.12, 0.07, 0.077);
    g.add(led);
    noLine.push(led);
    const home = PL.at(Math.PI * 0.82, 4.4);
    g.position.set(home.x, 0, home.z);
    g.rotation.y = Math.atan2(CROSS.c.x - home.x, CROSS.c.z - home.z);
    world.add(g);
    g.traverse((o) => {
      if (o.isMesh) {
        o.userData = { kind: 'radio' };
        pickables.push(o);
      }
    });
    const blobAt = soft(world, BLOB, 0.7, 0.45, home.x, 0.012, home.z, -Math.PI / 2, 0, 0.3, false);
    return { g, led, blobAt, held: false, src: { room: 'atrium', pos: new V3(home.x, 0.2, home.z), radio: true } };
  })();
  SPEAKERS.push(radio.src);
  const _rf = new V3(),
    _rr = new V3();
  // held: low in the right of the view, turned with it; put down: on the floor a step ahead (or at your feet, if a wall
  // is in the way)
  function radioTick() {
    const R = radio;
    if (R.held) {
      // (from the camera's own turn this frame, not its last drawn matrix: the radio never trails the view)
      _rf.set(0, 0, -1).applyQuaternion(camera.quaternion);
      _rr.set(1, 0, 0).applyQuaternion(camera.quaternion);
      // (a little smaller in the hand than on the floor, its face to you, clear of the player card)
      R.g.position
        .copy(camera.position)
        .addScaledVector(_rf, 0.72)
        .addScaledVector(_rr, 0.2)
        .add(new V3(0, -0.26, 0));
      R.g.rotation.set(0.25, me.yaw, 0, 'YXZ');
      R.g.scale.setScalar(0.78);
      R.src.pos.copy(R.g.position);
      R.src.room = room;
    }
    R.led.visible = !!R.src.lit;
  }
  function radioTake(on = !radio.held) {
    const R = radio;
    if (on === R.held) return;
    R.held = on;
    R.blobAt.visible = !on;
    if (!on) {
      const ahead = new V3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)),
        p = me.pos.clone().addScaledVector(ahead, 1.1).setY(0),
        at = regionAt(p) ? p : me.pos.clone().addScaledVector(ahead, 0.35).setY(0);
      R.g.position.copy(at);
      R.g.rotation.set(0, me.yaw, 0);
      R.g.scale.setScalar(1);
      R.blobAt.position.set(at.x, 0.012, at.z);
      R.src.pos.set(at.x, 0.2, at.z);
      R.src.room = regionAt(at)?.room || room;
      shadowDirty = true;
    }
  }

  /* ---------- the song in the rooms, and the rooms' own music (systems/audio.ts): this scene's part is its speakers,
     its rooms' reverb times, and the way sound walks through its doorways ---------- */
  // (sound leaves a room by its doorway onto the ring — the atrium by its doorway nearest the other end — and comes
  // into the other the same way)
  const exitsOf = (r, toward) => {
    if (r === 'gallery') return [];
    if (r === 'atrium') {
      const th = PL.polar({ x: toward.x, z: toward.z }).th,
        d = PL.ATRIUM_DOORS.reduce((m, x) => (Math.abs(PL.turn(th, x)) < Math.abs(PL.turn(th, m)) ? x : m));
      return [v3(PL.at(d, PL.ATRIUM.r + T / 2), EYE)];
    }
    return [doorOf(r), crossDoorOf(r)];
  };
  function soundPath(L, Lroom, S, Sroom) {
    if (Lroom === Sroom) return [L, S];
    return [L, ...exitsOf(Lroom, S), ...exitsOf(Sroom, L).reverse(), S];
  }
  const sound = new RoomAudio({
    audio: () => bind.audio(),
    sources: SPEAKERS,
    ambientFrom: SPEAKERS[1],
    // (a room's speaker, the next one through a doorway, and the radio)
    voices: 3,
    ambientUrl: AMBIENT,
    reverb: { gallery: 3.2, atrium: 4.5, lists: 1.8, settings: 1.8, listening: 2.4 },
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
  const _listener = { pos: camera.position, quat: camera.quaternion, room: 'gallery' };
  function audioTick(dt) {
    _listener.room = room;
    radioTick();
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
    origin: () => (room === 'listening' ? lyricMeshes[0].m.getWorldPosition(new V3()) : null),
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
    if (wallStars) wallStars.material.uniforms.px.value = (pr * h) / 800;
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
    // (at midnight every tone is taken far darker: the song colours the night, it never lights the room up)
    return out.setHSL(
      _hsl.h,
      Math.min(sMax, Math.max(sMin, _hsl.s * sMul)) * Math.min(1, _hsl.s * 4),
      NIGHT ? l * 0.3 : l,
    );
  };
  function tintTick(dt) {
    if (!tintBase) {
      tintBase = {
        // (the walls first — the plain ones, then each room's own — then the floor and the furniture's paper tones)
        surf: [MAT.paper, MAT.floor, MAT.oat, MAT.ivory, MAT.taupe, ...Object.values(WALL)].map((m) => [
          m,
          m.color.clone(),
        ]),
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
      const wall = i === 0 || i >= 5;
      tone(_a, tintNow, wall ? 0.74 : i === 1 ? 0.66 : 0.8, i === 1 ? 0.55 : 0.7);
      // (a room's own colour keeps more of itself)
      m.color.copy(base).lerp(_a, A * (i === 0 ? 0.62 : i >= 5 ? 0.42 : 0.5));
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
    if (liftTick(dt) || (frameN % 15 === 0 && room === 'atrium')) bowlDirty = true;
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
    // (the branches sway, a hair either way, each on its own slow phase)
    if (!RM()) {
      const tt = now / 1000;
      for (const b of swaying)
        b.o.rotation.x = b.x0 + 0.025 * Math.sin(tt * 0.5 + b.ph) * Math.sin(tt * 0.23 + b.ph * 2);
    }
    // (the wall stars twinkle on their own clock; held still under reduced motion)
    if (wallStars && !RM()) wallStars.material.uniforms.time.value = now / 1000;
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
    menuAt: (x, y) => menuAt(x, y),
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
      const s = sofas.find((x) => Math.hypot(x.seat.x - SANCT.c.x, x.seat.z - SANCT.c.z) < 4);
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
    CROSS,
    radio: () => ({ held: radio.held, room: radio.src.room, x: radio.src.pos.x, z: radio.src.pos.z }),
    field: () => FIELD.map((s) => s.feed),
    radioTake: (on) => radioTake(on),
    // (where to stand to face album place i, d metres in front of it)
    albumStand: (i, d = 3) => {
      const a = PL.ALBUM_SLOTS[i],
        p = PL.at(a.th, PL.RING.r1 - d);
      me.pos.set(p.x, EYE, p.z);
      me.yaw = -a.th;
      me.pitch = 0;
      walk.halt();
    },
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
