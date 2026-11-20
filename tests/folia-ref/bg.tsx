// Folia's own background layers, mounted as its visualizer shell mounts them, for tests/folia-bg-compare.cjs: each held
// still (paused, static, or at frame 0), so the two sides can be compared picture for picture — or, with `moving`, left
// to move and then stopped at a given moment (BG.seek), the layout's randoms drawn from a seed (BG.seed).
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import FluidBackground from '@/components/visualizer/backgrounds/common/FluidBackground';
import GeometricBackground from '@/components/visualizer/backgrounds/common/GeometricBackground';
import LatentBackground from '@/components/visualizer/backgrounds/latent/LatentBackground';
import SoraBackground from '@/components/visualizer/backgrounds/sora/SoraBackground';
import MonetBackgroundLayer from '@/components/visualizer/backgrounds/monet/MonetBackgroundLayer';
import NomandBackgroundLayer from '@/components/visualizer/backgrounds/nomand/NomandBackgroundLayer';
import {
  DEFAULT_LATENT_BACKGROUND_TUNING,
  DEFAULT_MONET_BACKGROUND_TUNING,
  DEFAULT_NOMAND_BACKGROUND_TUNING,
} from '@/types';

const host = document.getElementById('host')!;
let root: Root | null = null;
const zero = () => motionValue(0);
const bands = { bass: zero(), lowMid: zero(), mid: zero(), vocal: zero(), treble: zero() };

/** Cadenza's song-seeded generator (src/folia/backgrounds.ts rand), so a layout read from Math.random is the same one. */
function rand(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const nativeRandom = Math.random;
(window as any).BG = {
  /** Math.random from Cadenza's generator for the next mount (the layout reads it once) */
  seed(n: number) {
    Math.random = rand(n * 2654435761);
  },
  /** every animation on the page stopped at ms since its start */
  seek(ms: number) {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = ms;
    }
    return document.getAnimations().length;
  },
  show(kind: string, o: any) {
    root?.unmount();
    host.innerHTML = '';
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', inset: '0' });
    host.appendChild(el);
    root = createRoot(el);
    const theme = o.theme;
    // (an absolute address: Paper's image shaders take no relative one)
    o = { ...o, cover: o.cover ? new URL(o.cover, location.href).href : o.cover };
    let node;
    // (common as its entry.tsx mounts it: the cover's colours if asked, the ground, and — moving — the shapes)
    if (kind === 'common')
      node = createElement('div', { className: 'absolute inset-0' }, [
        o.moving
          ? null
          : createElement(
              'div',
              { key: 'f', className: 'absolute inset-0 z-0' },
              createElement(FluidBackground as any, { coverUrl: o.cover, theme }),
            ),
        createElement('div', {
          key: 'g',
          className: 'absolute inset-0 z-0',
          style: { backgroundColor: theme.backgroundColor, opacity: o.moving ? 1 : (o.opacity ?? 0.75) },
        }),
        o.moving
          ? createElement(
              'div',
              { key: 's', className: 'absolute inset-0 z-0' },
              createElement(GeometricBackground as any, {
                theme,
                audioPower: zero(),
                audioBands: bands,
                seed: 1,
                hideShapes: false,
                disableVignette: !o.vignette,
                paused: false,
              }),
            )
          : null,
      ]);
    else if (kind === 'latent')
      node = createElement(LatentBackground as any, {
        theme,
        coverUrl: null,
        audioPower: zero(),
        audioBands: bands,
        staticMode: true,
        paused: true,
        tuning: { ...DEFAULT_LATENT_BACKGROUND_TUNING, ...(o.tuning || {}) },
      });
    else if (kind === 'sora')
      node = createElement(
        'div',
        { className: 'absolute inset-0 z-0', style: { backgroundColor: '#000' } },
        createElement(SoraBackground as any, { theme, isDaylight: false, paused: true }),
      );
    else if (kind === 'monet')
      node = createElement(MonetBackgroundLayer as any, {
        coverUrl: o.cover,
        theme,
        isDaylight: false,
        tuning: { ...DEFAULT_MONET_BACKGROUND_TUNING, backgroundDriftEnabled: false, ...(o.tuning || {}) },
        staticMode: !o.moving,
      });
    else
      node = createElement(NomandBackgroundLayer as any, {
        coverUrl: o.cover,
        theme,
        isDaylight: false,
        tuning: { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...(o.tuning || {}) },
      });
    root.render(node);
    // (the layout is read on the first render; later randoms are the page's own)
    setTimeout(() => (Math.random = nativeRandom), 0);
    return true;
  },
};
