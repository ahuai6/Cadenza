// The Cadenza mark, as SVG: a squircle tile of deep ink, and on it an open ring — a "C" drawn as one sweep of light,
// warm at its foot, cool at its head — ending in a bright beat. Small sizes are drawn for themselves (a heavier stroke, no
// detail, edges on whole pixels) rather than shrunk from the large one.
const N = 5;                                     // superellipse exponent: the tile's corners are continuous curves
function squircle(S, inset = 0) {
  const r = S / 2 - inset, c = S / 2, pts = [];
  for (let i = 0; i < 128; i++) {
    const a = (i / 128) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    pts.push([c + r * Math.sign(ca) * Math.abs(ca) ** (2 / N), c + r * Math.sign(sa) * Math.abs(sa) ** (2 / N)]);
  }
  return 'M' + pts.map(p => p.map(v => v.toFixed(2)).join(' ')).join('L') + 'Z';
}
// the ring: from 40° (lower right) round through the left to −40° (upper right), its head at the upper end
function arc(cx, cy, r, a0, a1) {
  const p = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)], [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 1 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function svg(S, id = 'cz') {
  const small = S <= 32, k = S / 1024, D = Math.PI / 180;
  const cx = 512 * k, cy = 512 * k, r = (small ? 250 : 262) * k, w = (small ? 128 : 96) * k;
  const a0 = 42 * D, a1 = -46 * D, hx = cx + r * Math.cos(a1), hy = cy + r * Math.sin(a1), dot = (small ? 88 : 74) * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <linearGradient id="${id}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b2050"/><stop offset=".55" stop-color="#17122c"/><stop offset="1" stop-color="#0c0a17"/></linearGradient>
  <linearGradient id="${id}ring" gradientUnits="userSpaceOnUse" x1="${cx + r}" y1="${cy + r}" x2="${cx + r * 0.4}" y2="${cy - r}">
    <stop offset="0" stop-color="#ffb37a"/><stop offset=".45" stop-color="#f06bd8"/><stop offset="1" stop-color="#7f8cff"/></linearGradient>
  <radialGradient id="${id}glow" cx="${(hx / S).toFixed(3)}" cy="${(hy / S).toFixed(3)}" r=".42"><stop offset="0" stop-color="#9aa6ff" stop-opacity=".55"/><stop offset="1" stop-color="#9aa6ff" stop-opacity="0"/></radialGradient>
  <clipPath id="${id}tile"><path d="${squircle(S)}"/></clipPath>
</defs>
<g clip-path="url(#${id}tile)">
  <rect width="${S}" height="${S}" fill="url(#${id}bg)"/>
  ${small ? '' : `<rect width="${S}" height="${S}" fill="url(#${id}glow)"/>`}
  ${small ? '' : `<path d="${squircle(S, 6 * k)}" fill="none" stroke="#ffffff" stroke-opacity=".09" stroke-width="${10 * k}"/>`}
  <path d="${arc(cx, cy, r, a0, a1)}" fill="none" stroke="url(#${id}ring)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="${dot}" fill="#fff4ec"/>
  ${small ? '' : `<path d="${arc(cx, cy, r * 0.56, 52 * D, -56 * D)}" fill="none" stroke="url(#${id}ring)" stroke-opacity=".42" stroke-width="${30 * k}" stroke-linecap="round"/>`}
</g>
</svg>`;
}
module.exports = { svg, squircle };
