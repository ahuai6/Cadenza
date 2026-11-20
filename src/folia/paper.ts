// Folia's backgrounds draw with Paper shaders (@paper-design/shaders, Apache-2.0): the same fragment programs and the
// same ShaderMount that its React components wrap. Here a mount runs on a hidden element and draws on demand, at the
// song's time (setFrame), and the picture is copied onto Cadenza's canvas; nothing runs on a loop of its own.
import {
  ShaderMount,
  ShaderFitOptions,
  defaultObjectSizing,
  defaultPatternSizing,
  getShaderColorFromString,
  getShaderNoiseTexture,
} from '@paper-design/shaders';

/** One full-screen quad, no depth test: antialiasing and a depth buffer would only cost memory (as Folia sets it). */
const CONTEXT: WebGLContextAttributes = { antialias: false, depth: false, preserveDrawingBuffer: true };

type Sizing = typeof defaultObjectSizing;
/** The sizing uniforms of a shader component: its own defaults (object or pattern sizing, its preset's overrides),
 *  then what the caller sets. */
export function sizing(base: 'object' | 'pattern', over: Partial<Sizing> = {}) {
  const s = { ...(base === 'object' ? defaultObjectSizing : defaultPatternSizing), ...over } as Sizing;
  return {
    u_fit: ShaderFitOptions[s.fit as keyof typeof ShaderFitOptions],
    u_scale: s.scale,
    u_rotation: s.rotation,
    u_offsetX: s.offsetX,
    u_offsetY: s.offsetY,
    u_originX: s.originX,
    u_originY: s.originY,
    u_worldWidth: s.worldWidth,
    u_worldHeight: s.worldHeight,
  };
}
export const color = (hex: string) => getShaderColorFromString(hex);

type Uniforms = Record<string, unknown>;
interface Mount {
  dispose(): void;
  setFrame(ms: number): void;
  parentWidth: number;
  parentHeight: number;
  devicePixelsSupported: boolean;
  handleResize: () => void;
  setUniformValues: (u: Uniforms) => void;
  canvasElement: HTMLCanvasElement;
}

/** One Paper shader drawn when asked: its own hidden element and WebGL context, rebuilt when its program changes. */
export class PaperLayer {
  private host: HTMLDivElement | null = null;
  private mount: Mount | null = null;
  private key = '';
  private w = 0;
  private h = 0;
  failed = false;

  /** Draws `frag` with `uniforms` at `frameMs` (the shader's own time), `w`×`h` CSS px; the picture, or null. */
  draw(
    frag: string,
    uniforms: Uniforms,
    o: { w: number; h: number; frameMs: number; mipmaps?: string[]; maxPixels?: number },
  ): HTMLCanvasElement | null {
    if (this.failed || typeof document === 'undefined') return null;
    const key = frag.length + ':' + frag.slice(-200) + (o.mipmaps || []).join();
    try {
      if (!this.mount || key !== this.key) {
        this.dispose();
        const host = document.createElement('div');
        Object.assign(host.style, {
          position: 'fixed',
          left: '0',
          top: '0',
          width: o.w + 'px',
          height: o.h + 'px',
          opacity: '0',
          pointerEvents: 'none',
          zIndex: '-1',
          overflow: 'hidden',
        });
        document.body.appendChild(host);
        this.host = host;
        this.mount = new ShaderMount(
          host,
          frag,
          uniforms as never,
          CONTEXT,
          0,
          o.frameMs,
          1,
          o.maxPixels ?? 1920 * 1080,
          o.mipmaps ?? [],
        ) as unknown as Mount;
        this.key = key;
        this.w = this.h = 0;
      }
      const m = this.mount!;
      if (this.w !== o.w || this.h !== o.h) {
        this.w = o.w;
        this.h = o.h;
        this.host!.style.width = o.w + 'px';
        this.host!.style.height = o.h + 'px';
        m.devicePixelsSupported = false;
        m.parentWidth = o.w;
        m.parentHeight = o.h;
        m.handleResize();
      }
      m.setUniformValues(uniforms);
      m.setFrame(o.frameMs);
      return m.canvasElement.width > 0 ? m.canvasElement : null;
    } catch (e) {
      console.warn('[paper] shader failed', e);
      this.failed = true;
      this.dispose();
      return null;
    }
  }
  dispose() {
    try {
      const canvas = this.mount?.canvasElement;
      const gl = canvas?.getContext('webgl2');
      this.mount?.dispose();
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* already gone */
    }
    this.host?.remove();
    this.mount = null;
    this.host = null;
    this.key = '';
  }
}

/** A picture as the image shaders take it (a loaded <img>), made once per key; null until it has loaded. */
const images = new Map<string, HTMLImageElement | null>();
export function imageOf(
  src: CanvasImageSource & { width: number; height: number },
  key: string,
): HTMLImageElement | null {
  if (images.has(key)) return images.get(key)!;
  if (src instanceof HTMLImageElement && src.complete && src.naturalWidth > 0) {
    images.set(key, src);
    return src;
  }
  images.set(key, null);
  try {
    const k = Math.min(1, 1024 / Math.max(src.width, src.height, 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k));
    c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    const img = new Image();
    img.onload = () => images.set(key, img);
    img.src = c.toDataURL('image/jpeg', 0.92);
  } catch {
    /* a picture that cannot be read: no image shader for it */
  }
  if (images.size > 8) images.delete(images.keys().next().value as string);
  return null;
}

let noise: HTMLImageElement | null | undefined;
/** Paper's noise texture (the paper shader's fibres), once it has loaded. */
export function noiseTexture(): HTMLImageElement | null {
  if (noise === undefined) {
    const img = getShaderNoiseTexture() as HTMLImageElement | undefined;
    noise = null;
    if (img) {
      if (img.complete) noise = img;
      else img.onload = () => (noise = img);
    }
  }
  return noise;
}
