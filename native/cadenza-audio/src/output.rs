// Audio devices. On Windows: WASAPI, exclusive (the app alone sets the device's rate and sample format, nothing mixes
// or resamples in between) or shared (through the system mixer). Anywhere, with CADENZA_AUDIO_FAKE set: a simulated device
// that consumes in real time and can record what it was sent, for the tests.
use serde::Serialize;

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

pub trait Stream {
    fn space(&mut self) -> Result<usize, String>;
    fn padding(&mut self) -> Result<usize, String>;
    fn write(&mut self, data: &[u8], frames: usize) -> Result<(), String>;
    fn start(&mut self) -> Result<(), String>;
    fn stop(&mut self);
}

pub trait Backend {
    fn devices(&mut self) -> Vec<DevInfo>;
    fn probe(&mut self, dev: Option<&str>) -> Result<Caps, String>;
    fn open(&mut self, dev: Option<&str>, f: &Format) -> Result<Box<dyn Stream>, String>;
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
/// The arithmetic of the hardware offset, shared by every backend: from the level now and the offset applied before,
/// the level to set (inside the device's range) and the offset that level really applies.
pub fn hw_offset(level: f64, applied: f64, want: f64, min: f64, max: f64) -> (f64, f64) {
    let base = level - applied;
    let to = (base + want).clamp(min, max);
    (to, to - base)
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

    pub struct Fake {
        rates: Vec<u32>,
        fmts: Vec<SFmt>,
        mix: u32,
        busy: bool,
        present: bool,
        dump: Option<String>,
        n: usize,
        hw: Option<(f64, f64)>, // a hardware volume: (the level in dB, the offset applied)
    }
    impl Fake {
        #[cfg(not(windows))]
        pub fn none() -> Self {
            Fake { rates: vec![], fmts: vec![], mix: 48000, busy: false, present: false, dump: None, n: 0, hw: None }
        }
        // "rates=44100,48000;fmts=i32,i16;mix=48000;busy=1;dump=/path/prefix"
        pub fn new(spec: &str) -> Self {
            let mut f = Fake { rates: RATES[..6].to_vec(), fmts: vec![SFmt::I32v24, SFmt::I16], mix: 48000, busy: false, present: true, dump: None, n: 0, hw: None };
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
                    "dump" => f.dump = Some(v.to_string()),
                    // "hwvol=-20": the device has a hardware volume, the user's level at -20 dB (range -60..0)
                    "hwvol" => f.hw = v.parse().ok().map(|l: f64| (l, 0.0)),
                    _ => {}
                }
            }
            f
        }
    }
    impl Backend for Fake {
        fn usable(&mut self, dev: &str) -> bool {
            self.present && dev == "fake-dac"
        }
        fn devices(&mut self) -> Vec<DevInfo> {
            if !self.present {
                return vec![];
            }
            vec![DevInfo { id: "fake-dac".into(), name: "Test DAC".into(), default: true }]
        }
        fn probe(&mut self, _dev: Option<&str>) -> Result<Caps, String> {
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
                mix: Some(Format { rate: self.mix, ch: 2, fmt: SFmt::F32, exclusive: false }),
                why_not: if self.busy { Some("busy".into()) } else { None },
            })
        }
        fn open(&mut self, _dev: Option<&str>, f: &Format) -> Result<Box<dyn Stream>, String> {
            if f.exclusive && self.busy {
                return Err("busy".into());
            }
            self.n += 1;
            let file = self.dump.as_ref().map(|p| {
                let path = format!("{}-{}-{}-{}-{}.raw", p, self.n, f.rate, f.fmt.name(), if f.exclusive { "ex" } else { "sh" });
                std::fs::File::create(path).expect("dump")
            });
            let bufn = (f.rate as usize) / 20; // 50 ms
            Ok(Box::new(FakeStream { f: *f, bufn, written: 0, t0: None, file }))
        }
        fn hw_gain(&mut self, _dev: Option<&str>, db: f64) -> Option<(f64, f64)> {
            let (level, applied) = self.hw?;
            let (to, got) = hw_offset(level, applied, db, -60.0, 0.0);
            self.hw = Some((to, got));
            Some((got, to))
        }
    }
    struct FakeStream {
        f: Format,
        bufn: usize,
        written: u64,
        t0: Option<Instant>,
        file: Option<std::fs::File>,
    }
    impl FakeStream {
        fn consumed(&self) -> u64 {
            match self.t0 {
                Some(t) => ((t.elapsed().as_secs_f64() * self.f.rate as f64) as u64).min(self.written),
                None => 0,
            }
        }
    }
    impl Stream for FakeStream {
        fn space(&mut self) -> Result<usize, String> {
            Ok(self.bufn - self.padding()?)
        }
        fn padding(&mut self) -> Result<usize, String> {
            Ok((self.written - self.consumed()) as usize)
        }
        fn write(&mut self, data: &[u8], frames: usize) -> Result<(), String> {
            if data.len() != frames * self.f.ch * self.f.fmt.bytes() {
                return Err("length".into());
            }
            if let Some(file) = self.file.as_mut() {
                file.write_all(data).map_err(|e| e.to_string())?;
            }
            self.written += frames as u64;
            Ok(())
        }
        fn start(&mut self) -> Result<(), String> {
            // the clock runs from the first frame on: a full buffer was written before the start
            self.t0 = Some(Instant::now());
            Ok(())
        }
        fn stop(&mut self) {}
    }
}

