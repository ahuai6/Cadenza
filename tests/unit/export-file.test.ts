import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { openExport, stamp } = require('../../electron/export-file.cjs');

it('keeps existing work on export abort and only publishes a verified replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cadenza-export-test-'));
  try {
    const file = join(dir, 'film.mp4');
    await writeFile(file, 'old');
    const canceled = await openExport(file, await stamp(file));
    await canceled.write(Buffer.from('unfinished'), 0);
    await canceled.abort();
    expect(await readFile(file, 'utf8')).toBe('old');
    expect(await readdir(dir)).toEqual(['film.mp4']);

    const completed = await openExport(file, await stamp(file));
    await completed.write(Buffer.from('123456'), 0);
    await completed.write(Buffer.from('NEW'), 0);
    expect(await completed.close()).toBe(6);
    expect(await readFile(file, 'utf8')).toBe('NEW456');

    const conflicted = await openExport(file, await stamp(file));
    await conflicted.write(Buffer.from('export'), 0);
    await writeFile(file, 'someone edited this file');
    await expect(conflicted.close()).rejects.toThrow('changed during export');
    expect(await readFile(file, 'utf8')).toBe('someone edited this file');
    expect(await readdir(dir)).toEqual(['film.mp4']);

    const fresh = await openExport(join(dir, 'fresh.mp4'), null);
    await fresh.write(Buffer.from('data'), 0);
    expect(await fresh.close()).toBe(4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
