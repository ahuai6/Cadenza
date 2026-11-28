// Standard playback reads songs as PCM decoded by the native core (`--play-pcm`): stereo float samples at the song's
// own rate, from any position (the page's player resamples continuously across songs). The page's player owns each
// stream and cancels it on a seek or a change of song; the pipe's backpressure keeps decoding a few seconds ahead of
// what the player has taken. See docs/parts/engine.md.
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { binPath } = require('./audio.cjs');

const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' };
// the playing song, the next one decoding ahead, and a replaced stream still closing
const MAX_STREAMS = 4;
const streams = new Set();

function playbackPcm(file, request, start) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers });
  if (!Number.isFinite(start) || start < 0) return new Response(null, { status: 400, headers });
  if (request.signal.aborted) return new Response(null, { status: 499, headers });
  if (streams.size >= MAX_STREAMS) return new Response(null, { status: 503, headers });
  const child = spawn(binPath(), ['--play-pcm', file, String(start)], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  streams.add(child);
  const abort = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  request.signal.addEventListener('abort', abort, { once: true });
  child.on('error', (error) => child.stdout.destroy(error));
  child.on('close', () => {
    request.signal.removeEventListener('abort', abort);
    streams.delete(child);
  });
  const source = Readable.toWeb(child.stdout, {
    strategy: { highWaterMark: 128 * 1024, size: (chunk) => chunk.byteLength },
  }).getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        abort();
        controller.error(error);
      }
    },
    cancel(reason) {
      abort();
      return source.cancel(reason);
    },
  });
  return new Response(stream, { headers });
}

function closePlayback() {
  for (const child of streams) child.kill();
  streams.clear();
}

module.exports = { playbackPcm, closePlayback };
