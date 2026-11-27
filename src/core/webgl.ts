export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

interface Device {
  canvas: RenderCanvas;
  gl: WebGL2RenderingContext;
  generation: number;
  lost: boolean;
}

let device: Device | null | undefined;
const listeners = new Set<() => void>();

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
