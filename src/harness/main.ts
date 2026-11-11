// The test page: an engine on a full-window canvas, driven by the render tests through window.H.
import {
  Engine,
  Session,
  exportVideo,
  openFrameSource,
  FONTS,
  fontStack,
  ensureFont,
  type SessionSpec,
} from '../engine';
import { DEMO_LYRICS, DEMO_SONG } from '../theme/demo';
import { presetStyle, normalizeStyle } from '../theme/style';
import * as director from '../director';
import * as lyrics from '../render/lyrics';
import { drawFrame, PROFILE } from '../render/renderer';
import { effects } from '../render/effects/registry';
import { STATS as glyphStats } from '../render/glyphs';
import * as rhythm from '../rhythm';
import { neuralRhythm } from '../rhythm/neural';
import { setGfx, gfx, setGpuLyrics } from '../render/gfx';

const canvas = document.createElement('canvas');
const engine = new Engine(canvas, { audioContext: () => new AudioContext() });
engine.mount(document.getElementById('host')!);
const env = {
  lang: 'zh-Hant',
  labels: { composer: '作曲', lyricist: '作詞', artist: '演唱' },
  viewAspect: () => engine.viewAspect(),
};
async function open(spec: Partial<SessionSpec> & { theme?: string; cut?: string; bg?: string } = {}) {
  let style: any = spec.style;
  if (!style && spec.theme) {
    style = presetStyle(spec.theme);
    if (spec.cut || spec.bg) {
      style = normalizeStyle({
        ...style,
        preset: 'custom',
        ...(spec.cut ? { cut: spec.cut } : {}),
        ...(spec.bg ? { bgStyle: spec.bg } : {}),
      });
    }
  }
  if (style) style = { ...style, aspect: 'fill' };
  const s = await Session.open(
    {
      key: 'h',
      lyrics: spec.lyrics ?? DEMO_LYRICS,
      song: spec.song ?? DEMO_SONG,
      bpm: spec.bpm ?? 120,
      style,
      coverUrl: spec.coverUrl,
      audio: spec.audio,
      analysis: spec.analysis,
    },
    env,
  );
  engine.show(s, { play: false });
  await engine.setView('effect');
  engine.handoff.jump(1);
  return s;
}
(window as any).H = {
  PROFILE,
  GPU_STATS: lyrics.GPU_STATS,
  setGpuLyrics,
  fonts: { FONTS, fontStack, ensureFont },
  exportVideo,
  openFrameSource,
  engine,
  open,
  director,
  lyrics,
  drawFrame,
  effects,
  Session,
  setCulling: lyrics.setCulling,
  glyphStats,
  rhythm,
  neuralRhythm,
  setGfx,
  gfx,
};
// (the neural engine is off unless a test points it at its models: the other render tests stay on the built-in analysis)
rhythm.setRhythmEngine('dsp');
