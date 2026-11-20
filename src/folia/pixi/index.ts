// A Pixi v8-compatible stage, the subset Folia's visualizers use, drawn with Canvas2D and WebGL2 filters.
// Vendored Folia code imports this module where upstream imports 'pixi.js' (scripts/folia-sync.mjs
// rewrites the specifier), so the upstream composition code runs unchanged; only the runtimes that own
// a Pixi Application are rewritten for Cadenza's engine (src/folia/engines).
export * from './math';
export * from './color';
export * from './container';
export * from './graphics';
export * from './texture';
export * from './text';
export * from './filters';
export * from './mesh';
export { StageRenderer, StageRenderer as Renderer, makeCanvas, type RenderOptions } from './render';
export { glRunner } from './gl';
export { Assets } from './assets';

export const VERSION = '8-compat';
