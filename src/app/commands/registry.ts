// Every action a user can take on something in the library, defined once: its name, its icon, when it applies, what it
// does. A context menu, a row of buttons, the space's cards — each asks the registry what can be done with what it
// shows, and runs it; none writes the action again. A new action is one `define` (commands/library.ts).
//
// Some actions need the interface to ask or to show something (a name for a playlist, the tag editor). The interface in
// use says what it can do (`setHost`); an action whose need it cannot meet does not apply there.
import type { Track } from '../bridge';
import type { MenuItem } from '../state';

/** What an action is taken on. */
export type Target =
  /** one song, among the songs it is listed with (which play on after it); `playlist`: the playlist it is listed in */
  | { kind: 'track'; track: Track; list: Track[]; playlist?: string }
  /** several songs as one thing: an album, an artist, a genre, a selection */
  | { kind: 'tracks'; ids: string[] }
  | { kind: 'playlist'; id: string; name: string; ids: string[] };
export type Kind = Target['kind'];
type Of<K extends Kind> = Extract<Target, { kind: K }>;

/** What the interface in use can do for an action. */
export interface Host {
  /** ask for a line of text (null: cancelled) */
  ask?(title: string, label: string, value: string): Promise<string | null | undefined>;
  editTags?(t: Track): void;
  exportVideo?(t: Track, list: Track[]): void;
  toWorkshop?(t: Track): void;
}
let host: Host = {};
export function setHost(h: Host) {
  host = h;
}

export interface Command<K extends Kind = Kind> {
  id: string;
  on: K;
  /** commands of one section stay together (a menu draws a line between sections); within it, in the order defined */
  section: 'play' | 'collect' | 'make' | 'remove';
  icon: string;
  danger?: boolean;
  label(t: Of<K>): string;
  /** does it apply to this, in this interface? (always, if not said) */
  when?(t: Of<K>, h: Host): boolean;
  run?(t: Of<K>, h: Host): unknown;
  /** in place of `run`: the choices it opens into */
  sub?(t: Of<K>, h: Host): (MenuItem | '-')[];
}
const SECTIONS: Command['section'][] = ['play', 'collect', 'make', 'remove'];
const all: Command[] = [];
export function define<K extends Kind>(c: Command<K>) {
  if (all.some((x) => x.id === c.id)) throw new Error(`command defined twice: ${c.id}`);
  all.push(c as unknown as Command);
}

/** The commands that apply to a target, in order. */
export function commandsFor(t: Target): Command[] {
  return SECTIONS.flatMap((s) =>
    all.filter((c) => c.on === t.kind && c.section === s && (c.when ? c.when(t as never, host) : true)),
  );
}
/** Whether one command applies to a target (a button shows or hides by it). */
export function applies(id: string, t: Target): boolean {
  return commandsFor(t).some((c) => c.id === id);
}
/** Run one command on a target (nothing happens if it does not apply). */
export function run(id: string, t: Target): unknown {
  const c = commandsFor(t).find((x) => x.id === id);
  return c?.run?.(t as never, host);
}
/** A command's name for a target (a button's label, a tooltip). */
export function label(id: string, t: Target): string {
  const c = all.find((x) => x.id === id && x.on === t.kind);
  return c ? c.label(t as never) : '';
}
/** A target's context menu: its commands, a line between sections. */
export function menuFor(t: Target): (MenuItem | '-')[] {
  const out: (MenuItem | '-')[] = [];
  let last: string | null = null;
  for (const c of commandsFor(t)) {
    if (last && last !== c.section) out.push('-');
    last = c.section;
    out.push({
      label: c.label(t as never),
      icon: c.icon,
      danger: c.danger,
      ...(c.sub ? { sub: c.sub(t as never, host) } : { run: () => void c.run?.(t as never, host) }),
    });
  }
  return out;
}
