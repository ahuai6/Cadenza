// Pixi v8's Color, the part Folia uses: parse any colour form (number, CSS string, array, Color) and
// read it back as a number, an array or a CSS string. Values are straight (not premultiplied).

export type ColorSource =
  | number
  | string
  | number[]
  | Float32Array
  | Color
  | { r: number; g: number; b: number; a?: number };

const NAMED: Record<string, number> = {
  black: 0x000000,
  white: 0xffffff,
  red: 0xff0000,
  green: 0x008000,
  blue: 0x0000ff,
  yellow: 0xffff00,
  cyan: 0x00ffff,
  magenta: 0xff00ff,
  gray: 0x808080,
  grey: 0x808080,
  orange: 0xffa500,
  purple: 0x800080,
  pink: 0xffc0cb,
};

const cache = new Map<string, [number, number, number, number]>();
let probe: CanvasRenderingContext2D | null | undefined;

function parseCss(s: string): [number, number, number, number] {
  const hit = cache.get(s);
  if (hit) return hit;
  let out: [number, number, number, number] = [0, 0, 0, 1];
  const t = s.trim().toLowerCase();
  if (t === 'transparent') out = [0, 0, 0, 0];
  else if (t in NAMED) out = fromNumber(NAMED[t]);
  else if (t[0] === '#' || /^(0x)?[0-9a-f]{3,8}$/.test(t)) {
    let h = t.replace(/^#|^0x/, '');
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    out = fromNumber(n);
    if (h.length === 8) out[3] = parseInt(h.slice(6, 8), 16) / 255;
  } else {
    const m = t.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean);
      const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
      out = [
        ch(p[0]) / 255,
        ch(p[1]) / 255,
        ch(p[2]) / 255,
        p[3] === undefined ? 1 : p[3].endsWith('%') ? parseFloat(p[3]) / 100 : parseFloat(p[3]),
      ];
    } else {
      // Anything else (hsl(), named colours outside the short list): let a canvas normalise it.
      if (probe === undefined) {
        try {
          probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
        } catch {
          probe = null;
        }
      }
      if (probe) {
        probe.fillStyle = '#000';
        probe.fillStyle = s;
        const n = String(probe.fillStyle);
        if (n !== s) out = parseCss(n);
      }
    }
  }
  if (cache.size > 512) cache.clear();
  cache.set(s, out);
  return out;
}

function fromNumber(n: number): [number, number, number, number] {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

export class Color {
  private v: [number, number, number, number] = [1, 1, 1, 1];
  constructor(value: ColorSource = 0xffffff) {
    this.setValue(value);
  }
  static readonly shared = new Color();
  setValue(value: ColorSource) {
    if (value instanceof Color) this.v = [...value.v];
    else if (typeof value === 'number') this.v = fromNumber(value);
    else if (typeof value === 'string') this.v = [...parseCss(value)];
    else if (Array.isArray(value) || value instanceof Float32Array) {
      const a = value as ArrayLike<number>;
      this.v = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1];
    } else if (value && typeof value === 'object') {
      const o = value as { r: number; g: number; b: number; a?: number };
      const k = o.r > 1 || o.g > 1 || o.b > 1 ? 255 : 1;
      this.v = [o.r / k, o.g / k, o.b / k, o.a ?? 1];
    }
    return this;
  }
  get red() {
    return this.v[0];
  }
  get green() {
    return this.v[1];
  }
  get blue() {
    return this.v[2];
  }
  get alpha() {
    return this.v[3];
  }
  setAlpha(a: number) {
    this.v[3] = a;
    return this;
  }
  toNumber() {
    const [r, g, b] = this.v;
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  }
  toArray(): number[] {
    return [...this.v];
  }
  toRgbArray(): number[] {
    return this.v.slice(0, 3);
  }
  toRgba() {
    const [r, g, b, a] = this.v;
    return { r, g, b, a };
  }
  toHex() {
    return '#' + this.toNumber().toString(16).padStart(6, '0');
  }
  toRgbaString() {
    const [r, g, b, a] = this.v;
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  }
  /** Multiplies by another colour (Pixi's tint semantics). */
  multiply(value: ColorSource) {
    const o = new Color(value).v;
    this.v = [this.v[0] * o[0], this.v[1] * o[1], this.v[2] * o[2], this.v[3] * o[3]];
    return this;
  }
  static isColorLike(value: unknown): value is ColorSource {
    return (
      typeof value === 'number' ||
      typeof value === 'string' ||
      value instanceof Color ||
      Array.isArray(value) ||
      value instanceof Float32Array
    );
  }
}

/** The CSS string a canvas wants for a colour at an extra opacity. */
export function cssColor(value: ColorSource, alpha = 1): string {
  const c = Color.shared.setValue(value);
  const a = c.alpha * alpha;
  const n = c.toNumber();
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
