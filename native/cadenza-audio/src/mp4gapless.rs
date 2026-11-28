// Gapless information of an MP4 audio track: how many frames the encoder put before the music (its priming) and how
// many frames the music lasts. Symphonia 0.6.1 reads the edit list but does not apply it, so an AAC file otherwise
// plays its priming as silence at the start and its padding at the end, and a gapless album gains a gap at every join.
// Read from the first audio track's edit list (ISO/IEC 14496-12 8.6.6), or else from iTunes' iTunSMPB tag.
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Gapless {
    /// priming frames to drop, at the track's sample rate
    pub delay: u64,
    /// frames of music after the priming (None: to the end of the stream)
    pub length: Option<u64>,
}

struct Box_ {
    kind: [u8; 4],
    /// payload start and end (absolute offsets)
    start: u64,
    end: u64,
}

fn boxes(f: &mut File, from: u64, to: u64) -> Vec<Box_> {
    let mut out = Vec::new();
    let mut at = from;
    while at + 8 <= to {
        let mut head = [0u8; 8];
        if f.seek(SeekFrom::Start(at)).is_err() || f.read_exact(&mut head).is_err() {
            break;
        }
        let mut size = u32::from_be_bytes([head[0], head[1], head[2], head[3]]) as u64;
        let kind = [head[4], head[5], head[6], head[7]];
        let mut start = at + 8;
        if size == 1 {
            let mut large = [0u8; 8];
            if f.read_exact(&mut large).is_err() {
                break;
            }
            size = u64::from_be_bytes(large);
            start += 8;
        } else if size == 0 {
            size = to - at;
        }
        if size < start - at || at + size > to {
            break;
        }
        out.push(Box_ { kind, start, end: at + size });
        at += size;
    }
    out
}

fn bytes(f: &mut File, b: &Box_, max: usize) -> Option<Vec<u8>> {
    let len = ((b.end - b.start) as usize).min(max);
    let mut v = vec![0u8; len];
    f.seek(SeekFrom::Start(b.start)).ok()?;
    f.read_exact(&mut v).ok()?;
    Some(v)
}

fn be32(v: &[u8], at: usize) -> Option<u64> {
    Some(u32::from_be_bytes(v.get(at..at + 4)?.try_into().ok()?) as u64)
}
fn be64(v: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_be_bytes(v.get(at..at + 8)?.try_into().ok()?))
}

/// timescale of an mvhd or mdhd payload
fn timescale(v: &[u8]) -> Option<u64> {
    match v.first()? {
        0 => be32(v, 12),
        1 => be32(v, 20),
        _ => None,
    }
}

/// The first edit that plays media: (segment duration in the movie's timescale, media time in the track's)
fn edit(v: &[u8]) -> Option<(u64, u64)> {
    let version = *v.first()?;
    let count = be32(v, 4)? as usize;
    let mut at = 8;
    for _ in 0..count {
        let (duration, media) = if version == 1 {
            (be64(v, at)?, be64(v, at + 8)? as i64)
        } else {
            (be32(v, at)?, be32(v, at + 4)? as u32 as i32 as i64)
        };
        at += if version == 1 { 20 } else { 12 };
        // an empty edit (-1) inserts a pause before the media: not priming
        if media >= 0 {
            return Some((duration, media as u64));
        }
    }
    None
}

/// iTunSMPB: " 00000000 <priming> <padding> <length> …" in hexadecimal
fn smpb(text: &str) -> Option<Gapless> {
    let fields: Vec<u64> = text.split_whitespace().filter_map(|h| u64::from_str_radix(h, 16).ok()).collect();
    let (delay, length) = (*fields.get(1)?, *fields.get(3)?);
    (length > 0).then_some(Gapless { delay, length: Some(length) })
}

