// One song being read: a thread decodes it ahead into a queue of frames that are already in the output's layout (its
// channel count and rate), so the playback thread only copies. Samples are i32, left-justified: a 16-bit file is its
// samples shifted up by 16, a 24-bit file by 8, so handing them to a 24- or 32-bit device later is exact.
use std::collections::VecDeque;
use std::fs::File;
use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rubato::audioadapter_buffers::direct::SequentialSliceOfVecs;
use rubato::audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Indexing, Resampler};
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::audio::Channels;
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::{Time, TimeBase, Timestamp};

use crate::mp4gapless;

#[derive(Clone, Debug)]
pub struct SrcInfo {
    pub rate: u32,
    pub ch: usize,
    pub bits: Option<u32>, // Known valid bits of integer PCM, where the container reports them.
    pub frames: Option<u64>,
    pub codec: String,
    pub lossless: bool,
}

// what the decoder produces for the output
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plan {
    pub rate: u32,
    pub ch: usize,
}

pub struct Q {
    pub buf: VecDeque<i32>,
    pub base: i64, // output-frame position of the first frame in buf
    pub eof: bool,
    pub seek: Option<i64>, // a requested position in output frames, taken by the decoder
    pub gen: u64,
    pub info: Option<SrcInfo>,
    pub plan: Option<Plan>,
    pub err: Option<String>,
    pub quit: bool,
    pub closed: bool,
    pub refill_at: usize,
}

pub struct Shared {
    pub q: Mutex<Q>,
    pub cv: Condvar,
}

impl Shared {
    pub fn frames(q: &Q) -> usize {
        q.plan.map(|p| q.buf.len() / p.ch).unwrap_or(0)
    }
    // move the read position: the queue is emptied and refilled from there
    pub fn seek(&self, to: i64) {
        let mut q = self.q.lock().unwrap();
        q.buf.clear();
        q.base = to;
        q.eof = false;
        q.seek = Some(to.max(0));
        q.gen += 1;
        self.cv.notify_all();
    }
    pub fn quit(&self) {
        self.q.lock().unwrap().quit = true;
        self.cv.notify_all();
    }
    pub fn wait_closed(&self, timeout: std::time::Duration) -> bool {
        let q = self.q.lock().unwrap();
        let (q, _) = self.cv.wait_timeout_while(q, timeout, |q| !q.closed).unwrap();
        q.closed
    }
    pub fn closed(&self) -> bool {
        self.q.lock().unwrap().closed
    }
}

const AHEAD_SEC: f64 = 6.0; // how far ahead the queue is kept full

pub fn spawn(path: String, plan_for: Box<dyn FnOnce(&SrcInfo) -> Plan + Send>) -> Arc<Shared> {
    let sh = Arc::new(Shared {
        q: Mutex::new(Q { buf: VecDeque::new(), base: 0, eof: false, seek: None, gen: 0, info: None, plan: None, err: None, quit: false, closed: false, refill_at: 0 }),
        cv: Condvar::new(),
    });
    let s2 = sh.clone();
    std::thread::Builder::new()
        .name("decode".into())
        .spawn(move || {
            let result = run(&path, plan_for, &s2);
            let mut q = s2.q.lock().unwrap();
            if let Err(e) = result {
                q.err = Some(e);
                q.eof = true;
            }
            q.closed = true;
            s2.cv.notify_all();
        })
        .expect("decode thread");
    sh
}

struct Reader {
    fmt: Box<dyn FormatReader>,
    dec: Box<dyn AudioDecoder>,
    tid: u32,
    tb: Option<TimeBase>,
    start: Timestamp,
    channel_mask: u32,
    /** an MP4 track's priming and length (Symphonia leaves its edit list unapplied) */
    gapless: Option<mp4gapless::Gapless>,
}

