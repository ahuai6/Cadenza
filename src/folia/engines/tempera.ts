// Tempera (凝彩) on Cadenza's engine: Folia's colour-block compositions, hatching, cut-outs, inverted type, block-wipe
// transitions, credits, ink flash and depth are its own code (vendor/components/visualizer/tempera), drawn by the
// Pixi-compatible stage. This replaces upstream's createTemperaPixiRuntime.ts; kept line for line: the scene cache
// with its neighbour pre-roll and the incoming scene's pre-roll under a transition, the per-shot hand-off, the
// block wipe on the overlay, the ink flash on drum hits and the depth switch's ease. Upstream's song hand-over and
// the user's layer images are left to Cadenza (its own song change; its backdrop).
import * as pixi from '../pixi';
import { StageRenderer } from '../pixi';
import type { TemperaTuning, Theme } from '../vendor/types';
import { DEFAULT_TEMPERA_TUNING } from '../vendor/types';
import type { TemperaProgram } from '../vendor/components/visualizer/tempera/types';
import {
  compileTemperaProgram,
  findTemperaParagraphIndexAtTime,
} from '../vendor/components/visualizer/tempera/temperaProgram';
import { buildTemperaScene, type TemperaSceneView } from '../vendor/components/visualizer/tempera/temperaSceneBuilder';
import {
  destroyPixiDisplayTree,
  setPixiDisplayTreeVisibility,
  unloadPixiDisplayTree,
} from '../vendor/components/visualizer/pixi/pixiDisplayResources';
import { PixiSceneCache } from '../vendor/components/visualizer/pixiSceneCache';
import { setTemperaTransitionBlur } from '../vendor/components/visualizer/tempera/temperaSceneFilters';
import { destroyTemperaGradientFills } from '../vendor/components/visualizer/tempera/temperaShapes';
import { TemperaOverlay } from '../vendor/components/visualizer/tempera/temperaOverlay';
import { TemperaInkFlash } from '../vendor/components/visualizer/tempera/temperaInkFlash';
import {
  resolveTemperaCreditsFrame,
  TemperaCreditsLayer,
} from '../vendor/components/visualizer/tempera/temperaCreditsLayer';
import { resolveTemperaShotExit, updateTemperaShot } from '../vendor/components/visualizer/tempera/temperaShotFrame';
import {
  findTemperaActiveShotIndex,
  requiresTemperaSceneRebuild,
  resolveTemperaSceneTransitionFrame,
} from '../vendor/components/visualizer/tempera/temperaSceneFrame';
import { getBeatEffectStrength, getBeatFxHeard } from '../vendor/services/beatFx/beatFxLive';
import { BEAT_EFFECT_IDS } from '../vendor/services/beatFx/beatEffects';
import { getDrumHits } from '../shim/drumHits';
import type { EngineParam, FoliaEngine, FoliaEngineFrame, FoliaEngineSpec } from './types';

/** How long the depth switch eases (s), as upstream. */
const DEPTH_EASE_SECONDS = 0.6;

