// The main window's side of the desktop lyrics (electron/desk.cjs): while they are on, the line being sung and the two
// after it, with the song's time, are passed to their window — on every new line, and a few times a second between
// (the window runs its own clock on from the last time it was told, so the characters light smoothly).
import { D, type DeskFeed } from '../bridge';
import { settings } from '../state';
import { engine } from './stage';
import { player } from './player';

let off: (() => void) | null = null,
  lastAt = 0,
  lastKey = '';
function feed(t: number, force = false) {
  const p = player.get(),
    lines = p.session?.doc?.lines || [];
  let cur = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].t <= t + 0.05) cur = i;
  // (before the first line: the first three to come)
  const from = Math.max(0, cur),
    pick = lines.slice(from, from + 3),
    key = (p.shownId || '') + ':' + from + ':' + p.playing;
  const now = performance.now();
  if (!force && key === lastKey && now - lastAt < 250) return;
  lastKey = key;
  lastAt = now;
  const d: DeskFeed = {
    id: p.shownId,
    t,
    playing: p.playing,
    cur: cur < 0 ? -1 : 0,
    lines: pick.map((L) => ({
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
      b = player.subscribe(() => feed(engine.time)),
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
