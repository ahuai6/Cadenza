// Geometry for the Pixi-compatible stage: the subset of Pixi v8's math types that Folia's
// visualizer code touches (points, matrices, rectangles, bounds), with the same semantics.

export interface PointData {
  x: number;
  y: number;
}

export class Point implements PointData {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  /** Pixi's `set(x, y = x)`: one argument sets both. */
  set(x = 0, y = x) {
    this.x = x;
    this.y = y;
    return this;
  }
  copyFrom(p: PointData) {
    this.x = p.x;
    this.y = p.y;
    return this;
  }
  copyTo<T extends PointData>(p: T) {
    p.x = this.x;
    p.y = this.y;
    return p;
  }
  clone() {
    return new Point(this.x, this.y);
  }
  equals(p: PointData) {
    return p.x === this.x && p.y === this.y;
  }
  static get shared() {
    return SHARED_POINT.set(0, 0);
  }
}
const SHARED_POINT = new Point();

/** Pixi calls its transform points "observable"; here every frame recomputes transforms, so a plain point is enough. */
export { Point as ObservablePoint };

export class Matrix {
  constructor(
    public a = 1,
    public b = 0,
    public c = 0,
    public d = 1,
    public tx = 0,
    public ty = 0,
  ) {}
  set(a: number, b: number, c: number, d: number, tx: number, ty: number) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.tx = tx;
    this.ty = ty;
    return this;
  }
  identity() {
    return this.set(1, 0, 0, 1, 0, 0);
  }
  copyFrom(m: Matrix) {
    return this.set(m.a, m.b, m.c, m.d, m.tx, m.ty);
  }
  clone() {
    return new Matrix(this.a, this.b, this.c, this.d, this.tx, this.ty);
  }
  /** this = parent * this (Pixi's `prepend`'s mirror: `out = parent × local`). */
  static multiply(parent: Matrix, local: Matrix, out: Matrix) {
    const { a, b, c, d, tx, ty } = parent;
    return out.set(
      local.a * a + local.b * c,
      local.a * b + local.b * d,
      local.c * a + local.d * c,
      local.c * b + local.d * d,
      local.tx * a + local.ty * c + tx,
      local.tx * b + local.ty * d + ty,
    );
  }
  translate(x: number, y: number) {
    this.tx += x;
    this.ty += y;
    return this;
  }
  scale(x: number, y: number) {
    this.a *= x;
    this.d *= y;
    this.c *= x;
    this.b *= y;
    this.tx *= x;
    this.ty *= y;
    return this;
  }
  apply<T extends PointData = Point>(p: PointData, out?: T): T {
    const o = (out ?? new Point()) as T;
    const x = p.x,
      y = p.y;
    o.x = this.a * x + this.c * y + this.tx;
    o.y = this.b * x + this.d * y + this.ty;
    return o;
  }
  applyInverse<T extends PointData = Point>(p: PointData, out?: T): T {
    const o = (out ?? new Point()) as T;
    const id = 1 / (this.a * this.d - this.c * this.b || 1e-12);
    const x = p.x,
      y = p.y;
    o.x = this.d * id * x - this.c * id * y + (this.ty * this.c - this.tx * this.d) * id;
    o.y = this.a * id * y - this.b * id * x + (-this.ty * this.a + this.tx * this.b) * id;
    return o;
  }
  invert() {
    const { a, b, c, d, tx, ty } = this;
    const n = a * d - b * c || 1e-12;
    return this.set(d / n, -b / n, -c / n, a / n, (c * ty - d * tx) / n, -(a * ty - b * tx) / n);
  }
  static get IDENTITY() {
    return IDENTITY;
  }
  static get shared() {
    return SHARED_MATRIX.identity();
  }
}
const IDENTITY = new Matrix();
const SHARED_MATRIX = new Matrix();

export class Rectangle {
  readonly type = 'rectangle';
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  get left() {
    return this.x;
  }
  get right() {
    return this.x + this.width;
  }
  get top() {
    return this.y;
  }
  get bottom() {
    return this.y + this.height;
  }
  isEmpty() {
    return this.left === this.right || this.top === this.bottom;
  }
  set(x: number, y: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    return this;
  }
  copyFrom(r: Rectangle) {
    return this.set(r.x, r.y, r.width, r.height);
  }
  clone() {
    return new Rectangle(this.x, this.y, this.width, this.height);
  }
  contains(x: number, y: number) {
    return this.width > 0 && this.height > 0 && x >= this.x && x < this.right && y >= this.y && y < this.bottom;
  }
  pad(px: number, py = px) {
    this.x -= px;
    this.y -= py;
    this.width += px * 2;
    this.height += py * 2;
    return this;
  }
  static get EMPTY() {
    return new Rectangle();
  }
}

/** Pixi v8's Bounds: min/max corners, with the rectangle view Folia also reads. */
export class Bounds {
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  private rect: Rectangle | null = null;
  constructor(minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }
  clear() {
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
    return this;
  }
  isEmpty() {
    return this.minX > this.maxX || this.minY > this.maxY;
  }
  get isValid() {
    return this.minX + this.minY !== Infinity;
  }
  get x() {
    return this.isEmpty() ? 0 : this.minX;
  }
  get y() {
    return this.isEmpty() ? 0 : this.minY;
  }
  get width() {
    return this.isEmpty() ? 0 : this.maxX - this.minX;
  }
  get height() {
    return this.isEmpty() ? 0 : this.maxY - this.minY;
  }
  get left() {
    return this.minX;
  }
  get right() {
    return this.maxX;
  }
  get top() {
    return this.minY;
  }
  get bottom() {
    return this.maxY;
  }
  get rectangle() {
    this.rect ??= new Rectangle();
    return this.rect.set(this.x, this.y, this.width, this.height);
  }
  addPoint(x: number, y: number) {
    if (x < this.minX) this.minX = x;
    if (y < this.minY) this.minY = y;
    if (x > this.maxX) this.maxX = x;
    if (y > this.maxY) this.maxY = y;
  }
  /** Adds the rectangle (x0, y0)–(x1, y1), transformed by `m` when given (its four corners). */
  addFrame(x0: number, y0: number, x1: number, y1: number, m?: Matrix) {
    if (!m) {
      this.addPoint(x0, y0);
      this.addPoint(x1, y1);
      return this;
    }
    const { a, b, c, d, tx, ty } = m;
    this.addPoint(a * x0 + c * y0 + tx, b * x0 + d * y0 + ty);
    this.addPoint(a * x1 + c * y0 + tx, b * x1 + d * y0 + ty);
    this.addPoint(a * x1 + c * y1 + tx, b * x1 + d * y1 + ty);
    this.addPoint(a * x0 + c * y1 + tx, b * x0 + d * y1 + ty);
    return this;
  }
  addBounds(o: Bounds, m?: Matrix) {
    if (o.isEmpty()) return this;
    return this.addFrame(o.minX, o.minY, o.maxX, o.maxY, m);
  }
  addRect(r: Rectangle, m?: Matrix) {
    return this.addFrame(r.x, r.y, r.x + r.width, r.y + r.height, m);
  }
  pad(px: number, py = px) {
    if (this.isEmpty()) return this;
    this.minX -= px;
    this.maxX += px;
    this.minY -= py;
    this.maxY += py;
    return this;
  }
  clone() {
    return new Bounds(this.minX, this.minY, this.maxX, this.maxY);
  }
}

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
