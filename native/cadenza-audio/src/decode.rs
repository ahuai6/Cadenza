// One song being read: a thread decodes it ahead into a queue of frames that are already in the output's layout (its
// channel count and rate), so the playback thread only copies. Samples are i32, left-justified: a 16-bit file is its
// samples shifted up by 16, a 24-bit file by 8, so handing them to a 24- or 32-bit device later is exact.
use std::collections::VecDeque;
use std::fs::File;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rubato::{FftFixedIn, Resampler};
use symphonia::core::audio::{SampleBuffer, SignalSpec};
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymErr;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

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
    dec: Box<dyn Decoder>,
    tid: u32,
    tb: Option<symphonia::core::units::TimeBase>,
}

fn open(path: &str) -> Result<(Reader, SrcInfo), String> {
    let file = File::open(path).map_err(|e| format!("open: {e}"))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let fo = FormatOptions { enable_gapless: true, ..Default::default() };
    let probed = symphonia::default::get_probe().format(&hint, mss, &fo, &MetadataOptions::default()).map_err(|e| format!("probe: {e}"))?;
    let fmt = probed.format;
    let track = fmt.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL).ok_or("no audio track")?;
    let p = &track.codec_params;
    let rate = p.sample_rate.ok_or("unknown sample rate")?;
    let ch = p.channels.map(|c| c.count()).unwrap_or(2).max(1);
    let reg = symphonia::default::get_codecs();
    let codec = reg.get_codec(p.codec).map(|d| d.short_name.to_string()).unwrap_or_else(|| "?".into());
    let lossless = matches!(codec.as_str(), "flac" | "alac" | "wavpack") || codec.starts_with("pcm");
    let bits = if lossless { p.bits_per_sample.or(p.bits_per_coded_sample) } else { None };
    let info = SrcInfo { rate, ch, bits, frames: p.n_frames, codec };
    let dec = reg.make(p, &DecoderOptions::default()).map_err(|e| format!("codec: {e}"))?;
    let tid = track.id;
    let tb = p.time_base;
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
    let mut sbuf: Option<SampleBuffer<i32>> = None;
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
            let t = Time::new(target / info.rate as u64, (target % info.rate as u64) as f64 / info.rate as f64);
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
            Ok(p) => p,
            Err(SymErr::IoError(_)) | Err(SymErr::ResetRequired) => {
                // the end of the file: flush the resampler's tail
                let tail = conv.flush();
                push(sh, gen, tail, true);
                done = true;
                continue;
            }
            Err(e) => return Err(format!("read: {e}")),
        };
        if pkt.track_id() != rd.tid {
            continue;
        }
        let decoded = match rd.dec.decode(&pkt) {
            Ok(b) => b,
            Err(SymErr::DecodeError(_)) => continue, // a damaged packet: skip it, as players do
            Err(e) => return Err(format!("decode: {e}")),
        };
        let spec: SignalSpec = *decoded.spec();
        let n = decoded.frames();
        if n == 0 {
            continue;
        }
        if sbuf.as_ref().map(|b| b.capacity() < n).unwrap_or(true) {
            sbuf = Some(SampleBuffer::<i32>::new(decoded.capacity() as u64, spec));
        }
        let sb = sbuf.as_mut().unwrap();
        sb.copy_interleaved_ref(decoded);
        let mut s = sb.samples();
        let sch = spec.channels.count().max(1);
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

fn ts_frames(ts: u64, tb: Option<symphonia::core::units::TimeBase>, rate: u32) -> u64 {
    match tb {
        Some(tb) => {
            let t = tb.calc_time(ts);
            t.seconds * rate as u64 + (t.frac * rate as f64).round() as u64
        }
        None => ts,
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
    rs: Option<FftFixedIn<f32>>,
    chunk: usize,
    pend: Vec<Vec<f32>>, // source frames waiting for a full resampler chunk, per output channel
    trim: usize,         // resampler delay still to drop
    tmp: Vec<i32>,
}

impl Convert {
    fn new(info: &SrcInfo, plan: Plan) -> Self {
        let mut c = Convert { plan, rs: None, chunk: 1024, pend: vec![Vec::new(); plan.ch], trim: 0, tmp: Vec::new() };
        if info.rate != plan.rate {
            c.rs = FftFixedIn::<f32>::new(info.rate as usize, plan.rate as usize, c.chunk, 2, plan.ch).ok();
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
            let r = self.rs.as_mut().unwrap().process(&chunk, None);
            if let Ok(o) = r {
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
        if let Ok(o) = self.rs.as_mut().unwrap().process_partial(Some(&rest), None) {
            self.emit(&o, &mut out);
        }
        // the delay line still holds the last output_delay frames
        for _ in 0..2 {
            if let Ok(o) = self.rs.as_mut().unwrap().process_partial::<Vec<f32>>(None, None) {
                self.emit(&o, &mut out);
            }
        }
        out
    }
    fn emit(&mut self, o: &[Vec<f32>], out: &mut Vec<i32>) {
        let n = o[0].len();
        let start = self.trim.min(n);
        self.trim -= start;
        for f in start..n {
            for ch in o.iter() {
                let x = (ch[f] as f64 * 2147483648.0).round().clamp(-2147483648.0, 2147483647.0);
                out.push(x as i32);
            }
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
