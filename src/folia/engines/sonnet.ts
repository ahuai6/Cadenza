// Sonnet (商籟) on Cadenza's engine: the paragraph scenes, shots, MG, transitions, credits and frame
// marks are Folia's own code (vendor/components/visualizer/sonnet), drawn by the Pixi-compatible
// stage. This file replaces upstream's createSonnetPixiRuntime.ts: there a Pixi Application owns the
// canvas, the clock and the song swap; here Cadenza's engine owns them and hands each frame its time,
// size and canvas. What is kept line for line: the scene cache and its neighbour pre-roll, strict
// one-scene visibility, the per-shot update, the transition frame (blur, glitch, beat tear), and the
// outro blur under the credits poster.
import * as pixi from '../pixi';
import { StageRenderer } from '../pixi';
import type { Line, SonnetTuning, Theme } from '../vendor/types';
import { DEFAULT_SONNET_TUNING } from '../vendor/types';
import type { SonnetProgram } from '../vendor/components/visualizer/sonnet/types';
import {
  compileSonnetProgram,
  findSonnetParagraphIndexAtTime,
} from '../vendor/components/visualizer/sonnet/sonnetProgram';
import { buildSonnetScene, type SceneView } from '../vendor/components/visualizer/sonnet/sonnetSceneBuilder';
import {
  destroySonnetContainerChildren,
  destroySonnetDisplayTree,
  unloadSonnetDisplayTree,
} from '../vendor/components/visualizer/sonnet/sonnetPixiResources';
import {
  buildSonnetCreditsPoster,
  hasSonnetCreditsMetadata,
  resolveSonnetCreditsFrame,
  type SonnetCreditsMetadata,
} from '../vendor/components/visualizer/sonnet/sonnetCredits';
import { PixiSceneCache } from '../vendor/components/visualizer/pixiSceneCache';
import { createSonnetBeatFxReader } from '../vendor/components/visualizer/sonnet/sonnetBeatFx';
import {
  readSonnetModulation,
  updateSonnetShot,
  type SonnetShotFrameContext,
} from '../vendor/components/visualizer/sonnet/sonnetShotFrame';
import {
  findSonnetActiveShotIndex,
  resolveSonnetSceneTransitionFrame,
} from '../vendor/components/visualizer/sonnet/sonnetSceneFrame';
import { drawSonnetFrameOverlay } from '../vendor/components/visualizer/sonnet/sonnetFrameOverlay';
import { SonnetOutroBlur } from '../vendor/components/visualizer/sonnet/sonnetOutroBlur';
import {
  loadSonnetIconTextures,
  releaseSonnetIconUrls,
} from '../vendor/components/visualizer/sonnet/sonnetIconTextures';
import { liveBands, livePower } from '../live';
import { withSceneRandom } from '../shim/sceneRandom';
import type { EngineParam, FoliaEngine, FoliaEngineFrame, FoliaEngineSpec } from './types';

const D = DEFAULT_SONNET_TUNING;
/** Sonnet's settings on the style pages: upstream's tuning (SonnetSettingsPanel), plus the beat effects and the credits.
 *  The resolution and antialiasing settings are Cadenza's own (its quality and smoothing settings), not offered here. */
