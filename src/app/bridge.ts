import type { SettingValues } from './settings/schema';
import type { AudioContentId, LyricsRevision, MetadataRevision, TrackId } from '../core/media-identity';
// What the page may ask the desktop for (electron/preload.cjs), typed. In the web build there is no desktop: files are
// handed over as downloads and nothing else exists.

export interface Track {
  id: TrackId;
  file: string;
  folder: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string[];
  year: number | null;
  date?: string;
  copyright?: string;
  isrc?: string[];
  upc?: string;
  track: number | null;
  disc: number | null;
  duration: number;
  codec: string;
  bitrate: number;
  /** the sound: sample rate (Hz), bit depth, lossless, the file's extension */ sampleRate: number;
  bits: number;
  channels?: number;
  mediaRevision?: string;
  audioContentId?: AudioContentId | null;
  identityState?: 'verified' | 'pending' | 'unverified' | 'protected';
  metadataRevision?: MetadataRevision;
  lyricsRevision?: LyricsRevision;
  lossless: boolean;
  ext: string;
  composer: string;
  lyricist: string;
  cover: string | null;
  lrc: boolean;
  embedded: boolean;
  /** TTML lyrics (a .ttml beside it, or a TTML tag) */ ttml?: boolean;
  protected: boolean;
  analyzed: number;
  added: number;
  plays: number;
  last: number;
  edited: boolean;
  coverSet: boolean;
  /** marked as an instrumental: its own line instead of lyrics, the record theme by default */ instrumental?: boolean;
  /** how loud it is (BS.1770), once measured: the volume balance's input */ loudness?: {
    lufs: number;
    peak: number;
  } | null;
  tags: {
    title: string;
    artist: string;
    album: string;
    albumArtist: string;
    year: number | null;
    genre: string[];
    track: number | null;
    disc: number | null;
  };
}
export interface Playlist {
  id: string;
  name: string;
  created: number;
  tracks: string[];
}
export interface LibView {
  folders: string[];
  tracks: Track[];
  favorites: string[];
  playlists: Playlist[];
  identityConflicts?: { id: TrackId; file: string; reason: 'missing' | 'changed' }[];
}

