// The Monet background's picture made off the drawing thread, as upstream's monetBackground.worker.ts does (its paint
// is vendored as is); this one hands back an ImageBitmap the canvas draws, where upstream's makes a JPEG for CSS.
import {
  paintMonetBackground,
  MONET_BACKGROUND_WIDTH,
  MONET_BACKGROUND_HEIGHT,
  type MonetBackgroundColors,
} from './vendor/components/visualizer/monet/monetBackgroundPaint';
import type { MonetBackgroundTuning } from './vendor/types';

export interface MonetBackgroundRequest {
  image: ImageBitmap;
  colors: MonetBackgroundColors;
  tuning: MonetBackgroundTuning;
  blurPx: number | null;
}

const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<MonetBackgroundRequest>) => void) | null;
  postMessage: (m: unknown, t?: Transferable[]) => void;
};
scope.onmessage = (ev) => {
  const { image, colors, tuning, blurPx } = ev.data;
  try {
    const c = new OffscreenCanvas(MONET_BACKGROUND_WIDTH, MONET_BACKGROUND_HEIGHT);
    paintMonetBackground(c.getContext('2d')!, image, colors, tuning, blurPx);
    const picture = c.transferToImageBitmap();
    scope.postMessage({ picture }, [picture]);
  } catch (e) {
    scope.postMessage({ error: String(e) });
  } finally {
    image.close();
  }
};
