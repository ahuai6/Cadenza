// The main window's side of the desktop lyrics (electron/desk.cjs): while they are on, the line being sung and the two
// after it, with the song's time, are passed to their window — on every new line, and a few times a second between
// (the receiving window advances only within the latest permitted interpolation budget).
import { D, type DeskFeed } from '../bridge';
import { settings } from '../state';
import { engine } from './stage';
import { player } from './player';
import { clockBudgetMs } from './hifi';

let off: (() => void) | null = null,
  lastAt = 0,
  lastKey = '',
  lastDoc: unknown,
  revision = 0;
function feed(t: number, force = false) {
  const p = player.get(),
    doc = p.session?.doc,
    lines = doc?.lines || [];
  let cur = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].t <= t + 0.05) cur = i;
  // (before the first line: the first three to come)
  const from = Math.max(0, cur),
    key = (p.shownId || '') + ':' + cur;
  const now = performance.now();
  const hifi = p.route === 'hifi';
  const contentChanged = key !== lastKey || doc !== lastDoc;
  if (!force && !contentChanged && now - lastAt < (hifi ? 40 : 250)) return;
  if (contentChanged) revision++;
  lastDoc = doc;
  lastKey = key;
  lastAt = now;
  const d: DeskFeed = {
    id: p.shownId,
    t,
    playing: p.playing,
    advanceMs: hifi ? clockBudgetMs() : 300,
    revision,
    cur: cur < 0 ? -1 : 0,
    lines: lines.slice(from, from + 3).map((L) => ({
      t: L.t,
      text: L.text,
      // (each character's time where the line is timed — a line timed only as a whole is lit all at once)
      units: L.words.flatMap((w, k) =>
        w.units.map((u, j) => ({
          c: u.c,
          t: L.kar ? u.t : null,
          sp: j === w.units.length - 1 && k < L.words.length - 1,
        })),
      ),
    })),
  };
  D?.deskFeed?.(d);
}
function sync(on: boolean) {
  if (on && !off) {
    const a = engine.on('tick', (p) => feed(p.t)),
      b = player.subscribe((p, previous) =>
        feed(engine.time, p.playing !== previous.playing || p.route !== previous.route),
      ),
      // (once a second whatever happens: a window opened while the song is paused, or reloaded, has its lines at once)
      c = setInterval(() => feed(engine.time, true), 1000);
    off = () => {
      a();
      b();
      clearInterval(c);
    };
    lastKey = '';
    feed(engine.time);
  } else if (!on && off) {
    off();
    off = null;
  }
}
if (D?.deskFeed) {
  sync(!!settings.get().deskLyrics);
  settings.subscribe((s, prev) => {
    if (s.deskLyrics !== prev.deskLyrics) sync(!!s.deskLyrics);
  });
  // (the window's own buttons — lock, size, close — change the settings from the main process)
  D.onSettings?.((s) => settings.set(s));
}
