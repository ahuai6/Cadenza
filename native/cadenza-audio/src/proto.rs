// The protocol with the app: one JSON object per line, commands on stdin, events on stdout.
use serde::Deserialize;
use std::io::Write;
use std::sync::{mpsc::{sync_channel, SyncSender}, OnceLock};

#[derive(Deserialize, Debug)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum Cmd {
    Devices,
    Config {
        device: Option<String>,
        mode: Option<String>, // "exclusive" | "shared"
        release_after: Option<f64>,
        ticket: Option<u64>,
    },
    Load {
        id: String,
        path: String,
        #[serde(default)]
        next: bool,
        #[serde(default)]
        seq: u64,
    },
    Play {
        pos: f64,
        end: Option<f64>,
        seq: Option<u64>,
        #[serde(default)]
        run: u64,
    },
    Pause { seq: Option<u64> },
    Stop { seq: Option<u64> },
    Release,
    Closefile { ticket: u64, seq: u64 },
    Barrier { ticket: u64 },
    Clearnext,
    Gain {
        g: f64,
    },
    // the volume balance as the device's own hardware volume (dB from the user's level): the stream stays untouched
    Hwgain {
        db: f64,
    },
    Quit,
}

static EVENTS: OnceLock<SyncSender<Option<serde_json::Value>>> = OnceLock::new();

pub fn start_writer() -> std::thread::JoinHandle<()> {
    let (send, receive) = sync_channel::<Option<serde_json::Value>>(128);
    let _ = EVENTS.set(send);
    std::thread::Builder::new().name("events".into()).spawn(move || {
        let mut out = std::io::stdout().lock();
        while let Ok(Some(event)) = receive.recv() {
            if writeln!(out, "{event}").and_then(|_| out.flush()).is_err() { break; }
        }
    }).expect("event writer")
}

pub fn finish_writer(thread: std::thread::JoinHandle<()>) {
    if let Some(events) = EVENTS.get() { let _ = events.send(None); }
    let _ = thread.join();
}

pub fn emit(v: serde_json::Value) {
    if let Some(events) = EVENTS.get() {
        if v["ev"] == "pos" && v["run"] == true {
            // The next running observation can replace a stale one; lifecycle events still require delivery.
            let _ = events.try_send(Some(v));
        } else {
            let _ = events.send(Some(v));
        }
    }
}
