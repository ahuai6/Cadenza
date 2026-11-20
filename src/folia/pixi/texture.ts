// Pixi v8's Texture / TextureSource and Sprite: an image (canvas, bitmap, <img>) with a frame,
// drawn as a quad with an anchor and a tint.
import { Bounds, Matrix, Point, Rectangle } from './math';
import { Container, type ContainerOptions, type DestroyOptions } from './container';

export type ImageLike = HTMLCanvasElement | OffscreenCanvas | ImageBitmap | HTMLImageElement | HTMLVideoElement;

export interface TextureStyle {
  addressMode: 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
  scaleMode: 'linear' | 'nearest';
}

export class TextureSource {
  readonly uid = Math.random();
  style: TextureStyle = { addressMode: 'clamp-to-edge', scaleMode: 'linear' };
  /** Bumped when the pixels change, so GPU copies know to re-upload. */
  version = 0;
  destroyed = false;
  constructor(
    public resource: ImageLike | null,
    public resolution = 1,
  ) {}
  get pixelWidth() {
    const r = this.resource as { width?: number; naturalWidth?: number; videoWidth?: number } | null;
    return r ? r.naturalWidth || r.videoWidth || r.width || 0 : 1;
  }
  get pixelHeight() {
    const r = this.resource as { height?: number; naturalHeight?: number; videoHeight?: number } | null;
    return r ? r.naturalHeight || r.videoHeight || r.height || 0 : 1;
  }
  get width() {
    return this.pixelWidth / this.resolution;
  }
  get height() {
    return this.pixelHeight / this.resolution;
  }
  update() {
    this.version += 1;
  }
  unload() {}
  destroy() {
    this.destroyed = true;
    this.resource = null;
  }
}

export class Texture {
  readonly source: TextureSource;
  frame: Rectangle;
  destroyed = false;
  label = '';
  constructor(options: { source?: TextureSource; frame?: Rectangle; label?: string } | TextureSource = {}) {
    const o = options instanceof TextureSource ? { source: options } : options;
    this.source = o.source ?? new TextureSource(null);
    this.frame = o.frame ?? new Rectangle(0, 0, this.source.width, this.source.height);
    if (o.label) this.label = o.label;
  }
  get width() {
    return this.frame.width;
  }
  get height() {
    return this.frame.height;
  }
  /** `skipCache` is accepted for Pixi's signature; textures here are never globally cached. */
  static from(resource: ImageLike | TextureSource | Texture, _skipCache = false): Texture {
    if (resource instanceof Texture) return resource;
    if (resource instanceof TextureSource) return new Texture({ source: resource });
    return new Texture({ source: new TextureSource(resource) });
  }
  update() {
    this.source.update();
    this.frame = new Rectangle(0, 0, this.source.width, this.source.height);
  }
  destroy(destroySource = false) {
    this.destroyed = true;
    if (destroySource) this.source.destroy();
  }
  static readonly EMPTY = new Texture({
    source: new TextureSource(null),
    frame: new Rectangle(0, 0, 1, 1),
    label: 'EMPTY',
  });
  static readonly WHITE = (() => {
    const t = new Texture({ source: new TextureSource(null), frame: new Rectangle(0, 0, 1, 1), label: 'WHITE' });
    return t;
  })();
}

export interface SpriteOptions extends ContainerOptions {
  texture?: Texture;
  anchor?: number | { x: number; y: number };
  roundPixels?: boolean;
}

export class Sprite extends Container {
  private tex: Texture;
  readonly anchor = new Point();
  roundPixels = false;
  constructor(options: SpriteOptions | Texture = {}) {
    const o = options instanceof Texture ? { texture: options } : options;
    super(o);
    this.tex = o.texture ?? Texture.EMPTY;
    if (o.anchor !== undefined)
      typeof o.anchor === 'number' ? this.anchor.set(o.anchor) : this.anchor.set(o.anchor.x, o.anchor.y);
    if (o.roundPixels) this.roundPixels = true;
  }
  get texture() {
    return this.tex;
  }
  set texture(t: Texture) {
    this.tex = t ?? Texture.EMPTY;
  }
  static from(source: Texture | ImageLike) {
    return new Sprite({ texture: source instanceof Texture ? source : Texture.from(source) });
  }
  protected override addOwnBounds(bounds: Bounds, m: Matrix) {
    const { width: w, height: h } = this.tex.frame;
    const x0 = -this.anchor.x * w,
      y0 = -this.anchor.y * h;
    bounds.addFrame(x0, y0, x0 + w, y0 + h, m);
  }
  override destroy(options: boolean | DestroyOptions = false) {
    if (typeof options === 'object' && options.texture) this.tex.destroy(!!options.textureSource);
    super.destroy(options);
  }
}

export class TilingSprite extends Sprite {}
