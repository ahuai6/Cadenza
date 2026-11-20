// Brings Folia's visualizer code into src/folia/vendor, unchanged except for import specifiers, so
// it can follow upstream: bump `commit` in src/folia/upstream.json, run this, read the diff.
//
//   node scripts/folia-sync.mjs [path to a folia-major checkout]   (default: clones the pinned commit)
//   node scripts/folia-sync.mjs --check <checkout>                  (fails if the vendored tree is stale)
//
// The manifest lists:
//   copy     upstream files (or globs) copied whole, kept at their upstream paths under vendor/
//   extract  named declarations pulled from a large upstream file (with the local types they need)
//   shims    upstream modules Cadenza stands in for (its stage for 'pixi.js', its rhythm for the beat clock…)
//   patches  the few literal edits Cadenza's stricter compiler needs (unused names); each says why, and
//            the sync fails when one no longer applies, so an upstream change is never patched blindly
// Every relative import a vendored file makes must land on a vendored file or a shim; anything else
// is reported, and the sync fails rather than leave a dangling import.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST = path.join(ROOT, 'src/folia/upstream.json');
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const VENDOR = path.join(ROOT, manifest.vendor);
const args = process.argv.slice(2);
const check = args.includes('--check');
let upstream = args.find((a) => !a.startsWith('--'));

if (!upstream) {
  upstream = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-'));
  execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', manifest.repo, upstream], {
    stdio: 'inherit',
  });
  execFileSync('git', ['-C', upstream, 'checkout', '--quiet', manifest.commit], { stdio: 'inherit' });
}
upstream = path.resolve(upstream);
let head = '';
try {
  head = execFileSync('git', ['-C', upstream, 'rev-parse', '--short', 'HEAD']).toString().trim();
} catch {
  head = manifest.commit;
}
if (!head.startsWith(manifest.commit) && !manifest.commit.startsWith(head)) {
  console.error(`upstream checkout is at ${head}, the manifest pins ${manifest.commit}`);
  process.exit(1);
}

const posix = (p) => p.split(path.sep).join('/');
/** Where an upstream file lives under vendor/ (its path without the leading src/). */
const destRel = (rel) => rel.replace(/^src\//, '');
const exists = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

/** Expands the manifest's copy list: plain paths, `dir/*.ts` globs and `!path` exclusions. */
function copyList() {
  const out = new Set();
  const excl = new Set(manifest.copy.filter((e) => e.startsWith('!')).map((e) => e.slice(1)));
  for (const entry of manifest.copy) {
    if (entry.startsWith('!')) continue;
    if (entry.includes('*')) {
      const dir = path.dirname(entry);
      const re = new RegExp('^' + path.basename(entry).replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      for (const f of fs.readdirSync(path.join(upstream, dir))) {
        const rel = `${dir}/${f}`;
        if (re.test(f) && exists(path.join(upstream, rel)) && !excl.has(rel)) out.add(rel);
      }
    } else if (!excl.has(entry)) out.add(entry);
  }
  return [...out].sort();
}

const copied = copyList();
const extracted = manifest.extract.map((e) => e.file);
const vendored = new Set([...copied, ...extracted]);
const shims = manifest.shims;

/** The upstream file a relative specifier from `fromRel` names, as a path from the upstream root. */
function resolveUpstream(fromRel, spec) {
  const base = path.join(upstream, path.dirname(fromRel), spec);
  for (const c of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), base]) {
    if (exists(c)) return posix(path.relative(upstream, c));
  }
  return null;
}

/** A specifier from the vendored copy of `fromRel` to a file under ROOT (no extension). */
function specTo(fromRel, targetFromRoot) {
  const from = path.dirname(path.join(VENDOR, destRel(fromRel)));
  let rel = posix(path.relative(from, path.join(ROOT, targetFromRoot))).replace(/(\/index)?\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

const problems = [];
function rewrite(fromRel, source) {
  return source.replace(/((?:from|import)\s*\(?\s*)'([^']+)'/g, (whole, lead, spec) => {
    if (!spec.startsWith('.')) {
      if (spec in shims) return `${lead}'${specTo(fromRel, shims[spec])}'`;
      if (
        !(manifest.packages ?? []).includes(
          spec
            .split('/')
            .slice(0, spec.startsWith('@') ? 2 : 1)
            .join('/'),
        )
      )
        problems.push(`${fromRel}: package '${spec}' is neither a shim nor an allowed package`);
      return whole;
    }
    const target = resolveUpstream(fromRel, spec);
    if (!target) {
      problems.push(`${fromRel}: cannot resolve '${spec}'`);
      return whole;
    }
    if (target in shims) return `${lead}'${specTo(fromRel, shims[target])}'`;
    if (vendored.has(target)) return whole;
    problems.push(`${fromRel}: '${spec}' (${target}) is neither vendored nor shimmed`);
    return whole;
  });
}

const header = (rel, how) =>
  `// Vendored from Folia (AGPL-3.0, ${manifest.repo}) ${rel} @ ${manifest.commit}${how}.\n` +
  `// Generated by scripts/folia-sync.mjs: change the manifest or a shim, not this file.\n`;

/**
 * Splits a module into its top-level statements (with the comments right above each), tracking
 * strings, template literals, comments and brackets so a statement ends at its own `;` or `}`.
 */
