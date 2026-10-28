// cadenza-audio: the desktop app's Hi-Fi output. It reads the music file itself and sends it to the device at the file's own
// sample rate and full bit depth (WASAPI exclusive mode), so nothing in between mixes, resamples or changes it.
// The app talks to it over stdin/stdout (see proto.rs); when the app goes away, stdin closes and it stops cleanly.
mod decode;
mod output;
mod player;
mod proto;

use std::io::BufRead;
use std::sync::mpsc;

fn main() {
    let (tx, rx) = mpsc::channel::<proto::Cmd>();
    let th = std::thread::Builder::new().name("play".into()).spawn(move || player::run(rx)).expect("player thread");
    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<proto::Cmd>(&line) {
            Ok(c) => {
                let quit = matches!(c, proto::Cmd::Quit);
                if tx.send(c).is_err() || quit {
                    break;
                }
            }
            Err(e) => proto::emit(serde_json::json!({ "ev": "error", "code": "command", "msg": e.to_string() })),
        }
    }
    let _ = tx.send(proto::Cmd::Quit);
    let _ = th.join();
}
