import type { ProviderCapability, RemoteTrackRef } from '../../core/media-identity';
import type { Settings } from '../bridge';

export type HallAppearance = Pick<Settings, 'theme' | 'tone' | 'lang' | 'uiFont'>;
export interface HallProvider {
  id: string;
  name: string;
  label?: string;
  configuration?: { officialCatalog?: boolean };
  capabilities: Record<ProviderCapability, 'unavailable' | 'public' | 'authorized'>;
}
export interface HallSnapshot {
  providers: HallProvider[];
  accounts: { provider: string; id: string; name: string; state: 'connected' | 'expired' | 'disconnected' }[];
  ai: { id: string; name: string; auth: 'oauth' | 'api-key'; state: 'unavailable' }[];
  appearance: HallAppearance;
  downloadPreference: HallDownloadPreference;
}
export interface HallTrack {
  ref: RemoteTrackRef;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  image?: string;
  preview: boolean;
  collection?: boolean;
  albumId?: string;
  catalogId?: string;
}
export interface HallPage {
  rows: HallTrack[];
  more: boolean;
  syncedAt?: number;
  source?: 'apple' | 'lyricsflow' | 'qq-smartbox';
}
export type HallCapability = 'search' | 'recommendations' | 'charts' | 'collection' | 'preview' | 'lyrics' | 'open';
export interface HallPreview {
  provider: string;
  id: string;
  title?: string;
  phase: 'playing' | 'buffering' | 'ended' | 'error';
  duration: number;
  position: number;
}
export interface HallLogin {
  id?: string;
  image?: string;
  expiresAt?: number;
  phase: string;
}
export type HallResult =
  | { ok: true; data?: HallPage; lyrics?: { text: string; format: string } }
  | { ok: false; code: string };
export type HallTier = 'standard' | 'high' | 'lossless';
export interface HallDownloadPreference {
  hasDirectory: boolean;
  tier?: HallTier;
  fields: string[];
  languageTracks: string[];
  lyric: 'native' | 'lrc' | 'none';
  lyricFile: 'embedded' | 'external' | 'both';
  naming: 'artist-title' | 'title' | 'numbered';
  conflict: 'keep' | 'skip';
  importTrack: boolean;
}
export interface HallDownload {
  id: string;
  title: string;
  tier: HallTier;
  state: string;
  problem?: string;
  bytes: number;
  total: number;
  saved?: boolean;
}
interface HallApi {
  read(): Promise<HallSnapshot | null>;
  downloads(): Promise<HallDownload[]>;
  downloadSettings(
    scope: string,
    command: 'read' | 'save' | 'inherit' | 'folder',
    input?: Partial<HallDownloadPreference>,
  ): Promise<HallDownloadPreference | null>;
  downloadVariants(
    provider: string,
    input: { track: string; account?: string; region?: string },
  ): Promise<{ ok: true; tiers: HallTier[] } | { ok: false; code: string }>;
  downloadAdd(
    provider: string,
    input: {
      track: string;
      account?: string;
      region?: string;
      title: string;
      tier: HallTier;
      conflict: 'keep' | 'skip';
      useDefault: boolean;
      remember: boolean;
      settings?: Partial<HallDownloadPreference>;
    },
  ): Promise<
    { ok: true; task: HallDownload; downloadPreference: HallDownloadPreference } | { ok: false; code: string }
  >;
  downloadReveal(id: string): Promise<boolean>;
  downloadAct(id: string, action: 'cancel' | 'retry'): Promise<boolean>;
  onDownloads(fn: (tasks: HallDownload[]) => void): () => void;
  account(
    provider: string,
    action: 'begin' | 'poll' | 'cancel' | 'logout' | 'import',
    input?: object,
  ): Promise<{ ok: true; data: HallLogin } | { ok: false; code: string }>;
  playlists(
    provider: string,
    input: { account: string; id?: string; refresh?: boolean },
  ): Promise<{ ok: true; data: HallPage } | { ok: false; code: string; previous?: HallPage }>;
  catalog(provider: string, capability: HallCapability, input: object): Promise<HallResult>;
  cancel(provider: string, lane: 'browse' | 'search' | 'playlists' | 'variants'): Promise<void>;
  stopPreview(): Promise<void>;
  onPreview(fn: (preview: HallPreview | null) => void): () => void;
  window(op: 'min' | 'max' | 'close'): Promise<void>;
  onMaximized(fn: (value: boolean) => void): () => void;
  onAppearance(fn: (appearance: HallAppearance) => void): () => void;
}
export const hallApi = (window as Window & { cadenzaHall?: HallApi }).cadenzaHall;
