// Audio devices. On Windows: WASAPI, exclusive (the app alone sets the device's rate and sample format, nothing mixes
// or resamples in between) or shared (through the system mixer). Anywhere, with CADENZA_AUDIO_FAKE set: a simulated device
// that consumes in real time and can record what it was sent, for the tests.
use serde::Serialize;
use crate::clock::Observation;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum SFmt {
    I32,    // 32-bit integer
    I32v24, // 24 valid bits in a 32-bit container
    I24,    // packed 24-bit
    I16,
    F32,
}

impl SFmt {
    pub fn bytes(self) -> usize {
        match self {
            SFmt::I32 | SFmt::I32v24 | SFmt::F32 => 4,
            SFmt::I24 => 3,
            SFmt::I16 => 2,
        }
    }
    pub fn valid(self) -> u32 {
        match self {
            SFmt::I32 => 32,
            SFmt::I32v24 | SFmt::I24 => 24,
            SFmt::I16 => 16,
            SFmt::F32 => 24, // a float carries 24 bits of mantissa
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            SFmt::I32 => "i32",
            SFmt::I32v24 => "i24in32",
            SFmt::I24 => "i24",
            SFmt::I16 => "i16",
            SFmt::F32 => "f32",
        }
    }
    // preferred first: the most valid bits, integers before float
    pub const PREF: [SFmt; 5] = [SFmt::I32, SFmt::I32v24, SFmt::I24, SFmt::I16, SFmt::F32];
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Format {
    pub rate: u32,
    pub ch: usize,
    pub fmt: SFmt,
    pub exclusive: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Caps {
    pub name: String,
    pub exclusive: Vec<(u32, SFmt)>, // stereo formats the device takes in exclusive mode
    pub mix: Option<Format>,         // the system mixer's format (shared mode)
    pub why_not: Option<String>,     // why exclusive mode is unavailable, when it is
}

#[derive(Serialize, Clone)]
pub struct DevInfo {
    pub id: String,
    pub name: String,
    pub default: bool,
}

pub struct StreamFailure {
    pub kind: &'static str,
    pub message: String,
}

impl StreamFailure {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

pub trait Stream {
    fn space(&mut self) -> Result<usize, StreamFailure>;
    fn padding(&mut self) -> Result<usize, StreamFailure>;
    fn write(&mut self, data: &[u8], frames: usize) -> Result<(), StreamFailure>;
    fn start(&mut self) -> Result<(), StreamFailure>;
    fn stop(&mut self);
    fn clock(&mut self) -> Option<Observation> { None }
    fn latency_100ns(&self) -> Option<i64> { None }
    fn endpoint_position(&mut self) -> Option<(u64, u64)> { None }
}

pub trait Backend {
    fn devices(&mut self) -> Vec<DevInfo>;
    fn probe(&mut self, dev: Option<&str>) -> Result<Caps, String>;
    fn open(&mut self, dev: Option<&str>, f: &Format) -> Result<Box<dyn Stream>, String>;
    fn default_id(&mut self) -> Option<String> {
        self.devices().into_iter().find(|d| d.default).map(|d| d.id)
    }
    // can this device be opened now (it is there and enabled)? A device unplugged or switched off is still known to the
    // system by its id, and opening it only fails later: it is asked here first, and the default taken in its place
    fn usable(&mut self, _dev: &str) -> bool {
        true
    }
    // the volume balance in the device's own hardware volume: `db` from the level the user set (0 takes it back off).
    // The user's own changes are kept: the offset is measured from the level as it stands minus what was applied before.
    // Some((applied dB, the device's level in dB)) when the device has a hardware volume; None when it has none (then
    // nothing is touched: in exclusive mode only a hardware volume acts at all, and the samples are never changed).
    fn hw_gain(&mut self, _dev: Option<&str>, _db: f64) -> Option<(f64, f64)> {
        None
    }
}
/// Reuse our saved base only while the endpoint still reports our last write.
fn hw_target(level: f64, prior: Option<(f64, f64)>, want: f64, min: f64, max: f64) -> (f64, f64) {
    let base = prior.filter(|&(_, last)| (last - level).abs() < 0.05).map(|(base, _)| base).unwrap_or(level);
    (base, (base + want).clamp(min, max))
}

pub const RATES: [u32; 10] = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];

pub fn backend() -> Box<dyn Backend> {
    if let Ok(spec) = std::env::var("CADENZA_AUDIO_FAKE") {
        return Box::new(fake::Fake::new(&spec));
    }
    #[cfg(windows)]
    {
        Box::new(wasapi_be::Wasapi::new())
    }
    #[cfg(not(windows))]
    {
        Box::new(fake::Fake::none())
    }
}

/* ---------- simulated device ---------- */
pub mod fake {
    use super::*;
    use std::io::Write;
    use std::time::Instant;
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};

    pub struct Fake {
        rates: Vec<u32>,
        fmts: Vec<SFmt>,
        mix: u32,
        busy: bool,
        present: bool,
        dump: Option<String>,
        n: usize,
        hw: Option<f64>,
        hw_adjustment: Option<(f64, f64)>,
        speed: f64,
        clock_reset: Option<f64>,
        lose_after: Option<f64>,
        changed_mix: Option<u32>,
        fail_after_loss: usize,
        failed_opens: usize,
        lost: Arc<AtomicBool>,
        exclusive_open_fails: bool,
        born: Instant,
        return_after: Option<f64>,
        switch_default_after: Option<f64>,
        stall_exclusive: bool,
        crash_after: Option<f64>,
    }
    impl Fake {
        #[cfg(not(windows))]
        pub fn none() -> Self {
            let mut f = Self::new("");
            f.present = false;
            f
        }
        // "rates=44100,48000;fmts=i32,i16;mix=48000;busy=1;dump=/path/prefix"
        pub fn new(spec: &str) -> Self {
            let mut f = Fake { rates: RATES[..6].to_vec(), fmts: vec![SFmt::I32v24, SFmt::I16], mix: 48000, busy: false, present: true, dump: None, n: 0, hw: None, hw_adjustment: None, speed: 1.0, clock_reset: None, lose_after: None, changed_mix: None, fail_after_loss: 0, failed_opens: 0, lost: Arc::default(), exclusive_open_fails: false, born: Instant::now(), return_after: None, switch_default_after: None, stall_exclusive: false, crash_after: None };
            for kv in spec.split(';') {
                let mut it = kv.splitn(2, '=');
                let (k, v) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
                match k {
                    "rates" => f.rates = v.split(',').filter_map(|x| x.trim().parse().ok()).collect(),
                    "fmts" => {
                        f.fmts = v
                            .split(',')
                            .filter_map(|x| match x.trim() {
                                "i32" => Some(SFmt::I32),
                                "i24in32" => Some(SFmt::I32v24),
                                "i24" => Some(SFmt::I24),
                                "i16" => Some(SFmt::I16),
                                "f32" => Some(SFmt::F32),
                                _ => None,
                            })
                            .collect()
                    }
                    "mix" => f.mix = v.parse().unwrap_or(48000),
                    "busy" => f.busy = v == "1",
                    "exclusive-open-fails" => f.exclusive_open_fails = v == "1",
                    "speed" => f.speed = v.parse::<f64>().ok().filter(|n| (0.9..=1.1).contains(n)).unwrap_or(1.0),
                    "clock-reset" => f.clock_reset = v.parse().ok(),
                    "lose-after" => f.lose_after = v.parse().ok(),
                    "changed-mix" => f.changed_mix = v.parse().ok(),
                    "fail-after-loss" => f.fail_after_loss = v.parse().unwrap_or(0),
                    "return-after" => f.return_after = v.parse().ok(),
                    "switch-default-after" => f.switch_default_after = v.parse().ok(),
                    "stall-exclusive" => f.stall_exclusive = v == "1",
                    "crash-after" => f.crash_after = v.parse().ok(),
                    "dump" => f.dump = Some(v.to_string()),
                    // "hwvol=-20": the device has a hardware volume, the user's level at -20 dB (range -60..0)
                    "hwvol" => f.hw = v.parse().ok(),
                    _ => {}
                }
            }
            f
        }
    }
    impl Backend for Fake {
        fn usable(&mut self, dev: &str) -> bool {
            self.present && (dev == self.endpoint() || (dev == "fake-dac" && self.return_after.is_some_and(|t| self.born.elapsed().as_secs_f64() >= t)))
        }
        fn devices(&mut self) -> Vec<DevInfo> {
            if !self.present {
                return vec![];
            }
            vec![DevInfo { id: self.endpoint().into(), name: "Test DAC".into(), default: true }]
        }
        fn probe(&mut self, dev: Option<&str>) -> Result<Caps, String> {
            if !self.present {
                return Err("no output device".into());
            }
            let mut ex = vec![];
            if !self.busy {
                for &r in &self.rates {
                    for &f in &self.fmts {
                        ex.push((r, f));
                    }
                }
            }
            Ok(Caps {
                name: "Test DAC".into(),
                exclusive: ex,
                mix: Some(Format { rate: if dev.unwrap_or(self.endpoint()) == "fake-spare" { self.changed_mix.unwrap_or(self.mix) } else { self.mix }, ch: 2, fmt: SFmt::F32, exclusive: false }),
                why_not: if self.busy { Some("busy".into()) } else { None },
            })
        }
        fn open(&mut self, _dev: Option<&str>, f: &Format) -> Result<Box<dyn Stream>, String> {
            if f.exclusive && (self.busy || self.exclusive_open_fails) {
                return Err("busy".into());
            }
            if self.lost.load(Ordering::Relaxed) && self.failed_opens < self.fail_after_loss {
                self.failed_opens += 1;
                return Err("simulated endpoint unavailable".into());
            }
            self.n += 1;
            let file = self.dump.as_ref().map(|p| {
                let path = format!("{}-{}-{}-{}-{}.raw", p, self.n, f.rate, f.fmt.name(), if f.exclusive { "ex" } else { "sh" });
                std::fs::File::create(path).expect("dump")
            });
            let bufn = (f.rate as usize) / 20; // 50 ms
            let speed = if self.stall_exclusive && f.exclusive { 0.0 } else { self.speed };
            Ok(Box::new(FakeStream { f: *f, bufn, written: 0, t0: None, file, speed, clock_reset: self.clock_reset, lose_after: self.lose_after, lost: self.lost.clone(), crash_after: self.crash_after }))
        }
        fn hw_gain(&mut self, _dev: Option<&str>, db: f64) -> Option<(f64, f64)> {
            let (base, to) = hw_target(self.hw?, self.hw_adjustment, db, -60.0, 0.0);
            self.hw = Some(to);
            self.hw_adjustment = (db != 0.0).then_some((base, to));
            Some((to - base, to))
        }
    }
    impl Fake {
        fn endpoint(&self) -> &'static str {
            if (self.lost.load(Ordering::Relaxed) && self.changed_mix.is_some())
                || self.switch_default_after.is_some_and(|t| self.born.elapsed().as_secs_f64() >= t) {
                "fake-spare"
            } else { "fake-dac" }
        }
    }
    struct FakeStream {
        f: Format,
        bufn: usize,
        written: u64,
        t0: Option<Instant>,
        file: Option<std::fs::File>,
        speed: f64,
        clock_reset: Option<f64>,
        lose_after: Option<f64>,
        lost: Arc<AtomicBool>,
        crash_after: Option<f64>,
    }
    impl FakeStream {
        fn consumed(&self) -> u64 {
            match self.t0 {
                Some(t) => ((t.elapsed().as_secs_f64() * self.speed * self.f.rate as f64) as u64).min(self.written),
                None => 0,
            }
        }
    }
    impl Stream for FakeStream {
        fn space(&mut self) -> Result<usize, StreamFailure> {
            Ok(self.bufn - self.padding()?)
        }
        fn padding(&mut self) -> Result<usize, StreamFailure> {
            if self.t0.zip(self.crash_after).is_some_and(|(start, after)| start.elapsed().as_secs_f64() >= after) {
                std::process::exit(13);
            }
            if self.t0.zip(self.lose_after).is_some_and(|(start, after)| start.elapsed().as_secs_f64() >= after)
                && !self.lost.swap(true, Ordering::Relaxed) {
                return Err(StreamFailure::new("device-invalidated", "simulated endpoint invalidated"));
            }
            Ok((self.written - self.consumed()) as usize)
        }
        fn write(&mut self, data: &[u8], frames: usize) -> Result<(), StreamFailure> {
            if data.len() != frames * self.f.ch * self.f.fmt.bytes() {
                return Err(StreamFailure::new("write", "unexpected frame byte length"));
            }
            if let Some(file) = self.file.as_mut() {
                file.write_all(data).map_err(|e| StreamFailure::new("write", e.to_string()))?;
            }
            self.written += frames as u64;
            Ok(())
        }
        fn start(&mut self) -> Result<(), StreamFailure> {
            // the clock runs from the first frame on: a full buffer was written before the start
            self.t0 = Some(Instant::now());
            Ok(())
        }
        fn stop(&mut self) {}
        fn clock(&mut self) -> Option<Observation> {
            let elapsed = self.t0?.elapsed().as_secs_f64();
            let qpc = 10_000_000 + (elapsed * 10_000_000.0) as u64;
            let mut units = self.consumed() * 4; // deliberately not frames
            if self.clock_reset.is_some_and(|after| elapsed >= after) { units = 0; }
            Some(Observation { units, frequency: self.f.rate as u64 * 4, qpc_100ns: qpc, now_100ns: qpc, simulated: true })
        }
    }
}

