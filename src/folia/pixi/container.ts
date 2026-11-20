// Pixi v8's Container, as Folia uses it: a retained display tree with transform, alpha, visibility,
// blend mode, tint, mask and filters. Nothing here draws; the stage renderer (renderer.ts) walks the tree.
import { Bounds, Matrix, Point, Rectangle, DEG_TO_RAD, RAD_TO_DEG, type PointData } from './math';
import { Color, type ColorSource } from './color';
import type { Filter } from './filters';

export type BLEND_MODES =
  | 'inherit'
  | 'normal'
  | 'add'
  | 'multiply'
  | 'screen'
  | 'darken'
  | 'lighten'
  | 'erase'
  | 'color-dodge'
  | 'color-burn'
  | 'linear-burn'
  | 'linear-dodge'
  | 'linear-light'
  | 'hard-light'
  | 'soft-light'
  | 'pin-light'
  | 'vivid-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'overlay'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'normal-npm'
  | 'add-npm'
  | 'screen-npm'
  | 'none'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'min'
  | 'max';

export interface ContainerOptions {
  label?: string;
  x?: number;
  y?: number;
  alpha?: number;
  visible?: boolean;
  rotation?: number;
  isRenderGroup?: boolean;
  children?: Container[];
  [key: string]: unknown;
}

export interface DestroyOptions {
  children?: boolean;
  texture?: boolean;
  textureSource?: boolean;
  context?: boolean;
  style?: boolean;
}

type Listener = (...args: unknown[]) => void;

let nextUid = 1;

export class Container {
  readonly uid = nextUid++;
  label = '';
  children: Container[] = [];
  parent: Container | null = null;
  readonly position = new Point();
  readonly scale = new Point(1, 1);
  readonly pivot = new Point();
  readonly skew = new Point();
  rotation = 0;
  alpha = 1;
  visible = true;
  renderable = true;
  /** Pixi's `includeInBuild`/`measurable`: false for nodes used as a mask. */
  measurable = true;
  zIndex = 0;
  sortableChildren = false;
  cullable = false;
  eventMode: string = 'none';
  isRenderGroup = false;
  blendMode: BLEND_MODES = 'inherit';
  filterArea: Rectangle | null = null;
  destroyed = false;
  /** The 0xRRGGBB tint applied to this node and everything under it. */
  protected tintValue = 0xffffff;
  private filterList: Filter[] | null = null;
  private maskNode: Container | null = null;
  /** Masks are drawn by their owner only. */
  maskOwner: Container | null = null;
  private listeners: Map<string, Listener[]> | null = null;

