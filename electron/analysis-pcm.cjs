const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { binPath } = require('./audio.cjs');

let decoder;
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' };

function analysisPcm(file, request, metrics) {
  if (request.method !== 'GET' || request.headers.has('range')) return new Response(null, { status: 405, headers });
  if (request.signal.aborted || decoder) return new Response(null, { status: 503, headers });
  const child = spawn(binPath(), ['--analysis-pcm', file], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  decoder = child;
  metrics.decodeStreams++;
  const abort = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
  request.signal.addEventListener('abort', abort, { once: true });
  child.on('error', (error) => child.stdout.destroy(error));
  child.on('close', (code) => {
    if (code === 0) metrics.decodeCompleted++;
    request.signal.removeEventListener('abort', abort);
    if (decoder === child) decoder = undefined;
  });
  const source = Readable.toWeb(child.stdout, {
    strategy: {
      highWaterMark: 256 * 1024,
      size: (chunk) => chunk.byteLength,
    },
  }).getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await source.read();
        if (done) controller.close();
        else {
          metrics.decodedBytes += value.byteLength;
          controller.enqueue(value);
        }
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

module.exports = { analysisPcm, closeAnalysis: () => decoder?.kill() };