export const SONNET_PARAMS: EngineParam[] = [
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
    key: 'typographyMotion',
    label: 'eng.typeMotion',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.typographyMotion,
    group: 'style',
  },
  { key: 'enableTransitions', label: 'eng.transitions', kind: 'toggle', def: D.enableTransitions, group: 'style' },
  { key: 'beatFx', label: 'eng.beatFx', kind: 'toggle', def: true, group: 'style' },
  { key: 'showOnlyText', label: 'eng.onlyText', kind: 'toggle', def: D.showOnlyText, group: 'style' },
  {
    key: 'mgDensity',
    label: 'eng.mgDensity',
    kind: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    def: D.mgDensity,
    group: 'style',
  },
  { key: 'showBackgroundMg', label: 'eng.lineArt', kind: 'toggle', def: D.showBackgroundMg, group: 'style' },
  { key: 'showFixedGeo', label: 'eng.shapes', kind: 'toggle', def: D.showFixedGeo, group: 'style' },
  { key: 'showGuide', label: 'eng.guides', kind: 'toggle', def: D.showGuide, group: 'style' },
  {
    key: 'showGiantDecorativeText',
    label: 'eng.giantText',
    kind: 'toggle',
    def: D.showGiantDecorativeText,
    group: 'style',
  },
  { key: 'showBackgroundDecor', label: 'eng.icons', kind: 'toggle', def: D.showBackgroundDecor, group: 'style' },
  {
    key: 'outerFrameMode',
    label: 'eng.frame',
    kind: 'select',
    options: [
      ['full', 'eng.frame.full'],
      ['frame', 'eng.frame.frame'],
      ['none', 'eng.frame.none'],
    ],
    def: D.outerFrameMode,
    group: 'style',
  },
  { key: 'credits', label: 'eng.credits', kind: 'toggle', def: true, group: 'style' },
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
    key: 'postProcessHalftone',
    label: 'eng.halftone',
    kind: 'range',
    min: 0,
    max: 1,
    def: D.postProcessHalftone,
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
  {
    key: 'postProcessLensDispersion',
    label: 'eng.dispersion',
    kind: 'range',
    min: 0,
    max: 1,
    def: D.postProcessLensDispersion,
    group: 'fx',
    when: 'postProcessEnabled',
  },
];

/** Instrumental songs: upstream's virtual staff lines (one '♪' every 8 s). */
function virtualLines(dur: number): Line[] {
  const out: Line[] = [];
  const n = Math.max(1, Math.min(240, Math.ceil(dur / 8)));
  for (let i = 0; i < n; i += 1)
    out.push({
      id: `virtual-staff-${i}`,
      startTime: i * 8,
      endTime: i * 8 + 6,
      fullText: '♪',
      words: [],
      isChorus: false,
    });
  return out;
}

export interface SonnetOptions extends FoliaEngineSpec {
  tuning?: Partial<SonnetTuning>;
}

export class SonnetEngine implements FoliaEngine {
  readonly id = 'sonnet';
  private readonly renderer = new StageRenderer();
  private readonly stage = new pixi.Container();
  private readonly sceneContainer = new pixi.Container();
  private readonly creditsContainer = new pixi.Container();
  private readonly overlayContainer = new pixi.Container();
  private readonly outroBlur = new SonnetOutroBlur(pixi);
  private readonly iconTextures = new Map<string, pixi.Texture>();
  private readonly iconUrls = new Set<string>();
  private readonly readBeatFx = createSonnetBeatFxReader();
  private readonly program: SonnetProgram;
  private readonly sceneCache: PixiSceneCache<SceneView>;
  private readonly host = { clientWidth: 1280, clientHeight: 720 };
  private tuning: SonnetTuning;
  private theme: Theme;
  private activeParagraphIndex = -1;
  private width = 0;
  private height = 0;
  private resolution = 1;
  private loaded = false;
  private destroyed = false;

  constructor(private readonly spec: SonnetOptions) {
    this.tuning = { ...DEFAULT_SONNET_TUNING, ...(spec.tuning ?? {}) };
    this.theme = spec.theme;
    const lines = spec.lines.length ? spec.lines : spec.instrumental ? virtualLines(spec.duration) : [];
    this.program = compileSonnetProgram(lines, spec.seed);
    this.sceneCache = new PixiSceneCache<SceneView>({
      count: () => this.program.paragraphs.length,
      build: (index) => {
        const scene = this.buildScene(index);
        this.sceneContainer.addChild(scene.container);
        return scene;
      },
      destroy: (scene) => this.destroyScene(scene),
    });
    this.stage.addChild(this.sceneContainer, this.creditsContainer, this.overlayContainer);
    void this.loadIcons();
  }

  /** The decor icons are data URLs; scenes wait for them (a few ms) so a shot never pops icons in. */
  private async loadIcons() {
    const loaded = await loadSonnetIconTextures(pixi, this.theme, this.tuning);
    if (this.destroyed) {
      releaseSonnetIconUrls(pixi, loaded.urls);
      return;
    }
    loaded.textures.forEach((texture, key) => this.iconTextures.set(key, texture));
    loaded.urls.forEach((url) => this.iconUrls.add(url));
    this.loaded = true;
  }

  get ready() {
    return this.loaded;
  }

  get hasLyrics() {
    return this.program.paragraphs.length > 0;
  }

