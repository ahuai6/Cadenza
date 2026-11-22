//! A versioned proof of encoded audio packets and their playback configuration.
use sha2::{Digest, Sha256};
use std::{fs::File, path::Path};
use symphonia::core::{
    formats::{probe::Hint, FormatOptions, TrackType},
    io::MediaSourceStream,
    meta::MetadataOptions,
};

fn field(hash: &mut Sha256, data: &[u8]) {
    hash.update((data.len() as u64).to_le_bytes());
    hash.update(data);
}

pub fn write(file: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::System::Threading::{
            GetCurrentProcess, SetPriorityClass, PROCESS_MODE_BACKGROUND_BEGIN,
        };
        // This command runs in its own child, so lowering I/O priority cannot affect WASAPI or the renderer.
        let _ = unsafe { SetPriorityClass(GetCurrentProcess(), PROCESS_MODE_BACKGROUND_BEGIN) };
    }
    let source = File::open(file).map_err(|err| err.to_string())?;
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(file).extension().and_then(|ext| ext.to_str()) {
        hint.with_extension(ext);
    }
    let mut reader = symphonia::default::get_probe()
        .probe(
            &hint,
            MediaSourceStream::new(Box::new(source), Default::default()),
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|err| err.to_string())?;
    let default = reader
        .default_track(TrackType::Audio)
        .ok_or("missing audio track")?
        .id;
    let mut tracks = Vec::new();
    for track in reader.tracks() {
        let Some(p) = track.codec_params.as_ref().and_then(|p| p.audio()) else {
            continue;
        };
        let mut hash = Sha256::new();
        // Symphonia 0.6.1 is part of this version's encoding contract. Ignore tags, track labels,
        // verification checks and container-local identifiers such as Ogg serial numbers.
        let config = format!(
            "{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{}",
            p.codec,
            p.profile,
            p.sample_rate,
            p.sample_format,
            p.bits_per_sample,
            p.bits_per_coded_sample,
            p.channels,
            p.frames_per_block,
            track.time_base,
            track.delay,
            track.padding,
            track.start_ts.get()
        );
        field(&mut hash, config.as_bytes());
        field(&mut hash, p.extra_data.as_deref().unwrap_or(&[]));
        tracks.push((track.id, hash, 0_u64));
    }
    while let Some(packet) = reader.next_packet().map_err(|err| err.to_string())? {
        let Some((_, hash, count)) = tracks.iter_mut().find(|(id, _, _)| *id == packet.track_id)
        else {
            continue;
        };
        hash.update(packet.pts.get().to_le_bytes());
        hash.update(packet.dts.get().to_le_bytes());
        hash.update(packet.dur.get().to_le_bytes());
        hash.update(packet.trim_start.get().to_le_bytes());
        hash.update(packet.trim_end.get().to_le_bytes());
        field(hash, &packet.data);
        *count += 1;
    }
    if tracks.is_empty() || tracks.iter().any(|(_, _, count)| *count == 0) {
        return Err("missing audio packets".into());
    }
    let mut hash = Sha256::new();
    hash.update(b"cadenza/audio/packets/v1\0");
    for (id, track, count) in tracks {
        hash.update([u8::from(id == default)]);
        hash.update(count.to_le_bytes());
        hash.update(track.finalize());
    }
    println!(
        "{{\"container\":\"{}\",\"digest\":\"{:x}\"}}",
        reader.format_info().short_name,
        hash.finalize()
    );
    Ok(())
}
