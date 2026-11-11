// Puts the neural engine's weights in models/ (gitignored): each file is kept when its SHA-256 matches
// src/rhythm/neural/models.json, else fetched from the mirrors there in order (first match wins). Run before
// packaging (electron-builder ships models/ as resources/models) and before the neural render test.
//   node scripts/models.mjs [dir]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const M = JSON.parse(readFileSync(join(ROOT, 'src/rhythm/neural/models.json'), 'utf8'));
const dir = resolve(process.argv[2] || join(ROOT, 'models'));
mkdirSync(dir, { recursive: true });
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let failed = 0;
for (const [name, m] of Object.entries(M.models)) {
  const p = join(dir, m.file);
  if (existsSync(p) && sha(readFileSync(p)) === m.sha256) {
    console.log(`${name}: ${m.file} present`);
    continue;
  }
  let ok = false;
  for (const mirror of M.mirrors) {
    const url = mirror.replace('{file}', m.file);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`${name}: ${url} ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer()),
        h = sha(buf);
      if (buf.length !== m.bytes || h !== m.sha256) {
        console.log(`${name}: ${url} is not the file (${buf.length} bytes, ${h.slice(0, 12)}…)`);
        continue;
      }
      writeFileSync(p + '.part', buf);
      renameSync(p + '.part', p);
      console.log(`${name}: ${m.file} from ${url}`);
      ok = true;
      break;
    } catch (e) {
      console.log(`${name}: ${url} ${e.message}`);
    }
  }
  if (!ok) {
    console.error(`${name}: no mirror had ${m.file}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
