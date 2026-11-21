// Playback: one thread owns the device and the current song, and keeps the device's buffer topped up.
//
// What keeps it clean and safe:
// - starts and seeks wait for a bounded prebuffer; starvation returns to buffering
// - a next-track candidate can decode ahead within the same per-decoder budget
// - a working device is reused for a matching format; a freshly opened exclusive stream has a 300 ms lock period
// - every stop, pause, seek or song change fades the music out over 6 ms first, and a resume or seek fades it in, so no
//   transition cuts a waveform mid-swing (clicks and pops); a song started from its beginning is not faded at all
// - volume changes glide over 20 ms; the gain goes above 1 only for the volume balance's boost (kept within the song's
//   own headroom by the page), and every sample is clamped
// - fixed-volume balance uses endpoint hardware gain where supported, otherwise software gain can be requested
// - integer PCM segments are marked exact only for a matching exclusive rate and channel layout, sufficient device
//   precision and unity software gain without a fade
// - samples are only rounded to fewer bits with TPDF dither, and only where bits would really be lost
use std::collections::VecDeque;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::clock::StreamClock;
use crate::decode::{self, Plan, Shared, SrcInfo};
use crate::output::{self, Backend, Caps, Format, SFmt, Stream, StreamFailure};
use crate::proto::{emit, Cmd};

struct Track {
    id: Arc<str>,
    path: String,
    sh: Arc<Shared>,
    seq: u64,
    ready: bool,
    failed: bool,
}
impl Drop for Track {
    fn drop(&mut self) {
        self.sh.quit();
    }
}

type Closing = Vec<(u64, Arc<Shared>)>;
fn replace_track(slot: &mut Option<Track>, next: Option<Track>, closing: &mut Closing) {
    if let Some(old) = std::mem::replace(slot, next) {
        let reader = old.sh.clone();
        let seq = old.seq;
        drop(old);
        if !reader.closed() { closing.push((seq, reader)); }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum St {
    Idle,
    Waiting, // started, waiting for enough decoded audio (and the device)
    Playing,
    Paused,
}
#[derive(Debug)]
enum Pending {
    Pause,
    Seek(Start),
    Swap,
    Stop,
    Underrun,
}
struct Mark {
    dev: u64,
    len: u64,
    pos: i64,
    run: bool,
    id: Option<Arc<str>>,
    seq: u64,
    run_id: u64,
    eof: bool,
    exact: bool,
}
type Start = (f64, Option<f64>, u64);

const FADE_S: f64 = 0.006;
const GLIDE_S: f64 = 0.02;
const LOCK_S: f64 = 0.3; // silence after opening the device in exclusive mode, for the DAC to lock
const START_S: f64 = 0.5; // decoded ahead before a song may start
const RESUME_S: f64 = 0.25; // … and before a seek or resume may

pub struct Player {
    be: Box<dyn Backend>,
    dev: Option<String>,
    endpoint: Option<String>,
    excl: bool,
    force_shared: bool,
    release_after: f64,
    caps: Option<Arc<Caps>>,
    out: Option<Box<dyn Stream>>,
    ofmt: Option<Format>,
    started: bool,
    cur: Option<Track>,
    incoming: Option<Track>,
    next: Option<Track>,
    closing: Closing,
    queued_load: Option<(String, String, u64)>,
    st: St,
    want: Option<Start>,
    run_id: u64,
    fade_in: bool,
    run_origin: f64,
    head: i64,
    end: Option<i64>,
    env: f64,
    env_to: f64,
    pending: Option<Pending>,
    gain: f64,
    gain_to: f64,
    preroll: usize,
    dev_written: u64,
    marks: VecDeque<Mark>,
    epoch: u64,
    clock: StreamClock,
    heard: Option<(u64, u64, f64)>,
    last_hold: Option<(u64, u64, u64, i64)>,
    clock_source: Option<&'static str>,
    last_consumed: (u64, Instant),
    last_emit: Instant,
    ended: bool,
    reported_end: Option<(u64, u64)>,
    idle_at: Option<Instant>,
    rng: u64,
    bytes: Vec<u8>,
    frames: Vec<i32>,
    scheduling: Option<Scheduling>,
    hw_db: f64, // the volume balance asked for in the device's hardware volume (applied on the device in use)
    hw_applied: bool,
    on_default: bool,          // the chosen device is not there: the system's default plays in its place
    retry_at: Option<Instant>, // a device lost: when to try opening one again
    retries: usize,
    check_device_at: Instant,
    waiting_at: Instant,
}

struct Scheduling {
    #[cfg(windows)]
    mmcss: Option<windows::Win32::Foundation::HANDLE>,
    #[cfg(windows)]
    timer: bool,
}
impl Scheduling {
    fn begin() -> Self {
        #[cfg(windows)]
        unsafe {
            let timer = windows::Win32::Media::timeBeginPeriod(1) == 0;
            let mut index = 0;
            let mmcss = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(windows::core::w!("Pro Audio"), &mut index).ok();
            Self { mmcss, timer }
        }
        #[cfg(not(windows))]
        Self {}
    }
}
impl Drop for Scheduling {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if let Some(mmcss) = self.mmcss { let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(mmcss); }
            if self.timer { windows::Win32::Media::timeEndPeriod(1); }
        }
    }
}