  constructor(options: ContainerOptions = {}) {
    if (options.label !== undefined) this.label = options.label;
    if (options.x !== undefined) this.position.x = options.x;
    if (options.y !== undefined) this.position.y = options.y;
    if (options.alpha !== undefined) this.alpha = options.alpha;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.rotation !== undefined) this.rotation = options.rotation;
    if (options.isRenderGroup) this.isRenderGroup = true;
    if (options.children) this.addChild(...options.children);
  }

  get x() {
    return this.position.x;
  }
  set x(v: number) {
    this.position.x = v;
  }
  get y() {
    return this.position.y;
  }
  set y(v: number) {
    this.position.y = v;
  }
  get angle() {
    return this.rotation * RAD_TO_DEG;
  }
  set angle(v: number) {
    this.rotation = v * DEG_TO_RAD;
  }
  get tint(): number {
    return this.tintValue;
  }
  set tint(v: ColorSource) {
    this.tintValue = typeof v === 'number' ? v : Color.shared.setValue(v).toNumber();
  }
  get filters(): Filter[] | null {
    return this.filterList;
  }
  set filters(v: Filter[] | Filter | null | undefined) {
    this.filterList = v ? (Array.isArray(v) ? v.slice() : [v]) : null;
  }
  get mask(): Container | null {
    return this.maskNode;
  }
  set mask(v: Container | null | undefined) {
    if (this.maskNode) {
      this.maskNode.maskOwner = null;
      this.maskNode.measurable = true;
    }
    this.maskNode = v ?? null;
    if (this.maskNode) {
      this.maskNode.maskOwner = this;
      this.maskNode.measurable = false;
    }
  }
  setMask(options: { mask: Container | null }) {
    this.mask = options.mask;
  }

  /** Width in the parent's space: the local bounds times the scale. Setting it rescales. */
  get width() {
    return Math.abs(this.scale.x) * this.getLocalBounds().width;
  }
  set width(v: number) {
    const w = this.getLocalBounds().width;
    this.scale.x = w ? (v / w) * Math.sign(this.scale.x || 1) : 1;
  }
  get height() {
    return Math.abs(this.scale.y) * this.getLocalBounds().height;
  }
  set height(v: number) {
    const h = this.getLocalBounds().height;
    this.scale.y = h ? (v / h) * Math.sign(this.scale.y || 1) : 1;
  }
  setSize(width: number, height = width) {
    this.width = width;
    this.height = height;
  }

  addChild<T extends Container[]>(...children: T): T[0] {
    for (const c of children) this.addChildAt(c, this.children.length);
    return children[0];
  }
  addChildAt<T extends Container>(child: T, index: number): T {
    if (child.parent === this) {
      const i = this.children.indexOf(child);
      this.children.splice(i, 1);
      if (i < index) index -= 1;
    } else child.parent?.removeChild(child);
    this.children.splice(Math.max(0, Math.min(index, this.children.length)), 0, child);
    child.parent = this;
    child.emit('added', this);
    return child;
  }
  removeChild<T extends Container[]>(...children: T): T[0] {
    for (const c of children) {
      const i = this.children.indexOf(c);
      if (i >= 0) {
        this.children.splice(i, 1);
        c.parent = null;
        c.emit('removed', this);
      }
    }
    return children[0];
  }
  removeChildAt(index: number) {
    const c = this.children[index];
    if (c) this.removeChild(c);
    return c;
  }
  removeChildren(begin = 0, end = this.children.length): Container[] {
    const out = this.children.splice(begin, end - begin);
    for (const c of out) c.parent = null;
    return out;
  }
  removeFromParent() {
    this.parent?.removeChild(this);
  }
  getChildAt(index: number) {
    return this.children[index];
  }
  getChildIndex(child: Container) {
    return this.children.indexOf(child);
  }
  setChildIndex(child: Container, index: number) {
    const i = this.children.indexOf(child);
    if (i < 0) return;
    this.children.splice(i, 1);
    this.children.splice(index, 0, child);
  }
  swapChildren(a: Container, b: Container) {
    const i = this.children.indexOf(a),
      j = this.children.indexOf(b);
    if (i < 0 || j < 0) return;
    this.children[i] = b;
    this.children[j] = a;
  }
  getChildByLabel(label: string, deep = false): Container | null {
    for (const c of this.children) {
      if (c.label === label) return c;
      if (deep) {
        const f = c.getChildByLabel(label, true);
        if (f) return f;
      }
    }
    return null;
  }
  sortChildren() {
    this.children.sort((a, b) => a.zIndex - b.zIndex);
  }

  /** The transform from this node's space into its parent's (Pixi's formula, skew included). */
  updateLocalTransform(out: Matrix) {
    const { rotation: r, skew, scale, pivot, position } = this;
    const a = Math.cos(r + skew.y) * scale.x,
      b = Math.sin(r + skew.y) * scale.x,
      c = -Math.sin(r - skew.x) * scale.y,
      d = Math.cos(r - skew.x) * scale.y;
    return out.set(a, b, c, d, position.x - (pivot.x * a + pivot.y * c), position.y - (pivot.x * b + pivot.y * d));
  }
  get localTransform() {
    return this.updateLocalTransform(new Matrix());
  }
  /** This node's transform into the root of its tree. */
  get worldTransform() {
    const m = this.localTransform;
    for (let p = this.parent; p; p = p.parent) Matrix.multiply(p.localTransform, m, m);
    return m;
  }
  toGlobal<P extends PointData = Point>(position: PointData, point?: P): P {
    return this.worldTransform.apply(position, point);
  }
  toLocal<P extends PointData = Point>(position: PointData, from?: Container, point?: P): P {
    const global = from ? from.toGlobal(position) : position;
    return this.worldTransform.applyInverse(global, point);
  }

  /** The bounds of what this node itself draws, in its own space (leaves override). */
  protected addOwnBounds(_bounds: Bounds, _m: Matrix) {}

  /** Bounds of the drawn content under `m` (this node's own space when `m` is identity). */
  collectBounds(bounds: Bounds, m: Matrix) {
    this.addOwnBounds(bounds, m);
    const local = new Matrix(),
      child = new Matrix();
    for (const c of this.children) {
      if (!c.visible || !c.measurable) continue;
      Matrix.multiply(m, c.updateLocalTransform(local), child);
      c.collectBounds(bounds, child);
    }
    if (this.filterList?.some((f) => f.enabled)) {
      const pad = this.filterList.reduce((s, f) => s + (f.enabled ? f.padding : 0), 0);
      bounds.pad(pad);
    }
  }
  getLocalBounds(): Bounds {
    const b = new Bounds();
    this.collectBounds(b, new Matrix());
    return b;
  }
  /** Bounds in the root's space. */
  getBounds(): Bounds {
    const b = new Bounds();
    this.collectBounds(b, this.worldTransform);
    return b;
  }

  on(event: string, fn: Listener) {
    (this.listeners ??= new Map()).set(event, [...(this.listeners.get(event) ?? []), fn]);
    return this;
  }
  once(event: string, fn: Listener) {
    const wrap: Listener = (...a) => {
      this.off(event, wrap);
      fn(...a);
    };
    return this.on(event, wrap);
  }
  off(event: string, fn?: Listener) {
    const l = this.listeners?.get(event);
    if (l) this.listeners!.set(event, fn ? l.filter((x) => x !== fn) : []);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    const l = this.listeners?.get(event);
    if (l) for (const f of [...l]) f(...args);
    return !!l?.length;
  }
  removeAllListeners() {
    this.listeners = null;
    return this;
  }

  destroy(options: boolean | DestroyOptions = false) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('destroyed', this);
    this.removeFromParent();
    const opts = typeof options === 'boolean' ? { children: options } : options;
    const kids = this.removeChildren();
    if (opts.children) for (const c of kids) c.destroy(options);
    this.mask = null;
    this.filterList = null;
    this.listeners = null;
  }
}