impl Reader {
    fn seek_pcm(&mut self, first: u64, rate: u32) -> Result<u64, String> {
        let mp4 = self.fmt.format_info().short_name == "isomp4";
        let origin = if mp4 { ts_frames(self.start, self.tb, rate) } else { 0 };
        let target = first.checked_add(origin).ok_or("PCM seek overflow")?;
        let time = Time::try_from_secs_f64(target as f64 / rate as f64).ok_or("invalid PCM seek")?;
        let landed = self.fmt.seek(SeekMode::Accurate, SeekTo::Time { time, track_id: Some(self.tid) })
            .map_err(|e| format!("PCM seek: {e}"))?;
        let actual = ts_frames(landed.actual_ts, self.tb, rate);
        if mp4 && actual > target {
            return Err("PCM seek landed late".into());
        }
        Ok(target.saturating_sub(actual))
    }
}

fn open(path: &str) -> Result<(Reader, SrcInfo), String> {
    let file = File::open(path).map_err(|e| format!("open: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let fmt = symphonia::default::get_probe().probe(&hint, mss, FormatOptions::default(), MetadataOptions::default()).map_err(|e| format!("probe: {e}"))?;
    let track = fmt.default_track(TrackType::Audio).ok_or("no audio track")?;
    let p = track.codec_params.as_ref().and_then(|c| c.audio()).ok_or("no audio track")?;
    let rate = p.sample_rate.ok_or("unknown sample rate")?;
    let ch = p.channels.as_ref().map(|c| c.count()).unwrap_or(2).max(1);
    // (gapless: the decoder trims the encoder's delay and padding)
    let dec = symphonia::default::get_codecs().make_audio_decoder(p, &AudioDecoderOptions::default().gapless(true)).map_err(|e| format!("codec: {e}"))?;
    let codec = dec.codec_info().short_name.to_string();
    let integer = codec.starts_with("pcm_s") || codec.starts_with("pcm_u");
    let lossless = matches!(codec.as_str(), "flac" | "alac" | "wavpack") || integer || codec.starts_with("pcm_f");
    let bits = if codec == "alac" {
        use symphonia_common::apple::audio::alac::MagicCookie;
        p.extra_data.as_deref().and_then(|data| MagicCookie::read(data).ok()).map(|c| u32::from(c.bit_depth))
    } else if lossless && !codec.starts_with("pcm_f") {
        p.bits_per_sample.or(p.bits_per_coded_sample)
    } else { None };
    let gapless = if fmt.format_info().short_name == "isomp4" { mp4gapless::read(path, rate) } else { None };
    let frames = gapless.and_then(|g| g.length).or(track.num_frames);
    let info = SrcInfo { rate, ch, bits, frames, codec, lossless };
    let tid = track.id;
    let tb = track.time_base;
    let start = track.start_ts;
    let channel_mask = match p.channels.as_ref() {
        Some(Channels::Positioned(pos)) => u32::try_from(pos.bits()).unwrap_or(0),
        _ => 0,
    };
    Ok((Reader { fmt, dec, tid, tb, start, channel_mask, gapless }, info))
}

// The desktop serves this integer PCM as a virtual WAVE. Each request can seek independently,
// and blocking writes to the pipe bound decoding to what the consumer has requested.
pub fn alac_command(path: &str, range: Option<(u64, u64)>) -> Result<(), String> {
    let (mut rd, info) = open(path)?;
    if info.codec != "alac" { return Err("not an ALAC track".into()); }
    let frames = info.frames.filter(|n| *n > 0).ok_or("unknown ALAC frame count")?;
    let bits = info.bits.filter(|bits| matches!(bits, 16 | 20 | 24 | 32)).ok_or("unsupported ALAC bit depth")?;
    let width = bits.div_ceil(8) as usize;
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::with_capacity(64 * 1024, stdout.lock());
    let Some((first, mut count)) = range else {
        writeln!(out, "{}", serde_json::json!({
            "frames": frames, "rate": info.rate, "channels": info.ch, "bits": bits, "mask": rd.channel_mask
        })).map_err(|e| e.to_string())?;
        return out.flush().map_err(|e| e.to_string());
    };
    if first > frames || count > frames - first { return Err("invalid ALAC frame range".into()); }
    let mut skip = 0;
    if first > 0 && count > 0 {
        skip = rd.seek_pcm(first, info.rate)?;
        rd.dec.reset();
    }
    let mut samples = Vec::<i32>::new();
    let mut bytes = Vec::new();
    while count > 0 {
        let pkt = rd.fmt.next_packet().map_err(|e| format!("ALAC read: {e}"))?.ok_or("short ALAC stream")?;
        if pkt.track_id != rd.tid { continue; }
        let decoded = rd.dec.decode(&pkt).map_err(|e| format!("ALAC decode: {e}"))?;
        if decoded.spec().channels().count() != info.ch { return Err("ALAC channel layout changed".into()); }
        let drop = skip.min(decoded.frames() as u64);
        skip -= drop;
        let take = count.min(decoded.frames() as u64 - drop);
        if take == 0 { continue; }
        samples.resize(decoded.samples_interleaved(), 0);
        decoded.copy_to_slice_interleaved(&mut samples);
        bytes.clear();
        let from = drop as usize * info.ch;
        let to = from + take as usize * info.ch;
        for sample in &samples[from..to] {
            bytes.extend_from_slice(&sample.to_le_bytes()[4 - width..]);
        }
        out.write_all(&bytes).map_err(|e| e.to_string())?;
        count -= take;
    }
    out.flush().map_err(|e| e.to_string())
}

// One read of the media at its native sample rate, independent from the playback instance.
// A zero-sized block commits EOF. A broken pipe or a decode error never emits that marker.
pub fn analysis_pcm(path: &str) -> Result<(), String> {
    let (mut rd, info) = open(path)?;
    if info.rate < 8_000 || info.rate > 384_000 || info.ch > 32 {
        return Err("unsupported analysis PCM format".into());
    }
    let channels = info.ch.min(2);
    let mut out = std::io::BufWriter::with_capacity(64 * 1024, std::io::stdout().lock());
    let write_error = |e: std::io::Error| e.to_string();
    out.write_all(b"CDP1").map_err(write_error)?;
    out.write_all(&info.rate.to_le_bytes()).map_err(write_error)?;
    out.write_all(&(channels as u32).to_le_bytes()).map_err(write_error)?;
    let mut decoded_samples = Vec::<f32>::new();
    let mut output = Vec::with_capacity(4096 * channels * 4);
    // an MP4 track's priming is dropped and its padding left out, as playback does (media time, not stream time)
    let mut skip = rd.gapless.map_or(0, |g| g.delay) as usize;
    let mut left = rd.gapless.and_then(|g| g.length).map_or(usize::MAX, |n| n as usize);
    while let Some(packet) = rd.fmt.next_packet().map_err(|e| format!("analysis read: {e}"))? {
        if packet.track_id != rd.tid { continue; }
        if left == 0 { break; }
        let decoded = rd.dec.decode(&packet).map_err(|e| format!("analysis decode: {e}"))?;
        if decoded.spec().channels().count() != info.ch || decoded.spec().rate() != info.rate {
            return Err("analysis PCM format changed during decode".into());
        }
        decoded_samples.resize(decoded.samples_interleaved(), 0.0);
        decoded.copy_to_slice_interleaved(&mut decoded_samples);
        let frames = decoded_samples.len() / info.ch;
        let drop = skip.min(frames);
        skip -= drop;
        let take = (frames - drop).min(left);
        left -= take;
        output.clear();
        for frame in decoded_samples[drop * info.ch..(drop + take) * info.ch].chunks_exact(info.ch) {
            for sample in &frame[..channels] {
                output.extend_from_slice(&sample.to_le_bytes());
            }
            if output.len() == 4096 * channels * 4 {
                out.write_all(&(output.len() as u32).to_le_bytes()).map_err(write_error)?;
                out.write_all(&output).map_err(write_error)?;
                output.clear();
            }
        }
        if !output.is_empty() {
            out.write_all(&(output.len() as u32).to_le_bytes()).map_err(write_error)?;
            out.write_all(&output).map_err(write_error)?;
        }
    }
    out.write_all(&0u32.to_le_bytes()).map_err(write_error)?;
    out.flush().map_err(write_error)
}

// Standard playback: the song from `start` seconds, as stereo at its own sample rate (the page's player resamples
// continuously across songs, so a gapless join is not cut by two separate filters). The header is "CPL2", the rate,
// the channel count (always 2), the source's channels and valid bits (0 when unknown), the song's length and the
// first frame sent (u64 frames; length 0 when unknown). Then blocks of a byte length and interleaved f32 samples; a
// zero-sized block commits EOF. A blocked pipe holds the decoder within its read-ahead, so reading follows playback.
pub fn play_pcm(path: &str, start: f64) -> Result<(), String> {
    if !start.is_finite() || start < 0.0 {
        return Err("invalid playback position".into());
    }
    let sh = spawn(path.to_owned(), Box::new(|info: &SrcInfo| Plan { rate: info.rate, ch: 2 }));
    let finish = |result: Result<(), String>| {
        sh.quit();
        result
    };
    // The decoder publishes without notifying (the Hi-Fi thread polls its queue), so waits here are bounded polls.
    const POLL: Duration = Duration::from_millis(5);
    // A container the reader cannot make sense of can keep it probing: give up, and let the page try its own decoders.
    const PROBE_LIMIT: Duration = Duration::from_secs(3);
    let probing = std::time::Instant::now();
    // (the queue's lock is released before finish(), which takes it again to stop the decoder)
    let probed = {
        let mut q = sh.q.lock().unwrap();
        while q.info.is_none() && !q.closed && probing.elapsed() < PROBE_LIMIT {
            q = sh.cv.wait_timeout(q, POLL).unwrap().0;
        }
        match (&q.info, &q.err) {
            (Some(info), _) => Ok(info.clone()),
            (None, Some(err)) => Err(err.clone()),
            (None, None) if !q.closed => Err("probe timed out".to_string()),
            (None, None) => Err("no audio".to_string()),
        }
    };
    let info = match probed {
        Ok(info) => info,
        Err(error) => return finish(Err(error)),
    };
    if !(8_000..=768_000).contains(&info.rate) {
        return finish(Err("unsupported sample rate".into()));
    }
    let frames = info.frames.unwrap_or(0);
    let first = ((start * info.rate as f64).round() as u64).min(if frames > 0 { frames } else { u64::MAX });
    if first > 0 {
        // (anything decoded before this is dropped by the queue's generation)
        sh.seek(first as i64);
    }
    let stdout = std::io::stdout();
    let mut out = std::io::BufWriter::with_capacity(64 * 1024, stdout.lock());
    let mut header = Vec::with_capacity(40);
    header.extend_from_slice(b"CPL2");
    for value in [info.rate, 2, info.ch as u32, info.bits.unwrap_or(0)] {
        header.extend_from_slice(&value.to_le_bytes());
    }
    header.extend_from_slice(&frames.to_le_bytes());
    header.extend_from_slice(&first.to_le_bytes());
    if out.write_all(&header).and_then(|_| out.flush()).is_err() {
        return finish(Ok(()));
    }
    const BLOCK: usize = 4096 * 2;
    let mut samples = Vec::<i32>::with_capacity(BLOCK);
    let mut bytes = Vec::<u8>::with_capacity(BLOCK * 4);
    loop {
        let taken = {
            let mut q = sh.q.lock().unwrap();
            while q.buf.is_empty() && !q.eof && !q.closed {
                q = sh.cv.wait_timeout(q, POLL).unwrap().0;
            }
            if let Some(err) = q.err.clone() {
                Err(err)
            } else {
                let n = q.buf.len().min(BLOCK);
                samples.clear();
                samples.extend(q.buf.drain(..n));
                // the decoder waits for room: wake it once enough has been taken
                if q.refill_at != 0 && q.buf.len() < q.refill_at {
                    sh.cv.notify_all();
                }
                Ok(q.buf.is_empty() && (q.eof || q.closed))
            }
        };
        let eof = match taken {
            Ok(eof) => eof,
            Err(error) => return finish(Err(error)),
        };
        if !samples.is_empty() {
            bytes.clear();
            for &sample in &samples {
                bytes.extend_from_slice(&(sample as f32 * (1.0 / 2_147_483_648.0)).to_le_bytes());
            }
            let written = out
                .write_all(&(bytes.len() as u32).to_le_bytes())
                .and_then(|_| out.write_all(&bytes))
                .and_then(|_| out.flush());
            if written.is_err() {
                // the listener went on to something else
                return finish(Ok(()));
            }
        }
        if eof {
            let _ = out.write_all(&0u32.to_le_bytes()).and_then(|_| out.flush());
            return finish(Ok(()));
        }
    }
}

fn run(path: &str, plan_for: Box<dyn FnOnce(&SrcInfo) -> Plan + Send>, sh: &Shared) -> Result<(), String> {
    let (mut rd, info) = open(path)?;
    let plan = plan_for(&info);
    {
        let mut q = sh.q.lock().unwrap();
        q.info = Some(info.clone());
        q.plan = Some(plan);
    }
    let per_second = plan.rate as usize * plan.ch;
    let cap = ((AHEAD_SEC * per_second as f64) as usize).min(4 * 1024 * 1024).max(per_second / 2);
    let mut conv = Convert::new(&info, plan);
    let mut sbuf: Vec<i32> = Vec::new();
    let mut gen = 0u64;
    // source frames still to drop: the encoder's priming, or the rest of a packet after a seek (seeks land on a packet
    // boundary); `at` is the next frame's position in the music, and `limit` where the music ends
    let delay = rd.gapless.map_or(0, |g| g.delay);
    let limit = rd.gapless.and_then(|g| g.length);
    let mut skip: u64 = delay;
    let mut at: u64 = 0;
    let mut done = false;
    // (test hook: hold the decoder once, after 0.7 s of output; `stall-decoder-file=` limits it to matching paths)
    let mut stall = std::env::var("CADENZA_AUDIO_FAKE").ok().and_then(|s| {
        let only = s.split(';').find_map(|kv| kv.strip_prefix("stall-decoder-file="));
        if only.is_some_and(|name| !path.contains(name)) { return None; }
        s.split(';').find_map(|kv| kv.strip_prefix("stall-decoder-ms=")?.parse::<u64>().ok())
    });
    let mut produced = 0usize;
    loop {
        // wait until there is room, a seek, or the end
        let seek = {
            let mut q = sh.q.lock().unwrap();
            loop {
                if q.quit {
                    return Ok(());
                }
                let threshold = if q.refill_at != 0 { q.refill_at } else { cap };
                if q.seek.is_some() || (!done && q.buf.len() < threshold) {
                    q.refill_at = 0;
                    break;
                }
                q.refill_at = if done { 0 } else { cap - per_second.min(cap) / 4 };
                q = sh.cv.wait(q).unwrap();
            }
            let s = q.seek.take();
            if s.is_some() {
                gen = q.gen;
            }
            s
        };
        if let Some(to) = seek {
            // output frames → source frames
            let target = (to as f64 * info.rate as f64 / plan.rate as f64).round() as u64;
            // Symphonia 0.6.1 can seek its MP4 sample index after EOF, but its atom reader has
            // no pending atom left to service the first packet. Reopen only the exhausted reader.
            if done && rd.fmt.format_info().short_name == "isomp4" {
                (rd, _) = open(path)?;
            }
            at = target;
            match rd.seek_pcm(target + delay, info.rate) {
                Ok(frames) => skip = frames,
                Err(_) => {
                    // a reader that cannot seek: start over and drop frames up to the target
                    let (r2, _) = open(path)?;
                    rd = r2;
                    skip = target + delay;
                }
            }
            rd.dec.reset();
            conv.reset();
            done = false;
            continue;
        }
        if done {
            continue;
        }
        if produced >= (plan.rate as usize * plan.ch * 7 / 10) {
            if let Some(ms) = stall.take() {
                let q = sh.q.lock().unwrap();
                let gen = q.gen;
                drop(sh.cv.wait_timeout_while(q, Duration::from_millis(ms.min(4000)), |q| !q.quit && q.gen == gen).unwrap());
                continue;
            }
        }
        let pkt = match rd.fmt.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) | Err(SymErr::ResetRequired) => {
                // the end of the file: flush the resampler's tail
                let tail = conv.flush();
                push(sh, gen, tail, true);
                done = true;
                continue;
            }
            Err(SymErr::IoError(ref error)) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
                push(sh, gen, conv.flush(), true);
                done = true;
                continue;
            }
            Err(e) => return Err(format!("read: {e}")),
        };
        if pkt.track_id != rd.tid {
            continue;
        }
        let decoded = match rd.dec.decode(&pkt) {
            Ok(b) => b,
            Err(SymErr::DecodeError(_)) => continue, // a damaged packet: skip it, as players do
            Err(e) => return Err(format!("decode: {e}")),
        };
        let n = decoded.frames();
        if n == 0 {
            continue;
        }
        let sch = decoded.spec().channels().count().max(1);
        sbuf.resize(decoded.samples_interleaved(), 0);
        decoded.copy_to_slice_interleaved(&mut sbuf);
        let mut s = &sbuf[..];
        if skip > 0 {
            let drop = (skip as usize).min(n);
            skip -= drop as u64;
            s = &s[drop * sch..];
        }
        let mut ending = false;
        if let Some(limit) = limit {
            let room = limit.saturating_sub(at) as usize;
            if s.len() / sch >= room {
                s = &s[..room * sch];
                ending = true;
            }
        }
        at += (s.len() / sch) as u64;
        if !s.is_empty() {
            let out = conv.push(s, sch);
            produced = produced.saturating_add(out.len());
            push(sh, gen, out, false);
        }
        if ending {
            // the encoder's padding after the music is not played
            push(sh, gen, conv.flush(), true);
            done = true;
        }
    }
}