function topLevel(text) {
  const out = [];
  let i = 0,
    start = 0,
    depth = 0;
  const n = text.length;
  const finish = (end) => {
    const chunk = text.slice(start, end);
    if (chunk.trim()) out.push({ start, end, text: chunk });
    start = end;
  };
  while (i < n) {
    const c = text[i],
      d = text[i + 1];
    if (c === '/' && d === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) i = n;
      continue;
    }
    if (c === '/' && d === '*') {
      i = text.indexOf('*/', i + 2) + 2;
      if (i < 2) i = n;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < n && text[i] !== c) {
        if (text[i] === '\\') i += 1;
        else if (c === '`' && text[i] === '$' && text[i + 1] === '{') {
          let k = 1;
          i += 2;
          while (i < n && k) {
            if (text[i] === '{') k += 1;
            else if (text[i] === '}') k -= 1;
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) {
      depth -= 1;
      // a declaration body closing at the top level ends the statement unless more follows on its line
      if (depth === 0 && c === '}') {
        const rest = text.slice(i + 1, text.indexOf('\n', i + 1) < 0 ? n : text.indexOf('\n', i + 1));
        if (!/^\s*[;,.)\]=|&?:]/.test(rest) && /^\s*(\/\/.*)?$/.test(rest)) {
          const lineStart = text.lastIndexOf('\n', i) + 1;
          if (/^\}/.test(text.slice(lineStart))) {
            i += 1;
            finish(i);
            continue;
          }
        }
      }
    } else if (c === ';' && depth === 0) {
      i += 1;
      finish(i);
      continue;
    }
    i += 1;
  }
  finish(n);
  return out;
}

/** Pulls `names` (and the top-level declarations they reference, transitively) out of a large file. */
function extract(rel, names) {
  const text = fs.readFileSync(path.join(upstream, rel), 'utf8');
  const decls = new Map();
  const imports = new Map();
  for (const st of topLevel(text)) {
    const code = st.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').trim();
    const imp = code.match(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/);
    if (imp) {
      for (const part of imp[1].split(',')) {
        const nm = part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)
          .pop();
        if (nm) imports.set(nm, imp[2]);
      }
      continue;
    }
    const m = code.match(
      /^(?:export\s+)?(?:declare\s+)?(?:const|let|var|interface|type|enum|function|class|abstract class)\s+([A-Za-z_$][\w$]*)/,
    );
    if (m) decls.set(m[1], st);
  }
  const keep = new Set();
  const keepImports = new Map();
  const visit = (name) => {
    const st = decls.get(name);
    if (!st) {
      const spec = imports.get(name);
      if (spec) {
        if (!keepImports.has(spec)) keepImports.set(spec, new Set());
        keepImports.get(spec).add(name);
        return;
      }
      problems.push(`${rel}: no top-level declaration '${name}'`);
      return;
    }
    if (keep.has(st)) return;
    keep.add(st);
    const code = st.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    for (const id of new Set(code.match(/[A-Za-z_$][\w$]*/g) ?? []))
      if (id !== name && (decls.has(id) || imports.has(id))) visit(id);
  };
  names.forEach(visit);
  const importLines = [...keepImports].map(
    ([spec, used]) => `import type { ${[...used].sort().join(', ')} } from '${spec}';`,
  );
  // (a name asked for is exported, also where upstream keeps it to its own module: Cadenza uses it from outside)
  const asked = new Set(names.map((nm) => decls.get(nm)).filter(Boolean));
  const body = [...keep]
    .sort((a, b) => a.start - b.start)
    .map((st) => {
      const text = st.text.replace(/^\s*\n/, '').trimEnd();
      return asked.has(st)
        ? text.replace(
            /^((?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*\n)*\s*)(?=(?:const|let|interface|type|function|class|enum)\s)/,
            '$1export ',
          )
        : text;
    })
    .join('\n\n');
  return (importLines.length ? importLines.join('\n') + '\n\n' : '') + body + '\n';
}

/** Applies the manifest's patches for `rel`; every `find` must occur exactly once. */
function patch(rel, text) {
  let out = text;
  for (const p of (manifest.patches ?? []).filter((x) => x.file === rel)) {
    const count = out.split(p.find).length - 1;
    if (count !== 1) {
      problems.push(`${rel}: patch "${p.why}" matches ${count} times`);
      continue;
    }
    out = out.replace(p.find, () => p.replace);
  }
  return out;
}

const outputs = new Map();
for (const rel of copied) {
  const src = fs.readFileSync(path.join(upstream, rel), 'utf8');
  const patched = (manifest.patches ?? []).some((x) => x.file === rel);
  outputs.set(rel, header(rel, patched ? ', patched (see the manifest)' : '') + rewrite(rel, patch(rel, src)));
}
for (const e of manifest.extract) {
  outputs.set(
    e.file,
    header(e.file, ` (declarations: ${e.names.join(', ')})`) + rewrite(e.file, extract(e.file, e.names)),
  );
}

if (problems.length) {
  console.error(problems.map((p) => '  ' + p).join('\n'));
  console.error(
    `folia-sync: ${problems.length} unmapped import(s); vendor or shim them in ${path.relative(ROOT, MANIFEST)}`,
  );
  process.exit(1);
}

const existing = new Set();
const walkDir = (d) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkDir(p);
    else existing.add(posix(path.relative(VENDOR, p)));
  }
};
walkDir(VENDOR);

let stale = 0;
for (const [rel, text] of outputs) {
  const dest = path.join(VENDOR, destRel(rel));
  const same = exists(dest) && fs.readFileSync(dest, 'utf8') === text;
  existing.delete(destRel(rel));
  if (same) continue;
  stale += 1;
  if (check) console.error(`stale: ${rel}`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text);
  }
}
for (const rel of existing) {
  stale += 1;
  if (check) console.error(`not in the manifest: ${rel}`);
  else fs.rmSync(path.join(VENDOR, rel));
}
if (check && stale) process.exit(1);
console.log(
  `folia-sync: ${outputs.size} files from ${manifest.commit}${check ? ' (up to date)' : `, ${stale} written or removed`}`,
);
