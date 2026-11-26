/** Local library entry, independent of the file location and encoded content. */
export type TrackId = string;
export type AudioContentId = `audio-sha256-v1:${string}`;
export type MetadataRevision = number;
export type LyricsRevision = number;

export interface RemoteTrackRef {
  provider: string;
  namespace: string;
  id: string;
  access: { kind: 'public' } | { kind: 'account'; accountId: string };
  availability: { storefront?: string; regions?: string[] };
}

/** Availability changes over time. Namespaces may be region-specific if a provider scopes its IDs that way. */
export function remoteTrackKey(ref: RemoteTrackRef): string {
  return JSON.stringify([
    ref.provider,
    ref.namespace,
    ref.access.kind,
    ref.access.kind === 'account' ? ref.access.accountId : null,
    ref.id,
  ]);
}

export interface RecordingMatch {
  from: TrackId | RemoteTrackRef;
  to: RemoteTrackRef;
  evidence: { field: string; source: string; value: string }[];
  confidence: number;
  decision: 'candidate' | 'confirmed' | 'rejected';
  revision: number;
}

export interface MediaVariant {
  id: string;
  track: RemoteTrackRef;
  tier: string;
  status: 'unverified' | 'available' | 'unavailable' | 'restricted';
  detected?: {
    codec: string;
    container: string;
    sampleRate?: number;
    bits?: number;
    bitrate?: number;
    lossless?: boolean;
  };
  content?: AudioContentId;
}

/** Main-process runtime data. Persist the variant reference, never the lease. */
export interface MediaLease {
  variantId: string;
  url: string;
  expiresAt: number;
  generation: number;
  access: RemoteTrackRef['access'];
  permission: 'stream' | 'save';
  ranges: 'unknown' | 'bytes' | 'unsupported';
}

export type ProviderCapability =
  | 'search'
  | 'account'
  | 'playlists'
  | 'collection'
  | 'recommendations'
  | 'charts'
  | 'lyrics'
  | 'preview'
  | 'download'
  | 'variants'
  | 'open';
export interface ProviderDescriptor {
  id: string;
  capabilities: Partial<Record<ProviderCapability, 'public' | 'authorized'>>;
}

export interface FieldOrigin {
  source: 'file' | 'manual' | RemoteTrackRef;
  confidence?: number;
  candidateRevision?: string;
}

export interface TrackSourceLink {
  track: TrackId;
  remote: RemoteTrackRef;
  variantId?: string;
  verifiedContent?: AudioContentId;
}
