// Collect synchronous drawing and browser frame cadence separately. Neither is a GPU timer query.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const [snapshot, output] = process.argv.slice(2);
const root = process.env.CADENZA_BASELINE_ROOT;
if (!root || path.dirname(output) !== root || fs.existsSync(output))
  throw new Error('Use the isolated baseline runner');
const serve = require(path.join(snapshot, 'tests/serve.cjs'));

async function main() {
  const { server, url } = await serve(path.join(snapshot, 'dist-harness'));
  let browser;
  try {
    browser = await chromium.launch({
      channel: 'chromium',
      args: process.platform === 'win32' ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] : [],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(url + '/harness.html');
    await page.waitForFunction(() => window.H);
    const result = await page.evaluate(async () => {
      const adapter = document.createElement('canvas').getContext('webgl2');
      const debug = adapter?.getExtension('WEBGL_debug_renderer_info');
      const renderer = debug
        ? adapter.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : adapter?.getParameter(adapter.RENDERER);
      adapter?.getExtension('WEBGL_lose_context')?.loseContext();
      const cv = document.createElement('canvas');
      cv.width = 1920;
      cv.height = 1080;
      document.body.replaceChildren(cv);
      const g = cv.getContext('2d');
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const workload = {};
      for (const theme of ['liquid', 'gothic', 'cover']) {
        const session = await H.open({ theme, coverUrl: 'cover.jpg' });
        H.engine.setView('hidden');
        const submit = [];
        const cadence = [];
        const scale = cv.height / session.plan.H;
        let previous = await nextFrame();
        for (let i = 0; i < 150; i++) {
          const now = await nextFrame();
          const t = ((i * 5) / 60) % session.musicEnd;
          const f = H.engine.frameAt(t, { offline: true, px: scale });
          const start = performance.now();
          g.setTransform(scale, 0, 0, scale, 0, 0);
          H.drawFrame(g, f, { sig: session.sig });
          if (i >= 30) {
            submit.push(performance.now() - start);
            cadence.push(now - previous);
          }
          previous = now;
        }
        workload[theme] = { submit, cadence };
      }
      return { renderer, browser: navigator.userAgent, viewport: [cv.width, cv.height], workload };
    });
    for (const workload of Object.values(result.workload)) {
      for (const metric of ['submit', 'cadence']) {
        const sorted = [...workload[metric]].sort((a, b) => a - b);
        const at = (p) => +sorted[Math.ceil(sorted.length * p) - 1].toFixed(1);
        workload[metric + 'Ms'] = { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
      }
    }
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(result.renderer || 'WebGL2 adapter could not be identified', result.viewport.join('×'));
    for (const [theme, workload] of Object.entries(result.workload))
      console.log(theme, { submitMs: workload.submitMs, cadenceMs: workload.cadenceMs });
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
