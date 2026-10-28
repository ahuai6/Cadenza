// The protocol with the app: one JSON object per line, commands on stdin, events on stdout.
use serde::Deserialize;
use std::io::Write;

#[derive(Deserialize, Debug)]
#[serde(tag = "cmd", rename_all = "lowercase")]
pub enum Cmd {
    Devices,
    Config {
        device: Option<String>,
        mode: Option<String>, // "exclusive" | "shared"
        release_after: Option<f64>,
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
    },
    Pause,
    Stop,
    Release,
    Gain {
        g: f64,
    },
    Quit,
}

pub fn emit(v: serde_json::Value) {
    let out = std::io::stdout();
    let mut l = out.lock();
    let _ = writeln!(l, "{v}");
    let _ = l.flush();
}
