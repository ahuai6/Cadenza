// The Cadenza mark, as SVG (3.2.8): a squircle tile of deep dusk; on it a round window whose frame is an open "C" — the
// letter, and the atrium's well — with the evening sky inside it, the sun rising in the gap of the C (the beat), and
// three lines of light across the sky staggered like lines of lyrics. Small sizes are drawn for themselves: the frame
// heavier, the sky and the sun kept, the lines and the light falling out of the window left out.
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
  const small = S <= 32, tiny = S <= 20, k = S / 1024, D = Math.PI / 180;
  const cx = 500 * k, cy = 520 * k, R = (small ? 330 : 318) * k, w = (small ? 104 : 74) * k;
  // the C: the frame runs from 32° below the right round the left to 38° above it; the sun sits in the gap
  const a0 = 34 * D, a1 = -40 * D, sx = cx + R * 1.0 * Math.cos(-3 * D), sy = cy + R * Math.sin(-3 * D), sun = (small ? 96 : 70) * k;
  const inner = R - w / 2;
  const bar = (y, x0, x1, o) =>
    `<line x1="${(cx + x0 * k).toFixed(2)}" y1="${(cy + y * k).toFixed(2)}" x2="${(cx + x1 * k).toFixed(2)}" y2="${(cy + y * k).toFixed(2)}" stroke="#fff6ee" stroke-opacity="${o}" stroke-width="${30 * k}" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs>
  <linearGradient id="${id}bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#2e2457"/><stop offset=".6" stop-color="#1a1534"/><stop offset="1" stop-color="#100d22"/></linearGradient>
  <linearGradient id="${id}sky" gradientUnits="userSpaceOnUse" x1="${cx}" y1="${cy - inner}" x2="${cx}" y2="${cy + inner}">
    <stop offset="0" stop-color="#7d88e8"/><stop offset=".48" stop-color="#e98bb5"/><stop offset=".8" stop-color="#ffb784"/><stop offset="1" stop-color="#ffd2a1"/></linearGradient>
  <linearGradient id="${id}rim" gradientUnits="userSpaceOnUse" x1="${cx - R}" y1="${cy + R}" x2="${cx + R}" y2="${cy - R}">
    <stop offset="0" stop-color="#fff3e8"/><stop offset="1" stop-color="#ffd9c2"/></linearGradient>
  <radialGradient id="${id}sun" cx="${(sx / S).toFixed(3)}" cy="${(sy / S).toFixed(3)}" r=".36"><stop offset="0" stop-color="#ffd7a8" stop-opacity=".75"/><stop offset=".35" stop-color="#ff9fb4" stop-opacity=".22"/><stop offset="1" stop-color="#ff9fb4" stop-opacity="0"/></radialGradient>
  <linearGradient id="${id}beam" gradientUnits="userSpaceOnUse" x1="${sx}" y1="${sy}" x2="${cx - R * 0.9}" y2="${S}">
    <stop offset="0" stop-color="#ffe6cc" stop-opacity=".28"/><stop offset="1" stop-color="#ffe6cc" stop-opacity="0"/></linearGradient>
  <clipPath id="${id}tile"><path d="${squircle(S)}"/></clipPath>
  <clipPath id="${id}win"><circle cx="${cx}" cy="${cy}" r="${inner + 0.5}"/></clipPath>
</defs>
<g clip-path="url(#${id}tile)">
  <rect width="${S}" height="${S}" fill="url(#${id}bg)"/>
  ${small ? '' : `<path d="M${(sx - 40 * k).toFixed(2)} ${(sy - 30 * k).toFixed(2)}L${(sx + 30 * k).toFixed(2)} ${(sy + 40 * k).toFixed(2)}L${(cx - R * 0.15).toFixed(2)} ${S}L${(cx - R * 1.25).toFixed(2)} ${S}Z" fill="url(#${id}beam)"/>`}
  <circle cx="${cx}" cy="${cy}" r="${inner}" fill="url(#${id}sky)"/>
  ${
    small
      ? ''
      : `<g clip-path="url(#${id}win)">${bar(-120, -190, 60, 0.95)}${bar(-20, -230, 140, 0.7)}${bar(80, -170, 20, 0.45)}</g>`
  }
  ${tiny ? '' : `<rect width="${S}" height="${S}" fill="url(#${id}sun)"/>`}
  <path d="${arc(cx, cy, R, a0, a1)}" fill="none" stroke="url(#${id}rim)" stroke-width="${w}" stroke-linecap="round"/>
  <circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="${sun}" fill="#fff8f0"/>
  ${small ? '' : `<path d="${squircle(S, 6 * k)}" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="${10 * k}"/>`}
</g>
</svg>`;
}
module.exports = { svg, squircle };
