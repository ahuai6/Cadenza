const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');
const { identifyBuild, initializeProfile } = require('../electron/profile.cjs');
const { fields } = require('../electron/flac-lyrics.cjs');

const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cadenza-g55r-'));
const music = path.join(scratch, 'music');
const archive = path.join(scratch, 'second-root');
const reference = process.env.CADENZA_FLAC_SAMPLE;
const file = path.join(music, 'combined.flac');
const refCopy = path.join(music, 'sample.flac');
const tt = 'http://www.w3.org/ns/ttml';
const im = 'http://music.apple.com/lyric-ttml-internal';
const ttml = `<tt xmlns="${tt}" xmlns:itunes="${im}" xmlns:ttm="${tt}#metadata" xmlns:x="urn:fixture">
<head><itunes:iTunesMetadata><itunes:transliterations><itunes:transliteration xml:lang="ja-Latn">
<itunes:text for="a">michi</itunes:text></itunes:transliteration></itunes:transliterations></itunes:iTunesMetadata></head>
<body><div x:part="verse" ttm:agent="voice">
<p begin="1s" end="2s" itunes:key="a"><span begin="1s" end="1.7s">First</span> line<span ttm:role="x-bg">(echo)</span></p>

<p begin="2.1s" end="2.4s"></p>
<p begin="3s" end="3.7s" itunes:key="b">Again</p><x:marker mode="hold"/>
<p begin="6s" end="7s" itunes:key="c">Again</p></div></body><!-- Keep this --></tt>`;
const enhanced =
  '[00:01.40]First line\n[00:01.40]Translation one\n\n[00:02.40]\n' +
  '[00:03.24]Again\n[00:03.24]Translation two\n[00:06.32]Again\n[00:06.32]Translation three\n';
const synth = (location, codec, extra = []) =>
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=13',
      '-c:a',
      codec,
      ...extra,
      location,
    ],
    { windowsHide: true },
  );
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function oversizedWave(filename) {
  const header = Buffer.alloc(44);
  const bytes = 400 * 44100 * 4;
  header.write('RIFF');
  header.writeUInt32LE(bytes + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(176400, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes, 40);
  fs.writeFileSync(filename, header);
  fs.truncateSync(filename, bytes + header.length);
}
function init(profile, ui = 'space') {
  const dir = path.join(scratch, profile);
  fs.mkdirSync(dir);
  initializeProfile(dir, identifyBuild(require('../package.json').version));
  fs.mkdirSync(path.join(dir, 'library'));
  fs.writeFileSync(path.join(dir, 'library', 'db.json'), JSON.stringify({ version: 1, folders: [music, archive] }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ closeToTray: false, ui, rhythmEngine: 'dsp' }));
  return dir;
}
async function launch(profile) {
  const app = await _electron.launch({
    executablePath: process.env.CADENZA_TEST_EXE || require('electron'),
    args: process.env.CADENZA_TEST_EXE ? [] : [root, '--no-sandbox'],
    env: { ...process.env, CADENZA_USER_DATA: profile },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (error) => errors.push(error.message));
  try {
    await win.waitForFunction(
      () => window.__cadenza?.lib.get().tracks.some((track) => track.file === 'combined.flac' && track.audioContentId),
      undefined,
      { timeout: 30000 },
    );
    return { app, win, errors };
  } catch (error) {
    await app.close();
    throw error;
  }
}
async function nativeProcessCounters(app) {
  const pid = await app.evaluate(() => process.pid);
  assert.ok(Number.isSafeInteger(pid));
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object UserModeTime,KernelModeTime,ReadTransferCount,WriteTransferCount | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true, encoding: 'utf8', timeout: 15000 },
    ),
  );
}
const source = (win, id) => win.evaluate((id) => window.cadenzaLib.lyricSources(id), id);
async function waitFile(win, name) {
  const handle = await win.waitForFunction(
    (file) => window.__cadenza.lib.get().tracks.find((track) => track.file === file && track.audioContentId),
    name,
  );
  return handle.jsonValue();
}
async function activate(win, track) {
  await win.evaluate((id) => window.__cadenza.api.playIds([id], 0), track.id);
  await win.waitForFunction(
    (id) => window.__cadenza.player.get().shownId === id && !!window.__cadenza.player.get().session,
    track.id,
  );
}
async function setEditing(win, on) {
  const control = win.locator('[data-test=edit-mode]').first();
  if ((await control.getAttribute('aria-pressed')) !== String(on)) await control.click();
  await win.waitForFunction(
    (expected) => document.querySelector('[data-test=edit-mode]')?.getAttribute('aria-pressed') === expected,
    String(on),
  );
}
async function mutate(win, id, request) {
  return win.evaluate(({ id, request }) => window.cadenzaLib.mutateLyrics(id, request), { id, request });
}
const details = (win) => win.evaluate(() => window.cadenzaLib.taskDetails());
async function quiet(win) {
  await win.waitForFunction(() => {
    const value = window.__cadenza.lib.get();
    return value.progress.phase === 'idle' && !value.progress.queued && !value.progress.hashing;
  });
}

