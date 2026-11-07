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
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { SpaceBind, SpaceNow } from './bind';
import { navePage, navePages, NAVE_SLOTS, LIST_SLOTS } from './data';
import { CoverCache, CoverAtlas } from './covers';
import { ts } from './i18n';
import AMBIENT from './ambient.ogg?url';

export interface SpaceUi { openSettings(section?: string): void; closeSettings(): void }
export function createWorld(bind: SpaceBind, ui: SpaceUi): { dispose(): void; takePointer(): void } {
  const ac = new AbortController(); let alive = true;
  const opt = (o) => ({ ...(typeof o === 'object' ? o : { capture: !!o }), signal: ac.signal });
  const onW = (t, f, o) => window.addEventListener(t, f, opt(o)), onD = (t, f, o) => document.addEventListener(t, f, opt(o));
  const SYS_RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const V2 = THREE.Vector2, V3 = THREE.Vector3;
  const EYE = 1.7;

  /* ---------- settings: Cadenza's own (the space's fields, the picture-quality mode), followed as they change ---------- */
  let S = bind.prefs();
  const RM = () => S.motion === 'reduced';

  /* ---------- the library, through bind.ts: songs by title (the crossing), albums sixteen to a page (the nave), playlists ---------- */
  let LIB = bind.library(), SONGS = LIB.songs, navePg = 0, ALBUMS = navePage(LIB, 0), listPg = 0, PLAYLISTS = LIB.playlists.slice(0, LIST_SLOTS);
  let songById = new Map(SONGS.map((s, i) => [s.id, i]));
  const covers = new CoverCache(512, 48), thumbs = new CoverCache(256, 96), atlas = new CoverAtlas(256);
  // the song playing, read from bind once a frame
  let NOW: SpaceNow = bind.now(), nowId = undefined, curLine = -1;

  /* ---------- palette: paper and shade make the space, ink makes the line, accents stay under 10% ---------- */
  const C = { wheat: '#E8DCC4', oat: '#D8C7A8', ivory: '#F5EEE0', taupe: '#BFAF97', ink: '#29241F', clay: '#D97757', kraft: '#C99A6E', olive: '#8C9A62', mist: '#8BA2BD', apricot: '#FFE3B8' };
  C.paper = C.wheat;
  const ROOM_COL = { nave: C.clay, dome: C.olive, lists: C.mist, settings: C.kraft, altar: C.clay };

  /* ---------- renderer: no tone mapping, so a flat colour stays the colour it was chosen as ---------- */
  const canvas = $('world');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false;   // soft edges on every cast shadow
  const scene = new THREE.Scene(); scene.background = new THREE.Color(C.wheat);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 160);

  /* ---------- light: a cool ambient paints the shade colour, one warm sun paints the light ---------- */
  const SUN_DIR = new V3(.42, 1, .18).normalize();
  const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b);
  const ambLight = new THREE.AmbientLight(lin(.72, .68, .64), Math.PI); scene.add(ambLight);   // a little lower: the room was too bright
  const sun = new THREE.DirectionalLight(lin(.34, .31, .22), Math.PI); sun.castShadow = true; sun.shadow.bias = -0.0004; sun.shadow.normalBias = .09; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(lin(.12, .11, .1), Math.PI); fill.position.set(-.6, .7, .9); scene.add(fill);   // no shadow: gives round things a second tone

  // two-tone ramp (shade | a narrow middle | light)
  const ramp = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 40, 40, 40, 255, 150, 150, 150, 255, 235, 235, 235, 255, 255, 255, 255, 255]), 6, 1); ramp.minFilter = ramp.magFilter = THREE.LinearFilter; ramp.needsUpdate = true;
  const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, ...o });
  const flat = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, ...o });
  // walls brighten from wheat at the floor to ivory under the vault: light comes from above
  const WASH_TOP = { value: new THREE.Color(C.ivory) };   // the colour the walls lighten toward under the vault (tinted by the cover)
  const skyWash = (m, y0 = 1, y1 = 18, k = .55) => { m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uWashTop, smoothstep(${y0.toFixed(1)}, ${y1.toFixed(1)}, vWY) * ${k.toFixed(2)});`).replace('#include <common>', '#include <common>\nuniform vec3 uWashTop;'); sh.uniforms.uWashTop = WASH_TOP; };
    m.customProgramCacheKey = () => 'wash' + y0 + y1 + k; return m; };
  // a baked surface: no lighting at all, only a vertical gradient chosen by hand
  const BAKED = [];
  const skyBaked = (...a) => { const m = baked(...a); m.userData.sky = true; return m; };
  function baked(lo, hi, y0, y1, o) { const m = flat(lo, o), top = { value: new THREE.Color(hi) }; m.userData.top = top; BAKED.push(m); m.onBeforeCompile = (sh) => { sh.uniforms.uTop = top;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <project_vertex>', '#include <project_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vWY; uniform vec3 uTop;').replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTop, smoothstep(${y0.toFixed(1)}, ${y1.toFixed(1)}, vWY));`); };
    m.customProgramCacheKey = () => 'baked' + lo + hi + y0 + y1; return m; }
  const MAT = { paper: skyWash(toon(C.wheat)), oat: toon(C.oat), ivory: toon(C.ivory), taupe: toon(C.taupe), clay: toon(C.clay), kraft: toon(C.kraft), olive: toon(C.olive), mist: toon(C.mist), ink: flat(C.ink),
    dome: baked('#D2C2A6', '#EFE5D2', 14, 30, { side: THREE.BackSide, shadowSide: THREE.DoubleSide }), vault: baked('#D4C5AA', '#E2D5BC', 14, 21, {}), tunnel: baked('#CDBEA2', '#D9CBB0', 0, 8, {}), floor: toon(C.oat) };
  const roomMat = { nave: MAT.clay, dome: MAT.olive, lists: MAT.mist, settings: MAT.kraft, altar: MAT.clay };

  /* ---------- canvases: covers, text, glass compositions ---------- */
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const textTex = (w, h, draw) => { const c = mk(w, h); draw(c.getContext('2d'), w, h); return tex(c); };
  const MORANDI = [['#c9b8a8', '#9aa597', '#e6ddd0'], ['#a9b4bc', '#d3c4b4', '#7d8a93'], ['#b99a8d', '#e4d8c8', '#8e9a8a'], ['#cfc2ae', '#a39486', '#e9e2d6'], ['#9fa8a0', '#c7b5a6', '#dcd3c3'], ['#b3a3ab', '#d8cdbf', '#8f8a7d'], ['#c4a99a', '#a9b0a3', '#ece4d8'], ['#a7a49a', '#d6c2b4', '#80878a']];
  const labelTex = (title, sub, w = 512) => textTex(w, 140, (g, W, h) => { g.fillStyle = C.ink; g.font = '500 46px "Noto Serif TC", serif'; g.fillText(title, 8, 56); g.fillStyle = '#7a6f63'; g.font = 'italic 400 30px "Source Serif 4", serif'; g.fillText(sub, 8, 108); });
  const lyricTex = (t) => textTex(1600, 180, (g, w, h) => { g.font = '700 118px "Noto Serif TC", serif'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = C.ink; g.fillText(t, w / 2, h / 2); });
  const titleTex = (zh, en) => textTex(1024, 260, (g, w, h) => { g.textAlign = 'center'; g.fillStyle = C.ink; g.font = '700 132px "Noto Serif TC", serif'; g.fillText(zh, w / 2, 140); g.fillStyle = '#7a6f63'; g.font = 'italic 400 56px "Source Serif 4", serif'; g.fillText(en, w / 2, 222); });
  // a window is a small composition of flat shapes, never leaded glass
  function glassTex(seed, cols) { const W = 256, H = 512, c = mk(W, H), g = c.getContext('2d'); g.fillStyle = '#FBF1DF'; g.fillRect(0, 0, W, H);
    const pick = (k) => cols[Math.floor(rnd(seed * 7 + k) * cols.length)];
    for (let k = 0; k < 5; k++) { const kind = Math.floor(rnd(seed * 3 + k * 11) * 4), x = rnd(seed + k * 5.1) * W, y = 60 + rnd(seed * 2 + k * 3.7) * (H - 60), r = 50 + rnd(seed + k) * 90; g.fillStyle = pick(k);
      g.beginPath(); if (kind === 0) g.arc(x, y, r, 0, 7); else if (kind === 1) { g.arc(x, y, r, Math.PI, 0); g.closePath(); } else if (kind === 2) { g.moveTo(x, y); g.arc(x, y, r * 1.3, 0, Math.PI / 2); g.closePath(); } else g.rect(x - r / 2, y - r / 2, r, r * 1.4); g.fill(); }
    return tex(c); }
  function roseTex() { const N = 1024, c = mk(N, N), g = c.getContext('2d'), m = N / 2; g.fillStyle = '#FBF1DF'; g.fillRect(0, 0, N, N);
    const cols = [C.clay, C.kraft, C.olive, C.mist, '#FBF1DF'];
    for (let s = 0; s < 12; s++) { const a0 = s / 12 * Math.PI * 2; g.fillStyle = cols[s % 4]; g.beginPath(); g.moveTo(m, m); g.arc(m, m, 500, a0, a0 + Math.PI / 12); g.closePath(); g.fill(); }
    for (const [r, k] of [[330, 4], [250, 2], [170, 0], [90, 4], [40, 1]]) { g.fillStyle = cols[k]; g.beginPath(); g.arc(m, m, r, 0, 7); g.fill(); }
    for (let s = 0; s < 6; s++) { const a = s / 6 * Math.PI * 2; g.fillStyle = cols[(s + 1) % 4]; g.beginPath(); g.arc(m + Math.cos(a) * 250, m + Math.sin(a) * 250, 62, 0, 7); g.fill(); }
    return tex(c); }

  const softTex = (rgb, a0) => textTex(256, 256, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, `rgba(${rgb},${a0})`); r.addColorStop(.55, `rgba(${rgb},${a0 * .45})`); r.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = r; g.fillRect(0, 0, w, h); });
  const GLOW = softTex('255,227,184', 1), BLOB = softTex('110,92,70', 1);
  const boxUV = (g) => g;
  // a pointed arch outline from (-w/2,0) up over the apex to (w/2,0): two circular arcs meeting at the apex
  function archPts(w, h, n = 14) { const W = w / 2, r = Math.min(h, W * 1.55), s = h - r, c = (r * r - W * W) / (2 * W), R = c + W, pts = [new V2(-W, 0)];
    if (s > .001) pts.push(new V2(-W, s)); const a1 = Math.atan2(r, -c);
    for (let i = 1; i <= n; i++) { const t = Math.PI + (a1 - Math.PI) * i / n; pts.push(new V2(c + R * Math.cos(t), s + R * Math.sin(t))); }
    for (let i = pts.length - 2; i >= 0; i--) pts.push(new V2(-pts[i].x, pts[i].y)); return pts; }
  // a solid arch band (for ribs, tunnels, niche frames): outer arch, then the inner arch walked back
  function bandShape(w, h, t) { const o = archPts(w + 2 * t, h + t), i = archPts(w, h).reverse(); return new THREE.Shape(o.concat(i)); }
  // a wall panel in its own plane: x along, y up, thickness centred on z; inner face is -z
  function panelGeo(W, H, t, door, wins = [], circles = []) { const sh = new THREE.Shape(); sh.moveTo(-W / 2, 0);
    if (door) for (const q of archPts(door.w, door.h)) sh.lineTo(q.x + (door.x || 0), q.y);
    sh.lineTo(W / 2, 0); sh.lineTo(W / 2, H); sh.lineTo(-W / 2, H);
    for (const w of wins) sh.holes.push(new THREE.Path(archPts(w.w, w.h).map(q => new V2(q.x + w.x, q.y + w.y))));
    for (const c of circles) { const p = new THREE.Path(); p.absarc(c.x, c.y, c.r, 0, Math.PI * 2, true); sh.holes.push(p); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, curveSegments: 20 }); g.translate(0, 0, -t / 2); return boxUV(g); }
  const world = new THREE.Group(); scene.add(world);
  const noLine = [];                                      // things the ink pass leaves alone (text, light)
  const mesh = (geo, mat, parent = world, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = .1) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - .01, h / 2 - .01, d / 2 - .01));
  const cyl = (r0, r1, h, n = 32) => new THREE.CylinderGeometry(r0, r1, h, n);
  const extrude = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 20 });
  // one rule for everything lying on something else: pull it toward the eye by a fixed fraction of its distance.
  // (with a logarithmic depth buffer, polygon offset does nothing, so the bias goes into the written depth itself)
  const biasDepth = (m, k) => { const prev = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (sh, r) => { prev && prev.call(m, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <logdepthbuf_fragment>', `#include <logdepthbuf_fragment>\n  gl_FragDepth -= ${(k * 2e-5).toFixed(6)};`); };
    m.customProgramCacheKey = () => key() + '|bias' + k; m.userData.bias = k; return m; };
  const DEC = new Map(); const decal = (m, k) => { const key = m.uuid + k; if (!DEC.has(key)) DEC.set(key, biasDepth(m.clone(), k)); return DEC.get(key); };
  const soft = (parent, tex, w, h, x, y, z, rx, ry, opacity, additive) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat('#fff', { map: tex, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    biasDepth(m.material, 8);
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); m.renderOrder = 2; parent.add(m); noLine.push(m); return m; };
  const glassList = [];
  // glass lit from behind: brighter than white, hotter in the middle, and much hotter when seen straight on
  // resting brightness falls with the window's size (a big rose glows softly); seen straight on, any window flares
  const glassBase = (size) => Math.max(.95, Math.min(1.45, 1.75 - .12 * size));
  const glassFlare = (size) => Math.max(.3, Math.min(1, 1.25 - .12 * size));
  const glassMat = (map, size = 3) => new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { map: { value: map }, warm: { value: new THREE.Color(C.apricot) }, base: { value: glassBase(size) }, flare: { value: glassFlare(size) } },
    vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv; varying vec3 vW, vN; void main(){ vUv = uv; vW = (modelMatrix*vec4(position,1.)).xyz; vN = normalize(mat3(modelMatrix)*vec3(0.,0.,1.)); gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.);\n#include <logdepthbuf_vertex>\n}`,
    fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform sampler2D map; uniform vec3 warm; uniform float base, flare; varying vec2 vUv; varying vec3 vW, vN; void main(){\n#include <logdepthbuf_fragment>\n float f = abs(dot(normalize(cameraPosition-vW), vN)); vec3 c = texture2D(map, vUv).rgb;
      c = mix(mix(c, vec3(1.), .3), warm, .2) * (base + 2.8*flare*pow(f, 4.)) + warm * pow(f, 8.) * smoothstep(.75, .1, length(vUv-vec2(.5,.45))) * 1.6 * flare; gl_FragColor = vec4(c, 1.); }` });
  const glares = [];
  const glare = (parent, x, y, z, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: new THREE.Color(1.6, 1.3, .9), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); s.scale.setScalar(size); s.position.set(x, y, z); s.renderOrder = 7; parent.add(s); noLine.push(s); glares.push(s); return s; };
  function glassIn(panel, w, cols, seed, focal) { const pts = archPts(w.w, w.h), g = new THREE.ShapeGeometry(new THREE.Shape(pts), 20), uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + w.w / 2) / w.w, p.getY(i) / w.h);
    const m = new THREE.Mesh(g, glassMat(glassTex(seed, cols), Math.max(w.w, w.h))); m.position.set(w.x, w.y, 0); m.userData.outline = pts; m.userData.focal = focal; panel.add(m); glassList.push(m);
    // the window glows on the wall around it, on the inside only
    soft(panel, GLOW, w.w * 2.6, w.h * 1.7, w.x, w.y + w.h * .5, -T / 2 - .03, 0, Math.PI, .55 * glassFlare(Math.max(w.w, w.h)) + .2, true);
    m.userData.size = Math.max(w.w, w.h);
    m.userData.glare = glare(panel, w.x, w.y + w.h * .5, -T / 2 - .35, Math.max(w.w, w.h) * 1.6);
    return m; }
  // a relief where a window would only look into another room: a raised arch (or ring) with a flat flower of colour inside
  function relief(parent, w, cols, z, ry = 0) { const g = new THREE.Group(); g.position.set(w.x, w.y, z); g.rotation.y = ry; parent.add(g);
    const lay = (shape, mat, d, zz) => { const m = mesh(extrude(shape, d), mat, g, false); m.position.z = zz; return m; };
    const circ = (r, x = 0, y = 0) => { const s = new THREE.Shape(); s.absarc(x, y, r, 0, Math.PI * 2, false); return s; };
    if (w.r) { lay(circ(w.r + .25), MAT.oat, .08, 0); lay(circ(w.r - .05), MAT.ivory, .04, .08); }
    else { lay(new THREE.Shape(archPts(w.w + .5, w.h + .3)), MAT.oat, .08, 0).position.y = -.15; const inner = new THREE.Shape(archPts(w.w - .1, w.h - .2)); lay(inner, MAT.ivory, .04, .08).position.y = .1; }
    const cy = w.r ? 0 : w.h * .52, R = Math.min(w.r || w.w / 2, w.h ? w.h / 3 : 9) * .78, mats = cols.map(k => MAT[k]);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; lay(circ(R * .21, Math.cos(a) * R * .62, cy + Math.sin(a) * R * .62), mats[k % 2], .03, .12 + (k % 2) * .012); }   // petals never touch, and alternate in depth
    lay(circ(R * .34, 0, cy), MAT.ivory, .03, .12); lay(circ(R * .18, 0, cy), mats[2 % mats.length], .03, .15);
    if (!w.r) for (const s of [-1, 1]) lay(circ(.16, s * (w.w / 2 - .35), .55), mats[1], .03, .12);
    return g; }
  const label = (parent, texture, w, h, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat('#fff', { map: texture, transparent: true, depthWrite: false })); m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); noLine.push(m); return m; };

  /* ---------- the plan: a Latin cross of closed rooms joined by doorways ---------- */
  const T = .9;
  const NAVE = { w: 12, z0: 0, z1: -49, h: 14, bay: 6 };
  const CROSS = { c: new V3(0, 0, NAVE.z1 - T - 14), r: 14, h: 15 };
  const LISTS = { c: new V3(-(14 + T + 3 + T + 7), 0, CROSS.c.z), r: 7, h: 11 };
  const SETS = { c: new V3(14 + T + 3 + T + 7, 0, CROSS.c.z), r: 7, h: 11 };
  const SANCT = { c: new V3(0, 0, CROSS.c.z - (14 + T + 3 + T + 8)), r: 8, h: 13 };
  const DOOR = { w: 5, h: 8 };
  { const f = mesh(new THREE.PlaneGeometry(90, 120), MAT.floor, world, false); f.rotation.x = -Math.PI / 2; f.position.set(0, 0, -55); }

  // the nave: two plain walls with high windows, a vault, the albums in one even row
  const albumSlots = [];
  { const L = -NAVE.z1, zc = NAVE.z1 / 2;
    for (const side of [-1, 1]) {
      const wins = [], ry = side * Math.PI / 2;
      for (let b = 0; b < 8; b++) { const z = -.5 - NAVE.bay / 2 - b * NAVE.bay; wins.push({ x: side > 0 ? -(z - zc) : (z - zc), y: 8.6, w: 2.4, h: 4.8, z }); }
      const wall = mesh(panelGeo(L + 2 * T, NAVE.h, T, null, wins), MAT.paper); wall.position.set(side * (NAVE.w / 2 + T / 2), 0, zc); wall.rotation.y = ry;
      wins.forEach((w, k) => glassIn(wall, w, [C.clay, C.kraft, C.apricot, C.mist], k * 3 + side));
      for (let b = 0; b < 8; b++) albumSlots.push({ x: side * (NAVE.w / 2 - .02), z: -.5 - NAVE.bay / 2 - b * NAVE.bay, ry: -ry, side });
    }
    for (const side of [-1, 1]) for (const [dep, y0, hh, m] of [[.26, 13.48, .28, MAT.oat], [.48, 13.76, .22, MAT.ivory]]) { const b = mesh(new THREE.BoxGeometry(dep + .1, hh, L - .02), m, world, false); b.position.set(side * (NAVE.w / 2 - dep / 2 + .05), y0 + hh / 2, zc); }   // the same cornice along the nave
    { const v = mesh(extrude(bandShape(NAVE.w, 7, .5), L + 1), MAT.vault); v.position.set(0, NAVE.h, NAVE.z1 - .5); v.receiveShadow = false; }
    const west = mesh(panelGeo(NAVE.w + 2 * T + .4, NAVE.h + 8, T, null, [], [{ x: 0, y: 15.2, r: 3.1 }]), MAT.paper); west.position.set(0, 0, T / 2);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(3.1, 64), glassMat(roseTex(), 7.5)); rose.position.set(0, 15.2, 0); west.add(rose); rose.userData.size = 7.5; glassList.push(rose); rose.userData.noBeam = true; rose.material.uniforms.base.value = .74; rose.material.uniforms.flare.value = .12;   // the rose is read for its pattern: it glows, it never burns
    soft(west, GLOW, 9, 9, 0, 15.2, -T / 2 - .03, 0, Math.PI, .18, true);
    mesh(extrude(new THREE.Shape(archPts(4.4, 7)), .08), MAT.oat).position.set(0, 0, -.04);
    const east = mesh(panelGeo(NAVE.w + 2 * T + .4, NAVE.h + 8, T, { w: 6, h: 10.5 }, [], []), MAT.paper); east.position.set(0, 0, NAVE.z1 - T / 2); east.rotation.y = Math.PI;
    relief(east, { x: 0, y: 13, r: 1.3 }, ["olive", "kraft", "clay"], T / 2); relief(east, { x: 0, y: 13, r: 1.3 }, ['mist', 'kraft', 'clay'], -T / 2, Math.PI);
  }

  // an octagonal room: eight plain panels and a faceted dome with an oculus; nothing else is architecture
  const VEST_DIRS = [['settings', new V3(1, 0, 0)], ['lists', new V3(-1, 0, 0)], ['altar', new V3(0, 0, -1)]];
  const DIRS = Array.from({ length: 8 }, (_, i) => new V3(Math.sin(i * Math.PI / 4), 0, Math.cos(i * Math.PI / 4)));
  const domes = [];
  function octRoom(R, o) { const g = new THREE.Group(); g.position.copy(R.c); world.add(g); const r = R.r, h = R.h, side = 2 * (r + T) * Math.tan(Math.PI / 8) + .05, panels = [];
    for (let i = 0; i < 8; i++) { if (o.skip?.includes(i)) { panels.push(null); continue; } const door = o.doors?.includes(i) ? DOOR : null, all = (o.wins?.[i]) || [], wins = all.filter(w => !w.deco);
      const p = mesh(panelGeo(side, h, T, door, wins), MAT.paper, g); p.position.copy(DIRS[i]).multiplyScalar(r + T / 2); p.rotation.y = i * Math.PI / 4; panels.push(p);
      wins.forEach((w, k) => glassIn(p, w, o.glass, i * 5 + k + r, o.focal)); all.filter(w => w.deco).forEach(w => relief(p, w, ['olive', 'kraft', 'clay'], -T / 2, Math.PI)); }
    const rc = r / Math.cos(Math.PI / 8);
    const th0 = Math.asin(o.oculus / rc), dome = mesh(new THREE.SphereGeometry(rc, 8, 18, Math.PI / 8 + Math.PI / 2, Math.PI * 2, th0, Math.PI / 2 - th0), MAT.dome, g); dome.position.y = h - .05; dome.receiveShadow = false;   // no self-shadow ripples: the dome is lit by its own wash
    const top = h + rc * Math.cos(th0);
    const sky = new THREE.Mesh(new THREE.CircleGeometry(o.oculus + .4, 40), flat('#FFF6E6', { side: THREE.DoubleSide })); sky.rotation.x = Math.PI / 2; sky.position.y = top + 1.2; g.add(sky); noLine.push(sky);
    cornice(g, r, h);
    domes.push({ c: R.c, r: o.oculus, y: top, focal: o.focal, sky, g });
    return { g, panels, top }; }
  // a stepped cornice where the walls meet the dome: an octagonal ring in two tiers, one piece so no faces are shared
  function octRing(apIn, apOut, y, hgt, mat, g) { const ring = (ap) => Array.from({ length: 8 }, (_, j) => { const a = Math.PI / 8 + j * Math.PI / 4, R = ap / Math.cos(Math.PI / 8); return new V2(Math.sin(a) * R, -Math.cos(a) * R); });
    const sh = new THREE.Shape(ring(apOut)); sh.holes.push(new THREE.Path(ring(apIn).reverse())); const m = mesh(new THREE.ExtrudeGeometry(sh, { depth: hgt, bevelEnabled: false }), mat, g, false); m.rotation.x = -Math.PI / 2; m.position.y = y; return m; }
  const cornice = (g, r, h) => { octRing(r - .26, r + .12, h - .78, .42, MAT.oat, g); octRing(r - .5, r + .12, h - .36, .34, MAT.ivory, g); };
  function vestibule(from, dir, len) { const v = mesh(extrude(bandShape(DOOR.w, DOOR.h, .5), len), MAT.tunnel); v.receiveShadow = false; v.position.copy(from); v.rotation.y = Math.atan2(dir.x, dir.z); return v; }
  const tall = (x) => ({ x, y: 7.2, w: 2.2, h: 5.6 });
  const over = { x: 0, y: 9.4, w: 2.2, h: 3.8, deco: true };   // above a doorway there is only the next room: an ornament, not glass
  const crossing = octRoom(CROSS, { skip: [0], doors: [2, 4, 6], wins: { 1: [tall(0)], 2: [over], 3: [tall(0)], 4: [over], 5: [tall(0)], 6: [over], 7: [tall(0)] }, oculus: 3.2, glass: [C.olive, C.kraft, C.apricot, C.clay], focal: new V3(CROSS.c.x, 0, CROSS.c.z) });
  const lists = octRoom(LISTS, { doors: [2], wins: Object.fromEntries([0, 1, 3, 4, 5, 7].map(i => [i, [{ x: 0, y: 6.8, w: 1.6, h: 3.2 }]])), oculus: 2, glass: [C.mist, C.apricot, C.olive], focal: new V3(LISTS.c.x + .1, 0, LISTS.c.z + .6) });
  const sets = octRoom(SETS, { doors: [6], wins: Object.fromEntries([0, 1, 2, 3, 4, 5, 7].map(i => [i, [{ x: 0, y: 6.6, w: 1.6, h: 3.2 }]])), oculus: 2, glass: [C.kraft, C.apricot, C.clay], focal: new V3(SETS.c.x + .6, 0, SETS.c.z) });
  const sanct = octRoom(SANCT, { doors: [0], wins: Object.fromEntries([1, 2, 3, 5, 6, 7].map(i => [i, [{ x: 0, y: 5.8, w: 1.5, h: 6 }]])), oculus: 1.9, glass: [C.clay, C.kraft, C.apricot, C.mist], focal: new V3(SANCT.c.x, 0, SANCT.c.z - 5.4) });
  // every oculus is a clear-sky panel: a soft blue disc that washes the vault around it a cool white
  for (const d of domes) { const skyTex = textTex(256, 256, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, '#5AA2EA'); r.addColorStop(.65, '#82BCF2'); r.addColorStop(1, '#B9DCF8'); g.fillStyle = r; g.fillRect(0, 0, w, h); });
    d.sky.material = flat('#fff', { map: skyTex, side: THREE.DoubleSide }); d.sky.material.color.setRGB(1.05, 1.05, 1.08); d.blue = true;
    d.g.children.filter(m => m.material === MAT.dome).forEach(m => { m.material = skyBaked('#D2C2A6', '#D7E6F0', d.y - 12, d.y, { side: THREE.BackSide, shadowSide: THREE.DoubleSide }); });   // the sky panel lights the vault around it a cool white
  }
  for (const [R, d] of [[SETS, new V3(1, 0, 0)], [LISTS, new V3(-1, 0, 0)], [SANCT, new V3(0, 0, -1)]]) vestibule(CROSS.c.clone().addScaledVector(d, CROSS.r + T), d, 3);

  /* ---------- branches: ink stems, flat leaves and berries (now in vases, and two hanging in the sanctuary) ---------- */
  const leafShape = (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.quadraticCurveTo(.2, .15, .42, 0); s.quadraticCurveTo(.2, -.15, 0, 0); return s; })();
  const leafGeo = new THREE.ShapeGeometry(leafShape, 8), berryGeo = new THREE.CircleGeometry(.07, 16);
  const leafMats = [toon(C.olive, { side: THREE.DoubleSide }), toon(C.kraft, { side: THREE.DoubleSide }), toon(C.clay, { side: THREE.DoubleSide }), toon('#AEB98E', { side: THREE.DoubleSide })];
  const branches = [];
  function branch(seed, len, density = 2.2) { const g = new THREE.Group(), pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new V3(-len / 2 + t * len, Math.sin(t * 3.2 + seed) * .25 * len / 4, 0)); }
    const stem = new THREE.CatmullRomCurve3(pts); mesh(new THREE.TubeGeometry(stem, 48, .026, 6), MAT.ink, g);
    const n = Math.round(len * density);
    for (let k = 0; k < n; k++) { const t = .1 + .88 * k / n, p = stem.getPointAt(t), up = k % 2 ? 1 : -1, ang = up * (.5 + rnd(seed * 9 + k) * .7);
      if (rnd(seed + k * 3.3) < .25) { const tip = p.clone().add(new V3(Math.cos(ang) * .4, Math.sin(ang) * .4, 0)); mesh(new THREE.TubeGeometry(new THREE.LineCurve3(p.clone(), tip), 2, .015, 5), MAT.ink, g);
        for (let b = 0; b < 3; b++) { const be = mesh(berryGeo, MAT.clay, g); be.position.copy(tip).add(new V3((b - 1) * .1, (b % 2) * .1, .01)); } }
      else { const lf = mesh(leafGeo, leafMats[Math.floor(rnd(seed * 4 + k) * leafMats.length)], g); lf.position.copy(p); lf.rotation.z = ang; lf.scale.setScalar(.75 + rnd(seed + k) * .6); } }
    g.traverse(o => { if (o.isMesh) o.userData.thin = true; });   // twigs and leaves are not somewhere to land
    branches.push({ g, seed }); return g; }

  /* ---------- furniture and ornaments: rounded geometry, the same flat colour and ink ---------- */
  const sofas = [];
  const blob = (x, z, w, d) => { soft(world, BLOB, w, d, x, .012, z, -Math.PI / 2, 0, .3, false); soft(world, BLOB, w * .55, d * .55, x, .012, z, -Math.PI / 2, 0, .35, false); };   // two layers: a wide soft shade and a tighter contact
  const furniture = []; const put = (g, x, z, ry = 0) => { g.position.set(x, 0, z); g.rotation.y = ry; world.add(g); furniture.push(g); return g; };
  // a sofa faces +z in its own frame; `look` is the yaw a seated visitor should face
  function sofa(len, mat, x, z, ry) { const g = new THREE.Group();
    mesh(rbox(len, .44, .95, .14), mat, g).position.set(0, .22, 0); mesh(rbox(len, .5, .26, .12), mat, g).position.set(0, .62, -.36);
    for (const s of [-1, 1]) mesh(rbox(.24, .58, .95, .1), mat, g).position.set(s * (len / 2 - .12), .3, 0);
    for (let k = 0; k < Math.round(len / .8); k++) { const c = mesh(rbox(len / Math.round(len / .8) - .06, .12, .7, .05), MAT.ivory, g); c.position.set(-len / 2 + (k + .5) * len / Math.round(len / .8), .5, .08); }
    put(g, x, z, ry); blob(x, z, len + 1, 1.8); g.traverse(o => { if (o.isMesh) { o.userData = { kind: 'sofa', i: sofas.length }; } });
    sofas.push({ g, seat: new V3(x, 1.15, z).add(new V3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(.1)), yaw: ry + Math.PI }); return g; }
  function armchair(mat, x, z, ry) { const g = new THREE.Group(); mesh(rbox(1, .44, .9, .14), mat, g).position.y = .22;
    const back = mesh(new THREE.CylinderGeometry(.55, .55, .62, 24, 1, true, Math.PI * .65, Math.PI * .7), mat, g); back.position.set(0, .62, .1); back.material = mat.clone(); back.material.side = THREE.DoubleSide;
    mesh(rbox(.86, .12, .66, .05), MAT.ivory, g).position.set(0, .5, .1); put(g, x, z, ry); blob(x, z, 1.6, 1.5);
    g.traverse(o => { if (o.isMesh) o.userData = { kind: 'sofa', i: sofas.length }; }); sofas.push({ g, seat: new V3(x, 1.15, z), yaw: ry + Math.PI }); return g; }
  function ringSofa(x, z, r) { const g = new THREE.Group(); const t = mesh(new THREE.TorusGeometry(r, .5, 16, 72), MAT.olive, g); t.rotation.x = Math.PI / 2; t.scale.set(1, 1, .55); t.position.y = .3;
    const c = mesh(new THREE.TorusGeometry(r, .34, 12, 72), MAT.ivory, g); c.rotation.x = Math.PI / 2; c.scale.set(1, 1, .4); c.position.y = .52; put(g, x, z);
    g.traverse(o => { if (o.isMesh) o.userData = { kind: 'sofa', i: sofas.length, ring: true }; }); sofas.push({ g, ring: { x, z, r }, seat: new V3(x, 1.15, z + r), yaw: 0 }); return g; }
  function table(x, z) { const g = new THREE.Group(); mesh(cyl(.42, .42, .05), MAT.ivory, g).position.y = .58; mesh(cyl(.025, .025, .56, 8), MAT.ink, g).position.y = .29; mesh(cyl(.2, .22, .03), MAT.ink, g).position.y = .015; put(g, x, z); blob(x, z, 1.2, 1.2); return g; }
  const VASES = [[[0, 0], [.18, .02], [.24, .2], [.2, .5], [.08, .7], [.07, .95], [.11, 1.0]], [[0, 0], [.16, .02], [.34, .25], [.36, .42], [.22, .62], [.14, .7], [.16, .74]], [[0, 0], [.22, .02], [.4, .16], [.46, .3], [.44, .34]]];
  function vase(kind, mat, x, z, y = 0, stems = 3, s = 1) { const g = new THREE.Group(), prof = VASES[kind];
    mesh(new THREE.LatheGeometry(prof.map(([a, b]) => new V2(a * s, b * s)), 40), mat, g).material = mat.clone(); g.children[0].material.side = THREE.DoubleSide;
    const top = prof.at(-1)[1] * s;
    for (let k = 0; k < stems; k++) { const len = 1.4 + rnd(x + k) * 1.1, b = branch(x * 3 + z + k * 7, len, 2.6), hold = new THREE.Group(); b.position.x = len / 2; hold.add(b);   // the stem starts inside the neck
      hold.rotation.set(0, k * 1.9, Math.PI / 2 - (k - (stems - 1) / 2) * .22); hold.position.y = top - .12 * s; hold.scale.setScalar(.9); g.add(hold); }
    g.position.y = y; put(g, x, z); if (!y) blob(x, z, .9 * s + .3, .9 * s + .3); g.position.y = y; return g; }
  function rugRound(x, z, rings) { const g = new THREE.Group(); rings.forEach(([r, m], k) => { const d = mesh(new THREE.CircleGeometry(r, 64), decal(m, k + 1), g, false); d.rotation.x = -Math.PI / 2; d.position.y = .003; }); put(g, x, z); return g; }
  function rugRect(x, z, w, d, base, edge, ry = 0) { const g = new THREE.Group(); const rr = (W, D) => { const s = new THREE.Shape(), r = Math.min(.5, W / 4, D / 4); s.moveTo(-W / 2 + r, -D / 2); s.lineTo(W / 2 - r, -D / 2); s.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + r); s.lineTo(W / 2, D / 2 - r); s.quadraticCurveTo(W / 2, D / 2, W / 2 - r, D / 2); s.lineTo(-W / 2 + r, D / 2); s.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - r); s.lineTo(-W / 2, -D / 2 + r); s.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + r, -D / 2); return new THREE.ShapeGeometry(s, 6); };
    const a = mesh(rr(w, d), decal(edge, 1), g, false); a.rotation.x = -Math.PI / 2; a.position.y = .003; const b = mesh(rr(w - .5, d - .5), decal(base, 2), g, false); b.rotation.x = -Math.PI / 2; b.position.y = .003; put(g, x, z, ry); return g; }
  // ornaments for their own sake
  const ORN = {
    sphereCube: (m1, m2) => { const g = new THREE.Group(); mesh(rbox(.8, .8, .8, .04), m1, g).position.y = .4; mesh(new THREE.SphereGeometry(.42, 32, 16), m2, g).position.y = 1.22; return g; },
    halfArch: (m1) => { const g = new THREE.Group(); const a = mesh(extrude(new THREE.Shape(archPts(1.3, 2.1)), .24), m1, g); a.position.z = -.12; return g; },
    discs: (m1, m2) => { const g = new THREE.Group(); [[.6, m1], [.45, m2], [.3, m1]].forEach(([r, m], k) => mesh(cyl(r, r, .22), m, g).position.y = .11 + k * .24); return g; },
    cone: (m1) => { const g = new THREE.Group(); mesh(cyl(0, .55, 1.6), m1, g).position.y = .8; return g; },
    ring: (m1) => { const g = new THREE.Group(); mesh(new THREE.TorusGeometry(.62, .12, 16, 48), m1, g).position.y = .8; mesh(rbox(.5, .18, .3, .04), MAT.ink, g).position.y = .09; return g; },
    quarter: (m1) => { const g = new THREE.Group(); const q = mesh(new THREE.CylinderGeometry(1, 1, .3, 32, 1, false, 0, Math.PI / 2), m1, g); q.rotation.x = Math.PI / 2; q.position.set(-.5, 0, 0); return g; },
  };
  const ornament = (kind, x, z, ry, ...m) => { const g = ORN[kind](...m); put(g, x, z, ry); blob(x, z, 1.6, 1.6); return g; };

  // nave: one runner, two pairs of sofas back to back facing the walls, vases beside them, ornaments at both ends
  rugRect(0, -25, 4.2, 32, MAT.kraft, MAT.clay);
  for (let k = 0; k < 8; k++) { const h = mesh(new THREE.CircleGeometry(.55, 32, 0, Math.PI), decal(MAT.ivory, 3), world, false); h.rotation.set(-Math.PI / 2, 0, k < 4 ? 0 : Math.PI); h.position.set(-1.35 + (k % 4) * .9, .003, k < 4 ? -9.6 : -40.4); }
  for (const z of [-17, -33]) { sofa(3, MAT.clay, -.62, z, -Math.PI / 2); sofa(3, MAT.olive, .62, z, Math.PI / 2); }
  vase(0, MAT.ivory, -1.6, -21.5, 0, 3); vase(1, MAT.kraft, 1.6, -28.5, 0, 2); vase(2, MAT.clay, 0, -25, 0, 3, .8);
  ornament('sphereCube', -3.4, -4.5, .3, MAT.kraft, MAT.clay); ornament('halfArch', 3.5, -5, -.5, MAT.mist);
  ornament('cone', -3.6, -45.5, 0, MAT.olive); ornament('discs', 3.6, -45, 0, MAT.clay, MAT.ivory);
  // crossing: a round rug and a ring sofa at the centre, ornaments between the four aisles
  rugRound(CROSS.c.x, CROSS.c.z, [[3.6, MAT.olive], [3.0, MAT.oat], [2.2, MAT.kraft]]);
  ringSofa(CROSS.c.x, CROSS.c.z, 2.45);
  for (const [a, m] of [[Math.PI / 4, MAT.clay], [Math.PI * 5 / 4, MAT.mist]]) { const dx = -Math.sin(a), dz = -Math.cos(a); sofa(2.6, m, CROSS.c.x + dx * 5.6, CROSS.c.z + dz * 5.6, Math.atan2(dx, dz)); }
  table(CROSS.c.x - Math.sin(Math.PI * 3 / 4) * 5.4, CROSS.c.z - Math.cos(Math.PI * 3 / 4) * 5.4); vase(1, MAT.ivory, CROSS.c.x - Math.sin(Math.PI * 3 / 4) * 5.4, CROSS.c.z - Math.cos(Math.PI * 3 / 4) * 5.4, .6, 2, .55);
  const ripples = [0, 1, 2].map(k => { const m = new THREE.Mesh(new THREE.RingGeometry(.97, 1, 96), flat(C.ivory, { transparent: true, opacity: 0, depthWrite: false })); biasDepth(m.material, 9); m.rotation.x = -Math.PI / 2; m.position.set(CROSS.c.x, .004, CROSS.c.z); m.renderOrder = 2; world.add(m); noLine.push(m); return m; });
  const lightPools = []; const pool = (f, r) => { const a = soft(world, GLOW, r * 2, r * 2, f.x, .02, f.z, -Math.PI / 2, 0, .55, true), b = soft(world, GLOW, r * 4.4, r * 4.4, f.x, .02, f.z, -Math.PI / 2, 0, .35, true); lightPools.push(a, b); };
  pool(new V3(CROSS.c.x, 0, CROSS.c.z), 2.1);
  const focusLight = new THREE.PointLight(lin(1, .86, .62), 9, 9, 1.4); focusLight.position.set(CROSS.c.x, .9, CROSS.c.z); scene.add(focusLight);
  for (let k = 0; k < 9; k++) { const a = rnd(k * 3.1) * Math.PI * 2, r = 3.5 + rnd(k * 7.7) * 1.4, x = CROSS.c.x + Math.cos(a) * r, z = CROSS.c.z + Math.sin(a) * r, lf = mesh(leafGeo, decal(leafMats[k % leafMats.length], 4), world, false); lf.rotation.set(-Math.PI / 2, 0, rnd(k) * 6.3); lf.scale.setScalar(.9 + rnd(k * 2) * .6); lf.position.set(x, .004, z); soft(world, BLOB, .3, .3, x + .03, .005, z, -Math.PI / 2, 0, .22, false); }
  { const p = mesh(new THREE.PlaneGeometry(.42, .58), decal(MAT.ivory, 5), world, false); p.rotation.set(-Math.PI / 2, 0, .5); p.position.set(CROSS.c.x + 3.3, .005, CROSS.c.z + 2.1); const q = mesh(new THREE.PlaneGeometry(.42, .58), decal(MAT.ivory, 6), world, false); q.rotation.set(-Math.PI / 2, 0, .9); q.position.set(CROSS.c.x + 3.45, .006, CROSS.c.z + 2.25); soft(world, BLOB, 1.2, 1.2, CROSS.c.x + 3.4, .005, CROSS.c.z + 2.2, -Math.PI / 2, 0, .3, false); }
  // ornaments flank the two doors on the main axis, just inside the room, out of the song wall's way
  [['ring', MAT.clay, Math.PI - .3], ['discs', MAT.olive, Math.PI + .3, MAT.ivory], ['quarter', MAT.mist, -.3], ['sphereCube', MAT.ivory, .3, MAT.kraft]].forEach(([k, m1, a, m2]) => ornament(k, CROSS.c.x - Math.sin(a) * 12.2, CROSS.c.z - Math.cos(a) * 12.2, a + Math.PI, m1, m2));
  // north chapel: a reading corner under the light
  rugRound(LISTS.c.x + .4, LISTS.c.z, [[2.8, MAT.mist], [2.2, MAT.oat]]);
  armchair(MAT.mist, LISTS.c.x + 1.2, LISTS.c.z + 1.3, Math.PI * .8); table(LISTS.c.x + .1, LISTS.c.z + .6); vase(0, MAT.clay, LISTS.c.x + .1, LISTS.c.z + .6, .6, 2, .55);
  vase(1, MAT.ivory, LISTS.c.x - 3.6, LISTS.c.z + 3.4, 0, 3); ornament('cone', LISTS.c.x - 3.4, LISTS.c.z - 3.6, 0, MAT.kraft);
  // south chapel: a rug inside the arc of plinths
  rugRound(SETS.c.x + .6, SETS.c.z, [[2.6, MAT.kraft], [2.0, MAT.oat]]);
  vase(2, MAT.olive, SETS.c.x - 3.8, SETS.c.z + 3.6, 0, 3, 1.1); ornament('halfArch', SETS.c.x - 3.6, SETS.c.z - 3.8, 1.2, MAT.clay);
  // sanctuary: a listening room — a long sofa on a rug facing the clay arch
  rugRect(SANCT.c.x, SANCT.c.z - .3, 6.4, 4.6, MAT.clay, MAT.ivory);
  sofa(4, MAT.olive, SANCT.c.x, SANCT.c.z + .9, Math.PI); table(SANCT.c.x + 2.9, SANCT.c.z + .9); vase(1, MAT.ivory, SANCT.c.x + 2.9, SANCT.c.z + .9, .6, 2, .55);
  vase(0, MAT.kraft, SANCT.c.x - 4.2, SANCT.c.z - 4.4, 0, 3, 1.2); ornament('sphereCube', SANCT.c.x + 4.3, SANCT.c.z - 4.2, -.6, MAT.mist, MAT.ivory);

  /* ---------- baked occlusion: walls meet the floor in a soft shade; small things sit in their own ---------- */
  const AO_EDGE = textTex(64, 128, (g, w, h) => { const l = g.createLinearGradient(0, 0, 0, h); l.addColorStop(0, 'rgba(96,78,58,.55)'); l.addColorStop(.35, 'rgba(96,78,58,.2)'); l.addColorStop(1, 'rgba(96,78,58,0)'); g.fillStyle = l; g.fillRect(0, 0, w, h); });
  const aoStrip = (x, z, len, ry) => { const m = soft(world, AO_EDGE, len, 1.1, x, .006, z, -Math.PI / 2, 0, .8, false); m.rotation.set(-Math.PI / 2, 0, ry); return m; };
  // wall-to-floor shade from the true distance to the nearest wall, one map for the whole floor: corners come out round, never as triangles
  { const segs2 = [], W = 90, H = 120, X0 = -45, Z0 = 5, RES = .15, nx = Math.round(W / RES), nz = Math.round(H / RES);
    const seg = (ax, az, bx, bz) => segs2.push([ax, az, bx, bz]);
    seg(-6, 0, -6, -49); seg(6, 0, 6, -49); seg(-6, 0, 6, 0); seg(-6, -49, -3, -49); seg(3, -49, 6, -49);
    for (const [R, doors, gapW] of [[CROSS, [2, 4, 6, 0], [5, 5, 5, 6]], [LISTS, [2], [5]], [SETS, [6], [5]], [SANCT, [0], [5]]]) { const rc = R.r / Math.cos(Math.PI / 8);
      for (let k = 0; k < 8; k++) { const a0 = k * Math.PI / 4 - Math.PI / 8, a1 = k * Math.PI / 4 + Math.PI / 8, ax = R.c.x + Math.sin(a0) * rc, az = R.c.z + Math.cos(a0) * rc, bx = R.c.x + Math.sin(a1) * rc, bz = R.c.z + Math.cos(a1) * rc;
        const di = doors.indexOf(k); if (di < 0) { seg(ax, az, bx, bz); continue; } const L = Math.hypot(bx - ax, bz - az), g = gapW[di] / 2 / L; seg(ax, az, ax + (bx - ax) * (.5 - g), az + (bz - az) * (.5 - g)); seg(ax + (bx - ax) * (.5 + g), az + (bz - az) * (.5 + g), bx, bz); } }
    for (const [, d] of VEST_DIRS) for (const s of [-1, 1]) { const lat = new V3(d.z, 0, -d.x).multiplyScalar(2.5 * s), a = CROSS.c.clone().addScaledVector(d, CROSS.r + T).add(lat), b = CROSS.c.clone().addScaledVector(d, CROSS.r + T + 3).add(lat); seg(a.x, a.z, b.x, b.z); }
    const data = new Uint8Array(nx * nz * 4);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = X0 + (i + .5) * RES, z = Z0 - (j + .5) * RES; let d = 1e9;
      for (const [ax, az, bx, bz] of segs2) { const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz))), dx = x - ax - vx * t, dz = z - az - vz * t, q = dx * dx + dz * dz; if (q < d) d = q; }
      const v = Math.round(255 * (1 - .3 * Math.exp(-Math.sqrt(d) / .55))), o = (j * nx + i) * 4; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255; }
    const tex = new THREE.DataTexture(data, nx, nz); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    MAT.floor.onBeforeCompile = (sh) => { sh.uniforms.aoFloor = { value: tex };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFloor;').replace('#include <project_vertex>', '#include <project_vertex>\nvec4 fw = modelMatrix * vec4(transformed, 1.); vFloor = vec2((fw.x - (' + X0.toFixed(1) + ')) / ' + W.toFixed(1) + ', (' + Z0.toFixed(1) + ' - fw.z) / ' + H.toFixed(1) + ');');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFloor; uniform sampler2D aoFloor;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= texture2D(aoFloor, vFloor).r;'); };
    MAT.floor.customProgramCacheKey = () => 'floorAO'; }
  // albums in the nave
  /* ---------- albums in the nave: one even row, thin ink frames ---------- */
  const pickables = [], albumMeshes = [];
  const unpick = (objs) => { for (const o of objs) { const k = pickables.indexOf(o); if (k >= 0) pickables.splice(k, 1); } };
  // a room's part rebuilt: its geometry is its own; materials only when made for it (the shared MAT ones stay), their
  // textures only when drawn for it (covers belong to the cover caches)
  const freeGroup = (g) => { g.parent?.remove(g); g.traverse(o => { if (!o.isMesh) return; o.geometry.dispose(); const k = noLine.indexOf(o); if (k >= 0) noLine.splice(k, 1);
    const m = o.material; if (m.userData.own) { if (m.userData.ownMap) m.map?.dispose(); m.dispose(); } }); };
  const own = (m, map = false) => { m.material.userData.own = true; m.material.userData.ownMap = map; return m; };
  const albumSub = (a) => [a.artist, a.year].filter(Boolean).join(', ');
  function buildNave() {
    albumMeshes.forEach(m => { unpick([m.art]); freeGroup(m.g); }); albumMeshes.length = 0;
    albumSlots.forEach((s, i) => { const a = ALBUMS[i]; if (!a) return; const g = new THREE.Group(); g.position.set(s.x, EYE + .45, s.z); g.rotation.y = s.ry; world.add(g);
      mesh(box(2.1, 2.1, .06), MAT.ink, g).position.z = .03; mesh(box(1.98, 1.98, .07), MAT.ivory, g).position.z = .035;
      const art = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), flat('#fff', { map: covers.get(bind.cover(a.cover, true), a.key) })); own(art); art.position.z = .075; g.add(art);
      const pl = own(label(g, labelTex(a.title, albumSub(a)), 1.6, .44, 0, -1.4, .02), true);
      art.userData = { kind: 'album', i }; pickables.push(art); albumMeshes.push({ g, art, pl, s }); }); }
  function setNavePage(pg) { const n = navePages(LIB); pg = ((pg % n) + n) % n; if (pg === navePg && albumMeshes.length) return; navePg = pg; ALBUMS = navePage(LIB, pg); buildNave(); }
  buildNave();
  sofas.forEach(s => s.g.traverse(o => { if (o.isMesh) pickables.push(o); }));

  /* ---------- the wall of all songs: covers ride a fixed rail; size never changes, only opacity ---------- */
  const PER = 40, BOWL_R = 9.2, GAP = .44, ARC = Math.PI / 2 - GAP;
  // per-instance opacity for instanced, unlit materials
  const fading = (m) => { m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iAlpha; varying float vA;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = iAlpha;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vA;').replace('#include <opaque_fragment>', 'diffuseColor.rgb = mix(vec3(.86,.80,.71), diffuseColor.rgb, smoothstep(.35, 1., vA));\nif (vA < .35 && vA / .35 < fract(52.9829189*fract(dot(gl_FragCoord.xy, vec2(.06711056,.00583715))))) discard;\n#include <opaque_fragment>'); };
    m.customProgramCacheKey = () => 'fading'; return m; };
  // the same, for covers drawn from an atlas: each instance carries its cell's offset
  const fadingAtlas = (m) => { const base = fading(m), inner = base.onBeforeCompile; base.onBeforeCompile = (sh, r) => { inner(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 iCell;').replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = vMapUv / ${CoverAtlas.GRID.toFixed(1)} + iCell;\n#endif`); };
    base.customProgramCacheKey = () => 'fadingAtlas'; return base; };
  const bowlGeo = new THREE.BoxGeometry(.92, .92, .04);
  const withAlpha = (geo, n) => { const g = geo.clone(); g.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1)); return g; };
  // covers on the rail carry their own ink border (the ink pass cannot see opacity, so the rail stays out of it)
  let TIERS = 1, bowl = [], ledges = null;
  // the wall is rebuilt whole when the library changes: one instanced mesh per atlas of covers, one for the ledges
  function buildBowl() {
    for (const im of [...bowl, ledges].filter(Boolean)) { world.remove(im); unpick([im]); const k = noLine.indexOf(im); if (k >= 0) noLine.splice(k, 1); im.geometry.dispose(); im.material.dispose(); }
    TIERS = Math.max(1, Math.ceil(SONGS.length / PER));
    const at = SONGS.map(sg => atlas.cell(bind.cover(sg.cover), sg.albumKey || sg.id)), byPage = atlas.pages.map(() => []);
    at.forEach((c, i) => byPage[c.page].push(i));
    bowl = byPage.map((ids, pg) => { const geo = withAlpha(bowlGeo, ids.length), cells = new Float32Array(ids.length * 2);
      ids.forEach((i, j) => cells.set(CoverAtlas.uv(at[i].cell), j * 2)); geo.setAttribute('iCell', new THREE.InstancedBufferAttribute(cells, 2));
      const im = new THREE.InstancedMesh(geo, fadingAtlas(flat('#fff', { map: atlas.pages[pg].tex })), ids.length); im.userData = { kind: 'bowl', ids }; im.castShadow = true; im.frustumCulled = false; im.renderOrder = 1; world.add(im); pickables.push(im); noLine.push(im); return im; });
    ledges = new THREE.InstancedMesh(withAlpha(new THREE.BoxGeometry(1.02, .035, .08), SONGS.length), fading(flat(C.ink)), SONGS.length); ledges.frustumCulled = false; ledges.renderOrder = 1; world.add(ledges); noLine.push(ledges);
    labelCache.forEach(t => t.dispose()); labelCache.clear(); signCache.forEach(t => t.dispose()); signCache.clear();
    if (typeof pools !== 'undefined') pools.forEach(p => p.tier = -1);
    hoverSong = chosenSong = -1; tierGoal = Math.min(tierGoal, TIERS - 1); tierAt = Math.min(tierAt, TIERS - 1); }
  // the rail: tierAt follows tierGoal on a critically damped spring; the goal snaps to a whole tier once the wheel rests
  let tierAt = 2, tierVel = 0, tierGoal = 2, wheelRest = 0;
  const labelCache = new Map(), signCache = new Map();
  const songLabel = (i) => { if (!labelCache.has(i)) { if (labelCache.size > 320) { const [k, t] = labelCache.entries().next().value; t.dispose(); labelCache.delete(k); } const s = SONGS[i]; labelCache.set(i, textTex(480, 88, (g, w, h) => { g.fillStyle = '#29241F'; g.font = '500 34px "Noto Serif TC", serif'; g.textAlign = 'center'; g.fillText(s.title, w / 2, 38); g.fillStyle = '#7a6f63'; g.font = 'italic 400 24px "Source Serif 4", serif'; g.fillText(s.artist, w / 2, 74); })); } return labelCache.get(i); };
  const tierLabel = (t) => { if (!signCache.has(t)) { const a = SONGS[t * PER], b = SONGS[Math.min(SONGS.length, (t + 1) * PER) - 1]; signCache.set(t, textTex(640, 100, (g, w, h) => { g.fillStyle = '#C4603F'; g.font = '500 34px "Noto Sans TC", sans-serif'; g.textAlign = 'center'; g.fillText(`${ts('tier', { n: t + 1 })}　${(a?.title || ' ')[0]} — ${(b?.title || ' ')[0]}`, w / 2, 62); })); } return signCache.get(t); };
  // two sets of labels: the tier leaving and the tier arriving cross-fade, each riding with its own covers
  const mkPool = () => ({ tier: -1, labels: Array.from({ length: PER }, () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .22), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); m.renderOrder = 3; world.add(m); return m; }),
    sign: (() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, .5), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); m.renderOrder = 3; world.add(m); return m; })() });
  const pools = [mkPool(), mkPool()];
  const labelPool = pools.flatMap(p => p.labels), tierSign = pools[1].sign; noLine.push(pools[0].sign);
  function fillPool(p, t) { if (p.tier === t) return; p.tier = t; p.labels.forEach((m, k) => { const i = t * PER + k; m.visible = !!SONGS[i] && t >= 0 && t < TIERS; if (m.visible) { m.material.map = songLabel(i); m.material.needsUpdate = true; } });
    p.sign.visible = t >= 0 && t < TIERS; if (p.sign.visible) { p.sign.material.map = tierLabel(t); p.sign.material.needsUpdate = true; } }
  let labelsFor = -1;
  const dummy = new THREE.Object3D(), eyeAt = new V3(CROSS.c.x, EYE, CROSS.c.z);
  const songAngle = (i) => { const t = Math.floor(i / PER), k = i % PER, arc = Math.floor(k / 10), j = k % 10; return arc * Math.PI / 2 + GAP / 2 + (j + .5) / 10 * ARC + (t % 2 ? .02 : -.02); };
  // one continuous rail: height, radius and tilt are all smooth functions of rel, so nothing ever jumps
  function songPose(i, s, out) { const t = Math.floor(i / PER), rel = t - s, a = songAngle(i), ar = Math.abs(rel), rho = BOWL_R + .9 * ar * ar / (1 + .35 * ar), y = EYE + rel * 1.25;
    out.set(CROSS.c.x - Math.sin(a) * rho, y, CROSS.c.z - Math.cos(a) * rho); return { rel, a }; }
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const railAlpha = (rel, y) => (1 - sm(2.3, 3.3, Math.abs(rel))) * sm(-.15, .35, y);
  let hoverSong = -1, chosenSong = -1;
  buildBowl();
  const tmp = new V3();
  function layoutBowl() { let n = 0; const la = ledges.geometry.attributes.iAlpha;
    bowl.forEach(im => { const al = im.geometry.attributes.iAlpha; im.userData.ids.forEach((i, j) => { const { rel } = songPose(i, tierAt, tmp), a = railAlpha(rel, tmp.y), lift = (i === hoverSong || i === chosenSong) ? .12 : 0;
        dummy.position.copy(tmp); dummy.lookAt(eyeAt); if (lift) dummy.position.lerp(eyeAt, lift / BOWL_R); dummy.scale.setScalar(a > .003 ? 1 : 0); dummy.updateMatrix(); im.setMatrixAt(j, dummy.matrix); al.setX(j, a);
        dummy.position.copy(tmp); dummy.position.y -= .5; dummy.lookAt(eyeAt.x, dummy.position.y, eyeAt.z); dummy.updateMatrix(); ledges.setMatrixAt(n, dummy.matrix); la.setX(n++, a); });
      im.instanceMatrix.needsUpdate = true; al.needsUpdate = true; });
    ledges.instanceMatrix.needsUpdate = true; la.needsUpdate = true;
    const lo = Math.max(0, Math.min(TIERS - 1, Math.floor(tierAt))), hi = Math.min(TIERS - 1, lo + 1);
    // keep each pool on its tier: the pool already showing lo or hi keeps it
    if (pools[1].tier === lo || pools[0].tier === hi) { fillPool(pools[1], lo); fillPool(pools[0], hi); } else { fillPool(pools[0], lo); fillPool(pools[1], hi); }
    labelsFor = Math.round(tierAt);
    pools.forEach(p => { if (p.tier < 0) return; const fade = Math.max(0, 1 - Math.abs(p.tier - tierAt) * 1.6);
      p.labels.forEach((m, k) => { const i = p.tier * PER + k; if (!SONGS[i]) return; const { rel } = songPose(i, tierAt, tmp); m.position.copy(tmp); m.position.y -= .66; m.lookAt(CROSS.c.x, m.position.y, CROSS.c.z); m.material.opacity = fade * railAlpha(rel, tmp.y + .66); });
      const a = Math.PI / 4, rho = BOWL_R - .2 + .9 * Math.abs(p.tier - tierAt); p.sign.position.set(CROSS.c.x - Math.sin(a) * rho, EYE + 1.1 + (p.tier - tierAt) * 1.25, CROSS.c.z - Math.cos(a) * rho); p.sign.lookAt(eyeAt.x, p.sign.position.y, eyeAt.z); p.sign.material.opacity = fade; }); }
  function stepRail(dt, now) {
    if (wheelRest && now - wheelRest > 180) { tierGoal = Math.max(0, Math.min(TIERS - 1, Math.round(tierGoal))); wheelRest = 0; }
    if (RM()) { tierAt += (tierGoal - tierAt) * Math.min(1, dt * 14); tierVel = 0; return; }
    const w = 15, h = dt / 4; for (let k = 0; k < 4; k++) { tierVel += (-w * w * (tierAt - tierGoal) - 2 * w * tierVel) * h; tierAt += tierVel * h; }
    // draw the neighbouring tiers' labels ahead of time, a few per frame
    for (let q = 0, t0 = Math.round(tierGoal); q < 4; q++) { const t = t0 + [-1, 1, -2, 2][warm.k % 4], i = t * PER + Math.floor(warm.k / 4) % PER; warm.k++; if (t >= 0 && t < TIERS && SONGS[i]) songLabel(i); } }
  const warm = { k: 0 };
  noLine.push(...labelPool, tierSign);

  /* ---------- north chapel: one large playlist arch faces the door, the rest are smaller ---------- */
  const listMeshes = [];
  // a playlist's collage is its first four songs' covers
  const collageOf = (pl) => thumbs.collage(pl.ids.slice(0, 4).map(id => SONGS[songById.get(id)]).filter(Boolean).map(sg => ({ url: bind.cover(sg.cover), key: sg.albumKey || sg.id })), pl.id);
  function buildLists() {
    listMeshes.forEach(L => { unpick([L.im]); freeGroup(L.grp); }); listMeshes.length = 0;
    [6, 7, 5, 0, 4, 1, 3].forEach((pi, k) => { const p = lists.panels[pi], pl = PLAYLISTS[k]; if (!p || !pl) return; const big = k === 0, aw = big ? 3.8 : 2.5, ah = big ? 5.4 : 3.7, art = big ? 2.5 : 1.6;
      const grp = new THREE.Group(); grp.position.set(0, 0, -T / 2 - .02); grp.rotation.y = Math.PI; p.add(grp);
      mesh(extrude(new THREE.Shape(archPts(aw, ah)), .08), big ? MAT.mist : (k % 2 ? listTone[0] : listTone[1]), grp).position.y = .35;
      const im = own(new THREE.Mesh(new THREE.PlaneGeometry(art, art), flat('#fff', { map: collageOf(pl) }))); im.position.set(0, .35 + ah * .5, .1); grp.add(im);
      mesh(box(art + .1, art + .1, .04), MAT.ink, grp).position.set(0, .35 + ah * .5, .07);
      const plq = own(label(grp, labelTex(pl.name, pl.note), big ? 2.2 : 1.7, big ? .6 : .46, 0, .35 + ah * .5 - art / 2 - .5, .1), true);
      im.userData = { kind: 'playlist', i: k }; pickables.push(im); listMeshes.push({ grp, plq, im, panel: pi }); }); }
  const listTone = [toon('#B2C0CF'), toon('#C9D2DA')];
  const listPages = () => Math.max(1, Math.ceil(LIB.playlists.length / LIST_SLOTS));
  function setListPage(pg) { const n = listPages(); pg = ((pg % n) + n) % n; if (pg === listPg && listMeshes.length) return; listPg = pg; PLAYLISTS = LIB.playlists.slice(pg * LIST_SLOTS, (pg + 1) * LIST_SLOTS); buildLists(); }
  buildLists();

  /* ---------- south chapel: each kind of setting is a small geometric sculpture on a plinth ---------- */
  const SECTIONS = [['look', ts('g.look'), 'Appearance'], ['light', ts('g.light'), 'Light & Picture'], ['motion', ts('g.guide'), 'Moving around'], ['lyrics', ts('g.lyrics'), 'Lyrics'], ['audio', ts('g.audio'), 'Sound · Hi-Fi']];
  // which part of the settings page each sculpture opens
  const SECTION_OF = { look: 'look', light: 'light', motion: 'guide', lyrics: 'lyrics', audio: 'audio' };
  function sculpture(key) { const g = new THREE.Group();
    if (key === 'look') [[C.clay, -.22, 0], [C.olive, .2, .08], [C.mist, 0, .34]].forEach(([c, x, y], i) => { const d = mesh(cyl(.3, .3, .06, 40), toon(c), g); d.rotation.x = Math.PI / 2; d.position.set(x, .45 + y, i * .07); });
    if (key === 'light') { const d = mesh(new THREE.CylinderGeometry(.42, .42, .08, 40, 1, false, -Math.PI / 2, Math.PI), MAT.kraft, g); d.rotation.x = Math.PI / 2; d.position.y = .1;
      for (let k = 0; k < 5; k++) { const a = (k + .5) / 5 * Math.PI, r = mesh(box(.04, .3, .04), MAT.ink, g); r.position.set(Math.cos(a) * .62, .1 + Math.sin(a) * .62, 0); r.rotation.z = a - Math.PI / 2; } }
    if (key === 'motion') [[C.clay, 0], [C.mist, .2]].forEach(([c, x], i) => { const t = mesh(new THREE.TorusGeometry(.38 - i * .1, .05, 10, 40, Math.PI), toon(c), g); t.position.set(x - .1, .1, i * .1); });
    if (key === 'lyrics') [[.9, C.ink], [.6, C.clay], [.75, C.ink]].forEach(([w, c], i) => mesh(box(w, .12, .12), c === C.ink ? MAT.ink : toon(c), g).position.set((w - .9) / 2, .15 + i * .26, 0));
    if (key === 'audio') [.18, .32, .46].forEach((r, i) => { const t = mesh(new THREE.TorusGeometry(r, .04, 10, 48), i === 1 ? MAT.olive : MAT.ink, g); t.position.y = .55; });
    return g; }
  const stations = [];
  // five plinths on an arc in the middle of the chapel, all turned to the door
  SECTIONS.forEach(([key, zh, en], k) => { const th = (k - 2) * .52, R = 2.7, x = SETS.c.x + .6 + Math.cos(th) * R, z = SETS.c.z + Math.sin(th) * R;
    const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = -Math.PI / 2 + th * .6; world.add(grp);
    mesh(cyl(.5, .5, 1.0, 40), MAT.ivory, grp).position.y = .5; blob(x, z, 1.5, 1.5);
    const sc = sculpture(key); sc.position.y = 1.0; grp.add(sc);
    const title = label(grp, titleTex(zh, en), 1.7, .44, 0, 2.55, 0);
    grp.traverse(o => { if (o.isMesh && !noLine.includes(o)) { o.userData = { kind: 'setting', key }; pickables.push(o); } });
    stations.push({ key, grp, sc, title }); });

  /* ---------- the sanctuary: a clay arch, the cover on it, the words in ink on paper ---------- */
  const altarArt = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), flat('#fff', { map: covers.get(null, 'none') }));
  const lyricMeshes = [];
  { const p = sanct.panels[4], rer = new THREE.Group(); rer.position.set(0, 0, -T / 2 - .02); rer.rotation.y = Math.PI; p.add(rer);
    mesh(extrude(new THREE.Shape(archPts(6.2, 11)), .1), MAT.clay, rer).position.y = .4;
    mesh(box(3.3, 3.3, .05), MAT.ink, rer).position.set(0, 7.3, .14); altarArt.position.set(0, 7.3, .17); rer.add(altarArt);
    mesh(box(5.2, 3.6, .05), MAT.paper, rer).position.set(0, 3.2, .14);
    for (let k = 0; k < 9; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(5.4, .6), flat('#fff', { transparent: true, depthWrite: false, opacity: 0 })); m.visible = false; m.position.set(0, 3.2, .2); m.renderOrder = 6; rer.add(m); noLine.push(m); lyricMeshes.push({ m, y: 3.2, o: 0, idx: -1 }); } }
  // the song's lines as textures, drawn once each while the song lasts
  const lineTex = new Map();
  const lineTexOf = (i) => { let t = lineTex.get(i); if (!t) { t = lyricTex(NOW.lines[i]?.text || ''); lineTex.set(i, t); } return t; };
  // the wall shows the line being sung and three either side; a card leaving fades before it takes a new line
  function wallTick(dt) { const n = NOW.lines.length, cur = curLine, want = new Set();
    for (let d = -3; d <= 3; d++) { const i = cur + d; if (cur >= 0 && i >= 0 && i < n) want.add(i); }
    lyricMeshes.forEach(L => { if (L.idx >= 0 && !want.has(L.idx) && L.o < .01) { L.idx = -1; L.m.visible = false; } });
    for (const i of want) if (!lyricMeshes.some(L => L.idx === i)) { const L = lyricMeshes.find(x => x.idx < 0); if (!L) break; L.idx = i; L.m.material.map = lineTexOf(i); L.m.material.needsUpdate = true; L.o = 0; L.y = 3.2 - (i - cur) * .78 * (L.base || 1) - .3; }
    lyricMeshes.forEach(L => { if (L.idx < 0) return; const d = L.idx - cur, b = L.base || 1, inWin = want.has(L.idx);
      const ty = 3.2 - d * .78 * b, to = !inWin ? 0 : d === 0 ? 1 : Math.max(0, .4 - Math.abs(d) * .16), q = Math.min(1, dt * 5);
      L.y += (ty - L.y) * q; L.o += (to - L.o) * q; L.m.position.y = L.y; L.m.scale.setScalar((d === 0 ? 1 : .8) * b); L.m.material.opacity = L.o * (1 - sstep(.95, 1.4, Math.abs(L.y - 3.2))) * scene3.wallFade; L.m.visible = L.m.material.opacity > .003 && Math.abs(L.y - 3.2) < 1.7; }); }
  // the line being sung at t (shown a moment early, as the lyrics fly off the wall ahead of the voice)
  const lineAt = (t) => { const L = NOW.lines; let k = -1; for (let i = 0; i < L.length; i++) { if (L[i].t <= t + .35) k = i; else break; } return k; };

  /* ---------- light beams: soft volumes, no sheets. Each beam is an axis with two radii (plus a strength);
     a post pass integrates every beam along each pixel's view ray, stopping at the scene's depth ---------- */
  const beams = new THREE.Group(); scene.add(beams);
  const segs = [];
  // strength per room: the crossing pours hardest, the sanctuary keeps its words readable
  const beamK = () => 1;   // one brightness for every beam in the building
  function prism(pts0, toFloor, sunlit, k = 1) { const c = pts0.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / pts0.length), q = pts0.map(toFloor), qc = q.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / q.length);
    const ra = Math.max(...pts0.map(p => p.distanceTo(c))), rb = Math.max(...q.map(p => p.distanceTo(qc)));
    segs.push([c.clone(), qc, ra * .8, Math.max(.4, rb * .8), k]);
    if (sunlit) { const bb = new THREE.Box3().setFromPoints(q), sz = bb.getSize(new V3()), ce = bb.getCenter(new V3()); soft(beams, GLOW, sz.x * 1.6 + 1.4, sz.z * 1.6 + 1.4, ce.x, .02, ce.z, -Math.PI / 2, 0, .85, true).renderOrder = 3; } }
  function buildBeams() { world.updateMatrixWorld(true); const n = new V3(), up = new V3(0, 1, 0), seen = new Set();
    glassList.forEach(m => { if (m.userData.noBeam) return; n.set(0, 0, 1).transformDirection(m.matrixWorld); const pts = m.userData.outline.map(p => m.localToWorld(new V3(p.x, p.y, 0))), f = m.userData.focal;
      if (f) { // not physical: every window of the room pours toward one point on the floor
        const c = pts.reduce((a, p) => a.add(p), new V3()).multiplyScalar(1 / pts.length), d = new V3(c.x - f.x, 0, c.z - f.z).normalize(), u = new V3().crossVectors(up, d).normalize(), w = new V3().crossVectors(up, n).normalize();
        // each window lands on its own spot of a small lit area around the focus, a little toward its own side, never all on one point
        const spread = f.distanceTo(new V3(CROSS.c.x, 0, CROSS.c.z)) < 1 ? 1.25 : .55, land = f.clone().addScaledVector(d, spread * (.8 + .4 * rnd(c.x * 3.1 + c.z))).addScaledVector(u, (rnd(c.z * 1.7 + c.x) - .5) * spread * .8);
        prism(pts, p => { const o = p.clone().sub(c); return land.clone().addScaledVector(u, o.dot(w) * .45).addScaledVector(d, o.y * .32).setY(0); }, false, beamK(f));
        if (!seen.has(f)) { seen.add(f); if (f.distanceTo(new V3(CROSS.c.x, 0, CROSS.c.z)) > 1) pool(f, .9); } }
      else if (n.dot(SUN_DIR) >= .2) prism(pts, p => p.clone().addScaledVector(SUN_DIR, -p.y / SUN_DIR.y), true, beamK(null)); });
    domes.forEach(d => { const c = new V3(d.c.x, d.y, d.c.z), f = d.focal || new V3(d.c.x, 0, d.c.z);
      // under the clear-sky panel the light spreads out wide and soft, like daylight, instead of a column
      prism(Array.from({ length: 24 }, (_, k) => new V3(d.c.x + Math.cos(k / 24 * Math.PI * 2) * d.r, d.y, d.c.z + Math.sin(k / 24 * Math.PI * 2) * d.r)), p => f.clone().add(new V3((p.x - c.x) * (d.blue ? 2.4 : .6), 0, (p.z - c.z) * (d.blue ? 2.4 : .6))), false, beamK(f) * (d.blue ? .38 : .8));
      if (d.blue) { const s = segs[segs.length - 1]; s[2] *= 1.6; s[3] *= 1.7; s[5] = 1; } });   // the sky panel: one wide, coreless, daylight-white column
    buildMotes(); }

  function segTex() { if (segTex.t) return segTex.t; const data = new Float32Array(64 * 3 * 4); segs.slice(0, 64).forEach((s, k) => { data.set([s[0].x, s[0].y, s[0].z, s[2]], k * 4); data.set([s[1].x, s[1].y, s[1].z, s[3]], (64 + k) * 4); data.set([s[4], s[5] || 0, 0, 0], (128 + k) * 4); });
    const t = new THREE.DataTexture(data, 64, 3, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; segTex.t = t; return t; }

  /* ---------- motes: always there, barely visible; lit up when they drift through a beam; kicked by accents ---------- */
  let motes;
  function buildMotes() { const vols = [[0, -24, 5.4, 23.5, 0, 16], [CROSS.c.x, CROSS.c.z, 12.5, 12.5, 0, 20], [SETS.c.x, SETS.c.z, 6.2, 6.2, 0, 11], [LISTS.c.x, LISTS.c.z, 6.2, 6.2, 0, 11], [SANCT.c.x, SANCT.c.z, 7, 7, 0, 13]];
    const per = [1500, 1800, 900, 900, 1100], N = per.reduce((a, b) => a + b), pos = new Float32Array(N * 3), seed = new Float32Array(N), dir = new Float32Array(N * 3), yr = new Float32Array(N * 2); let i = 0;
    vols.forEach((v, vi) => { for (let k = 0; k < per[vi]; k++, i++) { const r = rnd(i * 1.37);
        // a fifth of the motes are seeded inside beams so beams carry some dust without crowding the light
        let x = v[0] + (rnd(i * 1.1) * 2 - 1) * v[2], y = .3 + rnd(i * 2.7) * (v[5] - .3), z = v[1] + (rnd(i * 3.9) * 2 - 1) * v[3];
        if (r < .2 && segs.length) { const s = segs[Math.floor(rnd(i * 5.1) * segs.length)], t = rnd(i * 6.7), p = s[0].clone().lerp(s[1], t), rr = (s[2] + (s[3] - s[2]) * t) * .7; x = p.x + (rnd(i * 7.3) - .5) * rr * 2; y = Math.max(.3, p.y + (rnd(i * 8.1) - .5) * rr); z = p.z + (rnd(i * 9.7) - .5) * rr * 2; }
        pos.set([x, y, z], i * 3); seed[i] = rnd(i * 5.3); const a = rnd(i * 4.4) * Math.PI * 2, b = rnd(i * 2.2) * 2 - 1; dir.set([Math.cos(a) * Math.sqrt(1 - b * b), b, Math.sin(a) * Math.sqrt(1 - b * b)], i * 3); yr.set([.2, v[5]], i * 2); } });
    const st = segTex();
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1)); geo.setAttribute('dir', new THREE.BufferAttribute(dir, 3)); geo.setAttribute('yr', new THREE.BufferAttribute(yr, 2));
    motes = new THREE.Points(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { segs: { value: st }, nSeg: { value: Math.min(64, segs.length) }, time: { value: 0 }, px: { value: 1 }, accent: { value: 0 }, still: { value: 0 }, col: { value: new THREE.Color(C.apricot) }, keep: { value: 1 } },
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
   float d = length(gl_PointCoord-.5); if (vB < .004 || d > .5) discard; gl_FragColor = vec4(col*vB*smoothstep(.5, .05, d)*1.6, 1.); }` }));
    motes.frustumCulled = false; motes.renderOrder = 5; scene.add(motes); noLine.push(motes); }

  /* ---------- ink: edges from depth and normals, drawn over the flat colour ---------- */
  const FSV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
  class Ink extends Pass {
    constructor() { super(); this.needsSwap = true;
      this.rt = new THREE.WebGLRenderTarget(2, 2, { depthTexture: new THREE.DepthTexture(2, 2), type: THREE.HalfFloatType });
      this.ids = new Map();   // one outline material per surface material: the boundary is between materials, not objects, so coplanar
      // pieces of one material (overlapping rug motifs, a sofa's arm meeting its back) never fight over a line
      this.idMat = (m) => { const side = m.side, bias = m.userData.bias || 0, tr = m.transparent || bias > 0 ? 1 : 0, key = m.uuid;   // decals lying flat on a floor (rugs and their motifs) stay out: a grazing outline there only crawls if (this.ids.has(key)) return this.ids.get(key);
        // materials that only differ by a depth bias (decal clones) are the same surface; they share their source's colour
        const tag = (m.color ? m.color.getHexString() : m.uuid) + (m.map ? m.map.uuid : ''); let hsh = 2166136261; for (let i = 0; i < tag.length; i++) hsh = Math.imul(hsh ^ tag.charCodeAt(i), 16777619);
        const im = new THREE.ShaderMaterial({ side, uniforms: { bias: { value: bias * 2e-5 }, tr: { value: tr }, mid: { value: ((hsh >>> 0) % 1000003) / 1000003 } },
          vertexShader: `#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec3 vN; void main(){ vec3 n = normal; mat4 M = modelMatrix;\n#ifdef USE_INSTANCING\n n = mat3(instanceMatrix)*n; M = modelMatrix*instanceMatrix;\n#endif\n vN = normalize(normalMatrix*n); gl_Position = projectionMatrix*viewMatrix*M*vec4(position, 1.);\n#include <logdepthbuf_vertex>\n}`,
          fragmentShader: `#include <common>\n#include <logdepthbuf_pars_fragment>\nuniform float bias, tr, mid; varying vec3 vN; void main(){\n#include <logdepthbuf_fragment>\n#ifdef USE_LOGDEPTHBUF\n gl_FragDepth -= bias;\n#endif\n vec3 n = normalize(vN)*(gl_FrontFacing ? 1. : -1.); gl_FragColor = vec4(n*.5+.5, tr > .5 ? -1. : mid); }` });
        this.ids.set(key, im); return im; };
      this.swap = [];
      this.mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: FSV,
        uniforms: { tDiffuse: { value: null }, tN: { value: this.rt.texture }, tD: { value: this.rt.depthTexture }, px: { value: new V2() }, w: { value: 1 }, two: { value: 1 }, near: { value: .1 }, far: { value: 300 }, ink: { value: new THREE.Color(C.ink) } },
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
            gl_FragColor = vec4(mix(c.rgb, ink, e*fade*.92)+grain, c.a); }` });
      this.q = new FullScreenQuad(this.mat); }
    setSize(w, h) { this.rt.setSize(w, h); this.mat.uniforms.px.value.set(1 / w, 1 / h); }
    render(r, write, read) { const bg = scene.background, ov = scene.overrideMaterial, hid = noLine.filter(o => o.visible);
      hid.forEach(o => o.visible = false); scene.background = null; const sw = this.swap; sw.length = 0;
      scene.traverseVisible(o => { if (o.isMesh && !Array.isArray(o.material)) { sw.push(o, o.material); o.material = this.idMat(o.material); } }); const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
      r.setClearColor(0x8080ff, 1); r.setRenderTarget(this.rt); r.clear(); r.render(scene, camera); r.setClearColor(cc, ca);
      for (let k = 0; k < sw.length; k += 2) sw[k].material = sw[k + 1]; scene.background = bg; hid.forEach(o => o.visible = true);
      const u = this.mat.uniforms; u.tDiffuse.value = read.texture; u.near.value = camera.near; u.far.value = camera.far;
      r.setRenderTarget(this.renderToScreen ? null : write); this.q.render(r); } }
  /* ---------- the dream: the eye adjusts to the light, the edges darken, distance softens into wheat ---------- */
  // how much light you are looking straight into: windows and skylights of the room you stand in, 25 m at most,
  // weighted by how close the centre of view is to them and how squarely they face you (the same terms the glass shader uses)
  let LIGHTS = null; const _lv = new V3(), _lf = new V3(), _ld = new V3();
  function lightsBuild() { LIGHTS = []; world.updateMatrixWorld(true); const n = new V3();
    glassList.forEach(m => { const p = m.getWorldPosition(new V3()), size = m.userData.size || 3; n.set(0, 0, 1).transformDirection(m.matrixWorld); const inward = n.clone().multiplyScalar(m.userData.inward || -1);
      if (m.userData.outline) { const c = m.userData.outline.reduce((a, q) => a.add(new V3(q.x, q.y, 0)), new V3()).multiplyScalar(1 / m.userData.outline.length); p.copy(m.localToWorld(c)); }
      const r = regionAt(p.clone().addScaledVector(inward, 1.4).setY(Math.min(p.y, 6)) ) || regionAt(p.clone().addScaledVector(inward, 1.4)); LIGHTS.push({ p, n, size, base: glassBase(size), flare: glassFlare(size), room: r ? r.room : null, glass: true }); });
    domes.forEach(d => { const r = regionAt(new V3(d.c.x, EYE, d.c.z)); LIGHTS.push({ p: new V3(d.c.x, d.y + 1, d.c.z), n: new V3(0, 1, 0), size: d.r * 2.4, base: 1.6, room: r ? r.room : null }); }); }
  function lightInView() { if (!LIGHTS) lightsBuild(); camera.updateMatrixWorld(true); const cam = camera.getWorldPosition(_lv), fwd = camera.getWorldDirection(_lf); let I = 0;
    for (const L of LIGHTS) { if (L.room !== room) continue; _ld.subVectors(L.p, cam); const dist = _ld.length(); if (dist > (L.glass ? 25 : 36) || dist < .5) continue; _ld.multiplyScalar(1 / dist);
      const ang = Math.acos(Math.max(-1, Math.min(1, fwd.dot(_ld)))), half = Math.atan(L.size / 2 / dist), w = 1 - sstep(half * .5, half * 1.6 + .06, ang); if (w <= 0) continue;
      const f = Math.abs(_ld.dot(L.n)), bright = L.glass ? L.base * (.7 + 1.2 * f * L.flare) : L.base * (.6 + .4 * f); I = Math.max(I, w * bright * (1 - (L.glass ? sstep(14, 25, dist) : sstep(22, 36, dist)) * .7)); }
    return I; }
  class Dream extends Pass {
    constructor() { super(); this.needsSwap = true; this.exposure = 1; this.small = new THREE.WebGLRenderTarget(8, 8); this.buf = new Uint8Array(8 * 8 * 4); this.n = 0;   // brightness is stored /4, so up to 4x white still reads
      this.probe = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: FSV, uniforms: { t: { value: null } }, fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ vec2 uv = .3 + vUv*.4; vec3 c = (texture2D(t, uv).rgb + texture2D(t, uv+vec2(.02,.03)).rgb + texture2D(t, uv-vec2(.03,.02)).rgb)/3.; gl_FragColor = vec4(vec3(dot(c, vec3(.2126,.7152,.0722))/4.), 1.); }` });
      const lin3 = (h) => new THREE.Color(h);
      this.mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: FSV,
        uniforms: { tDiffuse: { value: null }, tD: { value: null }, near: { value: .3 }, far: { value: 160 }, exposure: { value: 1 }, aspect: { value: 1 }, haze: { value: lin3(C.wheat) }, edge: { value: lin3('#9C8B74') } },
        fragmentShader: `uniform sampler2D tDiffuse, tD; uniform float near, far, exposure, aspect; uniform vec3 haze, edge; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb; float lum = dot(col, vec3(.2126, .7152, .0722));
            float d = exp2(texture2D(tD, vUv).x*log2(far+1.)) - 1.;
            float fog = smoothstep(16., 72., d)*.42; col = mix(col, mix(vec3(lum), col, .7), fog*.7); col = mix(col, haze, fog*.55);
            col *= exposure * .94;
            float v = smoothstep(.42, 1.08, length((vUv-.5)*vec2(aspect, 1.))); col = mix(col, col*edge/max(max(edge.r, edge.g), edge.b), v*.55);
            vec3 g = col/(1.+col*.12); float l2 = dot(g, vec3(.2126,.7152,.0722)); g = mix(g, g*vec3(1.04,1.,.93), smoothstep(.55, 1., l2)); g = mix(g, g*vec3(.97,.96,1.03), 1.-smoothstep(.15, .6, l2));
            g = mix(vec3(l2), g, 1.06); g = g*.965 + .02; gl_FragColor = vec4(g, c.a); }` });
      this.q = new FullScreenQuad(this.mat); this.pq = new FullScreenQuad(this.probe); }
    setSize(w, h) { this.mat.uniforms.aspect.value = w / h; }
    render(r, write, read) { const u = this.mat.uniforms;
      if (false) { this.probe.uniforms.t.value = read.texture; r.setRenderTarget(this.small); this.pq.render(r); r.readRenderTargetPixels(this.small, 0, 0, 8, 8, this.buf); let s = 0, mx = 0; for (let i = 0; i < 64; i++) { const l = this.buf[i * 4] / 255 * 4; s += l; mx = Math.max(mx, l); } this.lum = .55 * s / 64 + .45 * mx; }
      u.tDiffuse.value = read.texture; u.tD.value = ink.rt.depthTexture; u.near.value = camera.near; u.far.value = camera.far; u.exposure.value = this.exposure * (1 + (this.pulse || 0));
      r.setRenderTarget(this.renderToScreen ? null : write); this.q.render(r); }
    // the brighter the light in view, the harder the eye stops down: up to about 80% darker around a window seen straight on
    step(dt) { this.lum = lightInView(); const L = this.lum, goal = Math.max(.2, 1 / (1 + 1.55 * Math.max(0, L - .55)));
      this.exposure += (goal - this.exposure) * (1 - Math.exp(-dt / (goal < this.exposure ? .7 : 1.4))); } }
  class Shafts extends Pass {
    constructor() { super(); this.needsSwap = true;
      this.mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: FSV,
        uniforms: { tDiffuse: { value: null }, tD: { value: null }, segs: { value: null }, nSeg: { value: 0 }, far: { value: 160 }, projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new V3() }, col: { value: new THREE.Color(C.apricot) }, colS: { value: new THREE.Color('#EEF3F2') }, gain: { value: .06 }, time: { value: 0 } },
        fragmentShader: `uniform sampler2D tDiffuse, tD, segs; uniform int nSeg; uniform float far, gain, time; uniform mat4 projInv, camWorld; uniform vec3 camPos, col, colS; varying vec2 vUv;
          void main(){ vec4 base = texture2D(tDiffuse, vUv);
            vec4 v = projInv*vec4(vUv*2.-1., 1., 1.); vec3 dir = normalize((camWorld*vec4(v.xyz/v.w, 0.)).xyz); vec3 fwd = normalize((camWorld*vec4(0.,0.,-1.,0.)).xyz);
            float L = (exp2(texture2D(tD, vUv).x*log2(far+1.)) - 1.)/max(.05, dot(dir, fwd));
            float acc = 0., accS = 0.;
            for (int i = 0; i < 64; i++) { if (i >= nSeg) break; vec4 a = texelFetch(segs, ivec2(i,0), 0), b = texelFetch(segs, ivec2(i,1), 0); vec2 kk = texelFetch(segs, ivec2(i,2), 0).xy; float k = kk.x;
              vec3 u = b.xyz-a.xyz, w0 = camPos-a.xyz; float bb = dot(dir,u), cc = dot(u,u), dd = dot(dir,w0), ee = dot(u,w0), den = max(cc-bb*bb, 1e-4);
              float tu = (ee-bb*dd)/den, t = clamp(tu, 0., 1.); vec3 q = a.xyz+u*t; float s = clamp(dot(q-camPos, dir), 0., L);
              vec3 p = camPos+dir*s; float r = mix(a.w, b.w, t), d = length(p-q), sn = sqrt(max(1.-bb*bb/cc, .03));
              float near = smoothstep(.8, 4., s);
              // a narrow bright core inside a faint wide halo; thickness no longer adds brightness, so every beam reads the same
              float prof = kk.y > .5 ? .7*exp(-d*d/(r*r)*1.1) : exp(-d*d/(r*r)*7.) + .38*exp(-d*d/(r*r)*1.4);
              // each beam breathes on its own slow, unrelated rhythm
              float fi = float(i), breathe = 1. + .09*sin(time*.21 + fi*1.71)*sin(time*.133 + fi*4.13) + .05*sin(time*.47 + fi*2.93);
              float add = k*breathe*prof*min(1.25/sn, 3.2)*smoothstep(-.14, .05, tu)*(1.-.35*t)*near; if (kk.y > .5) accS += add; else acc += add; }   // fade softly past the window end (a hard cut there left a ring)
            float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453)*.04;
            gl_FragColor = vec4(base.rgb + (col*acc + colS*accS)*gain*(1.+n), base.a); }` });
      this.q = new FullScreenQuad(this.mat); }
    render(r, write, read) { const u = this.mat.uniforms; u.time.value = performance.now() / 1000; u.tDiffuse.value = read.texture; u.tD.value = ink.rt.depthTexture; u.segs.value = segTex(); u.nSeg.value = Math.min(64, segs.length); u.far.value = camera.far;
      u.projInv.value.copy(camera.projectionMatrixInverse); u.camWorld.value.copy(camera.matrixWorld); u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
      r.setRenderTarget(this.renderToScreen ? null : write); this.q.render(r); } }
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const ink = new Ink(); composer.addPass(ink);
  const shafts = new Shafts(); composer.addPass(shafts);
  const dream = new Dream(); composer.addPass(dream);
  const glow = new UnrealBloomPass(new V2(4, 4), .32, .7, 1.1); composer.addPass(glow);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa);
  class UiGlass extends Pass {
    constructor() { super(); this.needsSwap = true; this.rects = Array.from({ length: 12 }, () => new THREE.Vector4()); this.radii = new Array(12).fill(0);
      this.mat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, vertexShader: FSV,
        uniforms: { tDiffuse: { value: null }, res: { value: new V2(1, 1) }, rects: { value: this.rects }, radii: { value: this.radii }, n: { value: 0 }, block: { value: 14 }, tint: { value: new THREE.Color(.98, .96, .92) } },
        fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 res; uniform vec4 rects[12]; uniform float radii[12]; uniform int n; uniform float block; uniform vec3 tint; varying vec2 vUv;
          void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 p = vUv*res; float inside = 0.;
            for (int i = 0; i < 12; i++) { if (i >= n) break; vec4 r = rects[i]; vec2 hs = r.zw*.5; float rad = min(radii[i], min(hs.x, hs.y)); vec2 q = abs(p-(r.xy+hs))-hs+rad;
              float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - rad; inside = max(inside, 1.-smoothstep(-1., 1., d)); }
            if (inside > 0.) { vec2 b = (floor(p/block)+.5)*block; vec3 m = vec3(0.);
              for (int k = 0; k < 16; k++) { vec2 o = (vec2(float(k - (k/4)*4), float(k/4)) - 1.5)/4.*block*1.6; m += texture2D(tDiffuse, (b+o)/res).rgb; }
              m = m/16.; m = mix(m, vec3(dot(m, vec3(.3,.55,.15))), .25); c.rgb = mix(c.rgb, m, inside); }
            gl_FragColor = c; }` });
      this.q = new FullScreenQuad(this.mat); }
    setSize(w, h) { this.mat.uniforms.res.value.set(w, h); }
    collect() { const pr = renderer.getPixelRatio(); let n = 0;
      for (const el of document.querySelectorAll('.card')) { if (n >= 12 || el.hidden || !el.offsetParent && getComputedStyle(el).position !== 'fixed') continue; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || el.closest('[hidden]')) continue;
        if (el.dataset.rad == null) el.dataset.rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        this.rects[n].set(r.left * pr, (innerHeight - r.bottom) * pr, r.width * pr, r.height * pr); this.radii[n] = +el.dataset.rad * pr; n++; }
      this.mat.uniforms.n.value = n; this.mat.uniforms.block.value = 22 * pr; }
    render(r, write, read) { this.collect(); this.mat.uniforms.tDiffuse.value = read.texture; r.setRenderTarget(this.renderToScreen ? null : write); this.q.render(r); } }
  const uiGlass = new UiGlass(); composer.addPass(uiGlass);

  function fitSun(size) { const center = new V3(0, 10, -50); sun.target.position.copy(center); sun.position.copy(center).addScaledVector(SUN_DIR, 140); sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera; cam.position.copy(sun.position); cam.lookAt(center); cam.updateMatrixWorld(); const inv = cam.matrixWorldInverse, mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
    for (const x of [-38, 38]) for (const y of [-1, 32]) for (const z of [3, -103]) { const p = new V3(x, y, z).applyMatrix4(inv); mn.min(p); mx.max(p); }
    Object.assign(cam, { left: mn.x, right: mx.x, bottom: mn.y, top: mx.y, near: -mx.z - 2, far: -mn.z + 2 }); cam.updateProjectionMatrix();
    sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } renderer.shadowMap.needsUpdate = true; }
  /* ---------- rooms, doors and routes ---------- */
  const octIn = (p, R, m) => { const dx = p.x - R.c.x, dz = p.z - R.c.z; for (const d of DIRS) if (dx * d.x + dz * d.z > R.r - m) return false; return true; };
  const VEST = [['settings', new V3(1, 0, 0)], ['lists', new V3(-1, 0, 0)], ['altar', new V3(0, 0, -1)]];
  // each region: which room it belongs to, and how high you may float there
  function regionAt(p) {
    if (Math.abs(p.x) < NAVE.w / 2 - .6 && p.z < -.6 && p.z > NAVE.z1 + .6) return { room: 'nave', top: 19 };
    // every doorway reaches 1.5 m into both rooms, so the walkable areas always overlap
    if (Math.abs(p.x) < 2.4 && p.z <= NAVE.z1 + 1.5 && p.z > NAVE.z1 - T - 1.5) return { room: p.z > NAVE.z1 - T / 2 ? 'nave' : 'dome', top: 9.2, door: true };
    if (octIn(p, CROSS, .7)) return { room: 'dome', top: 24 };
    for (const [room, d] of VEST) { const rx = p.x - CROSS.c.x, rz = p.z - CROSS.c.z, along = rx * d.x + rz * d.z, lat = Math.abs(rx * d.z - rz * d.x); if (along > CROSS.r - 1.5 && along < CROSS.r + 2 * T + 3 + 1.5 && lat < DOOR.w / 2 - .5) return { room: along < CROSS.r + T + 1.5 ? 'dome' : room, top: 6.8, door: true }; }
    if (octIn(p, LISTS, .6)) return { room: 'lists', top: 15 }; if (octIn(p, SETS, .6)) return { room: 'settings', top: 15 }; if (octIn(p, SANCT, .6)) return { room: 'altar', top: 17 };
    return null; }
  const PLACES = {
    nave: { pos: new V3(0, EYE, -4), yaw: 0, pitch: .05, sign: ['The Nave', `${ts('room.nave')} · ${ts('room.nave.sub')}`] },
    dome: { pos: new V3(CROSS.c.x, EYE, CROSS.c.z + 11.2), yaw: 0, pitch: .03, sign: ['The Crossing', `${ts('room.dome')} · ${ts('room.dome.sub')}`] },
    lists: { pos: new V3(LISTS.c.x + 4.2, EYE, LISTS.c.z), yaw: Math.PI / 2, pitch: .02, sign: ['North Chapel', `${ts('room.lists')} · ${ts('room.lists.sub')}`] },
    altar: { pos: new V3(SANCT.c.x, EYE, SANCT.c.z + 5.2), yaw: 0, pitch: .1, sign: ['The Sanctuary', `${ts('room.altar')} · ${ts('room.altar.sub')}`] },
    settings: { pos: new V3(SETS.c.x - 4.2, EYE, SETS.c.z), yaw: -Math.PI / 2, pitch: -.04, sign: ['South Chapel', `${ts('room.settings')} · ${ts('room.settings.sub')}`] } };
  // the way through the building: every room hangs off the crossing; each link is the line through its doorways
  const at = (d, s) => new V3(CROSS.c.x + d.x * s, EYE, CROSS.c.z + d.z * s);
  const LINKS = { nave: [new V3(0, EYE, NAVE.z1 + 4), new V3(0, EYE, NAVE.z1 - T / 2), new V3(0, EYE, NAVE.z1 - T - 3)] };
  for (const [room, d] of VEST) LINKS[room] = [10.5, CROSS.r + T / 2, CROSS.r + T + 1.5, CROSS.r + T + 3 + T / 2, CROSS.r + 2 * T + 3 + 2.5].map(s => at(d, s)).reverse();
  function route(from, to) { if (from === to) return []; const out = from === 'dome' ? [] : [...LINKS[from]]; if (to !== 'dome') out.push(...[...LINKS[to]].reverse()); return out; }

  /* ---------- walking, looking, flying ---------- */
  const me = { pos: PLACES.nave.pos.clone(), yaw: 0, pitch: .05, vel: new V3() };
  const keys = new Set(); let looking = false, locked = false, flight = null, place = 'nave', room = 'nave';
  const ease = (u) => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const wrapTo = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d; };
  function fly(pos, yaw, pitch, dur) {
    const target = regionAt(pos)?.room || room, ways = route(room, target);
    if (RM()) { $('veil').style.opacity = 1; flight = null; setTimeout(() => { me.pos.copy(pos); me.yaw = yaw; me.pitch = pitch; me.vel.set(0, 0, 0); $('veil').style.opacity = 0; }, 360); return; }
    if (!ways.length) { const d = me.pos.distanceTo(pos); flight = { t0: performance.now(), dur: (dur ?? Math.min(2.4, .8 + d * .06)) * 1000, from: me.pos.clone(), to: pos.clone(), y0: me.yaw, y1: wrapTo(me.yaw, yaw), p0: me.pitch, p1: pitch }; return; }
    // a walk through the doorways, not through the walls
    const pts = [me.pos.clone(), ...ways, pos.clone()].filter((p, i, a) => i === 0 || p.distanceTo(a[i - 1]) > .4);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5), len = curve.getLength();
    flight = { curve, t0: performance.now(), dur: Math.max(1.6, Math.min(6.5, len / 10)) * 1000, y0: me.yaw, p0: me.pitch, yaw, pitch }; }
  function setPlace(p, go = true) { place = p; Object.keys(PLACES).forEach(k => $('go-' + k).setAttribute('aria-pressed', String(k === p))); const P = PLACES[p];
    if (go) { fly(P.pos, P.yaw, P.pitch); return; }   // the sign changes on arrival, not on departure
    const s = $('sign'); s.style.opacity = 0; setTimeout(() => { s.innerHTML = `<i>${P.sign[0]}</i><b>${P.sign[1]}</b><u style="background:${ROOM_COL[p]}"></u>`; s.style.opacity = 1; }, 300); }
  function onRoom(r) { room = r; setPlace(r, false); if (r !== 'settings') ui.closeSettings(); }

  function sit(i) { const s = sofas[i]; if (!s) return;
    if (s.ring) { const a = Math.atan2(me.pos.x - s.ring.x, me.pos.z - s.ring.z); s.seat.set(s.ring.x + Math.sin(a) * s.ring.r, 1.15, s.ring.z + Math.cos(a) * s.ring.r); s.yaw = a + Math.PI; }   /* the nearest point of the ring, facing out */ hideCards(); ui.closeSettings(); fly(s.seat.clone(), s.yaw, -.04); seated = true; }
  function hideCards() { $('focus').hidden = true; $('f-list').hidden = true; }
  function focusAlbum(i) { const m = albumMeshes[i]; if (!m) return; const s = m.s; chosenSong = -1; ui.closeSettings();
    fly(new V3(s.x - s.side * 4.4, EYE, s.z), s.side > 0 ? -Math.PI / 2 : Math.PI / 2, .1);
    showFocus(`${ts('kind.album')} · ${ts('room.nave')}`, ALBUMS[i].title, [ALBUMS[i].artist, ALBUMS[i].year].filter(Boolean).join('，'), () => play(ALBUMS[i].ids, 0)); }
  function focusSong(i) { chosenSong = i; const t = Math.floor(i / PER); tierGoal = t; const a = songAngle(i); ui.closeSettings();
    if (room === 'dome') { const tgt = new V3(); songPose(i, t, tgt); const d = tgt.clone().sub(me.pos); fly(me.pos.clone(), Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)) * .8, .7); }
    else fly(new V3(CROSS.c.x, EYE, CROSS.c.z), a, .02, 1);
    showFocus(`${ts('kind.song')} · ${ts('room.dome')}`, SONGS[i].title, [SONGS[i].artist, SONGS[i].album && `《${SONGS[i].album}》`].filter(Boolean).join('，'), () => play(SONGS.map(x => x.id), i)); }
  function focusList(k) { const L = listMeshes[k], pl = PLAYLISTS[k]; ui.closeSettings(); const w = new V3(); L.grp.getWorldPosition(w); const d = w.clone().sub(LISTS.c).setY(0).normalize();
    fly(new V3(LISTS.c.x + d.x * 2.2, EYE, LISTS.c.z + d.z * 2.2), Math.atan2(-d.x, -d.z), .08);
    showFocus(`${ts('kind.list')} · ${ts('room.lists')}`, pl.name, pl.note, () => play(pl.ids, 0));
    const ol = $('f-list'); ol.innerHTML = ''; pl.ids.slice(0, 8).forEach(id => { const sg = SONGS[songById.get(id)]; if (!sg) return; const li = document.createElement('li'); li.textContent = sg.title; ol.append(li); }); ol.hidden = false; }
  let onPlay = null; function showFocus(eye, title, meta, fn) { setTimeout(freePointer, 0); $('f-play').textContent = ts('play'); $('f-eye').textContent = eye; $('f-title').textContent = title; $('f-meta').textContent = meta; onPlay = fn; $('f-list').hidden = true; $('focus').hidden = false; }
  let playing = false, songT = 0, seated = false;
  // Cadenza plays; the scene follows (the card, the cover, the lyrics change when the player says so, in frame())
  function play(ids, index) { bind.play(ids, index); hideCards(); setPlace('altar'); }

  /* ---------- the settings: the sculptures open the settings page at their part (the page is SpaceShell's) ---------- */
  function openLedger(key) { const st = stations.find(l => l.key === key); hideCards(); freePointer(); ui.openSettings(SECTION_OF[key]);
    const w = new V3(); st.grp.getWorldPosition(w); const d = w.clone().sub(SETS.c).setY(0).normalize(); fly(new V3(w.x - d.x * 3, EYE, w.z - d.z * 3), Math.atan2(-d.x, -d.z), -.12); }
  let shadowSize = 0;
  // Cadenza's picture-quality modes: as designed; optimised (no second ink scale, half the motes, softer bloom);
  // lite (no beams' volumes, no bloom, no glass behind the HUD, a quarter of the motes, at most 75 % resolution)
  function quality() { const q = S.gfx, lite = q === 'lite', opt = q === 'optimized';
    shafts.enabled = !lite; glow.enabled = !lite && S.dream !== false; uiGlass.enabled = !lite;
    ink.mat.uniforms.two && (ink.mat.uniforms.two.value = lite || opt ? 0 : 1); glow.resolution?.set(innerWidth * (opt ? .5 : 1), innerHeight * (opt ? .5 : 1));
    if (motes) motes.material.uniforms.keep.value = lite ? .25 : opt ? .5 : 1; }
  function apply() { quality(); if (!S.immersive && document.pointerLockElement === canvas && !looking) document.exitPointerLock?.(); beams.visible = !!S.beams; if (typeof updateAmbient === 'function') updateAmbient(); dream.enabled = S.dream !== false; glow.enabled = S.dream !== false && S.gfx !== 'lite'; ink.mat.uniforms.w.value = { thin: .8, mid: 1.2, bold: 1.8 }[S.line] || 1.2;
    const size = { high: 4096, mid: 2048, low: 1024 }[S.shadow] || 4096; if (size !== shadowSize) { shadowSize = size; fitSun(size); }
    const pr = Math.min(1.5, devicePixelRatio || 1) * (+S.res || 1) * (S.gfx === 'lite' ? .75 : 1); if (Math.abs(renderer.getPixelRatio() - pr) > .001) { renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize(); }
    const ls = { s: .8, m: 1, l: 1.2 }[S.lyric] || 1; lyricMeshes.forEach(L => L.base = ls); }

  /* ---------- input ---------- */
  const ray = new THREE.Raycaster(), ndc = new V2();
  function pickAt(x, y) { const r = canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
    const h = ray.intersectObjects([...pickables, ...occluders], false)[0]; if (!h || !h.object.userData.kind) return null;
    if (h.distance > (h.object.userData.kind === 'bowl' ? 14 : 7)) return null;
    const back = h.point.clone().addScaledVector(ray.ray.direction, -.6), rr = regionAt(back); if (!rr || rr.room !== room) return null;   // only what is in your own room
    if (h.object.userData.kind === 'bowl') return { kind: 'song', i: h.object.userData.ids[h.instanceId] }; return h.object.userData; }
  const occluders = []; world.traverse(o => { if (o.isMesh && !o.isInstancedMesh && o.castShadow && !o.userData.kind) occluders.push(o); });   // walls stop the pointer like they stop the eye
  const immersive = () => !!S.immersive;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.button === 2 && !immersive()) { looking = true; canvas.setPointerCapture(e.pointerId); canvas.requestPointerLock?.(); $('tip').hidden = true; return; }
    if (e.button === 0 && immersive() && !locked) { canvas.requestPointerLock?.(); return; }
    if (e.button === 0) { const h = locked ? pickAt(innerWidth / 2, innerHeight / 2) : pickAt(e.clientX, e.clientY);
      if (locked && !h) { hideCards(); return; } if (!h) return;
      const key = h.kind + ':' + (h.i ?? h.key); if (locked && key === lastPick && !$('focus').hidden && onPlay) { onPlay(); lastPick = ''; return; } lastPick = key;
      if (h.kind === 'album') focusAlbum(h.i); else if (h.kind === 'song') focusSong(h.i); else if (h.kind === 'playlist') focusList(h.i); else if (h.kind === 'setting') openLedger(h.key); else if (h.kind === 'sofa') sit(h.i); }
  });
  onW('pointerup', e => { if (e.button === 2 && looking) { looking = false; if (!immersive()) document.exitPointerLock?.(); } });
  let lockAt = 0, lookDrift = 0, relock = false;
  // cards with buttons need the pointer: let it out, and take it back when the card is done
  function freePointer() { if (locked && immersive()) { relock = true; document.exitPointerLock?.(); } }
  function takePointer() { if (relock) { relock = false; canvas.requestPointerLock?.(); } }
  onD('pointerlockchange', () => { locked = document.pointerLockElement === canvas; lockAt = performance.now(); lookDrift = 0; $('reticle').hidden = !(locked && immersive()); if (!locked) { $('tip').hidden = true; $('reticle').classList.remove('hot'); } });
  let lastPick = '';
  // with the view locked, the reticle is the pointer: it lights up over anything you can use and names it
  function reticleHover() { if (!locked) return; const h = pickAt(innerWidth / 2, innerHeight / 2), r = $('reticle'), tip = $('tip'); r.classList.toggle('hot', !!h); hoverSong = h && h.kind === 'song' ? h.i : -1;
    if (h) { const t = tipText(h), again = lastPick === h.kind + ':' + (h.i ?? h.key) && !$('focus').hidden; tip.innerHTML = `${t[0]}<small>${again ? ts('tip.again') : t[1]}</small>`; tip.style.left = innerWidth / 2 + 'px'; tip.style.top = innerHeight / 2 + 'px'; tip.hidden = false; } else tip.hidden = true; }
  const tipText = (h) => h.kind === 'sofa' ? [ts('tip.sit'), ts('tip.sitSub')] : h.kind === 'song' ? [SONGS[h.i]?.title || '', SONGS[h.i]?.artist || ''] : h.kind === 'album' ? [ALBUMS[h.i]?.title || '', ALBUMS[h.i]?.artist || ''] : h.kind === 'playlist' ? [PLAYLISTS[h.i]?.name || '', PLAYLISTS[h.i]?.note || ''] : [SECTIONS.find(s => s[0] === h.key)[1], ts('tip.settings')];
  canvas.addEventListener('pointermove', e => {
    if (looking || locked) {
      // pointer lock sometimes reports one huge jump (on lock, unlock or focus): drop those, they are what 'reset' the view
      if (performance.now() - lockAt < 120 || Math.abs(e.movementX) > 160 || Math.abs(e.movementY) > 160) return;
      // a flight is only cancelled by a deliberate look, not by the hand resting on the mouse
      if (flight) { lookDrift += Math.abs(e.movementX) + Math.abs(e.movementY); if (lookDrift < 40) return; flight = null; }
      me.yaw -= e.movementX * .0024 * S.look; me.pitch = Math.max(-1.25, Math.min(1.25, me.pitch - e.movementY * .0022 * S.look)); return; }
    const h = pickAt(e.clientX, e.clientY); canvas.classList.toggle('hot', !!h); hoverSong = h && h.kind === 'song' ? h.i : -1;
    const tip = $('tip'); if (h) { const t = tipText(h); tip.innerHTML = `${t[0]}<small>${t[1]}</small>`; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px'; tip.hidden = false; } else tip.hidden = true;
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); const d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (room === 'dome' && octIn(me.pos, CROSS, 1)) { tierGoal = Math.max(-.35, Math.min(TIERS - .65, tierGoal + d / 110)); wheelRest = performance.now(); }
    else me.vel.addScaledVector(new V3(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)), -d * .02); }, { passive: false });
  const typing = () => document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && !['checkbox', 'range'].includes(document.activeElement.type);
  onW('keydown', e => {
    if (e.key === '/' && !typing()) { e.preventDefault(); $('q').focus(); return; }
    if (typing()) { if (e.key === 'Escape') { $('q').blur(); $('results').hidden = true; } return; }
    if (e.key === 'Escape') { hideCards(); ui.closeSettings(); }
    if (e.key === ',') { e.preventDefault(); hideCards(); freePointer(); ui.openSettings(); return; }
    if (e.key === 'Alt' && locked) { e.preventDefault(); document.exitPointerLock?.(); return; }
    if (e.code === 'KeyR') { rise = true; seated = false; flight = null; return; }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'nave') { e.preventDefault(); hideCards(); setNavePage(navePg + (e.code === 'PageDown' ? 1 : -1)); return; }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'lists') { e.preventDefault(); hideCards(); setListPage(listPg + (e.code === 'PageDown' ? 1 : -1)); return; }
    if ((e.code === 'PageUp' || e.code === 'PageDown') && room === 'dome') { e.preventDefault(); tierGoal = Math.max(0, Math.min(TIERS - 1, Math.round(tierGoal) + (e.code === 'PageDown' ? 1 : -1))); return; }
    if (e.code === 'Space' && !(locked && immersive())) { e.preventDefault(); togglePlay(); return; }
    keys.add(e.code); if (['Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  onW('keyup', e => keys.delete(e.code)); onW('blur', () => keys.clear());
  function togglePlay() { bind.toggle(); }

  $('pp').onclick = togglePlay; $('p-go').onclick = () => setPlace('altar');
  Object.keys(PLACES).forEach(k => $('go-' + k).onclick = () => { hideCards(); setPlace(k); });
  $('f-close').onclick = () => { hideCards(); chosenSong = -1; takePointer(); }; $('f-play').onclick = () => { onPlay && onPlay(); takePointer(); };
  $('cfg').onclick = () => { hideCards(); freePointer(); ui.openSettings(); };
  $('q').addEventListener('input', () => { const q = $('q').value.trim(), ul = $('results'); ul.innerHTML = ''; if (!q) { ul.hidden = true; return; }
    const ql = q.toLowerCase(), has = (x) => x.t.toLowerCase().includes(ql) || x.s.toLowerCase().includes(ql);
    const hits = [...LIB.playlists.map((p, j) => ({ t: p.name, s: `${ts('kind.list')} · ${p.note}`, go: () => { setListPage(Math.floor(j / LIST_SLOTS)); focusList(j % LIST_SLOTS); } })), ...LIB.albums.map((a, j) => ({ t: a.title, s: `${ts('kind.album')} · ${a.artist}`, go: () => { setNavePage(Math.floor(j / NAVE_SLOTS)); focusAlbum(j % NAVE_SLOTS); } })), ...SONGS.map((s, i) => ({ t: s.title, s: `${ts('kind.song')} · ${s.artist}`, go: () => focusSong(i) }))].filter(has).slice(0, 8);
    hits.forEach(h => { const li = document.createElement('li'), b = document.createElement('button'); b.textContent = h.t; const sm = document.createElement('small'); sm.textContent = h.s; b.append(sm); b.onclick = () => { ul.hidden = true; $('q').value = ''; $('q').blur(); h.go(); }; li.append(b); ul.append(li); });
    ul.hidden = !hits.length; });
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter') { const b = $('results').querySelector('button'); if (b) b.click(); } });

  /* ---------- speakers: one per room, the crossing's is the pool of light itself ---------- */
  const SPEAKERS = [
    { room: 'nave', pos: new V3(-4.7, 1.1, -24.5), ry: Math.PI / 2 },
    { room: 'dome', pos: new V3(CROSS.c.x, .6, CROSS.c.z), pool: true },
    { room: 'lists', pos: new V3(LISTS.c.x - 2.1, 1.1, LISTS.c.z - 5.2), ry: Math.PI * .12 },
    { room: 'settings', pos: new V3(SETS.c.x + 3.4, 1.1, SETS.c.z + 3.4), ry: -Math.PI * .75 },
    { room: 'altar', pos: new V3(SANCT.c.x + 4.4, 1.1, SANCT.c.z - 1.5), ry: -Math.PI / 2 } ];
  SPEAKERS.forEach(s => { if (s.pool) return; const g = new THREE.Group(); g.position.set(s.pos.x, 0, s.pos.z); g.rotation.y = s.ry; world.add(g); furniture.push(g);
    mesh(cyl(.05, .07, .7, 12), MAT.ink, g).position.y = .35; mesh(cyl(.28, .32, .04, 24), MAT.ink, g).position.y = .02;
    mesh(rbox(.62, .9, .5, .12), MAT.oat, g).position.y = 1.15;
    for (const [y, r] of [[1.35, .17], [.98, .1]]) { const ring = mesh(new THREE.TorusGeometry(r, .025, 8, 32), MAT.ink, g); ring.position.set(0, y, .26); const cone = mesh(new THREE.CircleGeometry(r - .02, 32), MAT.taupe, g, false); cone.position.set(0, y, .252); }
    s.led = new THREE.Mesh(new THREE.CircleGeometry(.025, 12), flat(new THREE.Color(2.2, 1.4, .7))); s.led.position.set(.2, 1.52, .252); g.add(s.led); noLine.push(s.led);
    blob(s.pos.x, s.pos.z, 1.1, 1.1); });

  /* ---------- spatial audio ----------
     one decoded track, many outputs. Every speaker is fed the same signal, so moving between them is only a change of gain.
     Sound from another room is heard from the doorway on the path to it, darker and further, as in games' portal propagation. */
  const RT60 = { nave: 3.2, dome: 4.5, lists: 1.8, settings: 1.8, altar: 2.4 };
  const doorOf = (r) => r === 'nave' ? new V3(0, EYE, NAVE.z1 - T / 2) : at(VEST.find(v => v[0] === r)[1], CROSS.r + T + 3 + T / 2);       // the room's own doorway
  const crossDoorOf = (r) => r === 'nave' ? new V3(0, EYE, NAVE.z1 - T / 2) : at(VEST.find(v => v[0] === r)[1], CROSS.r + T / 2);          // the crossing's doorway toward it
  function soundPath(L, Lroom, S, Sroom) { if (Lroom === Sroom) return [L, S];
    if (Lroom === 'dome') return [L, crossDoorOf(Sroom), doorOf(Sroom), S];
    if (Sroom === 'dome') return [L, doorOf(Lroom), crossDoorOf(Lroom), S];
    return [L, doorOf(Lroom), crossDoorOf(Lroom), crossDoorOf(Sroom), doorOf(Sroom), S]; }
  const au = { ctx: null, ready: false, phones: true, song: null, songT0: 0 };
  function makeIR(ctx, rt) { const sr = ctx.sampleRate, n = Math.floor(sr * rt * 1.1), ir = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0, seed = 1 + c * 7;
      for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; const w = seed / 2147483647 * 2 - 1, t = i / sr, k = Math.min(.92, .25 + t / rt * .7);   // the tail darkens as it decays
        lp = lp * k + w * (1 - k); d[i] = lp * Math.exp(-6.9 * t / rt) * (t < .004 ? t / .004 : 1); }
      for (const [ms, a] of [[11, .5], [19, .38], [29, .3], [43, .22], [61, .16]]) d[Math.floor(sr * (ms + c * 3) / 1000)] += a * (c ? -1 : 1); }   // a few early reflections
    return ir; }
  function seamless(ab, ctx) { const chs = Array.from({ length: ab.numberOfChannels }, (_, c) => ab.getChannelData(c)); let a = 0, b = ab.length - 1;
    const loud = (i) => chs.some(d => Math.abs(d[i]) > 1e-5); while (a < b && !loud(a)) a++; while (b > a && !loud(b)) b--;
    const L = b - a + 1, X = Math.min(Math.round(ab.sampleRate * .025), L >> 4), out = ctx.createBuffer(chs.length, L - X, ab.sampleRate);
    chs.forEach((d, c) => { const o = out.getChannelData(c); for (let i = 0; i < L - X; i++) o[i] = d[a + i];
      for (let i = 0; i < X; i++) { const u = i / X; o[i] = d[a + i] * Math.sin(u * Math.PI / 2) + d[a + L - X + i] * Math.cos(u * Math.PI / 2); } });
    return out; }
  // a speaker chain: input → wall/air filter → gain → HRTF panner → dry; and a reverb send by distance
  function chain(ctx, s) { const input = ctx.createGain(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), pan = ctx.createPanner(), send = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 18000; g.gain.value = 0; send.gain.value = 0;
    Object.assign(pan, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: 1, maxDistance: 1e4, rolloffFactor: 0 });   // distance is ours (by path), the panner only places it
    input.connect(lp); lp.connect(g); g.connect(pan); pan.connect(au.dry); g.connect(send); send.connect(au.verbIn);
    return { s, input, lp, g, pan, send, want: 0 }; }
  async function initAudio() { if (au.ctx) { au.ctx.resume?.(); return; } const A = bind.audio();
    const ctx = A.ctx; au.ctx = ctx; ctx.resume?.();
    au.master = ctx.createGain(); au.an = ctx.createAnalyser(); au.an.fftSize = 1024; au.bins = new Uint8Array(au.an.frequencyBinCount); au.master.connect(au.an); au.an.connect(ctx.destination);
    au.dry = ctx.createGain(); au.dry.connect(au.master); au.verbIn = ctx.createGain(); au.verbs = {};
    for (const r in RT60) { const cv = ctx.createConvolver(), gg = ctx.createGain(); gg.gain.value = 0; au.verbIn.connect(cv); cv.connect(gg); gg.connect(au.master); au.verbs[r] = { cv, g: gg }; }
    // the headphone path: straight to the output, with a filter that closes as you take them off
    au.direct = ctx.createGain(); au.directLP = ctx.createBiquadFilter(); au.directLP.type = 'lowpass'; au.directLP.frequency.value = 20000; au.direct.gain.value = 0; au.direct.connect(au.directLP); au.directLP.connect(au.master);
    au.scene = ctx.createGain(); au.scene.gain.value = 0;            // the song as heard in the room
    au.chains = SPEAKERS.map(s => chain(ctx, s)); au.chains.forEach(c => au.scene.connect(c.input));
    au.pool = chain(ctx, SPEAKERS[1]); au.amb = ctx.createGain(); au.amb.gain.value = 0; au.amb.connect(au.pool.input);   // the room's own music lives in the pool
    // the song comes in here when the room plays it (Cadenza's engine sends it after its own gain: volume, balance, fades)
    au.songIn = ctx.createGain(); au.songIn.connect(au.direct); au.songIn.connect(au.scene); au.ready = true; routeSong();
    try { const ab = await ctx.decodeAudioData(await (await fetch(AMBIENT)).arrayBuffer());
      au.buf = seamless(ab, ctx); const src = ctx.createBufferSource(); src.buffer = au.buf; src.loop = true; src.connect(au.amb); src.start(); au.ambSrc = src;
      // build the rooms' responses one at a time when the page is idle, so the picture never waits on them
      const rooms = Object.keys(RT60), next = () => { const r = rooms.shift(); if (!r) return; au.verbs[r].cv.buffer = makeIR(ctx, RT60[r]); later(next); }, later = (f) => window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 600 }) : setTimeout(f, 200); next();
      updateAmbient(); } catch (e) { au.failed = true; } }
  // in the prototype the demo songs are silent, so the room's music stands in for them (marked as such in the player)
  function startSong() { return; if (!au.ready) return; stopSong(); const src = au.ctx.createBufferSource(); src.buffer = au.buf; src.loop = true; src.connect(au.direct); src.connect(au.scene); src.start(); au.song = src; }
  function stopSong(delay = 0) { const s = au.song; au.song = null; if (s) try { s.stop(au.ctx.currentTime + delay); } catch (e) {} }
  function aramp(p, v, sec) { const t = au.ctx.currentTime; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + sec); }
  function updateAmbient() { if (!au.ready) return; const vol = +(S.musicVol ?? .6);
    aramp(au.amb.gain, (!playing && S.music !== false) ? vol : 0, playing ? 1.2 : 3.5); }
  // headphones: the song leaves Cadenza exactly as it always does (the engine's own path, untouched); taking them off
  // sends it into the room, the clean sound muffled away as the speakers come in. The Hi-Fi output never enters the page,
  // so with it the headphones stay on.
  let routed = false, unrouteAt = 0; const engineHifi = () => bind.audio().hifi;
  function routeSong() { if (!au.ready) return; const A = bind.audio(); if (A.hifi && !au.phones) setPhones(true);
    if (au.phones) { aramp(au.direct.gain, 1, .6); aramp(au.scene.gain, 0, .6); if (routed) { clearTimeout(unrouteAt); unrouteAt = setTimeout(() => { if (au.phones) { A.route(null); routed = false; } }, 700); } }
    else { clearTimeout(unrouteAt); if (!routed) { au.direct.gain.value = 1; au.scene.gain.value = 0; A.route(au.songIn); routed = true; } aramp(au.direct.gain, 0, .8); aramp(au.scene.gain, 1.15, .8); } }
  // taking the headphones off: the clean sound is muffled away while the room fades in; only the audio does this
  function setPhones(on) { au.phones = on; const b = $('hp'); b.setAttribute('aria-pressed', String(on)); b.textContent = ts(on ? 'phones.on' : 'phones.off'); b.title = ts(on ? 'phones.onHelp' : 'phones.offHelp');
    if (!au.ready) return; const t = au.ctx.currentTime, f = au.directLP.frequency; f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); f.exponentialRampToValueAtTime(on ? 20000 : 700, t + .6); routeSong(); }
  $('hp').onclick = () => { initAudio();
    if (au.phones && bind.audio().hifi) { showFocus(ts('hifi.eye'), ts('hifi.title'), ts('hifi.body'), async () => { hideCards(); await bind.audio().useStandard(); });
      $('f-play').textContent = ts('hifi.use'); return; }
    setPhones(!au.phones); };
  onW('pointerdown', initAudio); onW('keydown', initAudio);
  // every frame: place the listener, route each speaker through the doorways, keep only the two nearest awake
  const _f = new V3(), _u = new V3();
  function audioTick(dt) { if (!au.ready) return; if (!au.phones && engineHifi()) setPhones(true); const ctx = au.ctx, t = ctx.currentTime, L = camera.position, lsn = ctx.listener;
    _f.set(0, 0, -1).applyQuaternion(camera.quaternion); _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (lsn.positionX) { for (const [p, v] of [[lsn.positionX, L.x], [lsn.positionY, L.y], [lsn.positionZ, L.z], [lsn.forwardX, _f.x], [lsn.forwardY, _f.y], [lsn.forwardZ, _f.z], [lsn.upX, _u.x], [lsn.upY, _u.y], [lsn.upZ, _u.z]]) p.setTargetAtTime(v, t, .03); }
    else { lsn.setPosition(L.x, L.y, L.z); lsn.setOrientation(_f.x, _f.y, _f.z, _u.x, _u.y, _u.z); }
    const place = (c) => { const path = soundPath(L.clone(), room, c.s.pos, c.s.room); let dist = 0; for (let i = 1; i < path.length; i++) dist += path[i].distanceTo(path[i - 1]);
      const doors = path.length === 2 ? 0 : path.length === 4 ? 1 : 2, at1 = path[1], P = c.pan;
      const px = at1.x, py = at1.y, pz = at1.z; if (P.positionX) { P.positionX.setTargetAtTime(px, t, .12); P.positionY.setTargetAtTime(py, t, .12); P.positionZ.setTargetAtTime(pz, t, .12); } else P.setPosition(px, py, pz);
      c.gainNow = 3 / (3 + Math.max(0, dist - 3) * .9) * Math.pow(.55, doors);                      // full within 3 m, then falls with the walked distance
      c.lp.frequency.setTargetAtTime(Math.max(500, (doors ? (doors === 1 ? 2600 : 1100) : 18000) * (1 - Math.min(.6, dist / 80))), t, .25);
      c.send.gain.setTargetAtTime(.18 + .55 * Math.min(1, dist / 16) + doors * .2, t, .3); return c.gainNow; };
    // the song: of the five speakers, only the two strongest sound
    const g = au.chains.map(place), keep = g.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 2).map(x => x[1]);
    au.chains.forEach((c, i) => { const v = keep.includes(i) ? g[i] : 0; c.g.gain.setTargetAtTime(v, t, .35); c.s.lit = v > .02 && !au.phones && playing; });
    place(au.pool); au.pool.g.gain.setTargetAtTime(au.pool.gainNow, t, .35);
    for (const r in au.verbs) au.verbs[r].g.gain.setTargetAtTime(r === room ? .55 : 0, t, .6);   // the room you stand in rings
    SPEAKERS.forEach(s => { if (s.led) s.led.visible = !!s.lit; }); }
  function hearAccent(now) { if (!au.ready) return false; au.an.getByteFrequencyData(au.bins); let e = 0; for (let i = 1; i < 6; i++) e += au.bins[i]; e /= 5;
    const hit = e > (au.avg || 0) * 1.25 + 8 && e > 70 && now - (au.last || 0) > 450; au.avg = (au.avg || 0) * .96 + e * .04; if (hit) au.last = now; return hit; }

  /* ---------- scene lyrics: lines peel off the sanctuary wall and hang in the air in front of you; then they bleach, tip over and fall ---------- */
  const CH = .5;                                                        // character height in metres
  const glyphCache = new Map();
  const glyphTex = (ch) => { if (!glyphCache.has(ch)) glyphCache.set(ch, textTex(128, 128, (g, w, h) => { g.font = '700 104px "Noto Serif TC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(ch, w / 2, h / 2 + 6); })); return glyphCache.get(ch); };
  const scene3 = { on: false, lines: [], lastIdx: -1, lastPos: null, wallFade: 1 };
  function glyph(ch) { const m = biasDepth(new THREE.MeshBasicMaterial({ map: glyphTex(ch), color: new THREE.Color(C.ink), transparent: true, side: THREE.DoubleSide, depthWrite: false }), 10);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(CH, CH), m); card.position.y = CH / 2; card.renderOrder = 6; noLine.push(card);
    const pivot = new THREE.Group(); pivot.add(card); return { pivot, card, m }; }
  // where to put a line: somewhere in the half-sphere you face, never in your face, inside the room, near the previous one
  const sightRay = new THREE.Raycaster();
  function seen(from, to) { if (!landables) restHeight(0, 1, 0); const d = to.clone().sub(from), L = d.length(); sightRay.set(from, d.normalize()); sightRay.far = L - .3; return sightRay.intersectObjects(landables, false).length === 0; }
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  // where to put a line: in the half-sphere you face, preferring your eye level and the middle of the view when there is room
  function placeLine(width) { camera.updateMatrixWorld(true);   // read the view as it is right now, never as it was last frame
    const cam = camera.getWorldPosition(new V3()), view = camera.getWorldDirection(new V3()), yaw = Math.atan2(-view.x, -view.z), pitch = Math.asin(Math.max(-1, Math.min(1, view.y))); let best = null, bestScore = -1e9;
    const sp = Math.hypot(me.vel.x, me.vel.z), lead = new V3(me.vel.x, 0, me.vel.z).multiplyScalar(Math.min(1.2, .9));
    for (let k = 0; k < 64; k++) { const a = yaw + Math.max(-1.45, Math.min(1.45, gauss() * .5 * (1 - Math.min(.45, sp * .08)))), el = Math.max(-.4, Math.min(.9, pitch + gauss() * .18)), d = 3.2 + Math.min(3.5, sp * .9) + Math.random() * 4.3;
      const dir = new V3(-Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)), p = cam.clone().addScaledVector(dir, d).add(lead); p.y = Math.max(.9, Math.min(6, p.y));
      const side = new V3(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(width / 2 + .3);
      if (!regionAt(p.clone().add(side)) || !regionAt(p.clone().sub(side)) || !regionAt(p)) continue;                              // stays inside the room
      const off = Math.acos(Math.min(1, view.dot(p.clone().sub(cam).normalize())));
      if (p.distanceTo(cam) < 2.5 || off < .1) continue;                                                                                 // never in your face, never dead centre
      let score = -Math.abs(p.y - cam.y) * .8 - Math.max(0, off - .25) * 1.6;
      // must be seen: on screen, and nothing (sofa back, wall, a vase) between your eyes and the line's middle and ends
      const ndc = p.clone().project(camera); if (ndc.z > 1 || Math.abs(ndc.x) > .82 || ndc.y > .78 || ndc.y < -.6) score -= 20;
      if (!seen(cam, p) || !seen(cam, p.clone().add(side)) || !seen(cam, p.clone().sub(side))) score -= 40;
      if (scene3.lastPos) { const dl = p.distanceTo(scene3.lastPos); if (dl < 1.2 + width * .5) continue; score -= Math.abs(dl - (2.4 + width * .4)) * .5; }
      scene3.lines.forEach(l => { if (!l.falling && l.pos.distanceTo(p) < width * .6 + 1) score -= 4; });
      if (score > bestScore) { bestScore = score; best = p; } }
    return best || cam.clone().add(new V3(-Math.sin(yaw), .2, -Math.cos(yaw)).multiplyScalar(4)); }
  function spawnLine(text, idx) { const chars = [...text], width = chars.length * CH * .92, pos = placeLine(width), g = new THREE.Group();
    const toCam = new V3().subVectors(camera.position, pos); g.position.copy(pos); g.rotation.set(0, Math.atan2(toCam.x, toCam.z), 0); scene.add(g);   // turns to you once, then stays put
    const glyphs = chars.map((ch, k) => { const gl = glyph(ch); gl.pivot.position.set((k - (chars.length - 1) / 2) * CH * .92, -CH / 2, 0); g.add(gl.pivot); return gl; });
    // the first line peels off the sanctuary's paper and flies here
    let from = null; if (scene3.lastIdx < 0 || scene3.lines.length === 0) { from = new V3(); lyricMeshes[0].m.getWorldPosition(from); }
    const line = { g, glyphs, pos, idx, t0: performance.now(), from, falling: false, fallT: 0 }; scene3.lines.push(line); scene3.lastPos = pos; scene3.lastIdx = idx;
    if (S.follow) followTo = Math.atan2(-(pos.x - camera.position.x), -(pos.z - camera.position.z));
    return line; }
  let followTo = null;
  // where a falling glyph comes to rest: no physics bodies. One look straight down, at the moment it lets go, under its pivot,
  // its middle and its tip; it lands on the highest surface found and lies flat there. Nothing can sink in, so nothing can jitter.
  let landables = null; const downRay = new THREE.Raycaster(), DOWN = new V3(0, -1, 0), landed = [];
  function restHeight(x, y, z) { if (!landables) { landables = []; world.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.userData.thin && !noLine.includes(o) && !glassList.includes(o)) landables.push(o); }); }
    downRay.set(new V3(x, y, z), DOWN); downRay.far = y + 1; const h = downRay.intersectObjects(landables, false).find(h => h.face && h.face.normal && Math.abs(h.face.normal.clone().transformDirection(h.object.matrixWorld).y) > .5); return h ? h.point.y : 0; }
  function fall(line) { if (line.falling) return; line.falling = true; line.fallT = performance.now(); line.g.position.copy(line.pos); line.glyphs.forEach(gl => { gl.card.position.y = CH / 2; gl.card.rotation.set(0, 0, 0); gl.card.scale.setScalar(1); });
    line.g.updateMatrixWorld(true); const fz = new V3(0, 0, 1).transformDirection(line.g.matrixWorld);
    line.glyphs.forEach((gl, k) => { gl.delay = k * .05 + Math.random() * .04; gl.dir = Math.random() < .5 ? 1 : -1;
      const pw = gl.pivot.getWorldPosition(new V3()), tip = pw.clone().addScaledVector(fz, gl.dir * CH), mid = pw.clone().addScaledVector(fz, gl.dir * CH / 2);
      let rest = Math.max(...[pw, mid, tip].map(p => restHeight(p.x, pw.y, p.z))); const near = landed.filter(q => Math.hypot(q.x - mid.x, q.z - mid.z) < CH * .7 && Math.abs(q.y - rest) < .1).length;   // stack on glyphs already lying here
      gl.floor = rest + .02 + near * .012; landed.push({ x: mid.x, z: mid.z, y: gl.floor, t: performance.now() }); if (landed.length > 60) landed.shift(); gl.vy = .7 + Math.random() * .5; gl.y = line.pos.y - CH / 2; gl.ang = 0; gl.av = 0; gl.roll = 0; gl.rv = (Math.random() < .5 ? -1 : 1) * (1.6 + Math.random() * 2.2); gl.landed = 0; }); }
  function lyricsTick(now, dt) {
    const want = playing && (room === 'altar' || scene3.on);   // starts in the sanctuary, then follows you anywhere while the song plays
    if (want && !scene3.on) { scene3.on = true; scene3.lastIdx = -1; }
    if (!playing && scene3.on) { scene3.on = false; scene3.lines.forEach(fall); }
    scene3.wallFade += ((scene3.on ? 0 : 1) - scene3.wallFade) * Math.min(1, dt * 3);   // the paper empties while its words are out in the room
    if (scene3.on) { const idx = curLine; if (idx >= 0 && idx !== scene3.lastIdx) { scene3.lines.forEach(l => { if (!l.falling && now - l.t0 > 2600) l.leave = now + 1200; }); spawnLine(NOW.lines[idx].text, idx); } }
    if (followTo != null) { me.yaw += (wrapTo(me.yaw, followTo) - me.yaw) * Math.min(1, dt * 1.5); if (Math.abs(wrapTo(me.yaw, followTo) - me.yaw) < .01) followTo = null; }
    const air = scene3.lines.filter(l => !l.falling); while (air.length > 4) fall(air.shift());
    for (let i = scene3.lines.length - 1; i >= 0; i--) { const l = scene3.lines[i], age = (now - l.t0) / 1000;
      if (l.leave && now > l.leave) fall(l);
      if (!l.falling) { // flying in, then the sung part darkens from left to right
        const u = Math.min(1, age / .9), e = 1 - Math.pow(1 - u, 3);
        // each glyph arrives a beat after the last: rises a little, unfolds from a slight tilt, settles with a soft overshoot
        l.glyphs.forEach((gl, k) => { const sung = Math.max(0, Math.min(1, (age - .3) / 2.4 * l.glyphs.length - k)), v = Math.max(0, Math.min(1, (age - k * .045) / .55)), ob = 1 + 2.2 * Math.pow(v - 1, 3) + 1.2 * Math.pow(v - 1, 2);
          gl.m.color.set(C.ink); gl.m.opacity = (.35 + .65 * sung) * Math.min(1, v * 2.2);
          gl.card.position.y = CH / 2 - (1 - ob) * .3; gl.card.rotation.set((1 - ob) * .5, 0, (1 - ob) * .25 * (k % 2 ? 1 : -1)); gl.card.scale.setScalar((l.from ? .6 : .82) + (l.from ? .4 : .18) * ob); });
        if (l.from) { l.g.position.lerpVectors(l.from, l.pos, e); l.g.position.y += Math.sin(Math.PI * e) * 1.2; }   // an arc off the wall
        continue; }
      // falling: bleach, tip over on the bottom edge, drop, bounce, lie flat, shrink away
      const ft = (now - l.fallT) / 1000; let done = true;
      l.glyphs.forEach(gl => { const t = ft - gl.delay; if (t < 0) { done = false; return; }
        const bleach = Math.min(1, t / .3); gl.m.color.copy(new THREE.Color(C.ink)).lerp(new THREE.Color(C.ivory), bleach);
        if (RM()) { gl.m.opacity = Math.max(0, 1 - t / 1.2); if (gl.m.opacity > 0) done = false; return; }
        // a small lift as it lets go, then real gravity with a little air drag; it pitches over and barrel-rolls as it falls
        if (t > .25 && !gl.landed) { const h = Math.min(dt, 1 / 30); gl.vy -= 12.5 * h; gl.vy *= 1 - .35 * h; gl.y += gl.vy * h;
          gl.av += 9 * h; gl.ang = Math.min(Math.PI / 2, gl.ang + gl.av * h); gl.roll += gl.rv * h; gl.rv *= 1 - .8 * h;
          if (gl.y <= gl.floor) { gl.y = gl.floor; gl.ang = Math.PI / 2; if (gl.vy < -1.6) { gl.vy *= -.22; gl.rv *= .35; } else { gl.landed = now; } } }
        gl.pivot.position.y = gl.y - l.pos.y; gl.pivot.rotation.set(gl.ang * gl.dir, 0, gl.roll);   // roll spins in the glyph's own plane, so it still lands flat
        if (gl.landed) { const s = 1 - Math.min(1, (now - gl.landed) / 1200); gl.card.scale.setScalar(Math.max(.001, s)); gl.m.opacity = s; if (s > 0) done = false; } else done = false; });
      if (done) { scene.remove(l.g); l.glyphs.forEach(gl => { gl.m.dispose(); gl.card.geometry.dispose(); }); scene3.lines.splice(i, 1); } }
    const falling = scene3.lines.filter(l => l.falling); while (falling.length > 6) { const l = falling.shift(); scene.remove(l.g); scene3.lines.splice(scene3.lines.indexOf(l), 1); } }
  /* ---------- the frame ---------- */
  function resize() { const w = innerWidth, h = innerHeight, pr = renderer.getPixelRatio(); renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr)); if (motes) motes.material.uniforms.px.value = pr * h / 800; }
  onW('resize', resize);
  let frameN = 0, last = performance.now(), accent = 0, motion = 0, rise = false, swell = 0, lastClock = null;
  // the scene's colour: the whole atmosphere takes the cover's colour — walls, floor, vaults, the shade, the air and its
  // haze, the beams, their pools, the windows' glow and the motes — kept light (a pale, airy version of the colour), so
  // the cathedral changes its mood with every song and stays readable. The furniture's accents keep their own colours.
  // About two seconds to move to a new song's colour; with no song (or no colour) it returns to the wheat house tones.
  let tintBase = null; const tintNow = new THREE.Color(), tintGoal = new THREE.Color(); let tintAmt = 0, tintAmtGoal = 0, tintSig = '';
  const _hsl = { h: 0, s: 0, l: 0 }, _a = new THREE.Color(), _b = new THREE.Color();
  // a tone of the colour at a given lightness and a share of its saturation (so a vivid cover still gives a calm room)
  const tone = (out, src, l, sMul, sMin = .18, sMax = .62) => { src.getHSL(_hsl); return out.setHSL(_hsl.h, Math.min(sMax, Math.max(sMin, _hsl.s * sMul)) * Math.min(1, _hsl.s * 4), l); };
  function tintTick(dt) {
    if (!tintBase) { tintBase = { surf: [MAT.paper, MAT.floor, MAT.oat, MAT.ivory, MAT.taupe].map(m => [m, m.color.clone()]), baked: BAKED.map(m => [m, m.color.clone(), m.userData.top.value.clone(), !m.userData.sky]),
      wash: WASH_TOP.value.clone(), amb: ambLight.color.clone(), haze: dream.mat.uniforms.haze.value.clone(), bg: scene.background.clone(), beam: shafts.mat.uniforms.col.value.clone(),
      mote: motes ? motes.material.uniforms.col.value.clone() : null, glass: glassList.map(m => [m, m.material.uniforms?.warm?.value.clone()]).filter(x => x[1]), glare: glares.map(g => [g, g.material.color.clone()]) }; }
    const rgb = bind.tint();
    if (rgb) { tintGoal.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace); tintAmtGoal = 1; } else tintAmtGoal = 0;
    const k = Math.max(0, Math.min(1, dt / .7)); tintNow.lerp(tintGoal, k); tintAmt += (tintAmtGoal - tintAmt) * k;
    if (!tintBase.mote && motes) { tintBase.mote = motes.material.uniforms.col.value.clone(); tintSig = ''; }
    const sig = tintNow.getHexString() + tintAmt.toFixed(3); if (sig === tintSig) return; tintSig = sig; const A = tintAmt, B = tintBase;
    // surfaces: a pale tone of the colour, strongly (the walls carry the room's mood)
    B.surf.forEach(([m, base], i) => { tone(_a, tintNow, i === 0 ? .74 : i === 1 ? .66 : .8, i === 1 ? .55 : .7); m.color.copy(base).lerp(_a, A * (i === 0 ? .62 : .5)); });
    B.baked.forEach(([m, lo, top, tintTop]) => { tone(_a, tintNow, .7, .6); m.color.copy(lo).lerp(_a, A * .55); if (tintTop) { tone(_b, tintNow, .86, .55); m.userData.top.value.copy(top).lerp(_b, A * .55); } });
    tone(_a, tintNow, .9, .6); WASH_TOP.value.copy(B.wash).lerp(_a, A * .6);
    // the shade and the air
    tone(_a, tintNow, .5, .7); ambLight.color.copy(B.amb).lerp(_a.multiplyScalar(1.3), A * .45);
    tone(_a, tintNow, .8, .6); dream.mat.uniforms.haze.value.copy(B.haze).lerp(_a, A * .65); scene.background.copy(B.bg).lerp(_a, A * .65);
    // the light itself: beams, pools, the windows' glow, the dust in the air
    tone(_a, tintNow, .8, 1.1, .3, .85); shafts.mat.uniforms.col.value.copy(B.beam).lerp(_a, A * .85);
    lightPools.forEach(m => m.material.color.set('#fff').lerp(_a, A * .7));
    if (B.mote) motes.material.uniforms.col.value.copy(B.mote).lerp(_a, A * .85);
    B.glass.forEach(([m, w]) => m.material.uniforms.warm.value.copy(w).lerp(_a, A * .6));
    B.glare.forEach(([g, c]) => g.material.color.copy(c).lerp(_b.copy(_a).multiplyScalar(1.5), A * .6)); }
  const fwd = new V3(), right = new V3(), acc = new V3(), tng = new V3(), gp = new V3(), gd = new V3(), camDir = new V3();
  function frame(now) {
    if (!alive) return; requestAnimationFrame(frame); const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now;   // (the first frame can be stamped before the loop began)
    NOW = bind.now(); songT = NOW.t; $('p-bar').style.width = `${NOW.dur ? Math.min(100, NOW.t / NOW.dur * 100) : 0}%`;
    if (NOW.playing !== playing) { playing = NOW.playing; $('pp').textContent = playing ? '❚❚' : '▶'; $('pp').setAttribute('aria-label', ts(playing ? 'pause' : 'play')); updateAmbient(); }
    if (NOW.id !== nowId) { nowId = NOW.id; $('p-title').textContent = NOW.title || ts('nothing'); $('p-sub').textContent = [NOW.artist, NOW.album].filter(Boolean).join(' · ');
      altarArt.material.map = covers.get(NOW.coverFull, NOW.id || 'none'); altarArt.material.needsUpdate = true;
      lineTex.forEach(t => t.dispose()); lineTex.clear(); lyricMeshes.forEach(L => { L.idx = -1; L.m.visible = false; }); scene3.lastIdx = -1; }
    curLine = lineAt(NOW.t);
    if (flight) { const u = Math.max(0, Math.min(1, (now - flight.t0) / flight.dur)), k = ease(u);
      if (flight.curve) { flight.curve.getPointAt(k, me.pos); flight.curve.getTangentAt(Math.min(1, k + .03), tng); const ty = Math.atan2(-tng.x, -tng.z);
        const yw = wrapTo(flight.y0, ty), endw = sstep(.72, 1, k), startw = sstep(0, .14, k); let y = flight.y0 + (yw - flight.y0) * startw; y = y + (wrapTo(y, flight.yaw) - y) * endw;
        me.yaw = y; me.pitch = flight.p0 * (1 - startw) + flight.pitch * endw; }
      else { me.pos.lerpVectors(flight.from, flight.to, k); me.yaw = flight.y0 + (flight.y1 - flight.y0) * k; me.pitch = flight.p0 + (flight.p1 - flight.p0) * k; }
      me.vel.set(0, 0, 0); if (u >= 1) flight = null; }
    else {
      fwd.set(-Math.sin(me.yaw), 0, -Math.cos(me.yaw)); right.set(-fwd.z, 0, fwd.x); acc.set(0, 0, 0);
      if (keys.has('KeyW') || keys.has('ArrowUp')) acc.add(fwd); if (keys.has('KeyS') || keys.has('ArrowDown')) acc.sub(fwd);
      if (keys.has('KeyD') || keys.has('ArrowRight')) acc.add(right); if (keys.has('KeyA') || keys.has('ArrowLeft')) acc.sub(right);
      const upKey = keys.has('KeyE') || (locked && immersive() && keys.has('Space')), downKey = keys.has('KeyQ') || (locked && immersive() && (keys.has('ShiftLeft') || keys.has('ShiftRight')));
      if (upKey) acc.y += 1; if (downKey) acc.y -= 1;
      if (acc.lengthSq()) { acc.normalize().multiplyScalar(26 * S.walk); hideCards(); if (seated && (acc.x || acc.z)) { seated = false; rise = true; } }
      if (upKey || downKey) rise = false;
      if (rise) { me.pos.y += (EYE - me.pos.y) * Math.min(1, dt * 5); me.pitch *= Math.pow(.2, dt); if (Math.abs(me.pos.y - EYE) < .005) { me.pos.y = EYE; rise = false; } }
      me.vel.addScaledVector(acc, dt); me.vel.multiplyScalar(Math.pow(.02, dt));
      for (const axis of ['x', 'z', 'y']) { const next = me.pos.clone(); next[axis] += me.vel[axis] * dt; const reg = regionAt(next); if (reg && next.y >= EYE * .55 && next.y <= reg.top) me.pos.copy(next); else me.vel[axis] *= .2; }
    }
    const reg = regionAt(me.pos); if (reg && !reg.door && reg.room !== room) onRoom(reg.room);
    const bob = RM() ? 0 : Math.sin(now / 1000 * .7) * .02;
    camera.position.set(me.pos.x, me.pos.y + bob, me.pos.z); camera.rotation.set(me.pitch, me.yaw, 0, 'YXZ');
    stepRail(dt, now); if (room === 'dome' || Math.abs(tierGoal - tierAt) > .001 || Math.abs(tierVel) > .001) layoutBowl();
    // only the living things move with the music: branches sway, the beams breathe
    // everything stays still; only the motes answer the music
    const R = playing && NOW.id ? bind.rhythm(NOW.t) : null, P = bind.prefs();
    // the beams: always lit; an accent lifts them (up within ~80 ms, back over ~half a second), nothing else moves them
    const swellIn = R && P.beatBeams && !RM() ? R.dip : 0; swell = swellIn > swell ? swell + (swellIn - swell) * Math.min(1, dt / .03) : swell * Math.exp(-dt / .22);
    // the scene breathes with every event: at most 4 % brighter, deeper on the heavy ones (well under a flash's 10 %)
    dream.pulse = R && P.pulse && !RM() ? Math.min(.04, .022 * R.pulse + .018 * swell) : 0;
    tintTick(dt);
    shafts.mat.uniforms.gain.value = .145 * (S.beams ? 1 : 0) * (1 + .35 * swell);
    // the floor of the crossing: ripples spread out every 8 s; pools follow the beat and breathe on their own phase
    lightPools.forEach((m, k) => { const t = now / 1000, j = Math.floor(k / 2); m.material.opacity = (k % 2 ? .3 : .55) * (1 + .35 * swell) * (1 + .08 * Math.sin(t * .19 + j * 2.3) * Math.sin(t * .29 + j * 5.1)); });
    ripples.forEach((m, k) => { const u = ((now / 1000) / 8 + k / 3) % 1; m.scale.setScalar(3.1 + u * 2.6); m.material.opacity = Math.sin(Math.PI * u) * .55; });
    // accents slow the dust down (like the effect lyrics' slow-motion on heavy beats), then it eases back to speed
    if (R) { const step = lastClock == null ? 0 : R.clock - lastClock; lastClock = R.clock; motion += Math.max(0, Math.min(dt * 1.5, step)); accent = RM() ? 0 : R.dip; }
    else { lastClock = null; if (!playing && hearAccent(now)) accent = 1; accent = RM() ? 0 : accent * Math.exp(-dt / 1.1); motion += dt * (1 - .85 * accent); }
    if (motes) { const u = motes.material.uniforms; u.time.value = motion; u.accent.value = accent; u.still.value = RM() ? 1 : 0; }
    // windows glare when you face them
    glares.forEach(g => { g.getWorldPosition(gp); g.parent.getWorldDirection(gd); const f = Math.max(0, -gd.dot(camDir.set(0, 0, -1).applyQuaternion(camera.quaternion))), dist = gp.distanceTo(camera.position); g.material.opacity = Math.pow(f, 6) * .75 * Math.min(1, dist / 6); });
    dream.step(dt); audioTick(dt); lyricsTick(now, dt); if (locked && immersive() && (frameN++ % 4 === 0)) reticleHover();
    wallTick(dt);
    renderer.shadowMap.needsUpdate = true; composer.render();
  }
  window.__cad = { tint: () => [tintAmt, tintNow.getHexString(), MAT.paper.color.getHexString(), JSON.stringify(bind.tint())], scene: () => scene, lights: () => { if (!LIGHTS) lightsBuild(); return LIGHTS.map(L => [L.room, +L.p.x.toFixed(1), +L.p.y.toFixed(1), +L.p.z.toFixed(1), +L.size.toFixed(1)]); }, faceLight: (k) => { const L = LIGHTS[k], d = L.p.clone().sub(me.pos); me.yaw = Math.atan2(-d.x, -d.z); me.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); }, exp: () => [dream.exposure, dream.lum], overlaps: () => { world.updateMatrixWorld(true); const bx = furniture.map(g => { const b = new THREE.Box3(); g.traverse(o => { if (o.isMesh && !o.userData.thin && !noLine.includes(o)) b.expandByObject(o); }); return b.expandByScalar(-.04); }), out = [];
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) if (bx[i].max.y > .05 && bx[j].max.y > .05 && bx[i].intersectsBox(bx[j])) out.push([i, j, bx[i].getCenter(new V3()).toArray().map(v => +v.toFixed(1)), bx[j].getCenter(new V3()).toArray().map(v => +v.toFixed(1))]); return out; }, rest: (x, y, z) => restHeight(x, y, z), C: () => [SANCT.c.x, SANCT.c.z, CROSS.c.x, CROSS.c.z], camera: () => camera, sitAt: () => { const s = sofas.find(x => Math.abs(x.seat.z - (SANCT.c.z + .9)) < .5); if (s) { me.pos.copy(s.seat); me.yaw = s.yaw; me.pitch = -.04; seated = true; flight = null; } }, au: () => au, lyr: () => scene3, room: () => room, regionAt: (x, y, z) => regionAt(new V3(x, y, z)), LINKS, CROSS, NAVE, wheel: (d) => { tierGoal = Math.max(-.35, Math.min(TIERS - .65, tierGoal + d / 110)); wheelRest = performance.now(); }, rail: () => [tierAt, tierGoal], setRail: (v) => { tierAt = tierGoal = v; tierVel = 0; wheelRest = 0; }, go: (k) => { const P = PLACES[k]; me.pos.copy(P.pos); me.yaw = P.yaw; me.pitch = P.pitch; flight = null; }, fly: (k) => setPlace(k), look: (y, p) => { me.yaw = y; me.pitch = p; }, set: (k, v) => { S[k] = v; apply(); } };
  const start = () => { apply(); buildBeams(); resize(); layoutBowl(); $('loading').style.opacity = 0; setTimeout(() => $('loading').hidden = true, 800); requestAnimationFrame(frame); };
  stations.forEach(s => { const sec = SECTIONS.find(x => x[0] === s.key); s.title.material.map = titleTex(sec[1], sec[2]); s.title.material.needsUpdate = true; });
  start();
  const offPrefs = bind.onPrefs((p) => { S = p; apply(); });
  // a changed library rebuilds the rooms that show it (gathered by bind.ts)
  const offLibrary = bind.onLibrary((l) => { LIB = l; SONGS = l.songs; songById = new Map(SONGS.map((sg, i) => [sg.id, i])); listPg = Math.min(listPg, Math.max(1, Math.ceil(l.playlists.length / LIST_SLOTS)) - 1); PLAYLISTS = l.playlists.slice(listPg * LIST_SLOTS, (listPg + 1) * LIST_SLOTS);
    navePg = Math.min(navePg, navePages(l) - 1); ALBUMS = navePage(l, navePg); hideCards(); buildNave(); buildBowl(); buildLists(); layoutBowl(); });

  return { takePointer: () => takePointer(), dispose() { alive = false; ac.abort(); offLibrary(); offPrefs(); covers.dispose(); thumbs.dispose(); atlas.dispose(); try { clearTimeout(unrouteAt); if (routed) bind.audio().route(null); au.ambSrc?.stop(); au.master?.disconnect(); au.songIn?.disconnect(); } catch (e) {} composer.dispose?.(); renderer.dispose(); delete window.__cad; } };
}