fn ts_frames(ts: Timestamp, tb: Option<TimeBase>, rate: u32) -> u64 {
    match tb {
        Some(tb) => (tb.calc_time_saturating(ts).as_secs_f64() * rate as f64).round().max(0.0) as u64,
        None => ts.get().max(0) as u64,
    }
}

fn push(sh: &Shared, gen: u64, v: Vec<i32>, eof: bool) {
    let mut q = sh.q.lock().unwrap();
    if q.gen != gen {
        return; // a seek came in meanwhile: this belongs to the old position
    }
    q.buf.extend(v);
    if eof {
        q.eof = true;
    }
}

// channel layout and rate conversion from the source to the plan
struct Convert {
    plan: Plan,
    rs: Option<Fft<f32>>,
    chunk: usize,
    pend: Vec<Vec<f32>>, // source frames waiting for a full resampler chunk, per output channel
    trim: usize,         // resampler delay still to drop
    tmp: Vec<i32>,
    ratio: (u64, u64),   // output rate, source rate
    fed: u64,            // source frames given to the resampler since the last reset
    made: u64,           // output frames emitted since the last reset
}

impl Convert {
    fn new(info: &SrcInfo, plan: Plan) -> Self {
        let mut c = Convert {
            plan,
            rs: None,
            chunk: 1024,
            pend: vec![Vec::new(); plan.ch],
            trim: 0,
            tmp: Vec::new(),
            ratio: (plan.rate as u64, info.rate as u64),
            fed: 0,
            made: 0,
        };
        if info.rate != plan.rate {
            c.rs = Fft::<f32>::new(info.rate as usize, plan.rate as usize, c.chunk, plan.ch, FixedSync::Input).ok();
            c.reset();
        }
        c
    }
    fn reset(&mut self) {
        if let Some(r) = self.rs.as_mut() {
            r.reset();
            self.trim = r.output_delay();
        }
        for p in self.pend.iter_mut() {
            p.clear();
        }
        self.fed = 0;
        self.made = 0;
    }
    // src: interleaved frames with sch channels → interleaved output frames
    fn push(&mut self, src: &[i32], sch: usize) -> Vec<i32> {
        let n = src.len() / sch;
        let och = self.plan.ch;
        self.tmp.clear();
        self.tmp.resize(n * och, 0);
        for f in 0..n {
            map_frame(&src[f * sch..f * sch + sch], &mut self.tmp[f * och..f * och + och]);
        }
        if self.rs.is_none() {
            return std::mem::take(&mut self.tmp);
        }
        self.fed += n as u64;
        for f in 0..n {
            for c in 0..och {
                self.pend[c].push(self.tmp[f * och + c] as f32 * (1.0 / 2147483648.0));
            }
        }
        let mut out = Vec::new();
        while self.pend[0].len() >= self.chunk {
            let chunk: Vec<Vec<f32>> = self.pend.iter_mut().map(|p| p.drain(..self.chunk).collect()).collect();
            if let Some(o) = self.run(&chunk, self.chunk, None) {
                self.emit(&o, &mut out);
            }
        }
        out
    }
    fn flush(&mut self) -> Vec<i32> {
        let mut out = Vec::new();
        if self.rs.is_none() {
            return out;
        }
        let rest: Vec<Vec<f32>> = self.pend.iter_mut().map(std::mem::take).collect();
        let n = rest[0].len();
        if let Some(o) = self.run(&rest, n, Some(n)) {
            self.emit(&o, &mut out);
        }
        // the delay line still holds the last output_delay frames
        let empty = vec![Vec::new(); self.plan.ch];
        for _ in 0..2 {
            if let Some(o) = self.run(&empty, 0, Some(0)) {
                self.emit(&o, &mut out);
            }
        }
        // Flushing runs whole zero chunks through the filter. Keep exactly the frames the source's length converts to,
        // so a song ends on its last sample and the next one can follow it without a gap.
        let expected = (self.fed as u128 * self.ratio.0 as u128 / self.ratio.1 as u128) as u64;
        let surplus = self.made.saturating_sub(expected) as usize * self.plan.ch;
        out.truncate(out.len().saturating_sub(surplus));
        self.made = self.made.min(expected);
        out
    }
    // one resampler chunk (per-channel input of `frames` frames, `partial` when short of a chunk) → interleaved output
    fn run(&mut self, chunk: &[Vec<f32>], frames: usize, partial: Option<usize>) -> Option<Vec<f32>> {
        let rs = self.rs.as_mut()?;
        let och = self.plan.ch;
        let inp = SequentialSliceOfVecs::new(chunk, och, frames).ok()?;
        let mut o = InterleavedOwned::new(0.0f32, och, rs.output_frames_max());
        let idx = Indexing { partial_len: partial, ..Default::default() };
        let (_, got) = rs.process_into_buffer(&inp, &mut o, Some(&idx)).ok()?;
        let mut v = o.take_data();
        v.truncate(got * och);
        Some(v)
    }
    fn emit(&mut self, o: &[f32], out: &mut Vec<i32>) {
        let och = self.plan.ch;
        let start = self.trim.min(o.len() / och);
        self.trim -= start;
        self.made += (o.len() / och - start) as u64;
        for &x in &o[start * och..] {
            out.push((x as f64 * 2147483648.0).round().clamp(-2147483648.0, 2147483647.0) as i32);
        }
    }
}

