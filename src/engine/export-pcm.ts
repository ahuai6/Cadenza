type ReadPcm = (start: number, frames: number) => Float32Array<ArrayBuffer>;

/** The normal library decode already delivers 48 kHz PCM. Only resampling and speaker downmix need Web Audio. */
export async function exportPcm(
  audio: AudioBuffer,
  rate: number,
  length: number,
  offset: number,
  end: number,
  fade: boolean,
): Promise<ReadPcm> {
  const from = offset * rate;
  const fadeStart = Math.max(0.03, end - 1.6);
  if (audio.sampleRate === rate && audio.numberOfChannels <= 2 && Math.abs(Math.round(from) - from) < 1e-6) {
    const shift = Math.round(from);
    const left = audio.getChannelData(0);
    const right = audio.numberOfChannels === 1 ? left : audio.getChannelData(1);
    const last = Math.ceil(end * rate);
    return (start, frames) => {
      const data = new Float32Array(frames * 2);
      const a = Math.max(start, -shift);
      const b = Math.min(start + frames, last, left.length - shift);
      if (a >= b) return data;
      data.set(left.subarray(a + shift, b + shift), a - start);
      data.set(right.subarray(a + shift, b + shift), frames + a - start);
      const attenuate = (i: number, gain: number) => {
        data[i - start] *= gain;
        data[frames + i - start] *= gain;
      };
      const opening = 0.02 * rate;
      for (let i = a; i < Math.min(b, opening); i++) attenuate(i, i / opening);
      if (fade)
        for (let i = Math.max(a, Math.ceil(fadeStart * rate)); i < b; i++)
          attenuate(i, (end - i / rate) / (end - fadeStart));
      return data;
    };
  }

  const ctx = new OfflineAudioContext(2, length, rate);
  const src = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = audio;
  src.connect(gain).connect(ctx.destination);
  if (offset < 0) src.start(-offset, 0, Math.max(0, offset + end));
  else src.start(0, offset, end);
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, 0.02);
  if (fade) {
    gain.gain.setValueAtTime(1, fadeStart);
    gain.gain.linearRampToValueAtTime(0, end);
  }
  const mixed = await ctx.startRendering();
  const left = mixed.getChannelData(0);
  const right = mixed.getChannelData(1);
  return (start, frames) => {
    const data = new Float32Array(frames * 2);
    data.set(left.subarray(start, start + frames));
    data.set(right.subarray(start, start + frames), frames);
    return data;
  };
}