pub fn run(rx: Receiver<Cmd>) {
    let mut p = Player {
        be: output::backend(),
        dev: None,
        endpoint: None,
        excl: true,
        force_shared: false,
        release_after: 20.0,
        caps: None,
        out: None,
        ofmt: None,
        started: false,
        cur: None,
        incoming: None,
        next: None,
        closing: Vec::new(),
        queued_load: None,
        st: St::Idle,
        want: None,
        run_id: 0,
        fade_in: false,
        run_origin: 0.0,
        head: 0,
        end: None,
        env: 1.0,
        env_to: 1.0,
        pending: None,
        gain: 1.0,
        gain_to: 1.0,
        preroll: 0,
        dev_written: 0,
        marks: VecDeque::new(),
        epoch: 0,
        clock: StreamClock::default(),
        heard: None,
        last_hold: None,
        clock_source: None,
        last_consumed: (0, Instant::now()),
        last_emit: Instant::now(),
        ended: false,
        reported_end: None,
        idle_at: None,
        rng: 0x9E3779B97F4A7C15,
        bytes: Vec::new(),
        frames: Vec::new(),
        scheduling: None,
        hw_db: 0.0,
        hw_applied: false,
        on_default: false,
        retry_at: None,
        retries: 0,
        check_device_at: Instant::now(),
        waiting_at: Instant::now(),
    };
    emit(json!({ "ev": "hello", "version": env!("CARGO_PKG_VERSION"), "clockProtocol": 1 }));
    loop {
        let decoding = p.queued_load.is_some() || p.want.is_some() || p.st == St::Waiting
            || p.cur.iter().chain(&p.next).chain(&p.incoming).any(|t| !t.ready && !t.failed);
        let wait = if p.out.is_some() {
            if p.st == St::Playing || decoding { 3 } else { 12 }
        } else if decoding { 10 } else { 200 };
        match rx.recv_timeout(Duration::from_millis(wait)) {
            Ok(c) => {
                if !p.handle(c) {
                    break;
                }
                for c in rx.try_iter().take(31) {
                    if !p.handle(c) {
                        p.hush();
                        p.close();
                        p.unhw();
                        return;
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        p.poll();
        p.report();
        p.fill();
    }
    p.hush();
    p.close();
    p.unhw();
}

/* ---------- choosing the output format for a song ---------- */
fn family(r: u32) -> u32 {
    if r % 44100 == 0 { 44100 } else if r % 48000 == 0 { 48000 } else { r }
}
// the device rate for a song: its own when the device takes it; otherwise the nearest rate above in the same family
// (an exact multiple), then any rate above, then the highest below in the family, then the highest of all
fn pick_rate(src: u32, rates: &[u32]) -> u32 {
    if rates.contains(&src) {
        return src;
    }
    let fam = family(src);
    let above_f = rates.iter().copied().filter(|&r| r > src && family(r) == fam).min();
    let above = rates.iter().copied().filter(|&r| r > src).min();
    let below_f = rates.iter().copied().filter(|&r| r < src && family(r) == fam).max();
    above_f.or(above).or(below_f).or(rates.iter().copied().max()).unwrap_or(src)
}
fn choose(caps: &Caps, excl: bool, info: &SrcInfo) -> Format {
    if excl && !caps.exclusive.is_empty() {
        let mut rates: Vec<u32> = caps.exclusive.iter().map(|x| x.0).collect();
        rates.dedup();
        let r = pick_rate(info.rate, &rates);
        let supported = |f: &SFmt| caps.exclusive.contains(&(r, *f));
        let f = SFmt::PREF.iter().copied().filter(supported)
            .find(|f| *f != SFmt::F32 && f.valid() >= info.bits.unwrap_or(24))
            .or_else(|| SFmt::PREF.iter().copied().filter(supported).max_by_key(|f| f.valid()))
            .unwrap_or(SFmt::I16);
        return Format { rate: r, ch: 2, fmt: f, exclusive: true };
    }
    caps.mix.unwrap_or(Format { rate: 48000, ch: 2, fmt: SFmt::F32, exclusive: false })
}
fn can_be_exact(info: &SrcInfo, f: &Format) -> bool {
    f.exclusive && f.rate == info.rate && f.fmt != SFmt::F32 && info.ch == f.ch && info.bits.is_some_and(|bits| bits <= f.fmt.valid())
}
fn describe(info: &SrcInfo, f: &Format) -> serde_json::Value {
    let bitperfect = can_be_exact(info, f);
    json!({
        "src": { "rate": info.rate, "bits": info.bits, "ch": info.ch, "codec": info.codec, "lossy": !info.lossless },
        "out": { "rate": f.rate, "bits": f.fmt.valid(), "containerBits": f.fmt.bytes() * 8, "fmt": f.fmt.name(), "ch": f.ch, "exclusive": f.exclusive, "resample": f.rate != info.rate, "bitperfect": bitperfect }
    })
}

impl Player {
    // the device to open: the chosen one while it is there, else the system's default (said once, and said again when
    // the chosen one is back)
    fn probe_endpoint(&mut self) -> Result<Caps, String> {
        let preferred = self.dev.as_deref().filter(|id| self.be.usable(id)).map(str::to_owned);
        let target = preferred.clone().or_else(|| self.be.default_id());
        let (target, caps) = match self.be.probe(target.as_deref()) {
            Ok(caps) => (target, caps),
            Err(e) if preferred.is_some() => {
                let default = self.be.default_id();
                if default == preferred { return Err(e); }
                let caps = self.be.probe(default.as_deref())?;
                (default, caps)
            }
            Err(e) => return Err(e),
        };
        let fallback = self.dev.is_some() && target != self.dev;
        if fallback != self.on_default {
            emit(json!({ "ev": "fallback", "code": if fallback { "default" } else { "back" } }));
            self.on_default = fallback;
        }
        self.endpoint = target;
        Ok(caps)
    }
    fn ensure_caps(&mut self) -> Option<Arc<Caps>> {
        if self.caps.is_none() {
            // Device recovery owns the backoff deadline.
            if self.retry_at.is_some_and(|deadline| Instant::now() < deadline) { return None; }
            match self.probe_endpoint() {
                Ok(c) => {
                    emit(json!({ "ev": "caps", "name": c.name, "exclusive": !c.exclusive.is_empty(), "why": c.why_not,
                        "rates": c.exclusive.iter().map(|x| x.0).fold(Vec::<u32>::new(), |mut v, r| { if !v.contains(&r) { v.push(r) } v }),
                        "mix": c.mix.map(|m| m.rate) }));
                    self.caps = Some(Arc::new(c));
                    self.retry_at = None;
                }
                Err(e) => {
                    if self.st == St::Waiting && self.cur.is_some() { self.retry(e); }
                    return None;
                }
            }
        }
        self.caps.clone()
    }
    fn excl_now(&self) -> bool {
        self.excl && !self.force_shared
    }
    fn decoder_slot(&mut self) -> bool {
        self.closing.retain(|(_, reader)| !reader.closed());
        self.closing.len() < 6
    }
    fn spawn(&mut self, id: &str, path: &str, seq: u64) -> Option<Track> {
        if !self.decoder_slot() { return None; }
        let caps = self.ensure_caps()?;
        let excl = self.excl_now();
        let plan = Box::new(move |info: &SrcInfo| {
            let f = choose(&caps, excl, info);
            Plan { rate: f.rate, ch: f.ch }
        });
        Some(Track { id: Arc::from(id), path: path.to_string(), sh: decode::spawn(path.to_string(), plan), seq, ready: false, failed: false })
    }
    fn playing_audibly(&self) -> bool {
        self.st == St::Playing && !self.ended && self.out.is_some() && self.env > 0.0
    }

    // the volume balance in the device's hardware volume, reported either way (the page shows whether it applies)
    fn hw(&mut self, db: f64) {
        self.hw_db = db;
        if self.out.is_none() { return; }
        match self.be.hw_gain(self.endpoint.as_deref(), db) {
            Some((got, level)) => {
                self.hw_applied = got.abs() >= 0.05;
                emit(json!({ "ev": "hwvol", "supported": true, "db": got, "level": level }));
            }
            None => {
                emit(json!({ "ev": "hwvol", "supported": false }));
            }
        }
    }

    // leaving (the app quits, or closes this player): the device gets its own level back
    fn unhw(&mut self) {
        if self.hw_applied {
            if let Some((db, level)) = self.be.hw_gain(self.endpoint.as_deref(), 0.0) {
                emit(json!({ "ev": "hwvol", "supported": true, "db": db, "level": level }));
            }
            self.hw_applied = false;
        }
    }

    fn handle(&mut self, c: Cmd) -> bool {
        match c {
            Cmd::Devices => emit(json!({ "ev": "devices", "list": self.be.devices() })),
            Cmd::Config { device, mode, release_after, ticket } => {
                let dev = device.filter(|d| !d.is_empty());
                let excl = mode.as_deref() != Some("shared");
                if let Some(r) = release_after { self.release_after = r.max(1.0); }
                if self.dev == dev && self.excl == excl && self.caps.is_some() {
                    if let Some(ticket) = ticket { emit(json!({ "ev": "configured", "ticket": ticket, "ok": true })); }
                    return true;
                }
                self.hush();
                self.close();
                self.dev = dev;
                self.excl = excl;
                self.force_shared = false;
                self.caps = None;
                self.queued_load = None;
                self.endpoint = None;
                self.retry_at = None;
                self.retries = 0;
                self.heard = None;
                replace_track(&mut self.cur, None, &mut self.closing);
                replace_track(&mut self.incoming, None, &mut self.closing);
                replace_track(&mut self.next, None, &mut self.closing);
                self.st = St::Idle;
                self.want = None;
                self.pending = None;
                let ok = self.ensure_caps().is_some();
                emit(json!({ "ev": "reset" }));
                if let Some(ticket) = ticket { emit(json!({ "ev": "configured", "ticket": ticket, "ok": ok })); }
            }
            Cmd::Load { id, path, next, seq } => {
                if next {
                    if self.queued_load.is_some() || !self.decoder_slot() { return true; }
                    if self.next.as_ref().map(|t| &*t.id == id.as_str()).unwrap_or(false) || self.cur.as_ref().map(|t| &*t.id == id.as_str()).unwrap_or(false) {
                        return true;
                    }
                    let track = self.spawn(&id, &path, seq);
                    replace_track(&mut self.next, track, &mut self.closing);
                    return true;
                }
                self.queued_load = None;
                if !self.decoder_slot() {
                    // Supersede the previous request and wait for a retired reader's slot.
                    // The current file cannot keep playing while its replacement is queued.
                    self.handle(Cmd::Stop { seq: None });
                    self.queued_load = Some((id, path, seq));
                    return true;
                }
                // Keep a working fallback while it plays. Reconsider the preferred endpoint at a released load boundary.
                if self.on_default && self.out.is_none() && self.dev.as_deref().is_some_and(|id| self.be.usable(id)) {
                    self.caps = None;
                    self.force_shared = false;
                    replace_track(&mut self.next, None, &mut self.closing);
                }
                let t = match self.next.take() {
                    Some(mut t) if &*t.id == id.as_str() => {
                        t.seq = seq;
                        t.ready = false; // announced again for this load
                        Some(t)
                    }
                    other => {
                        self.next = other;
                        self.spawn(&id, &path, seq)
                    }
                };
                let Some(t) = t else {
                    emit(json!({ "ev": "error", "code": "decode", "id": id, "seq": seq, "msg": "output unavailable" }));
                    return true;
                };
                // the music cut by a song change also fades out
                self.want = None;
                if self.playing_audibly() {
                    replace_track(&mut self.incoming, Some(t), &mut self.closing);
                    self.env_to = 0.0;
                    self.pending = Some(Pending::Swap);
                } else {
                    replace_track(&mut self.incoming, None, &mut self.closing);
                    self.pending = None;
                    replace_track(&mut self.cur, Some(t), &mut self.closing);
                    self.run_id = 0;
                    self.ended = false;
                    self.st = St::Idle;
                    self.idle_at = Some(Instant::now());
                }
                emit(json!({ "ev": "loading", "id": id, "seq": seq }));
            }
            Cmd::Play { pos, end, seq, run } => {
                let target = self.incoming.as_ref().or(self.cur.as_ref());
                if seq.is_some() && seq != target.map(|t| t.seq) { return true; }
                if let Some(t) = target.filter(|t| t.failed) {
                    emit(json!({ "ev": "error", "code": "decode", "seq": t.seq, "runId": run, "msg": "decoder failed" }));
                    return true;
                }
                self.retries = 0;
                self.retry_at = None;
                self.waiting_at = Instant::now();
                if matches!(self.pending, Some(Pending::Swap)) {
                    self.want = Some((pos, end, run));
                } else if self.playing_audibly() {
                    self.pending = Some(Pending::Seek((pos, end, run)));
                    self.env_to = 0.0;
                } else {
                    self.pending = None;
                    self.want = Some((pos, end, run));
                    self.st = St::Waiting;
                }
            }
            Cmd::Pause { seq } => {
                if seq.is_some() && seq != self.incoming.as_ref().or(self.cur.as_ref()).map(|t| t.seq) {
                    return true;
                }
                self.want = None;
                if matches!(self.pending, Some(Pending::Swap)) {
                    // the swap still happens; nothing starts after it
                } else if self.playing_audibly() {
                    self.pending = Some(Pending::Pause);
                    self.env_to = 0.0;
                } else if self.st != St::Idle {
                    self.st = St::Paused;
                    self.idle_at = Some(Instant::now());
                }
            }
            Cmd::Stop { seq } => {
                if seq.is_none() || self.queued_load.as_ref().is_some_and(|(_, _, owner)| Some(*owner) == seq) {
                    self.queued_load = None;
                }
                if seq.is_some() && seq != self.incoming.as_ref().or(self.cur.as_ref()).map(|t| t.seq) {
                    return true;
                }
                self.want = None;
                replace_track(&mut self.incoming, None, &mut self.closing);
                if self.playing_audibly() {
                    self.pending = Some(Pending::Stop);
                    self.env_to = 0.0;
                } else {
                    replace_track(&mut self.cur, None, &mut self.closing);
                    self.pending = None;
                    self.st = St::Idle;
                    self.idle_at = Some(Instant::now());
                }
            }
            Cmd::Release => {
                self.queued_load = None;
                self.hush();
                self.close();
                self.want = None;
                self.pending = None;
                // the device goes back to others (the standard output): its own level with it
                if self.hw_db != 0.0 {
                    self.hw(0.0);
                }
                if self.st == St::Playing || self.st == St::Waiting {
                    self.st = St::Paused;
                }
            }
            Cmd::Closefile { ticket, seq } => {
                if self.queued_load.as_ref().is_some_and(|(_, _, owner)| *owner == seq) {
                    self.queued_load = None;
                }
                if Some(seq) == self.incoming.as_ref().or(self.cur.as_ref()).map(|t| t.seq) {
                    self.hush();
                    replace_track(&mut self.cur, None, &mut self.closing);
                    replace_track(&mut self.incoming, None, &mut self.closing);
                    self.want = None;
                    self.pending = None;
                    self.st = St::Idle;
                    self.idle_at = Some(Instant::now());
                }
                let deadline = Instant::now() + Duration::from_secs(1);
                let ok = self.closing.iter().filter(|(id, _)| *id == seq)
                    .all(|(_, reader)| reader.wait_closed(deadline.saturating_duration_since(Instant::now())));
                emit(json!({ "ev": "barrier", "ticket": ticket, "ok": ok }));
            }
            Cmd::Barrier { ticket } => emit(json!({ "ev": "barrier", "ticket": ticket })),
            Cmd::Clearnext => replace_track(&mut self.next, None, &mut self.closing),
            Cmd::Gain { g } => {
                // (above 1 only for the volume balance's boost, which keeps within the song's own headroom)
                self.gain_to = if g.is_finite() { g.clamp(0.0, 4.0) } else { 0.0 };
            }
            Cmd::Hwgain { db } => {
                let db = if db.is_finite() { db.clamp(-24.0, 12.0) } else { 0.0 };
                self.hw(db);
            }
            Cmd::Quit => {
                return false;
            }
        }
        true
    }

    // apply what was waiting for the fade-out to finish
    fn apply(&mut self, p: Pending) {
        match p {
            Pending::Pause => {
                self.st = St::Paused;
                self.idle_at = Some(Instant::now());
            }
            Pending::Seek(start) => {
                self.want = Some(start);
                self.st = St::Waiting;
            }
            Pending::Swap => {
                replace_track(&mut self.cur, self.incoming.take(), &mut self.closing);
                self.run_id = 0;
                self.ended = false;
                self.st = if self.want.is_some() { St::Waiting } else { St::Idle };
                self.idle_at = Some(Instant::now());
            }
            Pending::Stop => {
                replace_track(&mut self.cur, None, &mut self.closing);
                self.st = St::Idle;
                self.idle_at = Some(Instant::now());
            }
            Pending::Underrun => {
                self.st = St::Waiting;
                self.waiting_at = Instant::now();
                self.fade_in = true;
                emit(json!({ "ev": "underrun" }));
            }
        }
    }

    fn poll(&mut self) {
        if self.queued_load.is_some() && self.decoder_slot() {
            if let Some((id, path, seq)) = self.queued_load.take() {
                self.handle(Cmd::Load { id, path, seq, next: false });
            }
        }
        if self.st == St::Waiting && self.waiting_at.elapsed() >= Duration::from_secs(10) {
            let id = self.want.take().map(|(_, _, id)| id).unwrap_or(self.run_id);
            self.st = St::Paused;
            self.idle_at = Some(Instant::now());
            emit(json!({ "ev": "error", "code": "device", "kind": "start-timeout", "seq": self.cur.as_ref().map(|t| t.seq), "runId": id, "epoch": self.epoch, "msg": "output-start-timeout" }));
        }
        if self.out.is_some() && (self.dev.is_none() || self.on_default) && self.check_device_at.elapsed() >= Duration::from_secs(1) {
            self.check_device_at = Instant::now();
            if let Some(default) = self.be.default_id() {
                if self.endpoint.as_deref() != Some(default.as_str()) {
                    self.lost(StreamFailure::new("default-changed", "default endpoint changed"));
                }
            }
        }
        // song states: errors, decoded far enough ahead
        for which in 0..3 {
            let t = match which {
                0 => self.cur.as_mut(),
                1 => self.next.as_mut(),
                _ => self.incoming.as_mut(),
            };
            let Some(t) = t else { continue };
            let q = t.sh.q.lock().unwrap();
            if let Some(e) = q.err.clone() {
                if !t.failed {
                    t.failed = true;
                    let seq = t.seq;
                    let id = t.id.clone();
                    drop(q);
                    if which != 1 { emit(json!({ "ev": "error", "code": "decode", "id": &*id, "seq": seq, "msg": e })); }
                }
                continue;
            }
            if t.ready {
                continue;
            }
            let (Some(info), Some(plan)) = (q.info.clone(), q.plan) else { continue };
            let have = Shared::frames(&q) as f64 / plan.rate as f64;
            if have >= START_S || q.eof {
                drop(q);
                t.ready = true;
                if which == 1 {
                    emit(json!({ "ev": "preloaded", "id": &*t.id }));
                } else if let Some(caps) = self.caps.clone() {
                    let f = choose(&caps, self.excl && !self.force_shared, &info);
                    let mut d = describe(&info, &f);
                    d["ev"] = json!("ready");
                    d["id"] = json!(&*t.id);
                    d["seq"] = json!(t.seq);
                    d["dur"] = json!(info.frames.map(|n| n as f64 / info.rate as f64));
                    emit(d);
                }
            }
        }
        if self.cur.as_ref().map(|t| t.failed).unwrap_or(false) {
            if self.st != St::Idle {
                self.st = St::Idle;
                self.want = None;
            }
            return;
        }
        // a requested start: once the song's format is known
        if self.pending.is_none() {
            if let Some((pos, end, run)) = self.want {
                let Some(cur) = self.cur.as_ref() else {
                    self.want = None;
                    return;
                };
                let plan = cur.sh.q.lock().unwrap().plan;
                if let Some(plan) = plan {
                    self.want = None;
                    let rate = plan.rate as f64;
                    let target = (pos * rate).round() as i64;
                    let (base, has) = {
                        let q = cur.sh.q.lock().unwrap();
                        (q.base, !q.buf.is_empty() || q.eof)
                    };
                    // resuming where it stopped: the queue already holds what follows, no seek needed
                    if !(has && base == self.head && (target - self.head).abs() <= (rate * 0.02) as i64) {
                        cur.sh.seek(target.max(0));
                        self.head = target;
                    }
                    self.end = end.map(|e| (e * rate).round() as i64);
                    self.run_id = run;
                    self.run_origin = pos.max(0.0);
                    if run == 0 { self.reported_end = None; }
                    self.ended = false;
                    self.fade_in = self.head > 0;
                    self.st = St::Waiting;
                }
            }
        }
        if self.st == St::Waiting && self.want.is_none() {
            let Some(cur) = self.cur.as_ref() else {
                self.st = St::Idle;
                return;
            };
            let (info, plan, enough) = {
                let q = cur.sh.q.lock().unwrap();
                let Some(plan) = q.plan else { return };
                let need = if self.head > 0 { RESUME_S } else { START_S };
                (q.info.clone(), plan, Shared::frames(&q) as f64 >= need * plan.rate as f64 || q.eof)
            };
            let Some(info) = info else { return };
            let Some(caps) = self.ensure_caps() else { return };
            let f = choose(&caps, self.excl_now(), &info);
            if plan.rate != f.rate || plan.ch != f.ch {
                self.replan(plan.rate);
                return;
            }
            if self.ofmt != Some(f) {
                if !self.open(f) {
                    return;
                }
            }
            if enough {
                self.st = St::Playing;
                self.idle_at = None;
                if self.fade_in {
                    self.env = 0.0;
                } else {
                    self.env = 1.0;
                }
                self.env_to = 1.0;
            }
        }
        // a device left idle is let go of, so other programs can use it
        if matches!(self.st, St::Idle | St::Paused) && self.out.is_some() {
            if let Some(t) = self.idle_at {
                if t.elapsed().as_secs_f64() > self.release_after {
                    self.close();
                }
            }
        }
    }

    fn open(&mut self, f: Format) -> bool {
        self.close();
        match self.be.open(self.endpoint.as_deref(), &f) {
            Ok(s) => {
                self.scheduling = Some(Scheduling::begin());
                self.epoch += 1;
                self.clock = StreamClock::default();
                self.clock_source = None;
                self.check_device_at = Instant::now();
                let latency = s.latency_100ns().map(|latency| latency as f64 / 10_000.0);
                self.out = Some(s);
                self.ofmt = Some(f);
                self.started = false;
                self.dev_written = 0;
                self.marks.clear();
                self.preroll = (f.rate as f64 * if f.exclusive { LOCK_S } else { 0.03 }) as usize;
                let name = self.caps.as_ref().map(|c| c.name.clone()).unwrap_or_default();
                if self.excl && !f.exclusive && !self.force_shared {
                    emit(json!({ "ev": "fallback", "code": "shared", "msg": self.caps.as_ref().and_then(|c| c.why_not.as_deref()) }));
                }
                emit(json!({ "ev": "device", "open": true, "epoch": self.epoch, "endpoint": self.endpoint, "name": name, "exclusive": f.exclusive, "requestedExclusive": self.excl, "rate": f.rate, "bits": f.fmt.valid(), "containerBits": f.fmt.bytes() * 8, "fmt": f.fmt.name(), "ch": f.ch, "latencyMs": latency }));
                self.hw(self.hw_db);
                true
            }
            Err(e) => {
                if f.exclusive {
                    // exclusive mode refused (the device is busy, or Windows does not allow it): play through the mixer
                    // instead, from the same place
                    emit(json!({ "ev": "fallback", "code": "shared", "msg": e }));
                    self.force_shared = true;
                    replace_track(&mut self.next, None, &mut self.closing);
                } else {
                    self.retry(e);
                }
                false
            }
        }
    }
    fn replan(&mut self, rate: u32) {
        if let Some(cur) = self.cur.as_ref() {
            let (id, path, seq) = (cur.id.clone(), cur.path.clone(), cur.seq);
            replace_track(&mut self.cur, None, &mut self.closing);
            self.cur = self.spawn(&id, &path, seq);
            if self.cur.is_none() {
                emit(json!({ "ev": "error", "code": "device", "seq": seq, "runId": self.run_id, "epoch": self.epoch, "msg": "decoder slots unavailable" }));
                self.st = St::Idle;
                return;
            }
            let rate = rate as f64;
            self.want = Some((self.head as f64 / rate, self.end.map(|e| e as f64 / rate), self.run_id));
        }
    }
    fn retry(&mut self, reason: String) {
        self.caps = None;
        if self.retries < 3 {
            self.retry_at = Some(Instant::now() + Duration::from_millis(250 << self.retries));
            self.retries += 1;
        } else {
            self.retry_at = None;
            self.st = St::Paused;
            self.want = None;
            emit(json!({ "ev": "error", "code": "device", "seq": self.cur.as_ref().map(|t| t.seq), "runId": self.run_id, "epoch": self.epoch, "msg": reason }));
        }
    }
    fn close(&mut self) {
        if let Some(mut s) = self.out.take() {
            s.stop();
            drop(s);
            self.unhw();
            self.ofmt = None;
            self.started = false;
            self.scheduling = None;
            emit(json!({ "ev": "device", "open": false, "epoch": self.epoch }));
        }
    }
    // fade out whatever is sounding and let it play out before the device is stopped
    fn hush(&mut self) {
        if self.out.is_none() || (!self.playing_audibly() && !self.marks.iter().any(|m| m.run)) {
            return;
        }
        self.pending = None;
        let t0 = Instant::now();
        if self.playing_audibly() {
            self.env_to = 0.0;
            while self.env > 0.0 && self.out.is_some() && t0.elapsed() < Duration::from_millis(200) {
                self.fill();
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        self.st = St::Paused;
        // Supply one short, explicit silent tail when the last fade frame ended at a buffer boundary.
        // Further writes would keep refilling the endpoint and prevent it from draining.
        if let (Some(f), Some(out)) = (self.ofmt, self.out.as_mut()) {
            let tail = (f.rate / 500) as usize;
            while t0.elapsed() < Duration::from_millis(200) {
                match out.space() {
                    Ok(space) if space >= tail => {
                        self.bytes.clear();
                        self.bytes.resize(tail * f.ch * f.fmt.bytes(), 0);
                        let _ = out.write(&self.bytes, tail);
                        break;
                    }
                    Err(_) => break,
                    _ => std::thread::sleep(Duration::from_millis(2)),
                }
            }
        }
        while t0.elapsed() < Duration::from_millis(300) {
            let pad = self.out.as_mut().and_then(|s| s.padding().ok()).unwrap_or(0);
            let ms = self.ofmt.map(|f| pad as f64 * 1000.0 / f.rate as f64).unwrap_or(0.0);
            if ms < 2.0 || self.out.is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn mark(&mut self, len: usize, pos: i64, run: bool, exact: bool) {
        let id = self.cur.as_ref().map(|t| t.id.clone());
        let seq = self.cur.as_ref().map(|t| t.seq).unwrap_or(0);
        let run_id = self.run_id;
        let eof = self.ended && id.is_some();
        let dev = self.dev_written + self.frames.len() as u64 / self.ofmt.map(|f| f.ch as u64).unwrap_or(2) - len as u64;
        if let Some(m) = self.marks.back_mut() {
            let same = m.run == run && m.id == id && m.seq == seq && m.run_id == run_id && m.eof == eof && m.exact == exact
                && m.dev + m.len == dev && (if run { m.pos + m.len as i64 == pos } else { m.pos == pos });
            if same {
                m.len += len as u64;
                return;
            }
        }
        self.marks.push_back(Mark { dev, len: len as u64, pos, run, id, seq, run_id, eof, exact });
        while self.marks.len() > 64 {
            self.marks.pop_front();
        }
    }

    fn fill(&mut self) {
        let Some(f) = self.ofmt else { return };
        let space = match self.out.as_mut().unwrap().space() {
            Ok(s) => s,
            Err(e) => {
                self.lost(e);
                return;
            }
        };
        if space == 0 {
            return;
        }
        let ch = f.ch;
        let rate = f.rate as f64;
        let fstep = 1.0 / (FADE_S * rate);
        let gstep = 1.0 / (GLIDE_S * rate);
        self.frames.clear();
        let mut n = 0usize;
        while n < space {
            let left = space - n;
            if self.preroll > 0 {
                let k = self.preroll.min(left);
                self.frames.resize(self.frames.len() + k * ch, 0);
                self.mark(k, self.head, false, false);
                self.preroll -= k;
                n += k;
                continue;
            }
            if self.st != St::Playing {
                self.frames.resize(self.frames.len() + left * ch, 0);
                self.mark(left, self.head, false, false);
                n += left;
                break;
            }
            // silence needs no fade: what waits for one happens at once
            let silent = self.head < 0 || self.ended;
            if silent && self.env_to <= 0.0 {
                if let Some(p) = self.pending.take() {
                    self.env = 0.0;
                    self.apply(p);
                    continue;
                }
            }
            if self.head < 0 {
                let k = left.min((-self.head) as usize);
                self.frames.resize(self.frames.len() + k * ch, 0);
                self.mark(k, self.head, true, false);
                self.head += k as i64;
                n += k;
                continue;
            }
            let Some(cur) = self.cur.as_ref() else {
                self.st = St::Idle;
                continue;
            };
            let sh = cur.sh.clone();
            let mut q = sh.q.lock().unwrap();
            let avail = Shared::frames(&q);
            let lim = self.end.map(|e| (e - self.head).max(0) as usize).unwrap_or(usize::MAX);
            if lim == 0 || (q.eof && avail == 0) {
                // Mark the first silent frame. Report EOF only after the device consumes the preceding audio.
                drop(q);
                self.frames.resize(self.frames.len() + left * ch, 0);
                self.ended = true;
                self.mark(left, self.head, false, false);
                n += left;
                continue;
            }
            if avail == 0 {
                drop(q);
                self.apply(Pending::Underrun);
                continue;
            }
            // the decoder fell behind (only a stalled disk does that): fade out before the queue runs dry
            if !q.eof && avail <= left + (FADE_S * rate) as usize && self.pending.is_none() && self.env_to > 0.0 && lim > avail {
                self.env_to = 0.0;
                self.pending = Some(Pending::Underrun);
            }
            let k = left.min(avail).min(lim);
            let exact = self.env == 1.0 && self.env_to == 1.0 && self.gain == 1.0 && self.gain_to == 1.0
                && q.info.as_ref().is_some_and(|info| can_be_exact(info, &f));
            let mut taken = 0usize;
            let mut stop = false;
            // Most buffers have unity gain. Bulk copy in two slices without one deque pop per sample.
            if self.env == 1.0 && self.env_to == 1.0 && self.gain == 1.0 && self.gain_to == 1.0 {
                let (a, b) = q.buf.as_slices();
                let split = a.len().min(k * ch);
                self.frames.extend_from_slice(&a[..split]);
                self.frames.extend_from_slice(&b[..k * ch - split]);
                q.buf.drain(..k * ch);
                taken = k;
            }
            for _ in taken..k {
                let g = self.env * self.gain;
                for _ in 0..ch {
                    let s = q.buf.pop_front().unwrap_or(0);
                    self.frames.push(if g == 1.0 { s } else { ((s as f64) * g).round().clamp(i32::MIN as f64, i32::MAX as f64) as i32 });
                }
                taken += 1;
                if self.env != self.env_to {
                    self.env = if self.env < self.env_to { (self.env + fstep).min(self.env_to) } else { (self.env - fstep).max(self.env_to) };
                }
                if self.gain != self.gain_to {
                    self.gain = if self.gain < self.gain_to { (self.gain + gstep).min(self.gain_to) } else { (self.gain - gstep).max(self.gain_to) };
                }
                if self.env <= 0.0 && self.env_to <= 0.0 && self.pending.is_some() {
                    stop = true;
                    break;
                }
            }
            q.base += taken as i64;
            if q.refill_at != 0 && q.buf.len() < q.refill_at {
                sh.cv.notify_one();
            }
            drop(q);
            self.mark(taken, self.head, true, exact);
            self.head += taken as i64;
            n += taken;
            if stop {
                if let Some(p) = self.pending.take() {
                    self.apply(p);
                }
            }
        }
        // to the device's sample format
        let mut bytes = std::mem::take(&mut self.bytes);
        bytes.clear();
        to_bytes(&self.frames, f.fmt, &mut self.rng, &mut bytes);
        let r = self.out.as_mut().unwrap().write(&bytes, n);
        self.bytes = bytes;
        if let Err(e) = r {
            self.lost(e);
            return;
        }
        self.dev_written += n as u64;
        if !self.started {
            self.started = true;
            if let Err(e) = self.out.as_mut().unwrap().start() {
                self.lost(e);
            } else {
                self.last_consumed = (0, Instant::now());
            }
        }
    }
    fn lost(&mut self, e: StreamFailure) {
        let pending = self.pending.take();
        let old_seq = self.cur.as_ref().map(|t| t.seq);
        let rate = self.cur.as_ref().and_then(|c| c.sh.q.lock().unwrap().plan.map(|p| p.rate as f64)).unwrap_or(48000.0);
        let position = self.heard.filter(|(seq, run, _)| Some(*seq) == old_seq && *run == self.run_id).map(|(_, _, p)| p).unwrap_or(self.run_origin);
        match pending {
            Some(Pending::Swap) => self.apply(Pending::Swap),
            Some(Pending::Seek(start)) => self.apply(Pending::Seek(start)),
            Some(Pending::Stop) => self.apply(Pending::Stop),
            Some(Pending::Pause) => self.apply(Pending::Pause),
            _ if matches!(self.st, St::Playing | St::Waiting) && self.cur.is_some() => {
                self.want.get_or_insert((position, self.end.map(|x| x as f64 / rate), self.run_id));
                self.st = St::Waiting;
            }
            _ => {}
        }
        let resume = self.want.is_some() && self.st == St::Waiting;
        if let Some((at, _, run)) = self.want.filter(|_| resume) {
            self.waiting_at = Instant::now();
            emit(json!({ "ev": "lost", "seq": self.cur.as_ref().map(|t| t.seq), "runId": run, "epoch": self.epoch, "kind": e.kind, "msg": e.message, "resume": true, "t": at }));
        }
        let stalled = e.kind == "clock-stalled";
        let stalled_exclusive = stalled && self.ofmt.is_some_and(|f| f.exclusive);
        let keep_shared = stalled && self.force_shared;
        self.close();
        self.caps = None;
        self.force_shared = stalled_exclusive || keep_shared;
        if stalled_exclusive {
            emit(json!({ "ev": "fallback", "code": "shared", "msg": e.message }));
        }
        replace_track(&mut self.next, None, &mut self.closing);
        if resume { self.retry(e.message); }
    }

    // Map the stream's observed consumption to file time through the submitted frame marks.
    fn report(&mut self) {
        if self.last_emit.elapsed() < Duration::from_millis(20) {
            return;
        }
        self.last_emit = Instant::now();
        let (Some(f), Some(out)) = (self.ofmt, self.out.as_mut()) else { return };
        if !self.started { return; }
        let pad = match out.padding() { Ok(pad) => pad, Err(e) => { self.lost(e); return; } };
        let observation = out.clock();
        let reading = self.clock.read(observation, self.dev_written, pad, f.rate);
        if self.clock_source != Some(reading.source) {
            self.clock_source = Some(reading.source);
            emit(json!({ "ev": "clock-source", "epoch": self.epoch, "source": reading.source,
                "streamFrame": reading.frame, "submittedFrame": self.dev_written, "padding": pad,
                "units": observation.map(|o| o.units), "frequency": observation.map(|o| o.frequency),
                "qpc100ns": observation.map(|o| o.qpc_100ns), "sampledQpc100ns": observation.map(|o| o.now_100ns) }));
        }
        let h = reading.frame;
        if h > self.last_consumed.0 {
            self.last_consumed = (h, Instant::now());
        } else if self.dev_written > h && matches!(self.st, St::Playing | St::Waiting)
            && self.last_consumed.1.elapsed() >= Duration::from_secs(1) {
            self.lost(StreamFailure::new("clock-stalled", "endpoint stopped consuming queued frames"));
            return;
        }
        while self.marks.len() > 1 && self.marks.front().is_some_and(|m| h >= m.dev + m.len) { self.marks.pop_front(); }
        let m = self.marks.front().filter(|m| h >= m.dev && h <= m.dev + m.len);
        let Some(m) = m else { return };
        let (pos, run) = if m.run { (m.pos + (h.saturating_sub(m.dev)).min(m.len) as i64, true) } else { (m.pos, false) };
        if run {
            if let Some((frames, qpc)) = out.endpoint_position() {
                emit(json!({ "ev": "endpoint-clock", "epoch": self.epoch, "frame": frames, "qpc100ns": qpc }));
            }
        }
        let position = pos.max(0) as f64 / f.rate as f64;
        if m.seq == self.cur.as_ref().map(|c| c.seq).unwrap_or(0) && m.run_id == self.run_id && run {
            self.heard = Some((m.seq, m.run_id, position));
            if self.waiting_at.elapsed() >= Duration::from_secs(3) { self.retries = 0; }
        }
        if m.eof && m.id.is_some() && self.reported_end != Some((m.seq, m.run_id)) {
            self.reported_end = Some((m.seq, m.run_id));
            emit(json!({ "ev": "ended", "id": m.id.as_deref(), "seq": m.seq, "runId": m.run_id, "epoch": self.epoch, "t": position }));
            if m.seq == self.cur.as_ref().map(|t| t.seq).unwrap_or(0) && m.run_id == self.run_id && self.ended {
                self.st = St::Idle;
                self.idle_at = Some(Instant::now());
            }
        } else if !m.eof {
            let held = (m.seq, m.run_id, self.epoch, pos);
            if !run && self.last_hold == Some(held) { return; }
            self.last_hold = if run { None } else { Some(held) };
            let limit = if run { ((m.pos + m.len as i64).max(0) as f64 / f.rate as f64).max(position) } else { position };
            emit(json!({ "ev": "pos", "id": m.id.as_deref(), "seq": m.seq, "runId": m.run_id,
                "t": position, "run": run, "epoch": self.epoch, "source": reading.source, "qpc100ns": reading.qpc_100ns,
                "streamFrame": h, "submittedFrame": self.dev_written, "limit": limit, "exact": run && m.exact }));
        }
    }
}

// left-justified i32 samples into the device's format
fn to_bytes(s: &[i32], f: SFmt, rng: &mut u64, out: &mut Vec<u8>) {
    match f {
        SFmt::I32 => {
            for &x in s {
                out.extend_from_slice(&x.to_le_bytes());
            }
        }
        SFmt::I32v24 => {
            for &x in s {
                out.extend_from_slice(&quant(x, 24, rng).to_le_bytes());
            }
        }
        SFmt::I24 => {
            for &x in s {
                let b = (quant(x, 24, rng) >> 8).to_le_bytes();
                out.extend_from_slice(&b[..3]);
            }
        }
        SFmt::I16 => {
            for &x in s {
                out.extend_from_slice(&((quant(x, 16, rng) >> 16) as i16).to_le_bytes());
            }
        }
        SFmt::F32 => {
            for &x in s {
                out.extend_from_slice(&(x as f32 * (1.0 / 2147483648.0)).to_le_bytes());
            }
        }
    }
}
fn rand(r: &mut u64) -> u64 {
    *r ^= *r << 13;
    *r ^= *r >> 7;
    *r ^= *r << 17;
    *r
}
// to `bits` valid bits. A sample whose dropped bits are all zero (any 16- or 24-bit source at unity gain) is returned
// unchanged; anything else is rounded with TPDF dither, which turns the rounding error into a faint, even hiss
// instead of distortion
fn quant(x: i32, bits: u32, r: &mut u64) -> i32 {
    let sh = 32 - bits;
    let mask = (1i64 << sh) - 1;
    if (x as i64) & mask == 0 {
        return x;
    }
    let lsb = 1i64 << sh;
    let noise = (rand(r) as i64 & mask) + (rand(r) as i64 & mask) - lsb;
    let v = (x as i64 + noise + lsb / 2).clamp(i32::MIN as i64, i32::MAX as i64 - mask);
    (v & !mask) as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rates() {
        let all = [44100, 48000, 88200, 96000, 176400, 192000];
        assert_eq!(pick_rate(44100, &all), 44100);
        assert_eq!(pick_rate(352800, &all), 176400);
        assert_eq!(pick_rate(44100, &[48000, 96000]), 48000);
        assert_eq!(pick_rate(176400, &[44100, 48000, 88200, 96000]), 88200);
        assert_eq!(pick_rate(22050, &all), 44100);
        assert_eq!(pick_rate(96000, &[44100, 88200]), 88200);
    }
    #[test]
    fn exact_when_no_bits_are_lost() {
        let mut r = 1;
        for v in [0i32, 1 << 16, -(1 << 16), 12345 << 8, i32::MIN, (i32::MAX >> 8) << 8] {
            assert_eq!(quant(v, 24, &mut r) & !0xff, v & !0xff);
            assert_eq!(quant(v, 24, &mut r), v);
        }
        // a value between steps is rounded to a neighbour, never further
        let x = (1000 << 16) + 0x7fff;
        for _ in 0..100 {
            let q = quant(x, 16, &mut r) >> 16;
            assert!(q == 1000 || q == 1001 || q == 999);
        }
        assert!(quant(i32::MAX, 16, &mut r) <= i32::MAX);
    }
}