fn itunes(f: &mut File, ilst: &Box_) -> Option<Gapless> {
    for item in boxes(f, ilst.start, ilst.end) {
        if &item.kind != b"----" {
            continue;
        }
        let parts = boxes(f, item.start, item.end);
        let named = parts.iter().any(|p| {
            &p.kind == b"name" && bytes(f, p, 64).is_some_and(|v| v.len() > 4 && &v[4..] == b"iTunSMPB")
        });
        if !named {
            continue;
        }
        let data = parts.iter().find(|p| &p.kind == b"data")?;
        let v = bytes(f, data, 256)?;
        return smpb(std::str::from_utf8(v.get(8..)?).ok()?);
    }
    None
}

/// Gapless information for the file's first audio track, in frames at `rate`.
pub fn read(path: &str, rate: u32) -> Option<Gapless> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let moov = boxes(&mut f, 0, len).into_iter().find(|b| &b.kind == b"moov")?;
    let children = boxes(&mut f, moov.start, moov.end);
    let movie = timescale(&bytes(&mut f, children.iter().find(|b| &b.kind == b"mvhd")?, 64)?)?;
    for trak in children.iter().filter(|b| &b.kind == b"trak") {
        let parts = boxes(&mut f, trak.start, trak.end);
        let Some(mdia) = parts.iter().find(|b| &b.kind == b"mdia") else { continue };
        let media = boxes(&mut f, mdia.start, mdia.end);
        let handler = media.iter().find(|b| &b.kind == b"hdlr").and_then(|b| bytes(&mut f, b, 16));
        if handler.as_deref().and_then(|v| v.get(8..12)) != Some(b"soun") {
            continue;
        }
        let track = timescale(&bytes(&mut f, media.iter().find(|b| &b.kind == b"mdhd")?, 64)?)?;
        if movie == 0 || track == 0 {
            return None;
        }
        let edits = parts
            .iter()
            .find(|b| &b.kind == b"edts")
            .map(|edts| boxes(&mut f, edts.start, edts.end))
            .and_then(|e| e.into_iter().find(|b| &b.kind == b"elst"))
            .and_then(|elst| bytes(&mut f, &elst, 1 << 16))
            .and_then(|v| edit(&v));
        if let Some((duration, media_time)) = edits {
            let delay = (media_time as u128 * rate as u128 / track as u128) as u64;
            let length = (duration > 0).then(|| (duration as u128 * rate as u128 / movie as u128) as u64);
            if delay > 0 || length.is_some() {
                return Some(Gapless { delay, length });
            }
        }
        break;
    }
    // no usable edit list: iTunes' own tag
    let udta = children.iter().find(|b| &b.kind == b"udta")?;
    let meta = boxes(&mut f, udta.start, udta.end).into_iter().find(|b| &b.kind == b"meta")?;
    // meta is a full box: version and flags before its children
    let ilst = boxes(&mut f, meta.start + 4, meta.end).into_iter().find(|b| &b.kind == b"ilst")?;
    itunes(&mut f, &ilst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_itunes_tag() {
        let g = smpb(" 00000000 00000840 000001CA 00000000001CF4B4 00000000 00000000").unwrap();
        assert_eq!(g, Gapless { delay: 0x840, length: Some(0x1CF4B4) });
        assert!(smpb("garbage").is_none());
    }

    #[test]
    fn takes_the_first_edit_that_plays_media() {
        // version 0: an empty edit (-1), then 1000 ticks from media time 2112
        let mut v = vec![0, 0, 0, 0, 0, 0, 0, 2];
        v.extend_from_slice(&500u32.to_be_bytes());
        v.extend_from_slice(&(-1i32).to_be_bytes());
        v.extend_from_slice(&[0, 1, 0, 0]);
        v.extend_from_slice(&1000u32.to_be_bytes());
        v.extend_from_slice(&2112i32.to_be_bytes());
        v.extend_from_slice(&[0, 1, 0, 0]);
        assert_eq!(edit(&v), Some((1000, 2112)));
    }
}