/* ---------- WASAPI ---------- */
#[cfg(windows)]
pub mod wasapi_be {
    use super::*;
    use wasapi::*;
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{IAudioClock, IAudioClock2};

    pub struct Wasapi {
        en: Option<DeviceEnumerator>,
        hw: std::collections::HashMap<String, (f64, f64)>, // user's base and the last level we wrote
        com: bool,
    }
    impl Wasapi {
        pub fn new() -> Self {
            let com = initialize_mta().is_ok();
            Wasapi { en: DeviceEnumerator::new().ok(), hw: Default::default(), com }
        }
        fn device(&self, id: Option<&str>) -> Result<Device, String> {
            let en = self.en.as_ref().ok_or("no audio system")?;
            match id {
                Some(id) => en.get_device(id).map_err(|e| e.to_string()),
                None => en.get_default_device(&Direction::Render).map_err(|e| e.to_string()),
            }
        }
    }
    impl Drop for Wasapi {
        fn drop(&mut self) {
            self.en = None;
            if self.com { deinitialize(); }
        }
    }
    fn format(m: &WaveFormat, exclusive: bool) -> Result<Format, String> {
        let bits = m.get_validbitspersample();
        let fmt = match (m.get_subformat().map_err(|e| e.to_string())?, m.get_bitspersample(), bits) {
            (SampleType::Float, 32, _) => SFmt::F32,
            (SampleType::Int, 32, 32) => SFmt::I32,
            (SampleType::Int, 32, 24) => SFmt::I32v24,
            (SampleType::Int, 24, 24) => SFmt::I24,
            (SampleType::Int, 16, 16) => SFmt::I16,
            _ => return Err("unsupported endpoint sample layout".into()),
        };
        Ok(Format { rate: m.get_samplespersec(), ch: m.get_nchannels() as usize, fmt, exclusive })
    }
    fn wf(f: SFmt, rate: u32, ch: usize) -> WaveFormat {
        let (store, valid, t) = match f {
            SFmt::I32 => (32, 32, SampleType::Int),
            SFmt::I32v24 => (32, 24, SampleType::Int),
            SFmt::I24 => (24, 24, SampleType::Int),
            SFmt::I16 => (16, 16, SampleType::Int),
            SFmt::F32 => (32, 32, SampleType::Float),
        };
        WaveFormat::new(store, valid, &t, rate as usize, ch, None)
    }
    impl Backend for Wasapi {
        fn default_id(&mut self) -> Option<String> {
            self.device(None).ok()?.get_id().ok()
        }
        fn usable(&mut self, dev: &str) -> bool {
            let Some(en) = self.en.as_ref() else { return false };
            matches!(en.get_device(dev).and_then(|d| d.get_state()), Ok(DeviceState::Active))
        }
        fn devices(&mut self) -> Vec<DevInfo> {
            let Some(en) = self.en.as_ref() else { return vec![] };
            let def = en.get_default_device(&Direction::Render).ok().and_then(|d| d.get_id().ok());
            let mut out = vec![];
            if let Ok(col) = en.get_device_collection(&Direction::Render) {
                for d in col.into_iter().flatten() {
                    if let (Ok(id), Ok(name)) = (d.get_id(), d.get_friendlyname()) {
                        out.push(DevInfo { default: def.as_deref() == Some(id.as_str()), id, name });
                    }
                }
            }
            out
        }
        fn probe(&mut self, dev: Option<&str>) -> Result<Caps, String> {
            let d = self.device(dev)?;
            let name = d.get_friendlyname().unwrap_or_default();
            let client = d.get_iaudioclient().map_err(|e| e.to_string())?;
            let mix = client.get_mixformat().ok().and_then(|m| format(&m, false).ok());
            let mut ex = vec![];
            let mut why = None;
            for &r in RATES.iter() {
                for &f in SFmt::PREF.iter() {
                    match client.is_supported_exclusive_with_quirks(&wf(f, r, 2)) {
                        Ok(_) => ex.push((r, f)),
                        Err(WasapiError::Windows(e)) if e.code() == windows::Win32::Media::Audio::AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED => {
                            why = Some("exclusive-not-allowed".to_string());
                        }
                        Err(_) => {}
                    }
                }
                if why.is_some() {
                    break;
                }
            }
            if ex.is_empty() && why.is_none() {
                why = Some("no-exclusive-format".into());
            }
            Ok(Caps { name, exclusive: ex, mix, why_not: why })
        }
        fn open(&mut self, dev: Option<&str>, f: &Format) -> Result<Box<dyn Stream>, String> {
            let d = self.device(dev)?;
            let mut client = d.get_iaudioclient().map_err(|e| e.to_string())?;
            let fmt = if f.exclusive {
                client.is_supported_exclusive_with_quirks(&wf(f.fmt, f.rate, f.ch)).map_err(|e| e.to_string())?
            } else {
                client.get_mixformat().map_err(|e| e.to_string())?
            };
            let block = fmt.get_blockalign() as usize;
            if format(&fmt, f.exclusive)? != *f || block != f.ch * f.fmt.bytes() {
                return Err("endpoint format changed during initialization".into());
            }
            if f.exclusive {
                // polling (not event) timing: it works with more drivers, and USB DACs on the standard Windows driver do
                // not stutter with it. The device period as Windows suggests it, a buffer of about 60 ms.
                let (def, _min) = client.get_device_period().map_err(|e| e.to_string())?;
                let period = client.calculate_aligned_period_near(def, Some(128), &fmt).map_err(|e| e.to_string())?;
                let buffer = client.calculate_aligned_period_near(600_000, Some(128), &fmt).map_err(|e| e.to_string())?.max(period * 2);
                let mode = StreamMode::PollingExclusive { buffer_duration_hns: buffer, period_hns: period };
                if let Err(e) = client.initialize_client(&fmt, &Direction::Render, &mode) {
                    let aligned = matches!(&e, WasapiError::Windows(w) if w.code() == windows::Win32::Media::Audio::AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED);
                    if !aligned {
                        return Err(e.to_string());
                    }
                    // the driver wants another size: take the one it names and initialise a fresh client with it
                    let n = client.get_buffer_size().map_err(|e| e.to_string())?;
                    let p = calculate_period_100ns(n as i64, f.rate as i64);
                    client = d.get_iaudioclient().map_err(|e| e.to_string())?;
                    let mode = StreamMode::PollingExclusive { buffer_duration_hns: p.max(buffer), period_hns: p };
                    client.initialize_client(&fmt, &Direction::Render, &mode).map_err(|e| e.to_string())?;
                }
            } else {
                let mode = StreamMode::PollingShared { autoconvert: false, buffer_duration_hns: 600_000 };
                client.initialize_client(&fmt, &Direction::Render, &mode).map_err(|e| e.to_string())?;
            }
            let render = client.get_audiorenderclient().map_err(|e| e.to_string())?;
            let capacity = client.get_buffer_size().map_err(|e| e.to_string())? as usize;
            let audio_clock = unsafe { client.as_iaudioclient().GetService::<IAudioClock>().ok() };
            let endpoint_clock = if f.exclusive { None } else {
                audio_clock.as_ref().and_then(|clock| clock.cast().ok())
            };
            let clock = audio_clock.and_then(|clock| {
                let frequency = unsafe { clock.GetFrequency().ok()? };
                let mut qpc_hz = 0;
                unsafe { windows::Win32::System::Performance::QueryPerformanceFrequency(&mut qpc_hz).ok()?; }
                (frequency > 0 && qpc_hz > 0).then_some((clock, frequency, qpc_hz as u64))
            });
            let latency = unsafe { client.as_iaudioclient().GetStreamLatency().ok() };
            Ok(Box::new(WStream { client, render, block, capacity, clock, latency, endpoint_clock }))
        }
        fn hw_gain(&mut self, dev: Option<&str>, db: f64) -> Option<(f64, f64)> {
            let d = self.device(dev).ok()?;
            let key = d.get_id().ok()?;
            let prior = self.hw.get(&key).copied();
            let (base, to) = unsafe { endpoint_gain(d.as_immdevice(), prior, db) }.ok().flatten()?;
            if db == 0.0 { self.hw.remove(&key); }
            else { self.hw.insert(key, (base, to)); }
            Some((to - base, to))
        }
    }
    // the device's endpoint volume, only when the device applies it in its own hardware (then exclusive mode keeps it, and
    // the stream itself is never touched); Ok(None) when the device has no hardware volume
    unsafe fn endpoint_gain(d: &windows::Win32::Media::Audio::IMMDevice, prior: Option<(f64, f64)>, db: f64) -> windows::core::Result<Option<(f64, f64)>> {
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::Media::Audio::ENDPOINT_HARDWARE_SUPPORT_VOLUME;
        use windows::Win32::System::Com::CLSCTX_ALL;
        let ev: IAudioEndpointVolume = d.Activate(CLSCTX_ALL, None)?;
        if ev.QueryHardwareSupport()? & ENDPOINT_HARDWARE_SUPPORT_VOLUME == 0 {
            return Ok(None);
        }
        let (mut mn, mut mx, mut step) = (0f32, 0f32, 0f32);
        ev.GetVolumeRange(&mut mn, &mut mx, &mut step)?;
        let level = ev.GetMasterVolumeLevel()? as f64;
        let (base, to) = hw_target(level, prior, db, mn as f64, mx as f64);
        if (level - to).abs() >= 0.05 { ev.SetMasterVolumeLevel(to as f32, std::ptr::null())?; }
        Ok(Some((base, ev.GetMasterVolumeLevel()? as f64)))
    }
    struct WStream {
        client: AudioClient,
        render: AudioRenderClient,
        block: usize,
        capacity: usize,
        clock: Option<(IAudioClock, u64, u64)>,
        latency: Option<i64>,
        endpoint_clock: Option<IAudioClock2>,
    }
    fn stream_failure(operation: &'static str, error: WasapiError) -> StreamFailure {
        use windows::Win32::Media::Audio::{
            AUDCLNT_E_DEVICE_INVALIDATED, AUDCLNT_E_RESOURCES_INVALIDATED, AUDCLNT_E_SERVICE_NOT_RUNNING,
        };
        let kind = match &error {
            WasapiError::Windows(e) if e.code() == AUDCLNT_E_DEVICE_INVALIDATED => "device-invalidated",
            WasapiError::Windows(e) if e.code() == AUDCLNT_E_RESOURCES_INVALIDATED => "resources-invalidated",
            WasapiError::Windows(e) if e.code() == AUDCLNT_E_SERVICE_NOT_RUNNING => "service-unavailable",
            _ => operation,
        };
        StreamFailure::new(kind, error.to_string())
    }
    impl Stream for WStream {
        fn space(&mut self) -> Result<usize, StreamFailure> {
            Ok(self.capacity.saturating_sub(self.padding()?))
        }
        fn padding(&mut self) -> Result<usize, StreamFailure> {
            self.client.get_current_padding().map(|x| x as usize).map_err(|e| stream_failure("padding", e))
        }
        fn write(&mut self, data: &[u8], frames: usize) -> Result<(), StreamFailure> {
            debug_assert_eq!(data.len(), frames * self.block);
            self.render.write_to_device(frames, data, None).map_err(|e| stream_failure("write", e))
        }
        fn start(&mut self) -> Result<(), StreamFailure> {
            self.client.start_stream().map_err(|e| stream_failure("start", e))
        }
        fn stop(&mut self) {
            let _ = self.client.stop_stream();
        }
        fn clock(&mut self) -> Option<Observation> {
            let (clock, frequency, qpc_hz) = self.clock.as_ref()?;
            let (mut units, mut qpc_100ns) = (0, 0);
            // The Result wrapper treats S_FALSE as success, but WASAPI flags these samples as imprecise.
            let status = unsafe { (clock.vtable().GetPosition)(clock.as_raw(), &mut units, &mut qpc_100ns) };
            if status != windows::Win32::Foundation::S_OK { return None; }
            let mut qpc = 0;
            unsafe { windows::Win32::System::Performance::QueryPerformanceCounter(&mut qpc).ok()?; }
            let now_100ns = (qpc as u128 * 10_000_000 / *qpc_hz as u128) as u64;
            Some(Observation { units, frequency: *frequency, qpc_100ns, now_100ns, simulated: false })
        }
        fn latency_100ns(&self) -> Option<i64> { self.latency }
        fn endpoint_position(&mut self) -> Option<(u64, u64)> {
            let clock = self.endpoint_clock.as_ref()?;
            let (mut frame, mut qpc) = (0, 0);
            let status = unsafe { (clock.vtable().GetDevicePosition)(clock.as_raw(), &mut frame, &mut qpc) };
            (status == windows::Win32::Foundation::S_OK && qpc != 0).then_some((frame, qpc))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::hw_target;
    #[test]
    fn hardware_restore_preserves_an_external_master_change() {
        assert_eq!(hw_target(-26.0, Some((-20.0, -26.0)), 0.0, -60.0, 0.0), (-20.0, -20.0));
        assert_eq!(hw_target(-16.0, Some((-20.0, -26.0)), 0.0, -60.0, 0.0), (-16.0, -16.0));
        assert_eq!(hw_target(-16.0, Some((-20.0, -26.0)), -3.0, -60.0, 0.0), (-16.0, -19.0));
    }
    #[test]
    fn hw_offset_keeps_the_users_level() {
        assert_eq!(hw_target(-20.0, None, -6.0, -60.0, 0.0), (-20.0, -26.0));
        assert_eq!(hw_target(-26.0, Some((-20.0, -26.0)), 2.0, -60.0, 0.0), (-20.0, -18.0));
        assert_eq!(hw_target(-2.0, None, 6.0, -60.0, 0.0), (-2.0, 0.0));
    }
}
