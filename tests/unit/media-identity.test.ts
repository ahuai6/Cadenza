import { describe, expect, it } from 'vitest';
import { remoteTrackKey, type MediaLease, type MediaVariant, type RemoteTrackRef } from '../../src/core/media-identity';

describe('remote media identity', () => {
  const track: RemoteTrackRef = {
    provider: 'catalog-one',
    namespace: 'recording',
    id: '42',
    access: { kind: 'public' },
    availability: { storefront: 'us' },
  };

  it('separates platform, namespace and account while availability changes independently', () => {
    const privateTrack = (accountId: string) => ({ ...track, access: { kind: 'account' as const, accountId } });
    const distinct = [
      track,
      { ...track, provider: 'catalog-two' },
      { ...track, namespace: 'library' },
      privateTrack('a'),
      privateTrack('b'),
    ];
    expect(new Set(distinct.map(remoteTrackKey)).size).toBe(distinct.length);
    expect(remoteTrackKey({ ...track, availability: { storefront: 'jp' } })).toBe(remoteTrackKey(track));
  });

  it('describes one ALAC variant across different short-lived URLs and authorization generations', () => {
    const variant: MediaVariant = {
      id: 'original',
      track,
      tier: 'lossless',
      status: 'available',
      detected: { codec: 'alac', container: 'm4a', sampleRate: 44100, bits: 24, lossless: true },
    };
    const first: MediaLease = {
      variantId: variant.id,
      url: 'https://example.invalid/short-lived',
      expiresAt: 1000,
      generation: 1,
      access: track.access,
      permission: 'stream',
      ranges: 'bytes',
    };
    const second: MediaLease = { ...first, url: 'https://example.invalid/reissued', expiresAt: 2000, generation: 2 };
    expect(first.url).not.toBe(second.url);
    expect(first.variantId).toBe(second.variantId);
    expect(variant.detected?.codec).toBe('alac');
  });
});
