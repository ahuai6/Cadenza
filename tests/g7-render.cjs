// Isolated Windows Electron renderer probe. Pass a Vite harness directory, output directory and optional --verify.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron } = require('playwright');
const serve = require('./serve.cjs');
const { initializeProfile, identifyBuild } = require('../electron/profile.cjs');

const [build, folder] = process.argv.slice(2);
const verify = process.argv.includes('--verify');
const pressure = process.argv.includes('--pressure');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g7-electron-'));
const profile = path.join(temp, 'profile');
fs.mkdirSync(profile);
initializeProfile(profile, identifyBuild(require('../package.json').version));
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ closeToTray: false, ui: 'classic' }));

async function resources(app) {
  const processes = await app.evaluate(({ app }) => app.getAppMetrics());
  if (process.platform !== 'win32') return { processes };
  const pids = processes
    .map(({ pid }) => pid)
    .filter(Number.isSafeInteger)
    .join('|');
  try {
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory |
        Where-Object Name -Match '^pid_(${pids})_' |
        Select-Object Name,DedicatedUsage,SharedUsage | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true, timeout: 8000 },
    );
    return { processes, gpuMemoryByProcess: stdout.trim() ? [].concat(JSON.parse(stdout)) : [] };
  } catch (error) {
    return { processes, gpuMemoryUnavailable: error.message };
  }
}