(async () => {
  fs.mkdirSync(music);
  fs.mkdirSync(archive);
  fs.mkdirSync(path.join(music, 'new-files'));
  synth(file, 'flac', [
    '-metadata',
    'TTML=' + ttml,
    '-metadata',
    'LYRICS=' + enhanced,
    '-metadata',
    'X_KEEP_SENTINEL=keep untouched',
  ]);
  synth(path.join(music, 'blank.flac'), 'flac');
  const mp3 = path.join(music, 'plain.mp3');
  synth(mp3, 'libmp3lame');
  require('../electron/tag-lyrics.cjs').write(mp3, 'id3', 'id3:new', enhanced);
  synth(path.join(music, 'plain.ogg'), 'libvorbis', ['-metadata', 'LYRICS=' + enhanced]);
  synth(path.join(music, 'plain.opus'), 'libopus', ['-metadata', 'LYRICS=' + enhanced]);
  for (let i = 0; i < 14; i++) fs.copyFileSync(path.join(music, 'blank.flac'), path.join(archive, 'f' + i + '.flac'));
  if (reference) fs.copyFileSync(reference, refCopy);
  const originalRef = reference && hash(reference);
  const profile = init('test');
  const run = await launch(profile);
  let firstId;
  let before;
  let after;
  try {
    const { win } = run;
    const track = await waitFile(win, 'combined.flac');
    firstId = track.id;
    const original = await source(win, track.id);
    assert.deepEqual(
      original.fields.map((field) => field.label),
      ['TTML', 'LYRICS'],
    );
    assert.equal(original.primary, original.fields[0].id);
    assert.equal((await mutate(win, track.id, { source: original.primary, text: 'blocked' })).why, 'editing-disabled');
    assert.equal((await win.evaluate(() => window.cadenzaLyricAI.state())).why, 'editing-disabled');
    await activate(win, track);
    await setEditing(win, true);
    await win.locator('#p-extra button').first().click();
    const panel = win.locator('[data-test=space-lyrics]');
    await panel.locator('header button').first().click();
    await panel.getByText('从增强 LRC 迁移译文', { exact: true }).click();
    await panel.getByLabel('参考来源').selectOption(original.fields[1].id);
    await panel.getByRole('button', { name: '生成匹配预览' }).click();
    await panel.getByText('3 / 3 行已匹配。', { exact: false }).waitFor();
    await panel.getByRole('button', { name: '应用到草稿' }).click();
    await panel.getByRole('button', { name: '时间戳文本', exact: true }).click();
    const timed = panel.getByRole('textbox', { name: 'TTML 时间戳文本', exact: true });
    await timed.fill((await timed.inputValue()).replace('First line', 'First! line'));
    await panel.getByRole('button', { name: '应用到原文草稿' }).click();
    assert.equal(await panel.getByRole('textbox', { name: '第 1 行文本 1', exact: true }).inputValue(), 'First!');
    const permit = panel.getByRole('button', { name: '写入 TTML', exact: true });
    await permit.click();
    await panel.getByText('已保存到所选来源。', { exact: true }).waitFor();
    await win.waitForFunction(() =>
      window.__cadenza.player
        .get()
        .session?.doc.lines.some(
          (line) => line.sub === 'Translation one' || JSON.stringify(line).includes('Translation one'),
        ),
    );
    const saved = await source(win, track.id);
    const written = saved.fields.find((field) => field.label === 'TTML');
    assert.match(written.text, /begin="1s" end="1.7s">First!/);
    assert.match(written.text, /Translation two/);
    assert.match(written.text, /Translation three/);
    assert.match(written.text, /Keep this/);
    assert.match(written.text, /x:marker mode="hold"/);
    assert.match(written.text, /x:part="verse" ttm:agent="voice"/);
    assert.match(written.text, /x-bg">\(echo\)/);
    assert.match(written.text, />michi<\//);
    assert.equal(saved.fields.find((field) => field.label === 'LYRICS').text, enhanced);
    assert.equal((await waitFile(win, 'combined.flac')).audioContentId, track.audioContentId);
    await run.app.evaluate(() => {
      const upstream = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (String(url) === 'https://fixture.invalid/v1/models')
          return Response.json({ data: [{ id: 'fixture-model' }] });
        if (String(url) === 'https://fixture.invalid/v1/chat/completions') {
          const data = JSON.parse(JSON.parse(options.body).messages[1].content);
          const content = JSON.stringify({ rows: data.rows.map(({ id }) => ({ id, translation: 'Offline ' + id })) });
          const parts = [{ choices: [{ delta: { content } }] }, { choices: [{ finish_reason: 'stop' }] }];
          return new Response(
            parts.map((value) => 'data: ' + JSON.stringify(value) + '\n\n').join('') + 'data: [DONE]\n\n',
            {
              headers: { 'Content-Type': 'text/event-stream' },
            },
          );
        }
        return upstream(url, options);
      };
    });
    const ai = panel.locator('[data-test=lyric-ai]');
    await panel
      .locator('summary')
      .filter({ hasText: /^AI 歌词翻译$/ })
      .click();
    await ai.getByText('服务与授权设置', { exact: true }).click();
    const apiSettings = ai.locator('fieldset');
    await win.screenshot({ path: path.join(scratch, 'ai-settings-before-setup.png') });
    await apiSettings.locator('select').nth(1).selectOption('compatible');
    await apiSettings.getByLabel('名称', { exact: true }).fill('Isolated AI fixture');
    await apiSettings.getByLabel('Base URL', { exact: true }).fill('https://fixture.invalid/v1');
    await apiSettings.getByLabel('API Key', { exact: true }).fill('isolated-key');
    await apiSettings.getByLabel('模型', { exact: true }).fill('fixture-model');
    await apiSettings.getByLabel('目标语言（语言代码）', { exact: true }).fill('es');
    await apiSettings.getByRole('button', { name: '保存设置' }).click();
    await ai.getByText('服务与授权设置', { exact: true }).click();
    await ai
      .locator('select:has(option[value=chatgpt])')
      .locator('option')
      .filter({ hasText: 'Isolated AI fixture' })
      .waitFor({ state: 'attached' });
    await ai.getByRole('button', { name: '测试连接并获取模型' }).click();
    await ai.getByText('连接成功', { exact: true }).waitFor();
    await win.screenshot({ path: path.join(scratch, 'ai-translation-editor.png') });
    const beforeAi = hash(file);
    await ai.getByRole('button', { name: '生成译文' }).click();
    await ai.locator('input[value="Offline line-0"]').waitFor();
    assert.equal(hash(file), beforeAi);
    await ai.locator('input[value="Offline line-0"]').fill('Reviewed first line');
    await ai.getByRole('button', { name: '应用到草稿' }).click();
    assert.equal(hash(file), beforeAi);
    await panel.getByRole('button', { name: '写入 TTML', exact: true }).click();
    await win.waitForFunction(
      async (id) =>
        (await window.cadenzaLib.lyricSources(id)).fields.some((row) => row.text.includes('Reviewed first line')),
      track.id,
    );
    const currentTtml = (await source(win, track.id)).fields.find((field) => field.label === 'TTML').text;
    assert.match(currentTtml, /xml:lang="es"/);
    assert.match(currentTtml, /begin="1s" end="1.7s">First!/);
    assert.match(currentTtml, /Translation two/);
    assert.match(currentTtml, />michi<\//);
    assert.equal((await waitFile(win, 'combined.flac')).audioContentId, track.audioContentId);
    assert.equal(
      (await mutate(win, track.id, { source: original.primary, revision: original.fields[0].revision, text: ttml }))
        .why,
      'changed',
    );
    await win.screenshot({ path: path.join(scratch, 'synthetic-editor.png') });
    const copy = path.join(scratch, 'export.ttml');
    const digest = hash(file);
    await run.app.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
    }, copy);
    await panel.getByRole('button', { name: '独立导出', exact: true }).click();
    await panel.getByText('已独立导出。', { exact: true }).waitFor();
    assert.equal(fs.readFileSync(copy, 'utf8'), currentTtml);
    assert.equal(hash(file), digest);

    const chooser = panel.getByLabel('歌词来源');
    await chooser.selectOption(saved.fields.find((field) => field.label === 'LYRICS').id);
    const area = panel.getByRole('textbox', { name: '歌词正文' });
    await panel.getByText('批量调整时间戳', { exact: true }).click();
    await panel.getByLabel('偏移毫秒', { exact: true }).fill('240');
    await panel.getByRole('button', { name: '应用偏移', exact: true }).click();
    assert.ok((await area.inputValue()).includes('[00:01.640]First line'));
    await area.press('Control+z');
    assert.equal(await area.inputValue(), enhanced);
    await area.press('Control+h');
    await panel.getByLabel('查找', { exact: true }).fill('Translation');
    await panel.getByLabel('替换为', { exact: true }).fill('Localized');
    await panel.getByRole('button', { name: '全部替换' }).click();
    assert.equal(await area.inputValue(), enhanced.replaceAll('Translation', 'Localized'));
    await area.press('Control+z');
    assert.equal(await area.inputValue(), enhanced);
    await area.press('Control+y');
    assert.equal(await area.inputValue(), enhanced.replaceAll('Translation', 'Localized'));

    await ai.locator(':scope > summary').click();
    const service = ai.locator('select:has(option[value=chatgpt])');
    const fixtureService = service.locator('option').filter({ hasText: 'Isolated AI fixture' });
    await fixtureService.waitFor({ state: 'attached' });
    await service.selectOption(await fixtureService.getAttribute('value'));
    await ai.getByRole('button', { name: '生成译文' }).click();
    await ai.locator('input[value="Offline line-0"]').waitFor();
    await ai.getByRole('button', { name: '应用到草稿' }).click();
    await win.waitForFunction(
      () => document.querySelector('select[aria-label="歌词来源"]')?.value === 'sidecar:translation',
    );
    const translatedFile = file + '.translation.lrc';
    assert.equal(fs.existsSync(translatedFile), false);
    await panel.getByRole('button', { name: /写入 .*translation\.lrc/ }).click();
    await win.waitForFunction(
      async (id) => (await window.cadenzaLib.lyricSources(id)).fields.some((row) => row.id === 'sidecar:translation'),
      track.id,
    );
    assert.match(fs.readFileSync(translatedFile, 'utf8'), /Offline line-0/);
    assert.equal(hash(file), digest);
    await chooser.selectOption(saved.fields.find((field) => field.label === 'LYRICS').id);
    assert.equal(await area.inputValue(), enhanced.replaceAll('Translation', 'Localized'));

    const denied = path.join(scratch, 'music', 'combined.flac');
    await run.app.evaluate((_electron, expected) => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      const rename = fsp.rename;
      fsp.rename = async (from, to) => {
        if (String(to) === expected) {
          fsp.rename = rename;
          throw Object.assign(new Error('injected replacement failure'), { code: 'EIO' });
        }
        return rename(from, to);
      };
    }, denied);
    await panel.getByRole('button', { name: '写入 LYRICS', exact: true }).click();
    await panel.getByText(/写入失败，草稿已保留/).waitFor();
    assert.equal(await area.inputValue(), enhanced.replaceAll('Translation', 'Localized'));
    assert.equal(hash(file), digest);
    // The unwritten draft stays pinned to its original source and revision on restart.

    console.log(
      'Pass Windows renderer TTML editing, preview, migration, independent source, stale-write protection and preservation',
    );

    const candidate = await waitFile(win, 'blank.flac');
    let result = await mutate(win, candidate.id, { source: 'new:ttml', text: ttml });
    assert.equal(result.ok, true, JSON.stringify(result));
    result = await mutate(win, candidate.id, { source: 'new:lrc', text: enhanced });
    assert.equal(result.ok, true, JSON.stringify(result));
    result = await mutate(win, candidate.id, { source: 'sidecar:lrc', text: '\n[00:04.10]\n\ntext\n' });
    assert.equal(result.ok, true, JSON.stringify(result));
    result = await mutate(win, candidate.id, { source: 'new:ttml', text: enhanced });
    assert.equal(result.why, 'unsupported');
    for (const item of (await source(win, candidate.id)).fields.filter((row) => row.id.startsWith('flac:'))) {
      const refreshed = (await source(win, candidate.id)).fields.find((row) => row.id === item.id);
      const deleted = await mutate(win, candidate.id, { source: item.id, revision: refreshed.revision, text: null });
      assert.equal(deleted.ok, true, JSON.stringify(deleted));
    }
    const remaining = await source(win, candidate.id);
    assert.deepEqual(
      remaining.fields.map((row) => row.id),
      ['sidecar:lrc'],
    );
    assert.equal(remaining.fields[0].text, '\n[00:04.10]\n\ntext\n');
    assert.ok(fs.readdirSync(music).some((name) => name.startsWith('blank.flac.cadenza-backup-')));
    const auxiliary = '[00:04.100]First translation\n\n[00:05.000]\n';
    assert.ok(remaining.targets.some((target) => target.id === 'new:translation'));
    assert.equal((await mutate(win, candidate.id, { source: 'new:translation', text: auxiliary })).ok, true);
    const embedded = (await source(win, candidate.id)).fields.find((field) => field.label === 'LYRICS_TRANSLATION');
    assert.equal(embedded.text, auxiliary);
    assert.equal((await waitFile(win, 'blank.flac')).audioContentId, candidate.audioContentId);
    console.log('Pass blank FLAC create TTML/LRC/sidecar, independent deletion, backup, exact blank/time-only lines');

    for (const name of ['plain.mp3', 'plain.ogg', 'plain.opus']) {
      const music = await waitFile(win, name);
      const supported = (await source(win, music.id)).fields.find((row) => row.writable);
      assert.ok(supported, name);
      const reply = await mutate(win, music.id, {
        source: supported.id,
        revision: supported.revision,
        text: enhanced + 'New lyric\n',
      });
      assert.equal(reply.ok, true, name + ' ' + JSON.stringify(reply));
      const updated = (await source(win, music.id)).fields.find((row) => row.id === supported.id);
      assert.equal(updated.text, enhanced + 'New lyric\n', name);
      const remove = await mutate(win, music.id, { source: supported.id, revision: updated.revision, text: null });
      assert.equal(remove.ok, true, name + ' ' + JSON.stringify(remove));
      assert.ok(!(await source(win, music.id)).fields.some((row) => row.id === supported.id));
    }
    console.log('Pass ID3 USLT, Ogg Vorbis and Opus exact field edits and deletions');

    if (reference) {
      const track = await waitFile(win, 'sample.flac');
      const original = await source(win, track.id);
      assert.ok(
        original.fields.some((row) => row.label === 'TTML') && original.fields.some((row) => row.label === 'LYRICS'),
      );
      if (await panel.isVisible()) {
        await panel.locator('header button').last().click();
        await panel.waitFor({ state: 'detached' });
      }
      await activate(win, track);
      await win.locator('#p-extra button').first().click();
      await panel.locator('[data-test=open-lyric-sources]').click();
      await panel.getByLabel('歌词来源').waitFor();
      await panel.getByText('从增强 LRC 迁移译文', { exact: true }).click();
      await panel.getByLabel('参考来源').selectOption(original.fields.find((row) => row.label === 'LYRICS').id);
      await panel.getByRole('button', { name: '生成匹配预览' }).click();
      const statistics = panel.getByText(/\d+ \/ \d+ 行已匹配/);
      await statistics.waitFor();
      const evidence = /^\d+ \/ \d+/.exec(await statistics.textContent())[0];
      assert.ok(Number(evidence.split(' / ')[0]) > 0);
      await panel.getByRole('button', { name: '应用到草稿' }).click();
      await panel.getByRole('button', { name: '写入 TTML', exact: true }).click();
      await panel.getByText('已保存到所选来源。', { exact: true }).waitFor();
      const saved = await source(win, track.id);
      assert.match(saved.fields.find((row) => row.label === 'TTML').text, /xml:lang="zh-Hans"/);
      assert.equal(
        saved.fields.find((row) => row.label === 'LYRICS').text,
        original.fields.find((row) => row.label === 'LYRICS').text,
      );
      assert.equal(hash(reference), originalRef);
      console.log('Pass real dual-field FLAC on isolated copy; matched lines', evidence);
    }

    await quiet(win);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    await quiet(win);
    before = (await details(win)).counters;
    fs.copyFileSync(path.join(music, 'blank.flac'), path.join(music, 'new-files', 'new.flac'));
    await waitFile(win, 'new.flac');
    await quiet(win);
    after = (await details(win)).counters;
    assert.equal(after.tags - before.tags, 1);
    assert.equal(after.fingerprints - before.fingerprints, 1);
    assert.equal(after.directories - before.directories, 1);
    assert.deepEqual(run.errors, []);
    console.log(
      'Watch scope counter delta',
      Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]])),
    );

    const archived = await waitFile(win, 'f0.flac');
    await run.app.evaluate((_electron, folder) => {
      const fsp = process.getBuiltinModule('node:fs/promises');
      const readdir = fsp.readdir;
      fsp.readdir = async (file, ...args) => {
        if (String(file) === folder) throw Object.assign(new Error('unavailable'), { code: 'EACCES' });
        return readdir(file, ...args);
      };
      globalThis.restoreReaddir = () => {
        fsp.readdir = readdir;
      };
    }, archive);
    await win.evaluate(() => window.cadenzaLib.rescan());
    await win.waitForFunction(async () => (await window.cadenzaLib.taskDetails()).progress.unavailable === 1);
    assert.equal((await waitFile(win, 'f0.flac')).id, archived.id);
    await run.app.evaluate(() => globalThis.restoreReaddir());
    await win.evaluate(() => window.cadenzaLib.rescan());
    await win.waitForFunction(async () => {
      const progress = (await window.cadenzaLib.taskDetails()).progress;
      return progress.phase === 'idle' && progress.unavailable === 0;
    });
    assert.equal((await waitFile(win, 'f0.flac')).id, archived.id);

    await win.evaluate(() => window.__cadenza.pauseAnalysis(true, 'g55r'));
    oversizedWave(path.join(music, 'new-files', 'budget.wav'));
    await waitFile(win, 'budget.wav');
    await win.waitForFunction(() => window.__cadenza.lib.get().analysisTask.phase === 'paused');
    await win.evaluate(() => window.__cadenza.pauseAnalysis(false, 'g55r'));
    await win.waitForFunction(
      () => window.__cadenza.lib.get().tracks.some((track) => track.title === 'budget' && track.analyzed === 4),
      undefined,
      { timeout: 45000 },
    );
    await quiet(win);
    await win.waitForFunction(
      () => document.querySelector('[data-test=activity]')?.dataset.active === 'false',
      undefined,
      { timeout: 45000 },
    );
    console.log(
      'Pass unavailable directory recovery, paused/resumed analysis, long silence beyond the old budget and idle indicator',
    );
  } finally {
    await run.app.close();
  }

  const db = path.join(profile, 'library', 'db.json');
  const old = JSON.parse(fs.readFileSync(db, 'utf8'));
  const blankId = Object.values(old.tracks).find((track) => path.basename(track.path) === 'blank.flac').id;
  const originalHash = hash(file);
  old.overrides[firstId] = { ...old.overrides[firstId], preferLrc: true };
  delete old.overrides[firstId].lyricsSource;
  old.overrides[blankId] = { ...old.overrides[blankId], preferLrc: true };
  delete old.overrides[blankId].lyricsSource;
  fs.writeFileSync(db, JSON.stringify(old));
  const repeat = await launch(profile);
  try {
    await quiet(repeat.win);
    assert.equal((await waitFile(repeat.win, 'combined.flac')).id, firstId);
    const migrated = await source(repeat.win, firstId);
    assert.equal(migrated.fields.find((field) => field.id === migrated.primary).label, 'LYRICS');
    assert.equal((await source(repeat.win, blankId)).primary, 'sidecar:lrc');
    assert.equal(hash(file), originalHash);
    const recovered = await repeat.win.evaluate(() =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('cadenza-draft-v1:lyric-source:'))
        .map((key) => localStorage.getItem(key)),
    );
    assert.ok(recovered.includes(enhanced.replaceAll('Translation', 'Localized')));
    const counters = (await details(repeat.win)).counters;
    assert.equal(counters.tags, 0);
    assert.equal(counters.fingerprints, 0);
    console.log('Repeat startup counters', counters);
    await repeat.win.waitForFunction(() => document.querySelector('[data-test=activity]')?.dataset.active === 'false');
    const idleStart = await details(repeat.win);
    const measuredStart = await nativeProcessCounters(repeat.app);
    const start = process.hrtime.bigint();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const measuredEnd = await nativeProcessCounters(repeat.app);
    const idleEnd = await details(repeat.win);
    for (const key of ['directories', 'tags', 'fingerprints'])
      assert.equal(idleEnd.counters[key], idleStart.counters[key]);
    console.log('Windows idle main process counters', {
      observedMs: Number(process.hrtime.bigint() - start) / 1e6,
      cpuMs:
        (measuredEnd.UserModeTime +
          measuredEnd.KernelModeTime -
          measuredStart.UserModeTime -
          measuredStart.KernelModeTime) /
        10000,
      readBytes: measuredEnd.ReadTransferCount - measuredStart.ReadTransferCount,
      writtenBytes: measuredEnd.WriteTransferCount - measuredStart.WriteTransferCount,
    });
  } finally {
    await repeat.app.close();
  }

  const clean = await launch(init('new-profile', 'classic'));
  try {
    const saved = await source(clean.win, (await waitFile(clean.win, 'combined.flac')).id);
    assert.match(saved.fields.find((field) => field.id === saved.primary).text, /Translation one/);
    const blank = await source(clean.win, (await waitFile(clean.win, 'blank.flac')).id);
    assert.equal(
      blank.fields.find((field) => field.label === 'LYRICS_TRANSLATION').text,
      '[00:04.100]First translation\n\n[00:05.000]\n',
    );
    if (reference) {
      const ref = await source(clean.win, (await waitFile(clean.win, 'sample.flac')).id);
      assert.match(ref.fields.find((field) => field.id === ref.primary).text, /xml:lang="zh-Hans"/);
      assert.equal(hash(reference), originalRef);
    }
    const activity = clean.win.locator('[data-test=activity]').first();
    await activity.click();
    await clean.win.getByRole('dialog', { name: '后台任务' }).waitFor();
    await clean.win.screenshot({ path: path.join(scratch, 'background-activity.png') });
    await clean.win.getByRole('button', { name: '关闭后台任务' }).click();
    await clean.win.getByRole('dialog', { name: '后台任务' }).waitFor({ state: 'hidden' });
    assert.deepEqual(clean.errors, []);
    assert.equal((await fields(file)).length, 2);
    console.log('Pass reopen and clean profile from real embedded data and classic activity details');
  } finally {
    await clean.app.close();
  }
  console.log('Evidence:', scratch);
})().catch((error) => {
  console.error(error);
  console.error('Evidence:', scratch);
  process.exitCode = 1;
});
