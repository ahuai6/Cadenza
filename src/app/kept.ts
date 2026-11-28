// What the listener makes and chooses — saved looks and motion styles, the workshop's project, the listening choices
// made for songs, the queue last played — kept by the desktop app with the library (electron/kept.cjs), and in this
// browser for the web build. Read synchronously from a copy loaded before the interface starts; each change goes to the
// main process at once (it writes one item's latest value at a time).
import { Kept, type KeptKey } from './bridge';
import { keep, remember } from './state';

/** the localStorage names earlier builds used ('choices' was one entry per song under this prefix) */
const LEGACY: Record<Exclude<KeptKey, 'choices'>, string> = {
  themes: 'themes',
  motions: 'motions',
  project: 'project',
  queue: 'last',
};
const CHOICES_PREFIX = 'song-presets:';

const copy = new Map<KeptKey, unknown>();

/** The copies an earlier build left in this page's localStorage. */
function legacyValues(): Partial<Record<KeptKey, unknown>> {
  const values: Partial<Record<KeptKey, unknown>> = {};
  for (const [key, name] of Object.entries(LEGACY) as [Exclude<KeptKey, 'choices'>, string][]) {
    const value = remember<unknown>(name, null);
    if (value != null) values[key] = value;
  }
  const choices: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith('cz-' + CHOICES_PREFIX)) continue;
      const id = name.slice(('cz-' + CHOICES_PREFIX).length);
      const value = remember<unknown[]>(CHOICES_PREFIX + id, []);
      if (Array.isArray(value) && value.length) choices[id] = value;
    }
  } catch {
    /* storage unavailable: nothing to take over */
  }
  if (Object.keys(choices).length) values.choices = choices;
  return values;
}

/** Load the kept items before the interface starts (the desktop app); the first time, take over an earlier build's. */
export async function loadKept() {
  if (!Kept) return;
  let start = await Kept.start().catch(() => null);
  if (start && !start.moved) {
    await Kept.move(legacyValues()).catch(() => false);
    start = await Kept.start().catch(() => null);
  }
  for (const [key, value] of Object.entries(start?.values || {})) if (value != null) copy.set(key as KeptKey, value);
}

/** A kept item as it stands (`fallback` when there is none). The project is read with `keptProject`. */
export function kept<T>(key: Exclude<KeptKey, 'project'>, fallback: T): T {
  if (!Kept) return key === 'choices' ? fallback : remember<T>(LEGACY[key], fallback);
  return copy.has(key) ? (copy.get(key) as T) : fallback;
}

/** Keep an item's new value. */
export function setKept(key: KeptKey, value: unknown) {
  if (!Kept) {
    if (key !== 'choices') keep(LEGACY[key], value);
    return;
  }
  copy.set(key, value);
  void Kept.set(key, value).then(
    (ok) => ok || console.warn('kept: not saved', key),
    (error) => console.warn('kept', key, error),
  );
}

/** The workshop's project (read when the workshop opens: it can be large). */
export async function keptProject<T>(): Promise<T | null> {
  if (!Kept) return remember<T | null>(LEGACY.project, null);
  return ((await Kept.get('project').catch(() => null)) as T | null) ?? null;
}

/** The listening choices made for one song. */
export function songChoices<T>(id: string): T[] {
  if (!Kept) return remember<T[]>(CHOICES_PREFIX + id, []);
  const all = kept<Record<string, T[]>>('choices', {});
  return Array.isArray(all[id]) ? all[id] : [];
}
export function setSongChoices(id: string, choices: unknown[]) {
  if (!Kept) return keep(CHOICES_PREFIX + id, choices);
  const all = { ...kept<Record<string, unknown[]>>('choices', {}) };
  if (choices.length) all[id] = choices;
  else delete all[id];
  setKept('choices', all);
}
