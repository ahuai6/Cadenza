// Playback: one thread owns the device and the current song, and keeps the device's buffer topped up.
//
// What keeps it clean and safe:
// - a song starts only once enough of it is decoded (never stutters at the start, nor right after a seek)
// - the next song is decoded ahead, so changing songs never waits on the disk
// - the device is (re)opened only when the format really changes; after opening, 300 ms of silence lets the DAC lock
//   onto the new rate before the music starts (many DACs mute or click while they relock)
// - every stop, pause, seek or song change fades the music out over 6 ms first, and a resume or seek fades it in, so no
//   transition cuts a waveform mid-swing (clicks and pops); a song started from its beginning is not faded at all
// - volume changes glide over 20 ms; the gain goes above 1 only for the volume balance's boost (kept within the song's
//   own headroom by the page), and every sample is clamped
// - the volume balance with a fixed volume goes to the device's own hardware volume (Hwgain), never into the samples
// - at unity gain, with the device at the file's rate and at least the file's bit depth, the samples reach the device
//   exactly as stored in the file: bit-perfect
// - samples are only rounded to fewer bits with TPDF dither, and only where bits would really be lost
use std::collections::VecDeque;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use crate::decode::{self, Plan, Shared, SrcInfo};
use crate::output::{self, Backend, Caps, Format, SFmt, Stream};
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
    Seek(f64, Option<f64>),
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
}

const FADE_S: f64 = 0.006;
const GLIDE_S: f64 = 0.02;
const LOCK_S: f64 = 0.3; // silence after opening the device in exclusive mode, for the DAC to lock
const START_S: f64 = 0.5; // decoded ahead before a song may start
const RESUME_S: f64 = 0.25; // … and before a seek or resume may

pub struct Player {
    be: Box<dyn Backend>,
    dev: Option<String>,
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
    st: St,
    want: Option<(f64, Option<f64>)>,
    fade_in: bool,
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
    last_emit: Instant,
    ended: bool,
    idle_at: Option<Instant>,
    rng: u64,
    bytes: Vec<u8>,
    frames: Vec<i32>,
    mmcss: bool,
    hw_db: f64, // the volume balance asked for in the device's hardware volume (applied on the device in use)
}

