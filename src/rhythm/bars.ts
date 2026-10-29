// Where a beat sits in its bar. Either every `meter` beats from the first downbeat (the built-in analysis), or bar by
// bar from a list of downbeats (the neural engine finds them one by one, and a bar may be longer or shorter than the
// usual one); before the first and after the last listed downbeat the usual bar continues the count.
export interface BarIndexer {
  /** bar index (0 = the first downbeat's bar, negative before it), the beat's place in it, and that bar's length in beats */
  (beat: number): { bar: number; inBar: number; len: number };
  /** the beat index of bar `bar`'s downbeat */
  start(bar: number): number;
}
export function barIndexer(meter: number, downbeat: number, bars?: number[] | null): BarIndexer {
  const m = Math.max(1, meter);
  const uniform = (i: number, from: number, bar0: number) => { const r = i - from, b = Math.floor(r / m); return { bar: bar0 + b, inBar: r - b * m, len: m }; };
  if (!bars || bars.length < 2) {
    const d = bars && bars.length ? bars[0] : downbeat;
    const f = ((i: number) => uniform(i, d, 0)) as BarIndexer; f.start = b => d + b * m; return f;
  }
  const B = bars, n = B.length;
  const f = ((i: number) => {
    if (i < B[0]) return uniform(i, B[0], 0);
    if (i >= B[n - 1]) return uniform(i, B[n - 1], n - 1);
    let lo = 0, hi = n - 1; while (lo < hi) { const k = (lo + hi + 1) >> 1; if (B[k] <= i) lo = k; else hi = k - 1; }
    return { bar: lo, inBar: i - B[lo], len: B[lo + 1] - B[lo] };
  }) as BarIndexer;
  f.start = b => (b < 0 ? B[0] + b * m : b >= n ? B[n - 1] + (b - n + 1) * m : B[b]);
  return f;
}