const D = DEFAULT_TEMPERA_TUNING;
/** Tempera's settings on the style pages (upstream's TemperaSettingsPanel, without the image pool). */
export const TEMPERA_PARAMS: EngineParam[] = [
  {
    key: 'cameraIntensity',
    label: 'eng.camera',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.cameraIntensity,
    group: 'style',
  },
  {
    key: 'glyphMotion',
    label: 'eng.glyphMotion',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.glyphMotion,
    group: 'style',
  },
  {
    key: 'glyphSettleStretch',
    label: 'eng.settle',
    kind: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    def: D.glyphSettleStretch,
    group: 'style',
  },
  { key: 'wholeLineLyrics', label: 'eng.wholeLine', kind: 'toggle', def: D.wholeLineLyrics, group: 'style' },
  {
    key: 'colorMode',
    label: 'eng.colorMode',
    kind: 'select',
    options: [
      ['duo', 'eng.colorMode.duo'],
      ['mono', 'eng.colorMode.mono'],
      ['gradient', 'eng.colorMode.gradient'],
    ],
    def: D.colorMode,
    group: 'style',
  },
  { key: 'textInversion', label: 'eng.inversion', kind: 'toggle', def: D.textInversion, group: 'style' },
  { key: 'showBlocks', label: 'eng.blocks', kind: 'toggle', def: D.showBlocks, group: 'style' },
  { key: 'showDecor', label: 'eng.decor', kind: 'toggle', def: D.showDecor, group: 'style' },
  { key: 'showCornerMarks', label: 'eng.cornerMarks', kind: 'toggle', def: D.showCornerMarks, group: 'style' },
  { key: 'enableTransitions', label: 'eng.transitions', kind: 'toggle', def: D.enableTransitions, group: 'style' },
  { key: 'credits', label: 'eng.credits', kind: 'toggle', def: true, group: 'style' },
  { key: 'inkFlash', label: 'eng.inkFlash', kind: 'range', min: 0, max: 2, step: 0.05, def: 1, group: 'fx' },
  {
    key: 'depthOfField',
    label: 'eng.depth',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.depthOfField,
    group: 'fx',
    when: 'inkFlash',
  },
  {
    key: 'depthPan',
    label: 'eng.depthPan',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.depthPan,
    group: 'fx',
    when: 'inkFlash',
  },
  {
    key: 'glyphDepth',
    label: 'eng.glyphDepth',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.glyphDepth,
    group: 'fx',
    when: 'inkFlash',
  },
  { key: 'postProcessEnabled', label: 'eng.post', kind: 'toggle', def: D.postProcessEnabled, group: 'fx' },
  {
    key: 'postProcessGrain',
    label: 'eng.grain',
    kind: 'range',
    min: 0,
    max: 1,
    def: D.postProcessGrain,
    group: 'fx',
    when: 'postProcessEnabled',
  },
  {
    key: 'postProcessContrast',
    label: 'eng.contrast',
    kind: 'range',
    min: 0,
    max: 1,
    def: D.postProcessContrast,
    group: 'fx',
    when: 'postProcessEnabled',
  },
  {
    key: 'postProcessRgbShift',
    label: 'eng.rgbShift',
    kind: 'range',
    min: 0,
    max: 1,
    def: D.postProcessRgbShift,
    group: 'fx',
    when: 'postProcessEnabled',
  },
  {
    key: 'postProcessVignette',
    label: 'eng.vignette',
    kind: 'range',
    min: 0,
    max: 2,
    def: D.postProcessVignette,
    group: 'fx',
    when: 'postProcessEnabled',
  },
  {
    key: 'postProcessLensDistortion',
    label: 'eng.lens',
    kind: 'range',
    min: 0,
    max: 2,
    def: D.postProcessLensDistortion,
    group: 'fx',
    when: 'postProcessEnabled',
  },
];

export interface TemperaOptions extends FoliaEngineSpec {
  tuning?: Record<string, unknown>;
  /** the cover's representative colours (the gradient colour mode) */
  coverColors: string[];
}

const tuningOf = (t: Record<string, unknown> | undefined): TemperaTuning => {
  const out = { ...D } as TemperaTuning & Record<string, unknown>;
  for (const [k, v] of Object.entries(t ?? {})) if (k in D) out[k] = v;
  out.layerImages = [];
  return out;
};

export class TemperaEngine implements FoliaEngine {
  readonly id = 'tempera';
  readonly ready = true;
  private readonly renderer = new StageRenderer();
  private readonly stage = new pixi.Container();
  private readonly sceneContainer = new pixi.Container();
  private readonly creditsLayer = new TemperaCreditsLayer(pixi);
  private readonly overlay = new TemperaOverlay(pixi);
  private readonly inkFlash = new TemperaInkFlash(pixi);
  private readonly program: TemperaProgram;
  private readonly sceneCache: PixiSceneCache<TemperaSceneView>;
  private readonly host = { clientWidth: 1280, clientHeight: 720 };
  private readonly imageTextures = new Map<string, pixi.Texture>();
  private tuning: TemperaTuning;
  private readonly theme: Theme;
  private activeParagraphIndex = -1;
  private width = 0;
  private height = 0;
  private resolution = 1;
  private depthOn = false;
  private depthMix = 0;
  private lastT: number | null = null;
  private depthChange: { t: number; mix: number } | null = null;
  private destroyed = false;

  constructor(private readonly spec: TemperaOptions) {
    this.tuning = tuningOf(spec.tuning);
    this.theme = spec.theme;
    this.program = compileTemperaProgram(spec.lines, spec.seed, { wholeLineLyrics: this.tuning.wholeLineLyrics });
    this.sceneCache = new PixiSceneCache<TemperaSceneView>({
      count: () => this.program.paragraphs.length,
      build: (index) => {
        const scene = this.buildScene(index);
        this.sceneContainer.addChild(scene.container);
        return scene;
      },
      destroy: (scene) => this.destroyScene(scene),
      detach: (scene) => this.sceneContainer.removeChild(scene.container),
    });
    this.sceneContainer.sortableChildren = true;
    this.stage.addChild(
      this.sceneContainer,
      this.creditsLayer.container,
      this.inkFlash.container,
      this.overlay.container,
    );
    this.depthOn = getBeatEffectStrength(BEAT_EFFECT_IDS.temperaInkFlash) > 0;
    this.depthMix = this.depthOn ? 1 : 0;
  }