pub fn run(rx: Receiver<Cmd>) {
    let mut p = Player {
        be: output::backend(),
        dev: None,
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
        st: St::Idle,
        want: None,
        fade_in: false,
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
        last_emit: Instant::now(),
        ended: false,
        idle_at: None,
        rng: 0x9E3779B97F4A7C15,
        bytes: Vec::new(),
        frames: Vec::new(),
        mmcss: false,
        hw_db: 0.0,
    };
    #[cfg(windows)]
    unsafe {
        // 1 ms timer resolution for this process, so the polling below wakes when it asks to
        windows::Win32::Media::timeBeginPeriod(1);
    }
    emit(json!({ "ev": "hello", "version": env!("CARGO_PKG_VERSION") }));
    loop {
        let wait = if p.out.is_some() { 3 } else if p.cur.is_some() || p.next.is_some() { 10 } else { 200 };
        match rx.recv_timeout(Duration::from_millis(wait)) {
            Ok(c) => {
                if !p.handle(c) {
                    break;
                }
                while let Ok(c) = rx.try_recv() {
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
        p.fill();
        p.report();
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
        let f = SFmt::PREF.iter().copied().find(|f| caps.exclusive.contains(&(r, *f))).unwrap_or(SFmt::I16);
        return Format { rate: r, ch: 2, fmt: f, exclusive: true };
    }
    caps.mix.unwrap_or(Format { rate: 48000, ch: 2, fmt: SFmt::F32, exclusive: false })
}
fn describe(info: &SrcInfo, f: &Format) -> serde_json::Value {
    let bitperfect = f.exclusive && f.rate == info.rate && f.fmt != SFmt::F32 && info.ch <= 2 && info.bits.map(|b| b <= f.fmt.valid()).unwrap_or(false);
    json!({
        "src": { "rate": info.rate, "bits": info.bits, "ch": info.ch, "codec": info.codec, "lossy": info.bits.is_none() },
        "out": { "rate": f.rate, "bits": f.fmt.valid(), "fmt": f.fmt.name(), "ch": f.ch, "exclusive": f.exclusive, "resample": f.rate != info.rate, "bitperfect": bitperfect }
    })
}

impl Player {
    fn ensure_caps(&mut self) -> Option<Arc<Caps>> {
        if self.caps.is_none() {
            match self.be.probe(self.dev.as_deref()) {
                Ok(c) => {
                    emit(json!({ "ev": "caps", "name": c.name, "exclusive": !c.exclusive.is_empty(), "why": c.why_not,
                        "rates": c.exclusive.iter().map(|x| x.0).fold(Vec::<u32>::new(), |mut v, r| { if !v.contains(&r) { v.push(r) } v }),
                        "mix": c.mix.map(|m| m.rate) }));
                    self.caps = Some(Arc::new(c));
                }
                Err(e) => {
                    emit(json!({ "ev": "error", "code": "device", "msg": e }));
                    return None;
                }
            }
        }
        self.caps.clone()
    }
    fn excl_now(&self) -> bool {
        self.excl && !self.force_shared
    }
    fn spawn(&mut self, id: &str, path: &str, seq: u64) -> Option<Track> {
        let caps = self.ensure_caps()?;
        let excl = self.excl_now();
        let plan = Box::new(move |info: &SrcInfo| {
            let f = choose(&caps, excl, info);
            Plan { rate: f.rate, ch: f.ch }
        });
        Some(Track { id: Arc::from(id), path: path.to_string(), sh: decode::spawn(path.to_string(), plan), seq, ready: false, failed: false })
    }
    fn playing_audibly(&self) -> bool {
        self.st == St::Playing && self.out.is_some() && self.env > 0.0
    }

    // the volume balance in the device's hardware volume, reported either way (the page shows whether it applies)
    fn hw(&mut self, db: f64) {
        match self.be.hw_gain(self.dev.as_deref(), db) {
            Some((got, level)) => {
                self.hw_db = db;
                emit(json!({ "ev": "hwvol", "supported": true, "db": got, "level": level }));
            }
            None => {
                self.hw_db = 0.0;
                emit(json!({ "ev": "hwvol", "supported": false }));
            }
        }
    }

    // leaving (the app quits, or closes this player): the device gets its own level back
    fn unhw(&mut self) {
        if self.hw_db != 0.0 {
            self.be.hw_gain(self.dev.as_deref(), 0.0);
            self.hw_db = 0.0;
        }
    }

    fn handle(&mut self, c: Cmd) -> bool {
        match c {
            Cmd::Devices => emit(json!({ "ev": "devices", "list": self.be.devices() })),
            Cmd::Config { device, mode, release_after } => {
                self.hush();
                self.close();
                let dev = device.filter(|d| !d.is_empty());
                if dev != self.dev && self.hw_db != 0.0 {
                    // another device: the old one gets its own level back, the new one the balance
                    self.be.hw_gain(self.dev.as_deref(), 0.0);
                    self.dev = dev;
                    let db = self.hw_db;
                    self.hw(db);
                } else {
                    self.dev = dev;
                }
                self.excl = mode.as_deref() != Some("shared");
                self.force_shared = false;
                if let Some(r) = release_after {
                    self.release_after = r.max(1.0);
                }
                self.caps = None;
                self.cur = None;
                self.incoming = None;
                self.next = None;
                self.st = St::Idle;
                self.want = None;
                self.pending = None;
                self.ensure_caps();
                emit(json!({ "ev": "reset" }));
            }
            Cmd::Load { id, path, next, seq } => {
                if next {
                    if self.next.as_ref().map(|t| &*t.id == id.as_str()).unwrap_or(false) || self.cur.as_ref().map(|t| &*t.id == id.as_str()).unwrap_or(false) {
                        return true;
                    }
                    self.next = self.spawn(&id, &path, seq);
                    return true;
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
                let Some(t) = t else { return true };
                // the music cut by a song change also fades out
                self.want = None;
                if self.playing_audibly() {
                    self.incoming = Some(t);
                    self.env_to = 0.0;
                    self.pending = Some(Pending::Swap);
                } else {
                    self.incoming = None;
                    self.pending = None;
                    self.cur = Some(t);
                    self.st = St::Idle;
                    self.idle_at = Some(Instant::now());
                }
                emit(json!({ "ev": "loading", "id": id, "seq": seq }));
            }
            Cmd::Play { pos, end } => {
                if matches!(self.pending, Some(Pending::Swap)) {
                    self.want = Some((pos, end));
                } else if self.playing_audibly() {
                    self.pending = Some(Pending::Seek(pos, end));
                    self.env_to = 0.0;
                } else {
                    self.pending = None;
                    self.want = Some((pos, end));
                    self.st = St::Waiting;
                }
            }
            Cmd::Pause => {
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
            Cmd::Stop => {
                self.want = None;
                if self.playing_audibly() {
                    self.pending = Some(Pending::Stop);
                    self.env_to = 0.0;
                } else {
                    self.cur = None;
                    self.st = St::Idle;
                    self.idle_at = Some(Instant::now());
                }
            }
            Cmd::Release => {
                self.hush();
                self.close();
                // the device goes back to others (the standard output): its own level with it
                if self.hw_db != 0.0 {
                    self.hw(0.0);
                }
                if self.st == St::Playing || self.st == St::Waiting {
                    self.st = St::Paused;
                }
            }
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
            Pending::Seek(pos, end) => {
                self.want = Some((pos, end));
                self.st = St::Waiting;
            }
            Pending::Swap => {
                self.cur = self.incoming.take();
                self.ended = false;
                self.st = if self.want.is_some() { St::Waiting } else { St::Idle };
                self.idle_at = Some(Instant::now());
            }
            Pending::Stop => {
                self.cur = None;
                self.st = St::Idle;
                self.idle_at = Some(Instant::now());
            }
            Pending::Underrun => {
                self.st = St::Waiting;
                self.fade_in = true;
                emit(json!({ "ev": "underrun" }));
            }
        }
    }

    fn poll(&mut self) {
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
                    emit(json!({ "ev": "error", "code": "decode", "id": &*t.id, "seq": t.seq, "msg": e }));
                }
                continue;
            }
            if t.ready || which == 1 && t.ready {
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
            if let Some((pos, end)) = self.want {
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
            let (info, enough) = {
                let q = cur.sh.q.lock().unwrap();
                let Some(plan) = q.plan else { return };
                let need = if self.head > 0 { RESUME_S } else { START_S };
                (q.info.clone(), Shared::frames(&q) as f64 >= need * plan.rate as f64 || q.eof)
            };
            let Some(info) = info else { return };
            let Some(caps) = self.caps.clone() else { return };
            let f = choose(&caps, self.excl_now(), &info);
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
        match self.be.open(self.dev.as_deref(), &f) {
            Ok(s) => {
                #[cfg(windows)]
                if !self.mmcss {
                    // the system's scheduling class for audio threads
                    let mut idx = 0u32;
                    unsafe {
                        let _ = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(windows::core::w!("Pro Audio"), &mut idx);
                    }
                }
                self.mmcss = true;
                self.out = Some(s);
                self.ofmt = Some(f);
                self.started = false;
                self.dev_written = 0;
                self.marks.clear();
                self.preroll = (f.rate as f64 * if f.exclusive { LOCK_S } else { 0.03 }) as usize;
                let name = self.caps.as_ref().map(|c| c.name.clone()).unwrap_or_default();
                emit(json!({ "ev": "device", "open": true, "name": name, "exclusive": f.exclusive, "rate": f.rate, "bits": f.fmt.valid(), "fmt": f.fmt.name(), "ch": f.ch }));
                true
            }
            Err(e) => {
                if f.exclusive {
                    // exclusive mode refused (the device is busy, or Windows does not allow it): play through the mixer
                    // instead, from the same place
                    emit(json!({ "ev": "fallback", "msg": e }));
                    self.force_shared = true;
                    if let Some(cur) = self.cur.take() {
                        let old = cur.sh.q.lock().unwrap().plan.map(|p| p.rate as f64).unwrap_or(48000.0);
                        let (id, path, seq) = (cur.id.to_string(), cur.path.clone(), cur.seq);
                        drop(cur);
                        self.cur = self.spawn(&id, &path, seq);
                        self.want = Some((self.head as f64 / old, self.end.map(|e| e as f64 / old)));
                        self.st = St::Waiting;
                    }
                    self.next = None;
                } else {
                    emit(json!({ "ev": "error", "code": "device", "msg": e }));
                    self.st = St::Paused;
                }
                false
            }
        }
    }
    fn close(&mut self) {
        if let Some(mut s) = self.out.take() {
            s.stop();
            self.ofmt = None;
            emit(json!({ "ev": "device", "open": false }));
        }
    }
    // fade out whatever is sounding and let it play out before the device is stopped
    fn hush(&mut self) {
        if !self.playing_audibly() {
            return;
        }
        self.env_to = 0.0;
        self.pending = None;
        let t0 = Instant::now();
        while self.env > 0.0 && t0.elapsed() < Duration::from_millis(200) {
            self.fill();
            std::thread::sleep(Duration::from_millis(2));
        }
        self.st = St::Paused;
        while t0.elapsed() < Duration::from_millis(300) {
            self.fill();
            let pad = self.out.as_mut().and_then(|s| s.padding().ok()).unwrap_or(0);
            let ms = self.ofmt.map(|f| pad as f64 * 1000.0 / f.rate as f64).unwrap_or(0.0);
            if ms < 2.0 || self.out.is_none() {
                break;
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    fn mark(&mut self, len: usize, pos: i64, run: bool) {
        let id = self.cur.as_ref().map(|t| t.id.clone());
        let dev = self.dev_written + self.frames.len() as u64 / self.ofmt.map(|f| f.ch as u64).unwrap_or(2) - len as u64;
        if let Some(m) = self.marks.back_mut() {
            let same = m.run == run && m.id == id && m.dev + m.len == dev && (if run { m.pos + m.len as i64 == pos } else { m.pos == pos });
            if same {
                m.len += len as u64;
                return;
            }
        }
        self.marks.push_back(Mark { dev, len: len as u64, pos, run, id });
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
                self.mark(k, self.head, false);
                self.preroll -= k;
                n += k;
                continue;
            }
            if self.st != St::Playing {
                self.frames.resize(self.frames.len() + left * ch, 0);
                self.mark(left, self.head, false);
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
                self.mark(k, self.head, true);
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
                // the music is over (or its range is): silence, while the time keeps running for the ending
                drop(q);
                self.frames.resize(self.frames.len() + left * ch, 0);
                self.mark(left, self.head, true);
                self.head += left as i64;
                n += left;
                if !self.ended {
                    self.ended = true;
                    emit(json!({ "ev": "ended", "id": self.cur.as_ref().map(|t| t.id.to_string()) }));
                }
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
            let mut taken = 0usize;
            let mut stop = false;
            for _ in 0..k {
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
            drop(q);
            self.mark(taken, self.head, true);
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
            }
        }
    }
    fn lost(&mut self, e: String) {
        emit(json!({ "ev": "error", "code": "device", "msg": e }));
        self.out = None;
        self.ofmt = None;
        if self.st != St::Idle {
            self.st = St::Paused;
        }
        self.caps = None;
        emit(json!({ "ev": "device", "open": false }));
    }

    // where the listener is: the frame leaving the device now, mapped back to the song
    fn report(&mut self) {
        if self.last_emit.elapsed() < Duration::from_millis(20) {
            return;
        }
        self.last_emit = Instant::now();
        let (Some(f), Some(out)) = (self.ofmt, self.out.as_mut()) else { return };
        let Ok(pad) = out.padding() else { return };
        let h = self.dev_written.saturating_sub(pad as u64);
        let m = self.marks.iter().find(|m| h >= m.dev && h < m.dev + m.len).or(self.marks.back());
        let Some(m) = m else { return };
        let (pos, run) = if m.run { (m.pos + (h.saturating_sub(m.dev)).min(m.len) as i64, true) } else { (m.pos, false) };
        emit(json!({ "ev": "pos", "id": m.id.as_deref(), "t": pos as f64 / f.rate as f64, "run": run }));
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
