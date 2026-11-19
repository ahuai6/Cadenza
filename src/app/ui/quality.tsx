// The sound of a file at a glance: a tier (by losslessness, then sample rate and bit depth; lossy files by their bit rate)
// and its format, as a small label — coloured in lists, translucent over the now-playing picture.
import { tx } from '../../i18n';
import type { Track } from '../bridge';
import s from './quality.module.css';

export type Tier = 'std' | 'hq' | 'lossless' | 'hires';
const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff', 'tta']);
const FMT: Record<string, string> = {
  flac: 'FLAC',
  wav: 'WAV',
  aiff: 'AIFF',
  aif: 'AIFF',
  ape: 'APE',
  wv: 'WavPack',
  dsf: 'DSD',
  dff: 'DSD',
  tta: 'TTA',
  mp3: 'MP3',
  ogg: 'OGG',
  oga: 'OGG',
  opus: 'Opus',
  aac: 'AAC',
  wma: 'WMA',
};
export function quality(
  t: Pick<Track, 'ext' | 'codec' | 'lossless' | 'sampleRate' | 'bits' | 'bitrate' | 'protected'>,
): { tier: Tier; fmt: string } | null {
  if (t.protected || !t.ext) return null;
  const ext = t.ext.toLowerCase(),
    alac = /alac/i.test(t.codec || '');
  const fmt = ext === 'm4a' || ext === 'mp4' ? (alac ? 'ALAC' : 'AAC') : FMT[ext] || ext.toUpperCase();
  const lossless = t.lossless || LOSSLESS.has(ext) || alac;
  const tier: Tier = lossless
    ? (t.sampleRate || 0) > 48000 || (t.bits || 0) > 16
      ? 'hires'
      : 'lossless'
    : (t.bitrate || 0) >= 256000 || (t.sampleRate || 0) > 48000
      ? 'hq'
      : 'std';
  return { tier, fmt };
}
const detail = (t: Pick<Track, 'sampleRate' | 'bits'>) =>
  (t.sampleRate ? `${+(t.sampleRate / 1000).toFixed(1)} kHz` : '') + (t.bits ? ` / ${t.bits}-bit` : '');
/** look: 'solid' (a coloured label), 'glass' (translucent, over the picture) or 'text' (the lists: a line of small capitals in
 *  the tier's ink — "Hi-Res FLAC", "標準 MP3" — the rate and depth on hover) */
export function QualityTag({ t, look = 'solid' }: { t: Track; look?: 'solid' | 'glass' | 'text' }) {
  const q = quality(t);
  if (!q) return null;
  // (the lists: the tier and the format in words — "Hi-Res FLAC", "無損 ALAC" — the numbers on hover)
  if (look === 'text') {
    const lossy = q.tier === 'std' || q.tier === 'hq',
      sr = [detail(t), lossy && t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : ''].filter(Boolean).join(' · ');
    return (
      <span
        className={s.qt}
        data-q={q.tier}
        title={tx('q.title', { tier: tx('q.' + q.tier), fmt: q.fmt, sr, bits: '' })}
      >
        {tx('q.' + q.tier)} {q.fmt}
      </span>
    );
  }
  return (
    <span
      className={s.q}
      data-q={q.tier}
      data-look={look}
      title={tx('q.title', { tier: tx('q.' + q.tier), fmt: q.fmt, sr: detail(t), bits: '' })}
    >
      {tx('q.' + q.tier)}
      <i>{q.fmt}</i>
    </span>
  );
}
