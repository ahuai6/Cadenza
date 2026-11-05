// What the page may ask the desktop for (electron/preload.cjs), typed. In the web build there is no desktop: files are
// handed over as downloads and nothing else exists.

export interface Track {
  id: string; file: string; folder: string; title: string; artist: string; album: string; albumArtist: string; genre: string[];
  year: number | null; track: number | null; disc: number | null; duration: number; codec: string; bitrate: number;
  /** the sound: sample rate (Hz), bit depth, lossless, the file's extension */ sampleRate: number; bits: number; lossless: boolean; ext: string;
  composer: string; lyricist: string;
  cover: string | null; lrc: boolean; embedded: boolean; protected: boolean; analyzed: number;
  added: number; plays: number; last: number; looked: boolean; edited: boolean; coverSet: boolean;
  /** marked as an instrumental: its own line instead of lyrics, the record theme by default */ instrumental?: boolean;
  /** how loud it is (BS.1770), once measured: the volume balance's input */ loudness?: { lufs: number; peak: number } | null;
  tags: { title: string; artist: string; album: string; albumArtist: string; year: number | null; genre: string[]; track: number | null; disc: number | null };
}
export interface Playlist { id: string; name: string; created: number; tracks: string[] }
export interface LibView { folders: string[]; tracks: Track[]; favorites: string[]; playlists: Playlist[] }
/** What is bound to one song: its lyric style, lyric timing, the lock, its MV. */
export interface SongData { /** the listener's word spacing, line by line (lyrics/spacing.ts) */ spacing?: Record<string, string>; style?: unknown; lshift?: number; locked?: boolean; mv?: { name: string; offset: number } | null; mvOn?: boolean; v?: number; unbind?: boolean }
export interface LyricsFound { id: number; title: string; artist: string; album: string; duration: number; synced: string; plain: string; instrumental: boolean }
export interface MetaFound { mbid: string; title: string; artist: string; album: string; year: string | null; duration: number | null; genre: string[] }
export interface CoverFound { src: 'itunes' | 'caa'; title: string; artist: string; year: string | null; thumb: string; full: string }
export interface Settings {
  /** the interface's typeface (uifont.ts) */ uiFont?: string;
  /** where edited lyrics are saved: into the song's own tags (default), or as the .lrc beside it */ lyricsTarget?: 'tag' | 'lrc';
  /** the effect lyrics' frame shape, in the window, full screen and in exports: 16:9, 16:10, 9:16, 1:1 */ fxAspect?: string;
  theme: 'system' | 'light' | 'dark'; /** the light theme's ground: paper (warm) or the earlier white */ tone?: 'paper' | 'white'; scanOnLaunch: boolean; openAtLogin: boolean; closeToTray: boolean; lang: string; scale: 'auto' | number; fps: number; prerender: boolean;
  audioOut: 'standard' | 'hifi'; audioMode: 'exclusive' | 'shared'; audioDevice: string; fixedVolume: boolean; /** the volume balance: every song at a like loudness */ volBalance?: boolean; platform?: string; version?: string;
  /** the song's own video (MV mode): shade, soft focus, desaturation, and whether it is kept upright to crop it least */
  mvDark: number; mvBlur: number; mvDesat: number; mvFit: boolean;
  /** which engine finds the beats ('auto': the neural one where it can run), and whether it separates the drums */
  rhythmEngine?: 'auto' | 'neural' | 'dsp'; rhythmDrums?: boolean;
  /** where the neural networks run: natively when their models are there (auto), or always in WebGPU; natively on the GPU (auto) or the CPU */ rhythmRuntime?: 'auto' | 'webgpu'; rhythmDevice?: 'auto' | 'cpu';
  /** an unanalysed song: played at once on a reading of its opening, the full one taking over (stream), or after it (full) */
  rhythmStream?: 'stream' | 'full';
  /** the picture-quality mode (render/gfx.ts): as designed, optimised (cheap stand-ins for blurs and glass), or lite */
  gfx?: 'default' | 'optimized' | 'lite';
  /** the lyric layer drawn on the GPU (default on) */ gpuLyrics?: boolean;
  /** the performance overlay over the effect lyrics */ perfHud?: boolean;
}
type Off = () => void;
export interface DesktopApi {
  saveDialog(o: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  openWrite(path: string): Promise<number>; write(id: number, data: Uint8Array, pos: number): Promise<void>; close(id: number): Promise<number>; abort(id: number): Promise<void>;
  saveText(path: string, text: string): Promise<void>; showItem(path: string): Promise<void>;
  platform: string; win(op: 'min' | 'max' | 'close' | 'full'): Promise<{ max: boolean; full: boolean } | null>;
  onWin(f: (s: { max: boolean; full: boolean }) => void): Off; onMedia(f: (op: 'toggle' | 'next' | 'prev') => void): Off;
  settings(): Promise<Settings>; setSettings(p: Partial<Settings>): Promise<Settings>;
}
export interface LibApi {
  get(): Promise<LibView>; addFolder(): Promise<LibView>; removeFolder(d: string): Promise<LibView>; rescan(): Promise<boolean>;
  favorite(id: string, on: boolean): Promise<boolean>; playlist(op: string, a?: unknown, b?: unknown): Promise<unknown>; played(id: string): Promise<void>;
  analysis(id: string, version?: number): Promise<unknown>; saveAnalysis(id: string, a: unknown): Promise<boolean>; saveLoudness(id: string, l: { lufs: number; peak: number } | null): Promise<boolean>; analysisFailed(id: string, why?: string): Promise<void>;
  /** analyse these songs again (their cached analysis dropped), first in the queue */ reanalyze(ids: string[] | 'all'): Promise<boolean>;
  /** a cached analysis found sound: not checked again until a new version */ verified(id: string, version: number): Promise<void>;
  /** the songs whose cached analysis of this version has not been checked yet */ unverified(version: number): Promise<string[]>;
  /** the caches (rhythm, loudness, thumbnails) cleared; every song is analysed again */ clearCaches(): Promise<boolean>;
  /** everything Cadenza keeps — library, songs' data, caches, settings — removed, and the app restarted */ resetAll(): Promise<void>;
  nextAnalysis(version: number): Promise<{ id: string; only?: 'loudness' } | null>; prioritize(ids: string[]): Promise<void>;
  song(id: string): Promise<SongData | null>; setSong(id: string, d: SongData): Promise<boolean>;
  lyrics(id: string): Promise<{ source: 'lrc' | 'embedded'; text: string } | null>; writeLyrics(id: string, t: string, target?: 'tag' | 'lrc'): Promise<{ ok: boolean; target?: 'tag' | 'lrc'; why?: string }>; importLyricsFile(): Promise<string | null>;
  searchLyrics(q: object): Promise<LyricsFound[]>; searchMeta(q: object): Promise<MetaFound[]>; applyMeta(id: string, m: MetaFound): Promise<boolean>; clearMeta(id: string, part: 'tags' | 'cover' | 'all'): Promise<boolean>; instrumental(id: string, on: boolean): Promise<boolean>;
  editMeta(id: string, f: object): Promise<boolean>; searchCovers(q: object): Promise<CoverFound[]>; setCover(id: string, how: { url?: string; file?: boolean; reset?: boolean }): Promise<boolean>;
  bindMv(id: string): Promise<{ name: string; offset: number } | null>;
  onChanged(f: (v: LibView) => void): Off; onProgress(f: (p: { phase: string; done: number; total: number }) => void): Off;
  onAnalysis(f: (p: { done: number; total: number }) => void): Off; onWake(f: () => void): Off;
}
export interface AudioApi { state(): Promise<any>; cmd(o: Record<string, unknown>): Promise<boolean>; onEvent(f: (e: any) => void): Off }
/** The rhythm engine's networks run natively (electron/infer.cjs): their state, the models' download, one pass. */
export interface InferApi {
  status(): Promise<{ runtime: boolean; models: boolean; ep: string | null; downloading: boolean; size: number }>;
  download(): Promise<{ ok: boolean; why?: string }>; onProgress(f: (k: number) => void): Off;
  run(op: 'beat', a: { spect: Float32Array }): Promise<{ beat: Float32Array; downbeat: Float32Array }>;
  run(op: 'separate', a: { left: Float32Array; right: Float32Array }): Promise<{ left: Float32Array; right: Float32Array }[]>;
}

const W = (typeof window !== 'undefined' ? window : {}) as any;
export const D: DesktopApi | null = W.cadenzaDesktop ?? null;
export const Lib: LibApi | null = W.cadenzaLib ?? null;
export const AudioOut: AudioApi | null = W.cadenzaAudio ?? null;
export const Infer: InferApi | null = W.cadenzaInfer ?? null;
export const desktop = !!D;

export const coverUrl = (key: string | null | undefined, full = false) => (key ? `cadenza://${full ? 'cover' : 'thumb'}/${key}` : '');
export const mediaUrl = (id: string) => `cadenza://media/${id}`;

/* ---------- files ---------- */
/** In a browser a finished file is offered as a download. */
export async function offerFile(filename: string, blob: Blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
/** Desktop: ask for a path first, then stream every write to it (positional, so the muxer can patch box sizes). */
export function pickSavePath(name: string, kind: 'mp4' | 'json') {
  if (!D) return Promise.resolve(null);
  return D.saveDialog({ defaultPath: name, filters: kind === 'mp4' ? [{ name: 'MP4', extensions: ['mp4'] }] : [{ name: 'Cadenza project', extensions: ['json'] }] });
}
export function fileSink(path: string) {
  let id: number | null = null; const d = D!;
  return {
    async write(data: Uint8Array, pos: number) { if (id == null) id = await d.openWrite(path); await d.write(id, data, pos); },
    async close() { if (id == null) id = await d.openWrite(path); const size = await d.close(id); return { path, size }; },
    async abort() { if (id != null) await d.abort(id); },
  };
}
export const slug = (s: string) => (s || 'cadenza').trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cadenza';