  get hasLyrics() {
    return this.program.paragraphs.length > 0;
  }

  private buildScene(index: number) {
    return buildTemperaScene(
      pixi,
      {
        programSeed: this.program.seed,
        host: this.host as unknown as HTMLDivElement,
        theme: this.theme,
        tuning: this.tuning,
        renderResolution: this.resolution,
        lyricsFontScale: this.spec.fontScale,
        staticMode: this.spec.still,
        coverColors: this.spec.coverColors,
        imageTextures: this.imageTextures,
        renderer: this.depthOn ? this.renderer : null,
      },
      this.program.paragraphs[index],
    );
  }

  private destroyScene(scene: TemperaSceneView) {
    this.sceneContainer.removeChild(scene.container);
    unloadPixiDisplayTree(scene.container);
    scene.container.filters = null;
    scene.shots.forEach((shot) => {
      shot.textLayer.filters = null;
    });
    scene.postProcessFilters.forEach((filter) => filter.destroy());
    scene.bakedTextures.forEach((texture) => texture.destroy(true));
    scene.bakedTextures.clear();
    destroyTemperaGradientFills(pixi, scene.container);
    destroyPixiDisplayTree(scene.container);
  }

  private clearScenes() {
    this.sceneCache.clear();
    this.activeParagraphIndex = -1;
  }

  private drawCredits() {
    const view = this.spec.credits
      ? this.creditsLayer.build(
          {
            theme: this.theme,
            coverColors: this.spec.coverColors,
            tuning: this.tuning,
            metadata: { title: this.spec.title, artist: this.spec.artist, album: this.spec.album },
            lyricsFontScale: this.spec.fontScale,
          },
          this.sceneCache.get(Math.max(0, this.activeParagraphIndex))?.palette,
          this.width,
          this.height,
        )
      : null;
    this.creditsLayer.adopt(view, this.width, this.height);
  }

  private resize(width: number, height: number, resolution: number) {
    if (width === this.width && height === this.height && resolution === this.resolution) return;
    const geometryChanged = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.host.clientWidth = width;
    this.host.clientHeight = height;
    if (!geometryChanged && this.activeParagraphIndex >= 0) return;
    this.clearScenes();
    this.drawCredits();
    this.overlay.draw(width, height, this.tuning, this.theme);
  }

  setTuning(tuning: Record<string, unknown>) {
    const next = tuningOf(tuning);
    if (JSON.stringify(next) === JSON.stringify(this.tuning)) return;
    const previous = this.tuning;
    this.tuning = next;
    if (requiresTemperaSceneRebuild(previous, next) || previous.depthOfField !== next.depthOfField) this.clearScenes();
    if (this.width > 0) {
      this.overlay.draw(this.width, this.height, this.tuning, this.theme);
      this.drawCredits();
    }
  }

  /** The depth (墨染奥行) follows the ink flash's switch, easing in over DEPTH_EASE_SECONDS of song time. */
  private updateDepthSwitch(t: number) {
    const on = getBeatEffectStrength(BEAT_EFFECT_IDS.temperaInkFlash) > 0;
    const seek = this.lastT === null || t < this.lastT || t - this.lastT > 0.3;
    if (on !== this.depthOn) {
      this.depthOn = on;
      this.depthChange = seek ? null : { t, mix: this.depthMix };
      this.clearScenes();
    }
    this.lastT = t;
    if (seek) this.depthChange = null;
    const change = this.depthChange;
    if (!change) this.depthMix = Number(on);
    else {
      const k = Math.min(1, (t - change.t) / DEPTH_EASE_SECONDS);
      this.depthMix = change.mix + (Number(on) - change.mix) * k;
      if (k === 1) this.depthChange = null;
    }
  }