async function run() {
  fs.mkdirSync(folder, { recursive: true });
  const { server, url } = await serve(path.resolve(build));
  let app;
  try {
    const exe = process.env.CADENZA_TEST_EXE;
    const flags = ['--ignore-gpu-blocklist', '--use-angle=d3d11'];
    app = await _electron.launch({
      executablePath: exe || require('electron'),
      args: exe ? flags : [path.join(__dirname, '..'), ...flags],
      timeout: 30000,
      env: { ...process.env, CADENZA_USER_DATA: profile },
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => {
      const contexts = new Set();
      const gl = WebGL2RenderingContext.prototype;
      const canvases = [HTMLCanvasElement.prototype, OffscreenCanvas.prototype];
      for (const proto of canvases) {
        const call = proto.getContext;
        proto.getContext = function (type, ...options) {
          const ctx = call.call(this, type, ...options);
          if (type === 'webgl2' && ctx) contexts.add(ctx);
          return ctx;
        };
      }
      const calls = {};
      for (const name of [
        'drawArrays',
        'drawElements',
        'drawArraysInstanced',
        'texImage2D',
        'texSubImage2D',
        'createTexture',
        'deleteTexture',
        'createFramebuffer',
        'deleteFramebuffer',
        'bindFramebuffer',
      ]) {
        const call = gl[name];
        gl[name] = function (...args) {
          const slot = (calls[name] ??= { count: 0, uploadBytes: 0, storageBytes: 0 });
          slot.count++;
          if (name.startsWith('tex')) {
            const src = args.at(-1);
            const explicit = name === 'texImage2D' ? 3 : 4;
            const w = src?.videoWidth || src?.width || (args.length >= 9 ? args[explicit] : 0);
            const h = src?.videoHeight || src?.height || (args.length >= 9 ? args[explicit + 1] : 0);
            const bytes = (w || 0) * (h || 0) * 4;
            if (src) slot.uploadBytes += bytes;
            if (name === 'texImage2D') slot.storageBytes += bytes;
          }
          return call.apply(this, args);
        };
      }
      window.g7 = { calls, contexts };
    });
    await page.goto(url + '/harness.html');
    await page.waitForFunction(() => !!window.H);
    const renderer = await page.evaluate(() => {
      const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      const name = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      g7.contexts.delete(gl);
      return name;
    });
    const cases = {};
    for (const size of [
      [1280, 720],
      [1920, 1080],
    ])
      for (const theme of ['liquid', 'sonnet', 'tempera']) {
        const key = `${theme}-${size[0]}`;
        const outcome = await page.evaluate(
          async ([theme, width, height]) => {
            H.engine.setAspectBox(16 / 9);
            const s = await H.open({ theme: theme === 'liquid' ? theme : 'cover' });
            if (theme !== 'liquid') s.style = { ...s.style, engine: theme };
            if (theme !== 'liquid' && s.style.engine !== theme) throw new Error('Wrong style under test');
            H.engine.setView('hidden');
            const canvas =
              document.querySelector('#gpu-g7') || document.body.appendChild(document.createElement('canvas'));
            canvas.id = 'gpu-g7';
            canvas.width = width;
            canvas.height = height;
            Object.assign(canvas.style, {
              position: 'fixed',
              inset: '0',
              width: '100vw',
              height: '100vh',
              zIndex: '999999',
            });
            const ctx = canvas.getContext('2d');
            const draw = (t) =>
              H.drawFrame(ctx, H.engine.frameAt(t, { offline: true, px: height / s.plan.H }), { sig: s.sig });
            window.g7.draw = draw;
            const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
            for (let i = 0; i < 15; i++) {
              await raf();
              draw(3);
            }
            let prev = await raf();
            const submit = [],
              cadence = [];
            const timers = [...g7.contexts]
              .map((gl) => ({ gl, ext: gl.getExtension('EXT_disjoint_timer_query_webgl2'), pending: [] }))
              .filter(({ ext }) => ext);
            for (let i = 0; i < 110; i++) {
              const now = await raf();
              if (i === 25) for (const key of Object.keys(g7.calls)) delete g7.calls[key];
              const start = performance.now();
              if (i >= 25)
                for (const { gl, ext, pending } of timers) {
                  const query = gl.createQuery();
                  gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
                  pending.push(query);
                }
              draw(2 + i / 9);
              if (i >= 25) {
                for (const { gl, ext } of timers) gl.endQuery(ext.TIME_ELAPSED_EXT);
                submit.push(performance.now() - start);
                cadence.push(now - prev);
              }
              prev = now;
            }
            const stats = (values) => {
              const sorted = [...values].sort((a, b) => a - b);
              const at = (p) => +sorted[Math.ceil(p * sorted.length) - 1].toFixed(3);
              return { p50: at(0.5), p95: at(0.95), p99: at(0.99) };
            };
            await raf();
            const gpu = timers.map(({ gl, ext, pending }) => {
              const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
              const values = [];
              for (const query of pending) {
                if (!disjoint && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE))
                  values.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1_000_000);
                gl.deleteQuery(query);
              }
              return { samples: values.length, ...(values.length ? stats(values) : {}) };
            });
            draw(12.1);
            return {
              submit: stats(submit),
              cadence: stats(cadence),
              fps: 1000 / (cadence.reduce((a, b) => a + b, 0) / cadence.length),
              gpu,
              calls: structuredClone(g7.calls),
              contexts: g7.contexts.size,
            };
          },
          [theme, ...size],
        );
        cases[key] = outcome;
        await page.locator('#gpu-g7').screenshot({ path: path.join(folder, key + '.png') });
        console.log(key, JSON.stringify(outcome));
      }
    let recovery, stress;
    if (verify) {
      recovery = await page.evaluate(async () => {
        const initial = H.folia.pixi.glRunner();
        const gl = initial.gl;
        const loss = gl.getExtension('WEBGL_lose_context');
        if (!loss) throw new Error('WEBGL_lose_context not available');
        const event = (name) =>
          new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Missing ' + name)), 5000);
            gl.canvas.addEventListener(
              name,
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true },
            );
          });
        const lost = event('webglcontextlost');
        loss.loseContext();
        await lost;
        g7.draw(11.25); // retained Canvas2D fallback during device loss
        const unavailable = !H.folia.pixi.glRunner().ok;
        const restored = event('webglcontextrestored');
        await new Promise((resolve) => setTimeout(resolve, 30));
        loss.restoreContext();
        await restored;
        g7.draw(12.1);
        const next = H.folia.pixi.glRunner();
        return { unavailable, restored: next.ok && next !== initial && next.gl === gl, error: gl.getError() };
      });
      assert.deepEqual(recovery, { unavailable: true, restored: true, error: 0 });
    }
    if (pressure) {
      const before = await resources(app);
      const sample = () =>
        page.evaluate(async (independentWorlds) => {
          const raster = document.querySelector('#gpu-g7');
          const ctx = raster.getContext('2d');
          const start = performance.now();
          for (let round = 0; round < 12; round++) {
            const s = await H.open({ theme: 'liquid' });
            H.engine.setAspectBox(16 / 10);
            const viewRatio = H.engine.viewAspect();
            if (Math.abs(viewRatio - 1.6) > 0.01) throw new Error('Invalid 16:10 drawable region');
            H.engine.setView('hidden');
            for (let frame = 0; frame < 40; frame++) {
              if (frame % 10 === 0) {
                const w = frame % 20 ? 1120 : 1600;
                raster.width = w;
                raster.height = Math.round(w / 1.6);
                s.style = {
                  ...s.style,
                  engine: ['sonnet', 'tempera', undefined, 'sonnet'][frame / 10],
                  fx: { ...s.style.fx, motes: (round & 1) === 0 },
                };
              }
              await new Promise((resolve) => requestAnimationFrame(resolve));
              const t = frame % 2 ? frame * 0.2 + 10 : 30 - frame * 0.3;
              const visual = H.engine.frameAt(t, { offline: true, px: raster.height / s.plan.H });
              if (
                independentWorlds &&
                s.style.engine &&
                (visual.cam.cam.z !== 1 || visual.cam.cam.x !== 0 || visual.cam.cam.r !== 0)
              )
                throw new Error('Native camera leaked into the Folia world');
              H.drawFrame(ctx, visual, { sig: s.sig });
            }
            H.engine.clear();
          }
          return { elapsedMs: performance.now() - start, frames: 480, contexts: g7.contexts.size };
        }, verify);
      const counts = await sample();
      const after = await resources(app);
      const repeated = await sample();
      const end = await resources(app);
      stress = { before, counts, after, repeated, end };
      if (verify) {
        assert.equal(counts.contexts, 1);
        assert.equal(repeated.contexts, 1);
      }
      console.log('Pressure:', JSON.stringify(stress));
    }
    const result = {
      renderer,
      cases,
      recovery,
      stress,
      errors,
      process: await app.evaluate(({ app }) => app.getAppMetrics()),
    };
    fs.writeFileSync(path.join(folder, 'metrics.json'), JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
    console.log(renderer, recovery || '', 'Evidence:', folder);
  } finally {
    await app?.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
