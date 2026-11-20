// Pixi's Mesh / MeshGeometry / Shader, for the one use Folia has: a screen-covering quad drawn by a
// custom fragment program (Tempera's ink flash). The stage runs the program on its GL context over
// the quad's bounds and draws the result (see StageRenderer's custom-draw hook).
import { Bounds, Matrix } from './math';
import { Container, type ContainerOptions } from './container';
import type { GlProgram, FilterResource } from './filters';
import type { Texture } from './texture';

export class MeshGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  constructor(o: { positions?: Float32Array; uvs?: Float32Array; indices?: Uint32Array } = {}) {
    this.positions = o.positions ?? new Float32Array(8);
    this.uvs = o.uvs ?? new Float32Array(8);
    this.indices = o.indices ?? new Uint32Array([0, 1, 2, 0, 2, 3]);
  }
  destroy() {}
}

export class Shader {
  glProgram: GlProgram | null;
  resources: Record<string, FilterResource>;
  constructor(o: { glProgram?: GlProgram; resources?: Record<string, FilterResource> } = {}) {
    this.glProgram = o.glProgram ?? null;
    this.resources = o.resources ?? {};
  }
  destroy() {}
}

export interface MeshOptions<G extends MeshGeometry = MeshGeometry, S extends Shader = Shader>
  extends ContainerOptions {
  geometry: G;
  shader?: S;
  texture?: Texture;
}

export class Mesh<G extends MeshGeometry = MeshGeometry, S extends Shader = Shader> extends Container {
  geometry: G;
  shader: S | null;
  texture: Texture | null;
  constructor(o: MeshOptions<G, S>) {
    super(o);
    this.geometry = o.geometry;
    this.shader = o.shader ?? null;
    this.texture = o.texture ?? null;
  }
  protected override addOwnBounds(bounds: Bounds, m: Matrix) {
    const p = this.geometry.positions;
    for (let i = 0; i + 1 < p.length; i += 2)
      bounds.addPoint(m.a * p[i] + m.c * p[i + 1] + m.tx, m.b * p[i] + m.d * p[i + 1] + m.ty);
  }
}