  private buildScene(index: number): SceneView {
    return withSceneRandom(`${this.program.seed}:${index}`, () =>
      buildSonnetScene(
        pixi,
        {
          programSeed: this.program.seed,
          host: this.host as unknown as HTMLDivElement,
          theme: this.theme,
          tuning: this.tuning,
          smartBeatEnabled: this.spec.beatFx,
          lyricsFontScale: this.spec.fontScale,
          staticMode: this.spec.still,
          transparentBackground: this.spec.transparent,
          renderResolution: this.resolution,
          antialiasMode: 'auto',
        },
        this.iconTextures,
        this.program.paragraphs[index],
      ),
    );
  }

  private destroyScene(scene: SceneView) {
    if (this.outroBlur.isOn(scene)) this.outroBlur.clear();
    this.sceneContainer.removeChild(scene.container);
    unloadSonnetDisplayTree(scene.container);
    scene.container.filters = null;
    scene.shots.forEach((shot) => {
      shot.haloLayer.filters = null;
    });
    scene.postProcessFilters.forEach((filter) => filter.destroy());
    destroySonnetDisplayTree(scene.container);
  }

  private clearScenes() {
    this.outroBlur.clear();
    this.sceneCache.clear();
    this.activeParagraphIndex = -1;
  }

  private get metadata(): SonnetCreditsMetadata {
    return { title: this.spec.title, artist: this.spec.artist, album: this.spec.album };
  }

  private drawCredits() {
    destroySonnetContainerChildren(this.creditsContainer);
    if (this.tuning.showOnlyText || !this.spec.credits || !hasSonnetCreditsMetadata(this.metadata)) return;
    this.creditsContainer.addChild(
      buildSonnetCreditsPoster(pixi, this.theme, this.metadata, this.width, this.height, this.spec.fontScale),
    );
    this.creditsContainer.pivot.set(this.width / 2, this.height / 2);
    this.creditsContainer.position.set(this.width / 2, this.height / 2);
    this.creditsContainer.visible = false;
  }

  /** A new size (or resolution): every scene is laid out again, like upstream's resize. */
  private resize(width: number, height: number, resolution: number) {
    if (width === this.width && height === this.height && resolution === this.resolution) return;
    const sizeChanged = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    this.resolution = resolution;
    this.host.clientWidth = width;
    this.host.clientHeight = height;
    if (!sizeChanged && this.activeParagraphIndex >= 0) return;
    this.clearScenes();
    this.drawCredits();
    drawSonnetFrameOverlay(pixi, this.overlayContainer, width, height, this.tuning, this.theme);
  }

  /** Changes the tuning in place: scenes are rebuilt on the next frame (upstream's setTuning). */
  setTuning(tuning: Partial<SonnetTuning>) {
    const next = { ...DEFAULT_SONNET_TUNING, ...tuning };
    if (JSON.stringify(next) === JSON.stringify(this.tuning)) return;
    this.tuning = next;
    this.clearScenes();
    if (this.width > 0) {
      this.drawCredits();
      drawSonnetFrameOverlay(pixi, this.overlayContainer, this.width, this.height, this.tuning, this.theme);
    }
  }

  private readonly mod = (key: string) => readSonnetModulation(undefined, key);

