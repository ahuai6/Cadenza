// One-off: carries the interface words of Lyric Motion 2.x (engine, workshop, desktop shell) into Cadenza's dictionary.
const fs = require('fs'), vm = require('vm'), path = require('path');
const old = process.argv[2], out = process.argv[3];
const ctx = vm.createContext({});
const eng = vm.runInContext(fs.readFileSync(path.join(old, 'engine/02-words.js'), 'utf8') + ';({LANGS,I18N})', ctx);
const extra = vm.runInContext(fs.readFileSync(path.join(old, 'src/i18n.js'), 'utf8').replace(/^export /gm, '').split('function installWords')[0] + ';EXTRA', vm.createContext({}));
const shell = vm.runInContext(fs.readFileSync(path.join(old, 'src/shell/words.js'), 'utf8').replace(/^export /gm, '') + ';({W,LANGS})', vm.createContext({}));
const langs = eng.LANGS.map(x => x[0]), dict = {};
for (const l of langs) dict[l] = { ...eng.I18N[l], ...(extra[l] || {}) };
for (const [k, arr] of Object.entries(shell.W)) shell.LANGS.forEach((l, i) => { if (arr[i] != null) dict[l][k] = arr[i]; });
const rename = s => typeof s === 'string' ? s.replace(/詞幕\s*Lyric Motion/g, 'Cadenza').replace(/Lyric Motion/g, 'Cadenza').replace(/詞幕|词幕/g, 'Cadenza') : s;
for (const l of langs) for (const k of Object.keys(dict[l])) dict[l][k] = rename(dict[l][k]);
fs.writeFileSync(out, JSON.stringify({ langs: eng.LANGS, dict }, null, 0));
console.log(langs.map(l => l + ':' + Object.keys(dict[l]).length).join(' '));
