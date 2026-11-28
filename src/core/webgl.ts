export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

interface Device {
  canvas: RenderCanvas;
  gl: WebGL2RenderingContext;
  generation: number;
  lost: boolean;
}

let device: Device | null | undefined;
const listeners = new Set<() => void>();
let largeUseAt = 0;

/** Shared 2D surface. Callers submit synchronously and copy the result before another pass draws. */
export function webglDevice(): Device | null {
  if (device !== undefined) return device;
  device = null;
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  try {
    // The window owns context-loss events as well as the visible composition. Use a detached HTML canvas here;
    // a worker without a document can still get an OffscreenCanvas.
    const canvas = typeof document === 'undefined' ? new OffscreenCanvas(16, 16) : document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    const result: Device = { canvas, gl, generation: 0, lost: false };
    canvas.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault();
      result.lost = true;
      for (const notify of listeners) notify();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      result.generation++;
      result.lost = false;
      for (const notify of listeners) notify();
    });
    return (device = result);
  } catch {
    return null;
  }
}

export function observeWebgl(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** Keep successive passes on one backing surface, but retire an export-sized surface after returning to preview. */
export function fitWebglSurface(canvas: RenderCanvas, width: number, height: number) {
  const now = performance.now();
  const growing = canvas.width < width || canvas.height < height;
  const used = width > canvas.width * 0.75 || height > canvas.height * 0.75;
  const oversized = width * 2 <= canvas.width && height * 2 <= canvas.height;
  if (growing) {
    if (canvas.width < width) canvas.width = width;
    if (canvas.height < height) canvas.height = height;
  } else if (oversized && now - largeUseAt > 20_000) {
    canvas.width = width;
    canvas.height = height;
  }
  if (growing || used || (oversized && canvas.width === width)) largeUseAt = now;
  return canvas.height - height;
}
