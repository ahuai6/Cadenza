// The sound of a file at a glance: a tier (by losslessness, then sample rate and bit depth; lossy files by their bit rate)
// and its format, as a small label — coloured in lists, translucent over the now-playing picture.
import { tx } from '../../i18n';
import type { Track } from '../bridge';
import s from './quality.module.css';

export type Tier = 'std' | 'hq' | 'lossless' | 'hires';
const LOSSLESS = new Set(['flac', 'wav', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff', 'tta']);
const FMT: Record<string, string> = { flac: 'FLAC', wav: 'WAV', aiff: 'AIFF', aif: 'AIFF', ape: 'APE', wv: 'WavPack', dsf: 'DSD', dff: 'DSD', tta: 'TTA', mp3: 'MP3', ogg: 'OGG', oga: 'OGG', opus: 'Opus', aac: 'AAC', wma: 'WMA' };
export function quality(t: Pick<Track, 'ext' | 'codec' | 'lossless' | 'sampleRate' | 'bits' | 'bitrate' | 'protected'>): { tier: Tier; fmt: string } | null {
  if (t.protected || !t.ext) return null;
  const ext = t.ext.toLowerCase(), alac = /alac/i.test(t.codec || '');
  const fmt = ext === 'm4a' || ext === 'mp4' ? (alac ? 'ALAC' : 'AAC') : FMT[ext] || ext.toUpperCase();
  const lossless = t.lossless || LOSSLESS.has(ext) || alac;
  const tier: Tier = lossless ? ((t.sampleRate || 0) > 48000 || (t.bits || 0) > 16 ? 'hires' : 'lossless') : ((t.bitrate || 0) >= 256000 || (t.sampleRate || 0) > 48000 ? 'hq' : 'std');
  return { tier, fmt };
}
const detail = (t: Pick<Track, 'sampleRate' | 'bits'>) => (t.sampleRate ? `${+(t.sampleRate / 1000).toFixed(1)} kHz` : '') + (t.bits ? ` / ${t.bits}-bit` : '');
/** The sound in a few characters: "24/96" for a lossless file (bits / kHz), "320K" for a lossy one. */
const short = (t: Pick<Track, 'sampleRate' | 'bits' | 'bitrate'>, lossless: boolean) => lossless
  ? (t.bits || t.sampleRate ? `${t.bits || 16}/${Math.round((t.sampleRate || 44100) / 1000)}` : '') : (t.bitrate ? `${Math.round(t.bitrate / 1000)}K` : '');
/** look: 'solid' (a coloured label), 'glass' (translucent, over the picture) or 'text' (the lists: a line of small capitals in
 *  the tier's ink — "FLAC · 24/96", "MP3 · 320K") */
export function QualityTag({ t, look = 'solid' }: { t: Track; look?: 'solid' | 'glass' | 'text' }) {
  const q = quality(t); if (!q) return null;
  if (look === 'text') { const d = short(t, q.tier === 'lossless' || q.tier === 'hires');
    return <span className={s.qt} data-q={q.tier} title={tx('q.title', { tier: tx('q.' + q.tier), fmt: q.fmt, sr: detail(t), bits: '' })}>{q.fmt}{d ? ` · ${d}` : ''}</span>; }
  return <span className={s.q} data-q={q.tier} data-look={look} title={tx('q.title', { tier: tx('q.' + q.tier), fmt: q.fmt, sr: detail(t), bits: '' })}>{tx('q.' + q.tier)}<i>{q.fmt}</i></span>;
}