  private updateInkFlash(time: number, width: number, height: number, paragraphIndex: number) {
    const strength = this.spec.still ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.temperaInkFlash);
    const heard = getBeatFxHeard();
    const known = strength > 0 ? getDrumHits(heard.key) : null;
    const hitTime = heard.time ?? time;
    const hits = known && (known.until === undefined || hitTime < known.until) ? known : null;
    const inkColor = hits ? (this.sceneCache.get(paragraphIndex)?.palette.accent ?? this.theme.accentColor) : '';
    this.inkFlash.update({ time: hitTime, width, height, strength, hits, paragraphIndex, inkColor });
  }

  /** Upstream's renderFrame. */
  private update(time: number) {
    this.updateDepthSwitch(time);
    const paragraphIndex = findTemperaParagraphIndexAtTime(this.program, time);
    if (paragraphIndex !== this.activeParagraphIndex) {
      this.activeParagraphIndex = paragraphIndex;
      this.sceneCache.ensure(paragraphIndex);
      this.sceneCache.prune(paragraphIndex);
    } else {
      const next = paragraphIndex + 1;
      const previous = paragraphIndex - 1;
      if (this.sceneCache.hasRetired) this.sceneCache.drainRetired();
      else if (next < this.program.paragraphs.length && !this.sceneCache.has(next)) this.sceneCache.ensure(next);
      else if (previous >= 0 && !this.sceneCache.has(previous)) this.sceneCache.ensure(previous);
    }
    const width = this.width;
    const height = this.height;
    const finalParagraph = this.program.paragraphs.at(-1);
    const creditsFrame = resolveTemperaCreditsFrame(time, finalParagraph?.endTime ?? Number.POSITIVE_INFINITY);
    const hasCredits = this.creditsLayer.hasPoster;
    let wipeDrawn = false;
    const transitionsEnabled = this.tuning.enableTransitions && !this.spec.still;
    const outgoingTransition = this.program.paragraphs[paragraphIndex]?.transitionOut ?? null;
    // Every transition but the block wipe shows the incoming scene under the outgoing one before the boundary.
    const preRoll =
      transitionsEnabled &&
      outgoingTransition !== null &&
      outgoingTransition.kind !== 'block-wipe' &&
      time >= outgoingTransition.startTime;
    this.sceneCache.forEach((scene, index) => {
      const isActive = index === paragraphIndex;
      const isIncoming = preRoll && index === paragraphIndex + 1;
      setPixiDisplayTreeVisibility(scene.container, isActive || isIncoming);
      scene.container.zIndex = index;
      if (!scene.container.visible) {
        scene.shots.forEach((shot) => {
          shot.container.visible = false;
        });
        scene.activeShotIndex = -1;
        return;
      }
      const transitionFrame = resolveTemperaSceneTransitionFrame(
        this.program,
        scene,
        index,
        time,
        isIncoming,
        outgoingTransition,
        transitionsEnabled,
      );
      const activeShotIndex = findTemperaActiveShotIndex(scene, time);
      scene.shots.forEach((shot, shotIndex) => {
        const isShotActive = shotIndex === activeShotIndex;
        const isHandingOff = shotIndex < activeShotIndex && resolveTemperaShotExit(shot, time) < 1;
        setPixiDisplayTreeVisibility(shot.container, isShotActive || isHandingOff);
        if (!shot.container.visible) return;
        updateTemperaShot(shot, time, width, height, this.tuning, this.theme, this.depthMix);
      });
      scene.activeShotIndex = activeShotIndex;
      const isFinalScene = index === this.program.paragraphs.length - 1;
      const lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1;
      scene.container.alpha = transitionFrame.alpha * lyricAlpha;
      scene.container.pivot.set(width / 2, height / 2);
      scene.container.position.set(width / 2 + transitionFrame.x * width, height / 2 + transitionFrame.y * height);
      scene.container.scale.set(transitionFrame.scale);
      scene.container.rotation = transitionFrame.rotation;
      setTemperaTransitionBlur(scene, transitionFrame.blur);
      if (transitionFrame.wipe > 0.001 && transitionFrame.wipe < 1.999) {
        this.overlay.drawWipe(transitionFrame.wipe, transitionFrame.wipeAngle, width, height, scene.palette.tone3);
        wipeDrawn = true;
      }
    });
    if (!wipeDrawn) this.overlay.drawWipe(0, 0, width, height, '#000000');
    this.updateInkFlash(time, width, height, paragraphIndex);
    this.creditsLayer.applyFrame(creditsFrame, hasCredits, time, finalParagraph?.endTime, width, height);
  }

  draw(g: CanvasRenderingContext2D, f: FoliaEngineFrame) {
    if (this.destroyed || !this.hasLyrics) return;
    this.resize(f.W, f.H, f.px);
    this.update(f.t);
    this.stage.alpha = f.alpha;
    g.save();
    const ox = f.ox ?? 0,
      oy = f.oy ?? 0;
    if (ox || oy) {
      // (placed in part of the picture — the play page's lyric area: clipped to it)
      g.setTransform(f.px, 0, 0, f.px, 0, 0);
      g.beginPath();
      g.rect(ox, oy, f.W, f.H);
      g.clip();
    }
    this.renderer.render(this.stage, g, {
      width: f.W,
      height: f.H,
      resolution: f.px,
      clear: false,
      transform: ox || oy ? new pixi.Matrix(1, 0, 0, 1, ox, oy) : undefined,
    });
    g.restore();
  }

  get stats() {
    return this.renderer.stats;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sceneCache.destroyAll();
    this.creditsLayer.dispose();
    this.overlay.release();
    this.inkFlash.destroy();
    this.renderer.clearCaches();
  }
}
