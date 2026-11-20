// Folia's own background layers, mounted as its visualizer shell mounts them, for tests/folia-bg-compare.cjs: each held
// still (paused, static, or at frame 0), so the two sides can be compared picture for picture.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import FluidBackground from '@/components/visualizer/backgrounds/common/FluidBackground';
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

(window as any).BG = {
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
    if (kind === 'common')
      node = createElement('div', { className: 'absolute inset-0' }, [
        createElement(
          'div',
          { key: 'f', className: 'absolute inset-0 z-0' },
          createElement(FluidBackground as any, { coverUrl: o.cover, theme }),
        ),
        createElement('div', {
          key: 'g',
          className: 'absolute inset-0 z-0',
          style: { backgroundColor: theme.backgroundColor, opacity: o.opacity ?? 0.75 },
        }),
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
        staticMode: true,
      });
    else
      node = createElement(NomandBackgroundLayer as any, {
        coverUrl: o.cover,
        theme,
        isDaylight: false,
        tuning: { ...DEFAULT_NOMAND_BACKGROUND_TUNING, ...(o.tuning || {}) },
      });
    root.render(node);
    return true;
  },
};