  /** Upstream's renderFrame: picks the scene and shot for `time` and poses them. */
  private update(time: number, lineLift?: number) {
    const paragraphIndex = findSonnetParagraphIndexAtTime(this.program, time);
    if (paragraphIndex !== this.activeParagraphIndex) {
      this.activeParagraphIndex = paragraphIndex;
      this.sceneCache.ensure(paragraphIndex);
      this.sceneCache.prune(paragraphIndex);
    } else {
      // Neighbours are pre-rolls for a boundary still ahead: at most one built per frame.
      const next = paragraphIndex + 1;
      const previous = paragraphIndex - 1;
      if (next < this.program.paragraphs.length && !this.sceneCache.has(next)) this.sceneCache.ensure(next);
      else if (previous >= 0 && !this.sceneCache.has(previous)) this.sceneCache.ensure(previous);
    }
    const width = this.width;
    const height = this.height;
    const finalParagraph = this.program.paragraphs.at(-1);
    const creditsFrame = resolveSonnetCreditsFrame(time, finalParagraph?.endTime ?? Number.POSITIVE_INFINITY);
    const hasCredits = this.creditsContainer.children.length > 0;
    const beatFx = this.spec.still ? null : this.readBeatFx(liveBands, this.spec.beatFx, time, lineLift);
    const shotFrameContext: SonnetShotFrameContext = {
      tuning: this.tuning,
      smartBeatEnabled: this.spec.beatFx,
      theme: this.theme,
      audioBands: liveBands,
      audioPower: livePower,
      mod: this.mod,
      beatFx,
    };
    this.sceneCache.forEach((scene, index) => {
      const isActive = index === paragraphIndex;
      // Strict visibility: only the active scene is ever drawn.
      scene.container.visible = isActive;
      if (!isActive) {
        const previousShot = scene.shots[scene.activeShotIndex];
        if (previousShot) unloadSonnetDisplayTree(previousShot.container);
        scene.activeShotIndex = -1;
        return;
      }
      const transitionsEnabled = this.tuning.enableTransitions && !this.spec.still;
      const visibleShotIndex = findSonnetActiveShotIndex(scene, time);
      const transitionFrame = resolveSonnetSceneTransitionFrame(
        this.program,
        scene,
        index,
        visibleShotIndex,
        time,
        transitionsEnabled,
      );
      scene.shots.forEach((shot, shotIndex) => {
        const isShotActive = shotIndex === visibleShotIndex;
        shot.container.visible = isShotActive;
        if (!isShotActive) return;
        updateSonnetShot(shot, time, width, height, 0, shotFrameContext);
      });
      if (scene.activeShotIndex !== visibleShotIndex) {
        const previousShot = scene.shots[scene.activeShotIndex];
        if (previousShot) unloadSonnetDisplayTree(previousShot.container);
        scene.activeShotIndex = visibleShotIndex;
      }
      const isFinalScene = index === this.program.paragraphs.length - 1;
      const lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1;
      scene.container.alpha = transitionFrame.alpha * lyricAlpha;
      scene.container.pivot.set(width / 2, height / 2);
      scene.container.position.set(width / 2 + transitionFrame.x * width, height / 2 + transitionFrame.y * height);
      scene.container.scale.set(transitionFrame.scale);
      scene.container.rotation = transitionFrame.rotation;
      if (scene.transitionBlurFilter) {
        scene.transitionBlurFilter.strength = transitionFrame.blur;
        scene.transitionBlurFilter.enabled = transitionFrame.blur > 0.01;
      }
      if (scene.transitionGlitchEffect) {
        const transitionGlitch = transitionFrame.glitch;
        // The downbeat tear shares this filter; the stronger of the two drives it.
        const beatTearWins = !!beatFx && beatFx.tear > transitionGlitch;
        const glitchAmount = beatTearWins ? beatFx!.tear : transitionGlitch;
        scene.transitionGlitchEffect.update(glitchAmount, beatTearWins ? beatFx!.tearSeed : transitionFrame.glitchSeed);
        scene.transitionGlitchEffect.filter.enabled = beatTearWins
          ? glitchAmount > 0.01
          : transitionFrame.glitch > 0.01;
      }
      if (isFinalScene && hasCredits) this.outroBlur.update(scene, creditsFrame.lyricBlur, this.resolution);
    });
    if (!creditsFrame.active || !hasCredits) this.outroBlur.clear();
    this.creditsContainer.visible = creditsFrame.active && hasCredits && !this.tuning.showOnlyText;
    this.creditsContainer.alpha = creditsFrame.posterAlpha;
    this.creditsContainer.position.set(width / 2, height / 2 + creditsFrame.posterOffsetY * height);
    this.creditsContainer.scale.set(creditsFrame.posterScale);
  }

  draw(g: CanvasRenderingContext2D, f: FoliaEngineFrame) {
    if (this.destroyed || !this.loaded || !this.hasLyrics) return;
    this.resize(f.W, f.H, f.px);
    this.update(f.t, f.lineLift);
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
    this.clearScenes();
    destroySonnetContainerChildren(this.creditsContainer);
    destroySonnetContainerChildren(this.overlayContainer);
    this.iconTextures.clear();
    releaseSonnetIconUrls(pixi, this.iconUrls);
    this.renderer.clearCaches();
  }
}
