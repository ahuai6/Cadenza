import { AudioSampleSink, Input, UrlSource, OGG, MATROSKA, MP4, ADTS } from 'mediabunny';
import { AnalysisFeatures, consumePcm } from './file-analysis';
import { NeuralWindows } from './neural-windows';
import type { NeuralRhythm } from './neural/types';

type Init = {
  url: string;
  duration: number;
  engine: 'dsp' | 'auto' | 'neural';
  onlyLoudness: boolean;
  browser: boolean;
  drums: boolean;
  preview: boolean;
};
let receive: ((value: NeuralRhythm | null) => void) | null = null;
let receiveBeats: ((value: NeuralRhythm) => void) | null = null;
let running = false;
self.onmessage = (event: MessageEvent<Init | { neural: NeuralRhythm | null } | { neuralBeats: NeuralRhythm }>) => {
  if ('neuralBeats' in event.data) {
    receiveBeats?.(event.data.neuralBeats);
  } else if ('neural' in event.data) {
    receive?.(event.data.neural);
    receive = receiveBeats = null;
  } else if (!running) {
    running = true;
    void run(event.data).catch((error) => self.postMessage({ error: String(error?.message || error) }));
  }
};

async function browserPcm(
  url: string,
  start: (channels: number, rate: number) => void,
  push: (values: Float32Array[]) => Promise<void>,
) {
  const input = new Input({
    source: new UrlSource(url, {
      maxCacheSize: 2 * 1024 * 1024,
      parallelism: 1,
      requestInit: { priority: 'low' },
      getRetryDelay: () => null,
    }),
    formats: [OGG, MATROSKA, MP4, ADTS],
  });
  let rate = 0,
    count = 0,
    cursor = 0;
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no compatible audio track');
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        if (!rate) {
          rate = sample.sampleRate;
          count = Math.min(sample.numberOfChannels, 2);
          start(count, rate);
        }
        if (sample.sampleRate !== rate || sample.numberOfChannels < count)
          throw new Error('analysis audio format changed');
        const at = Math.round(sample.timestamp * rate);
        // Container clocks can be rounded to a millisecond. Keep adjacent packets contiguous;
        // larger gaps represent silence on the media timeline, not a change in decoded sample rate.
        let gap = at - cursor;
        if (Math.abs(gap) <= rate / 500) gap = 0;
        if (gap > 60 * rate) throw new Error('analysis timeline discontinuity');
        while (gap > 0) {
          const n = Math.min(gap, 4096);
          await push(Array.from({ length: count }, () => new Float32Array(n)));
          cursor += n;
          gap -= n;
        }
        const skip = Math.max(0, -gap);
        if (skip >= sample.numberOfFrames) continue;
        const channels = Array.from({ length: count }, (_, planeIndex) => {
          const channel = new Float32Array(sample.numberOfFrames);
          sample.copyTo(channel, { planeIndex, format: 'f32-planar' });
          return channel.subarray(skip);
        });
        await push(channels);
        cursor += channels[0].length;
      } finally {
        sample.close();
      }
    }
  } finally {
    input.dispose();
  }
}

async function run({ url, duration, engine, onlyLoudness, browser, drums, preview }: Init) {
  let features!: AnalysisFeatures;
  let neural: NeuralWindows | null = null;
  let rate = 0;
  let frames = 0;
  let lastProgress = 0;
  const start = (channels: number, sampleRate: number) => {
    rate = sampleRate;
    features = new AnalysisFeatures(
      channels,
      rate,
      onlyLoudness,
      preview
        ? (slice) => (self as unknown as Worker).postMessage({ preview: slice }, [slice.samples.buffer])
        : undefined,
    );
    if (engine !== 'dsp' && !onlyLoudness)
      neural = new NeuralWindows(
        rate,
        channels,
        (window, sampleRate, onBeats) =>
          new Promise((resolve) => {
            receive = resolve;
            receiveBeats = onBeats;
            (self as unknown as Worker).postMessage(
              { window, sampleRate },
              window.map((channel) => channel.buffer),
            );
          }),
        preview ? (slice) => self.postMessage({ preview: slice }) : undefined,
      );
  };
  const push = async (channels: Float32Array[]) => {
    features.push(channels);
    frames += channels[0].length;
    if (frames / rate - lastProgress > 0.5) {
      lastProgress = frames / rate;
      self.postMessage({ progress: Math.min(0.9, duration > 0 ? (0.9 * lastProgress) / duration : 0) });
    }
    await neural?.push(channels);
  };
  if (browser) await browserPcm(url, start, push);
  else {
    const res = await fetch(url, { priority: 'low' });
    if (!res.ok || !res.body)
      throw new Error(res.status === 503 ? 'analysis decoder busy' : 'analysis media unavailable');
    await consumePcm(res.body, start, push);
  }
  if (!frames) throw new Error('analysis audio is empty');
  if (onlyLoudness) self.postMessage({ loudness: features.loudness() });
  else {
    const reading = neural && (await (neural as NeuralWindows).finish());
    self.postMessage({ stage: 'merge' });
    if (engine === 'neural' && !reading && features.loudness().peak >= 1e-7)
      throw new Error('neural engine unavailable');
    const analysis = features.finish({
      neural: reading,
      progress: (p) => self.postMessage({ progress: 0.9 + p * 0.1 }),
    });
    if (engine === 'neural' && analysis.engine !== 'neural' && analysis.beatEvidence !== 'none')
      throw new Error('neural beat evidence unavailable');
    if (drums && analysis.engine === 'neural' && analysis.stems === 'skipped') analysis.stems = 'failed';
    self.postMessage({ analysis });
  }
}
