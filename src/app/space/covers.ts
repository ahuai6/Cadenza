// Covers as textures. A cover is a canvas texture that starts as a calm placeholder (flat colour blocks from the cover's
// key) and is redrawn in place when the image arrives, so whatever shows it never swaps its material. The wall of all
// songs draws many covers into a few atlases (8 x 8 cells), one draw per atlas instead of one per album.
import * as THREE from 'three';

const MORANDI = [['#c9b8a8', '#9aa597', '#e6ddd0'], ['#a9b4bc', '#d3c4b4', '#7d8a93'], ['#b99a8d', '#e4d8c8', '#8e9a8a'], ['#cfc2ae', '#a39486', '#e9e2d6'],
  ['#9fa8a0', '#c7b5a6', '#dcd3c3'], ['#b3a3ab', '#d8cdbf', '#8f8a7d'], ['#c4a99a', '#a9b0a3', '#ece4d8'], ['#a7a49a', '#d6c2b4', '#80878a']];
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** A placeholder in the house colours: the same key always draws the same blocks. */
export function placeholder(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, key: string) {
  const n = hash(key || '?'), [a, b, c] = MORANDI[n % MORANDI.length], m = (n >>> 3) % 3;
  g.fillStyle = c; g.fillRect(x, y, w, h);
  if (m === 0) { g.fillStyle = a; g.fillRect(x + w * .1, y + h * .11, w * .8, h * .46); g.fillStyle = b; g.fillRect(x + w * .1, y + h * .6, w * .8, h * .3); }
  else if (m === 1) { g.fillStyle = a; g.beginPath(); g.arc(x + w / 2, y + h * .44, w * .29, 0, 7); g.fill(); g.fillStyle = b; g.fillRect(x, y + h * .74, w, h * .26); }
  else { g.fillStyle = a; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + w / 2, y + h * .25); g.lineTo(x + w, y + h); g.fill(); g.fillStyle = b; g.beginPath(); g.arc(x + w * .72, y + h * .26, w * .09, 0, 7); g.fill(); }
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
/** One load per URL, shared by every texture that shows it. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) { p = new Promise(res => { const im = new Image(); im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; }); images.set(url, p); }
  return p;
}
const mkCanvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const texOf = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

/** Single covers (the nave's frames, the playlists' collages, the sanctuary), kept while in use, the oldest dropped past a limit. */
export class CoverCache {
  private map = new Map<string, { tex: THREE.CanvasTexture; used: number }>();
  constructor(private size = 512, private limit = 48) {}
  /** The cover at `url` (null: no cover), keyed so a song without one still gets its own placeholder. */
  get(url: string | null, key: string): THREE.CanvasTexture {
    const id = (url || '') + '#' + key, hit = this.map.get(id);
    if (hit) { hit.used = performance.now(); return hit.tex; }
    const c = mkCanvas(this.size, this.size), g = c.getContext('2d')!, tex = texOf(c);
    placeholder(g, 0, 0, this.size, this.size, key);
    if (url) loadImage(url).then(im => { if (!im) return; g.drawImage(im, 0, 0, this.size, this.size); tex.needsUpdate = true; });
    this.map.set(id, { tex, used: performance.now() }); this.trim(); return tex;
  }
  /** A 2 x 2 collage of up to four covers (a playlist). */
  collage(items: { url: string | null; key: string }[], key: string): THREE.CanvasTexture {
    const id = 'collage#' + key + '#' + items.map(i => i.url || i.key).join(','), hit = this.map.get(id);
    if (hit) { hit.used = performance.now(); return hit.tex; }
    const S = this.size, c = mkCanvas(S, S), g = c.getContext('2d')!, tex = texOf(c), half = S / 2;
    if (!items.length) placeholder(g, 0, 0, S, S, key);
    items.slice(0, 4).forEach((it, q) => { const x = (q % 2) * half, y = (q >> 1) * half; placeholder(g, x, y, half, half, it.key);
      if (it.url) loadImage(it.url).then(im => { if (!im) return; g.drawImage(im, x, y, half, half); tex.needsUpdate = true; }); });
    if (items.length && items.length < 4) for (let q = items.length; q < 4; q++) placeholder(g, (q % 2) * half, (q >> 1) * half, half, half, key + q);
    this.map.set(id, { tex, used: performance.now() }); this.trim(); return tex;
  }
  private trim() {
    if (this.map.size <= this.limit) return;
    const old = [...this.map.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.map.size - this.limit);
    for (const [k, v] of old) { v.tex.dispose(); this.map.delete(k); }
  }
  dispose() { this.map.forEach(v => v.tex.dispose()); this.map.clear(); }
}

/** The wall's covers: 64 to an atlas, each cell with its own ink border (the ink pass cannot outline the rail). */
export class CoverAtlas {
  static readonly GRID = 8;
  readonly pages: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D }[] = [];
  private cells = new Map<string, { page: number; cell: number }>();
  constructor(private cellPx = 256, private ink = '#29241F') {}
  /** Where the cover of `key` sits (allotted on first ask, drawn as its image arrives). */
  cell(url: string | null, key: string) {
    const id = url || '#' + key, hit = this.cells.get(id); if (hit) return hit;
    const n = this.cells.size, per = CoverAtlas.GRID ** 2, page = Math.floor(n / per), cell = n % per;
    if (!this.pages[page]) { const S = this.cellPx * CoverAtlas.GRID, c = mkCanvas(S, S); this.pages[page] = { tex: texOf(c), g: c.getContext('2d')! }; }
    const at = { page, cell }; this.cells.set(id, at);
    const P = this.pages[page], x = (cell % CoverAtlas.GRID) * this.cellPx, y = Math.floor(cell / CoverAtlas.GRID) * this.cellPx, s = this.cellPx;
    const frame = () => { P.g.strokeStyle = this.ink; P.g.lineWidth = s * .027; P.g.strokeRect(x + s * .0137, y + s * .0137, s - s * .027, s - s * .027); P.tex.needsUpdate = true; };
    placeholder(P.g, x, y, s, s, key); frame();
    if (url) loadImage(url).then(im => { if (!im) return; P.g.drawImage(im, x, y, s, s); frame(); });
    return at;
  }
  /** A cell's offset in its atlas, in uv (the atlas's rows run top down in the canvas, bottom up in uv). */
  static uv(cell: number): [number, number] { const G = CoverAtlas.GRID; return [(cell % G) / G, 1 - (Math.floor(cell / G) + 1) / G]; }
  dispose() { this.pages.forEach(p => p.tex.dispose()); this.pages.length = 0; this.cells.clear(); }
}
