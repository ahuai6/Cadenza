// Distance fields for the GPU lyric layer's glyphs (glyphs.ts makes the masks, gpu.ts draws from the fields). No canvas
// here: the field is worked out from a coverage mask alone, so it is tested on its own (tests/unit/sdf.test.ts).

/* The distance to the edge for every pixel of an anti-aliased coverage mask (the alpha of RGBA `a`), positive inside,
   as bytes: 128 at the edge, ±127 at ±spread px. Two squared Euclidean distance transforms (to the nearest pixel outside,
   to the nearest inside; Felzenszwalb & Huttenlocher's lower envelope of parabolas, a row then a column at a time), each
   started from the partly covered pixels at their sub-pixel distance from the edge (half a pixel either side of 50 %).
   `ss`: the mask is drawn that many times finer each way than the field (odd: a field pixel's centre is then a mask
   pixel's centre); the distances are found on the fine mask and read at the field's pixels. Found on the field's own
   pixels, the edge's place within each pixel is guessed from its coverage alone — well enough for an edge along a row
   or a column, off by up to a third of a pixel on a slant and round a corner: a glyph drawn two or three times the
   field's size then showed those guesses as a ragged, eaten-away edge (3.1.2) */
const INF = 1e20;
export function distanceField(a: Uint8ClampedArray, w: number, h: number, spread: number, ss = 1): Uint8Array {
  const W = w * ss,
    H = h * ss,
    n = W * H,
    inner = new Float64Array(n),
    outer = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = a[i * 4 + 3] / 255;
    if (v >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (v <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const o = Math.max(0, 0.5 - v),
        d = Math.max(0, v - 0.5);
      outer[i] = o * o;
      inner[i] = d * d;
    }
  }
  const L = Math.max(W, H),
    f = new Float64Array(L),
    d = new Float64Array(L),
    v = new Int32Array(L),
    z = new Float64Array(L + 1);
  edt(outer, W, H, f, d, v, z);
  edt(inner, W, H, f, d, v, z);
  const out = new Uint8Array(w * h * 4),
    c = (ss - 1) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * ss + c) * W + x * ss + c,
        s = (Math.sqrt(inner[i]) - Math.sqrt(outer[i])) / ss,
        b = Math.max(0, Math.min(255, Math.round(128 + (s / spread) * 127))),
        o = (y * w + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = b;
    }
  return out;
}
function edt(g: Float64Array, w: number, h: number, f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array) {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    edt1(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const o = y * w;
    for (let x = 0; x < w; x++) f[x] = g[o + x];
    edt1(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[o + x] = d[x];
  }
}
function edt1(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = q - v[k];
    d[q] = r * r + f[v[k]];
  }
}
