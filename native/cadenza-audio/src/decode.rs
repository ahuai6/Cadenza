// One song being read: a thread decodes it ahead into a queue of frames that are already in the output's layout (its
// channel count and rate), so the playback thread only copies. Samples are i32, left-justified: a 16-bit file is its
// samples shifted up by 16, a 24-bit file by 8, so handing them to a 24- or 32-bit device later is exact.
use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rubato::audioadapter_buffers::direct::SequentialSliceOfVecs;
use rubato::audioadapter_buffers::owned::InterleavedOwned;
use rubato::{Fft, FixedSync, Indexing, Resampler};
use symphonia::core::codecs::audio::{AudioDecoder, AudioDecoderOptions};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::units::{Time, TimeBase, Timestamp};

#[derive(Clone, Debug)]
pub struct SrcInfo {
    pub rate: u32,
    pub ch: usize,
    pub bits: Option<u32>, // None for lossy codecs (they decode to floating point)
    pub frames: Option<u64>,
    pub codec: String,
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
}

const AHEAD_SEC: f64 = 6.0; // how far ahead the queue is kept full

pub fn spawn(path: String, plan_for: Box<dyn FnOnce(&SrcInfo) -> Plan + Send>) -> Arc<Shared> {
    let sh = Arc::new(Shared {
        q: Mutex::new(Q { buf: VecDeque::new(), base: 0, eof: false, seek: None, gen: 0, info: None, plan: None, err: None, quit: false }),
        cv: Condvar::new(),
    });
    let s2 = sh.clone();
    std::thread::Builder::new()
        .name("decode".into())
        .spawn(move || {
            if let Err(e) = run(&path, plan_for, &s2) {
                let mut q = s2.q.lock().unwrap();
                q.err = Some(e);
                q.eof = true;
            }
        })
        .expect("decode thread");
    sh
}

struct Reader {
    fmt: Box<dyn FormatReader>,
    dec: Box<dyn AudioDecoder>,
    tid: u32,
    tb: Option<TimeBase>,
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
    let lossless = matches!(codec.as_str(), "flac" | "alac" | "wavpack") || codec.starts_with("pcm");
    let bits = if lossless { p.bits_per_sample.or(p.bits_per_coded_sample) } else { None };
    let info = SrcInfo { rate, ch, bits, frames: track.num_frames, codec };
    let tid = track.id;
    let tb = track.time_base;
    Ok((Reader { fmt, dec, tid, tb }, info))
}

fn run(path: &str, plan_for: Box<dyn FnOnce(&SrcInfo) -> Plan + Send>, sh: &Shared) -> Result<(), String> {
    let (mut rd, info) = open(path)?;
    let plan = plan_for(&info);
    {
        let mut q = sh.q.lock().unwrap();
        q.info = Some(info.clone());
        q.plan = Some(plan);
    }
    let cap = (AHEAD_SEC * plan.rate as f64) as usize * plan.ch;
    let mut conv = Convert::new(&info, plan);
    let mut sbuf: Vec<i32> = Vec::new();
    let mut gen = 0u64;
    let mut skip: u64 = 0; // source frames still to drop after a seek (seeks land on a packet boundary)
    let mut done = false;
    loop {
        // wait until there is room, a seek, or the end
        let seek = {
            let mut q = sh.q.lock().unwrap();
            loop {
                if q.quit {
                    return Ok(());
                }
                if q.seek.is_some() || (!done && q.buf.len() < cap) {
                    break;
                }
                q = sh.cv.wait_timeout(q, Duration::from_millis(100)).unwrap().0;
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
            let t = Time::try_from_secs_f64(target as f64 / info.rate as f64).unwrap_or(Time::ZERO);
            match rd.fmt.seek(SeekMode::Accurate, SeekTo::Time { time: t, track_id: Some(rd.tid) }) {
                Ok(s) => {
                    skip = target.saturating_sub(ts_frames(s.actual_ts, rd.tb, info.rate));
                }
                Err(_) => {
                    // a reader that cannot seek: start over and drop frames up to the target
                    let (r2, _) = open(path)?;
                    rd = r2;
                    skip = target;
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
        let pkt = match rd.fmt.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) | Err(SymErr::IoError(_)) | Err(SymErr::ResetRequired) => {
                // the end of the file: flush the resampler's tail
                let tail = conv.flush();
                push(sh, gen, tail, true);
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
        if s.is_empty() {
            continue;
        }
        let out = conv.push(s, sch);
        push(sh, gen, out, false);
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
}

impl Convert {
    fn new(info: &SrcInfo, plan: Plan) -> Self {
        let mut c = Convert { plan, rs: None, chunk: 1024, pend: vec![Vec::new(); plan.ch], trim: 0, tmp: Vec::new() };
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
