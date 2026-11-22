// The desktop app's Hi-Fi output process. It decodes the music file and negotiates the actual WASAPI device format.
// Samples can be passed through at source precision when the exclusive format and playback processing allow it.
// The app talks to it over stdin/stdout (see proto.rs); when the app goes away, stdin closes and it stops cleanly.
mod clock;
mod decode;
mod identity;
mod output;
mod player;
mod proto;

use std::io::BufRead;
use std::sync::mpsc;

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if !args.is_empty() {
        let result = match args.as_slice() {
            [cmd, path] if cmd == "--audio-identity" => identity::write(path),
            [cmd, path] if cmd == "--alac-info" => decode::alac_command(path, None),
            [cmd, path, first, count] if cmd == "--alac-pcm" => match (first.parse(), count.parse()) {
                (Ok(first), Ok(count)) => decode::alac_command(path, Some((first, count))),
                _ => Err("invalid ALAC frame range".into()),
            },
            _ => Err("unknown audio command".into()),
        };
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let events = proto::start_writer();
    let (tx, rx) = mpsc::sync_channel::<proto::Cmd>(128);
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
    proto::finish_writer(events);
}
