import type { ProviderCapability, RemoteTrackRef } from '../../core/media-identity';
import type { Settings } from '../bridge';

export type HallAppearance = Pick<Settings, 'theme' | 'tone' | 'lang' | 'uiFont'>;
export interface HallProvider {
  id: string;
  name: string;
  label?: string;
  capabilities: Record<ProviderCapability, 'unavailable' | 'public' | 'authorized'>;
}
export interface HallSnapshot {
  providers: HallProvider[];
  accounts: { provider: string; id: string; name: string; state: 'connected' | 'expired' | 'disconnected' }[];
  ai: { id: string; name: string; auth: 'oauth' | 'api-key'; state: 'unavailable' }[];
  appearance: HallAppearance;
}
export interface HallTrack {
  ref: RemoteTrackRef;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  image?: string;
  preview: boolean;
}
export interface HallPage {
  rows: HallTrack[];
  more: boolean;
  syncedAt?: number;
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
export interface HallDownload {
  id: string;
  title: string;
  tier: HallTier;
  state: string;
  problem?: string;
  bytes: number;
  total: number;
}
interface HallApi {
  read(): Promise<HallSnapshot | null>;
  downloads(): Promise<HallDownload[]>;
  downloadAdd(
    provider: string,
    input: { track: string; account: string; title: string; tier: HallTier; conflict: 'keep' | 'skip' },
  ): Promise<{ ok: true; task: HallDownload } | { ok: false; code: string }>;
  downloadAct(id: string, action: 'cancel' | 'retry'): Promise<boolean>;
  onDownloads(fn: (tasks: HallDownload[]) => void): () => void;
  account(
    provider: string,
    action: 'begin' | 'poll' | 'cancel' | 'logout',
    input?: object,
  ): Promise<{ ok: true; data: HallLogin } | { ok: false; code: string }>;
  playlists(
    provider: string,
    input: { account: string; id?: string; refresh?: boolean },
  ): Promise<{ ok: true; data: HallPage } | { ok: false; code: string; previous?: HallPage }>;
  catalog(provider: string, capability: HallCapability, input: object): Promise<HallResult>;
  cancel(provider: string, lane: 'browse' | 'search' | 'playlists'): Promise<void>;
  stopPreview(): Promise<void>;
  onPreview(fn: (preview: HallPreview | null) => void): () => void;
  window(op: 'min' | 'max' | 'close'): Promise<void>;
  onMaximized(fn: (value: boolean) => void): () => void;
  onAppearance(fn: (appearance: HallAppearance) => void): () => void;
}
export const hallApi = (window as Window & { cadenzaHall?: HallApi }).cadenzaHall;
