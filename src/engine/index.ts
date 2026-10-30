// The engine's public face: sessions, the engine, media, handoff, export.
export { Engine, type View, type Tick, type RenderSettings } from './engine';
export { Session, loadImage, type SessionSpec, type SessionEnv } from './session';
export { AudioClock, type AudioLike, type ExternalOut } from './audio';
export { VideoSource, MvSource } from './media';
export { Handoff, type HandoffSpec, type HandoffLine, type HandoffCover, type WinRect } from './handoff';
export { configure, type EngineConfig } from './config';
export { exportVideo, openFrameSource, estimate, exportSize, blobSink, type ExportOptions, type ExportResult, type Sink } from './export';

/* ---- what the interface may use from the layers under the engine ----
   The app imports only from here (and from core, theme and i18n): a rebuilt interface needs nothing else, and
   tests/unit/arch.test.ts keeps it so. */
export { analyzeInBackground, analyzeHead, loudnessInBackground, RHYTHM_VERSION, isCurrent, checkAnalysis, balanceDb, rhythmEngine, neuralDrums, neuralStatus, type RhythmAnalysis, type RhythmEngine } from '../rhythm';
export { parse as parseLyrics } from '../lyrics/parse';
export { autoSpacing, spacingKey, type Spacing } from '../lyrics/spacing';
export { loadSegmenter } from '../text/segment';
export type { Line as LyricLine } from '../lyrics/model';
export type { SongInfo } from '../director/titles';
export { LYRIC_TYPES } from '../director/lyrictypes';
export { ASPECTS } from '../director';
export { FONTS, FONT_KINDS, fontStack, ensureFont, type Face, type FontKind } from '../text/fonts';
export { effects, type Param as EffectParam } from '../render/effects/registry';
export type { GfxMode } from '../render/gfx';