export interface AnalysisToken {
  id: TrackId;
  content: AudioContentId;
  source: string;
  epoch: number;
  revision: number;
  settings: string;
}
/** What is bound to one song: its lyric style, lyric timing, the lock, its MV. */
export interface SongData {
  /** the listener's word spacing, line by line (lyrics/spacing.ts) */ spacing?: Record<string, string>;
  style?: unknown;
  lshift?: number;
  locked?: boolean;
  mv?: { name: string; offset: number } | null;
  mvOn?: boolean;
  v?: number;
  unbind?: boolean;
}
export interface LyricsFound {
  id: string;
  source: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  synced?: string;
  plain?: string;
  translation?: string;
  transliteration?: string;
  format: string;
  precision: 'plain' | 'line' | 'word';
  warnings: string[];
  delta: number | null;
}
export type Settings = SettingValues & { platform?: string; version?: string };
type Off = () => void;
export interface DesktopApi {
  setEditing(on: boolean): Promise<boolean>;
  saveDialog(o: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  openWrite(path: string): Promise<number>;
  write(id: number, data: Uint8Array, pos: number): Promise<void>;
  close(id: number): Promise<number>;
  abort(id: number): Promise<void>;
  saveText(path: string, text: string): Promise<void>;
  showItem(path: string): Promise<void>;
  platform: string;
  win(op: 'min' | 'max' | 'close' | 'full' | 'mini'): Promise<{ max: boolean; full: boolean; mini?: boolean } | null>;
  onWin(f: (s: { max: boolean; full: boolean; mini?: boolean; min?: boolean }) => void): Off;
  /** whether a song is playing (the taskbar's play / pause button shows it) */ playing?(on: boolean): Promise<void>;
  onMedia(f: (op: 'toggle' | 'next' | 'prev') => void): Off;
  settings(): Promise<Settings>;
  setSettings(p: Partial<Settings>): Promise<Settings>;
  /** restart the app (the interface mode takes effect at start) */ relaunch(): Promise<void>;
  /** the settings as the main process has them, when they change from elsewhere (the desktop lyrics' own buttons) */
  onSettings?(f: (s: Settings) => void): Off;
  /** the lyrics on the desktop (electron/desk.cjs): fed by the main window, read by their own */
  deskFeed?(d: DeskFeed): void;
  onDeskFeed?(f: (d: DeskFeed) => void): Off;
  onDeskState?(f: (s: DeskState) => void): Off;
  deskState?(): Promise<DeskState>;
  deskOp?(op: 'lock' | 'bigger' | 'smaller' | 'close'): Promise<boolean>;
}
/** What the desktop lyrics show: three lines from the one being sung (each its words and, timed word by word, each
 *  character's time), the song's time and whether it plays (they run on from it between feeds). */
export interface DeskFeed {
  id: string | null;
  t: number;
  playing: boolean;
  advanceMs?: number;
  revision?: number;
  lines: { t: number; text: string; units: { c: string; t: number | null; sp: boolean }[] }[];
  /** the index in `lines` of the line being sung (-1: none yet) */ cur: number;
}
export interface DeskState {
  locked: boolean;
  size: number;
  hovered: boolean;
}
export interface LibApi {
  get(): Promise<LibView>;
  openWorkshopAudio(): Promise<{ id: string; name: string } | null>;
  closeWorkshopAudio(id: string): Promise<void>;
  addFolder(): Promise<LibView>;
  removeFolder(d: string): Promise<LibView>;
  rescan(): Promise<boolean>;
  favorite(id: string, on: boolean): Promise<boolean>;
  playlist(op: string, a?: unknown, b?: unknown): Promise<unknown>;
  played(id: string): Promise<void>;
  analysis(id: string, version?: number): Promise<unknown>;
  analysisToken(id: string): Promise<AnalysisToken | null>;
  saveAnalysis(id: string, a: unknown, token: AnalysisToken): Promise<boolean>;
  saveLoudness(id: string, l: { lufs: number; peak: number } | null, token: AnalysisToken): Promise<boolean>;
  analysisFailed(id: string, why: string, token: AnalysisToken): Promise<boolean>;
  /** analyse these songs again (their cached analysis dropped), first in the queue */ reanalyze(
    ids: string[] | 'all',
  ): Promise<boolean>;
  /** a cached analysis found sound: not checked again until a new version */ verified(
    id: string,
    version: number,
    token: AnalysisToken,
  ): Promise<void>;
  /** unchecked caches, plus unclassified older caches when a better analysis is available */ unverified(
    version: number,
    inspectQuality?: boolean,
  ): Promise<string[]>;
  /** the caches (rhythm, loudness, thumbnails) cleared; every song is analysed again */ clearCaches(): Promise<boolean>;
  /** everything Cadenza keeps — library, songs' data, caches, settings — removed, and the app restarted */ resetAll(): Promise<void>;
  taskDetails(): Promise<BackgroundTasks>;
  nextAnalysis(
    version: number,
    omit?: string[],
    capability?: string,
  ): Promise<{ id: string; only?: 'loudness'; upgrade?: true } | null>;
  prioritize(ids: string[]): Promise<void>;
  song(id: string): Promise<SongData | null>;
  setSong(id: string, d: SongData): Promise<boolean>;
  lyrics(id: string): Promise<{ source: 'lrc' | 'embedded' | 'ttml'; text: string } | null>;
  lyricSources(id: string): Promise<LyricSources | null>;
  selectLyrics(id: string, source: string): Promise<boolean>;
  mutateLyrics(
    id: string,
    request: LyricMutation,
  ): Promise<{ ok: boolean; target?: 'tag' | 'lrc' | 'ttml'; why?: string }>;
  exportLyrics(id: string, text: string): Promise<boolean>;
  writeLyrics(
    id: string,
    t: string,
    target?: 'tag' | 'lrc' | 'ttml',
  ): Promise<{ ok: boolean; target?: 'tag' | 'lrc' | 'ttml'; why?: string }>;
  importLyricsFile(): Promise<string | null>;
  cancelLyricSearch(): Promise<void>;
  searchLyrics(q: object): Promise<LyricsFound[]>;
  clearMeta(id: string, part: 'tags' | 'cover' | 'all'): Promise<boolean>;
  instrumental(id: string, on: boolean): Promise<boolean>;
  editMeta(id: string, f: object): Promise<boolean>;
  setCover(id: string, how: { file?: boolean; reset?: boolean }): Promise<boolean>;
  bindMv(id: string): Promise<{ name: string; offset: number } | null>;
  onChanged(f: (v: LibView) => void): Off;
  onProgress(f: (p: ScanProgress) => void): Off;
  onAnalysis(f: (p: { done: number; total: number }) => void): Off;
  onWake(f: () => void): Off;
  onAnalysisInvalidated(f: (contents: string[] | null) => void): Off;
}
export interface ScanProgress {
  phase: string;
  done: number;
  total: number;
  unavailable: number;
  hashing: number;
  queued: number;
}
export interface BackgroundTasks {
  progress: ScanProgress;
  cached: number;
  pending: number;
  skipped: number;
  failed: number;
  unresolved: number;
  recent: { file: string; reason: string }[];
  counters: { directories: number; tags: number; fingerprints: number; analyses: number; cacheHits: number };
}
export interface LyricTarget {
  id: string;
  label: string;
  format: 'ttml' | 'lrc' | 'yrc' | 'krc' | 'either';
}
export interface LyricField extends LyricTarget {
  text: string;
  writable: boolean;
  revision: string;
}
export interface LyricMutation {
  source: string;
  revision?: string;
  text: string | null;
}
export interface LyricSources {
  fields: LyricField[];
  targets: LyricTarget[];
  primary?: string;
  errors: string[];
}
export interface AudioApi {
  state(): Promise<any>;
  cmd(o: Record<string, unknown>): Promise<boolean>;
  onEvent(f: (e: any) => void): Off;
}
/** The rhythm engine's networks run natively (electron/infer.cjs): their state, the models' download, one pass. */
export interface InferApi {
  status(): Promise<{
    runtime: boolean;
    models: boolean;
    beats: boolean;
    stems: boolean;
    ep: string | null;
    downloading: boolean;
    size: number;
  }>;
  download(): Promise<{ ok: boolean; why?: string }>;
  onProgress(f: (k: number) => void): Off;
  run(op: 'beat', a: { spect: Float32Array }): Promise<{ beat: Float32Array; downbeat: Float32Array }>;
  run(
    op: 'separate',
    a: { left: Float32Array; right: Float32Array },
  ): Promise<{ left: Float32Array; right: Float32Array }[]>;
}

export type AiProvider = 'openai' | 'deepseek' | 'compatible';
export interface AiEntry {
  id: string;
  name: string;
  provider: AiProvider;
  base: string;
  protocol: 'responses' | 'chat';
  model: string;
  timeout: number;
  language: string;
}
type AiResult<T> = { ok: true; value: T } | { ok: false; why: string };
export interface AiTranslationRow {
  id: string;
  translation: string;
}
export interface AiTranslationPreferences {
  model: string;
  language: string;
  instructions: string;
  timeout: number;
}
interface LyricAiApi {
  state(): Promise<
    AiResult<{
      entries: AiEntry[];
      chatgpt: { connected: boolean; inference: boolean };
      preferences: { service: string; byService: Record<string, AiTranslationPreferences> };
    }>
  >;
  signIn(): Promise<AiResult<void>>;
  cancelSignIn(): Promise<AiResult<void>>;
  signOut(): Promise<AiResult<void>>;
  save(entry: Omit<AiEntry, 'id'> & { id?: string; key: string }): Promise<AiResult<AiEntry>>;
  remove(id: string): Promise<AiResult<void>>;
  models(id: string): Promise<AiResult<string[]>>;
  preferences(input: AiTranslationPreferences & { service: string }): Promise<AiResult<void>>;
  translate(input: {
    service: string;
    model: string;
    language: string;
    context: string;
    instructions: string;
    timeout?: number;
    rows: Array<{ id: string; text: string }>;
  }): Promise<AiResult<AiTranslationRow[]>>;
  cancel(): Promise<AiResult<void>>;
}

const W = (typeof window !== 'undefined' ? window : {}) as any;
export const D: DesktopApi | null = W.cadenzaDesktop ?? null;
export const LyricAI: LyricAiApi | null = W.cadenzaLyricAI ?? null;
export const Lib: LibApi | null = W.cadenzaLib ?? null;
export const AudioOut: AudioApi | null = W.cadenzaAudio ?? null;
export const Infer: InferApi | null = W.cadenzaInfer ?? null;
export const desktop = !!D;

export const coverUrl = (key: string | null | undefined, full = false) =>
  key ? `cadenza://${full ? 'cover' : 'thumb'}/${key}` : '';
export const mediaUrl = (id: string, revision?: string) =>
  `cadenza://media/${id}${revision ? `?rev=${encodeURIComponent(revision)}` : ''}`;

/* ---------- files ---------- */
/** In a browser a finished file is offered as a download. */
export async function offerFile(filename: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 4000);
}
/** Desktop: ask for a path first, then stream every write to it (positional, so the muxer can patch box sizes). */
export function pickSavePath(name: string, kind: 'mp4' | 'json') {
  if (!D) return Promise.resolve(null);
  return D.saveDialog({
    defaultPath: name,
    filters:
      kind === 'mp4' ? [{ name: 'MP4', extensions: ['mp4'] }] : [{ name: 'Cadenza project', extensions: ['json'] }],
  });
}
export function fileSink(path: string) {
  let id: number | null = null;
  const d = D!;
  return {
    async write(data: Uint8Array, pos: number) {
      if (id == null) id = await d.openWrite(path);
      await d.write(id, data, pos);
    },
    async close() {
      if (id == null) id = await d.openWrite(path);
      const size = await d.close(id);
      return { path, size };
    },
    async abort() {
      if (id != null) await d.abort(id);
    },
  };
}
export const slug = (s: string) =>
  (s || 'cadenza')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cadenza';