// one frame from the source's channels into the output's
fn map_frame(s: &[i32], o: &mut [i32]) {
    let (sn, on) = (s.len(), o.len());
    if sn == on {
        o.copy_from_slice(s);
    } else if sn == 1 {
        o[0] = s[0];
        if on > 1 {
            o[1] = s[0];
        }
    } else if on == 1 {
        o[0] = ((s[0] as i64 + s[1] as i64) / 2) as i32;
    } else if sn == 2 {
        o[0] = s[0];
        o[1] = s[1];
    } else if on == 2 {
        // surround to stereo (FL FR C LFE SL SR …): centre and surrounds at -3 dB, scaled so a full-scale mix cannot clip
        let g = std::f64::consts::FRAC_1_SQRT_2;
        let c = if sn > 2 { s[2] as f64 * g } else { 0.0 };
        let (sl, sr) = if sn > 5 { (s[4] as f64 * g, s[5] as f64 * g) } else if sn > 4 { (s[3] as f64 * g, s[4] as f64 * g) } else { (0.0, 0.0) };
        let k = 1.0 / (1.0 + g + if sn > 4 { g } else { 0.0 });
        o[0] = ((s[0] as f64 + c + sl) * k) as i32;
        o[1] = ((s[1] as f64 + c + sr) * k) as i32;
    } else {
        let m = sn.min(on);
        o[..m].copy_from_slice(&s[..m]);
    }
}