/* ---------- WASAPI ---------- */
#[cfg(windows)]
pub mod wasapi_be {
    use super::*;
    use wasapi::*;

    pub struct Wasapi {
        en: Option<DeviceEnumerator>,
        hw: std::collections::HashMap<String, f64>, // the offset applied to each device's hardware volume
    }
    impl Wasapi {
        pub fn new() -> Self {
            let _ = initialize_mta();
            Wasapi { en: DeviceEnumerator::new().ok(), hw: Default::default() }
        }
        fn device(&self, id: Option<&str>) -> Result<Device, String> {
            let en = self.en.as_ref().ok_or("no audio system")?;
            match id {
                Some(id) => en.get_device(id).or_else(|_| en.get_default_device(&Direction::Render)).map_err(|e| e.to_string()),
                None => en.get_default_device(&Direction::Render).map_err(|e| e.to_string()),
            }
        }
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
            let mix = client.get_mixformat().ok().map(|m| Format { rate: m.get_samplespersec(), ch: m.get_nchannels() as usize, fmt: SFmt::F32, exclusive: false });
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
            Ok(Box::new(WStream { client, render, block }))
        }
        fn hw_gain(&mut self, dev: Option<&str>, db: f64) -> Option<(f64, f64)> {
            let key = dev.unwrap_or("").to_string();
            let applied = *self.hw.get(&key).unwrap_or(&0.0);
            let d = self.device(dev).ok()?;
            let (to, got) = unsafe { endpoint_gain(d.as_immdevice(), applied, db) }.ok().flatten()?;
            self.hw.insert(key, got);
            Some((got, to))
        }
    }
    // the device's endpoint volume, only when the device applies it in its own hardware (then exclusive mode keeps it, and
    // the stream itself is never touched); Ok(None) when the device has no hardware volume
    unsafe fn endpoint_gain(d: &windows::Win32::Media::Audio::IMMDevice, applied: f64, db: f64) -> windows::core::Result<Option<(f64, f64)>> {
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
        let (to, got) = hw_offset(level, applied, db, mn as f64, mx as f64);
        ev.SetMasterVolumeLevel(to as f32, std::ptr::null())?;
        Ok(Some((to, got)))
    }
    struct WStream {
        client: AudioClient,
        render: AudioRenderClient,
        block: usize,
    }
    impl Stream for WStream {
        fn space(&mut self) -> Result<usize, String> {
            self.client.get_available_space_in_frames().map(|x| x as usize).map_err(|e| e.to_string())
        }
        fn padding(&mut self) -> Result<usize, String> {
            self.client.get_current_padding().map(|x| x as usize).map_err(|e| e.to_string())
        }
        fn write(&mut self, data: &[u8], frames: usize) -> Result<(), String> {
            debug_assert_eq!(data.len(), frames * self.block);
            self.render.write_to_device(frames, data, None).map_err(|e| e.to_string())
        }
        fn start(&mut self) -> Result<(), String> {
            self.client.start_stream().map_err(|e| e.to_string())
        }
        fn stop(&mut self) {
            let _ = self.client.stop_stream();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::hw_offset;
    #[test]
    fn hw_offset_keeps_the_users_level() {
        // the user at -20 dB; a song asks for -6: -26
        let (to, got) = hw_offset(-20.0, 0.0, -6.0, -60.0, 0.0);
        assert_eq!((to, got), (-26.0, -6.0));
        // the user turns it up to -16 meanwhile (their base is now -10); the next song asks for -3: -13
        let (to, got) = hw_offset(-16.0, -6.0, -3.0, -60.0, 0.0);
        assert_eq!((to, got), (-13.0, -3.0));
        // back to 0: the user's own level, whatever they changed
        let (to, got) = hw_offset(-13.0, -3.0, 0.0, -60.0, 0.0);
        assert_eq!((to, got), (-10.0, 0.0));
        // a boost past the top of the range stops at it, and says how much it really applied
        let (to, got) = hw_offset(-2.0, 0.0, 6.0, -60.0, 0.0);
        assert_eq!((to, got), (0.0, 2.0));
    }
}
