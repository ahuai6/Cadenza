// Every setting, declared once: its key, its default, what it may be, where it belongs. From this come the `Settings`
// type, the defaults the app starts with, the defaults the desktop's main process saves over
// (electron/settings.defaults.json — `npm run gen:settings` writes it, a unit test keeps it true), and, as the
// settings pages are rebuilt, the pages themselves. A new setting is one entry here; nothing else keeps a list.
//
// (No imports: the main process's defaults are generated from this file as it stands.)

/** Where a setting belongs on a settings page. */
export type Group =
  | 'look' // the interface: theme, typeface, language, which interface
  | 'lyrics' // captions, where edits are saved
  | 'library'
  | 'system' // start with the computer, the tray
  | 'picture' // quality, scale, frame rate, frame shape
  | 'sound'
  | 'video' // the song's own video behind the lyrics
  | 'rhythm'
  | 'diagnostics'
  | 'space.move'
  | 'space.scene'
  | 'space.picture'
  | 'space.sound'
  | 'space.lyrics';
interface Meta {
  group: Group;
  /** its name and note on a settings page (dictionary keys); a choice's options are named by `label` + '.' + option,
   *  unless `optionLabel` says otherwise. A setting without a label is drawn by hand where it is shown */
  label?: string;
  help?: string;
  /** the dictionary key naming one option (a choice), and its words' values ({n}: the option itself) */
  optionLabel?: (o: string | number) => [string, Record<string, number>?];
  /** a choice's note for the option chosen (a dictionary key), in place of `help` */
  optionHelp?: (o: string | number) => string;
  /** how a range's value is written: a share (60%) or a multiple (1.2×) */
  unit?: 'percent' | 'times';
  /** which interface it acts in (both, if not said) */ only?: 'classic' | 'space';
  /** for those who look for it: shown only under "advanced" */ advanced?: true;
}
const toggle = (dflt: boolean, m: Meta) => ({ kind: 'toggle' as const, default: dflt, ...m });
const choice = <const T extends readonly (string | number)[]>(options: T, dflt: T[number], m: Meta) => ({
  kind: 'choice' as const,
  options,
  default: dflt as T[number],
  ...m,
});
const range = (min: number, max: number, step: number, dflt: number, m: Meta) => ({
  kind: 'range' as const,
  min,
  max,
  step,
  default: dflt,
  ...m,
});
/** a space setting: its group, and its words under `sp.` (with a note, `sp.<name>.help`, if `help`) */
const sp = (g: 'move' | 'scene' | 'picture' | 'sound' | 'lyrics', name: string, help = false): Meta => ({
  group: `space.${g}`,
  only: 'space',
  label: 'sp.' + name,
  ...(help ? { help: 'sp.' + name + '.help' } : {}),
});
/** a name from a list kept elsewhere (a typeface, an audio device, a language), or a colour */
const text = (dflt: string, m: Meta) => ({ kind: 'text' as const, default: dflt, ...m });

export const SCHEMA = {
  // the interface
  ui: choice(['classic', 'space'], 'classic', {
    group: 'look',
    label: 's.set.uiMode.pick',
    help: 's.set.uiMode.help',
    optionLabel: (o) => ['s.set.uiMode.' + o],
  }),
  theme: choice(['system', 'light', 'dark'], 'system', {
    group: 'look',
    only: 'classic',
    label: 's.set.theme',
    optionLabel: (o) => ['s.set.' + o],
  }),
  tone: choice(['paper', 'white'], 'paper', { group: 'look', only: 'classic', label: 's.set.tone' }),
  uiFont: text('default', { group: 'look', only: 'classic' }),
  lang: text('', { group: 'look' }),
  // lyrics
  fxCapSubs: toggle(true, { group: 'lyrics', label: 's.set.fxCapSubs' }),
  fxCapReads: toggle(true, { group: 'lyrics', label: 's.set.fxCapReads' }),
  lyricsTarget: choice(['tag', 'lrc'], 'tag', { group: 'lyrics' }),
  // the library, the system
  scanOnLaunch: toggle(true, { group: 'library', label: 's.set.scanOnLaunch' }),
  openAtLogin: toggle(false, { group: 'system', label: 's.set.openAtLogin' }),
  closeToTray: toggle(false, { group: 'system', label: 's.set.tray' }),
  // the picture
  gfx: choice(['default', 'optimized', 'lite'], 'default', {
    group: 'picture',
    label: 's.set.gfx',
    optionHelp: (o) => 's.set.gfx.' + o + 'Help',
  }),
  scale: choice(['auto', 1, 0.85, 0.7, 0.55], 'auto', {
    group: 'picture',
    only: 'classic',
    label: 's.set.scale',
    optionLabel: (o) => (o === 'auto' ? ['s.set.scale.auto'] : ['s.set.scale.p', { n: Math.round(+o * 100) }]),
  }),
  fps: choice([0, 120, 60, 30], 0, {
    group: 'picture',
    only: 'classic',
    label: 's.set.fps',
    optionLabel: (o) => (o ? ['s.set.fps.n', { n: +o }] : ['s.set.fps.none']),
  }),
  fxAspect: choice(['16:9', '16:10', '9:16', '1:1'], '16:9', { group: 'picture', only: 'classic' }),
  prerender: toggle(true, {
    group: 'picture',
    only: 'classic',
    advanced: true,
    label: 's.set.prerender',
    help: 's.set.prerenderHelp',
  }),
  gpuLyrics: toggle(true, {
    group: 'picture',
    only: 'classic',
    advanced: true,
    label: 's.set.gpuLyrics',
    help: 's.set.gpuLyricsHelp',
  }),
  // the sound
  audioOut: choice(['standard', 'hifi'], 'standard', {
    group: 'sound',
    label: 's.set.out',
    optionLabel: (o) => [o === 'hifi' ? 's.set.out.hifi' : 's.set.out.std'],
  }),
  audioMode: choice(['exclusive', 'shared'], 'exclusive', { group: 'sound', advanced: true }),
  audioDevice: text('', { group: 'sound', advanced: true }),
  fixedVolume: toggle(true, { group: 'sound', advanced: true }),
  volBalance: toggle(true, { group: 'sound', label: 's.set.balance' }),
  // the song's own video
  mvDark: range(0, 0.9, 0.01, 0.34, { group: 'video', only: 'classic' }),
  mvBlur: range(0, 1, 0.01, 0.12, { group: 'video', only: 'classic' }),
  mvDesat: range(0, 1, 0.01, 0, { group: 'video', only: 'classic' }),
  mvFit: toggle(false, { group: 'video', only: 'classic' }),
  // finding the beats
  rhythmEngine: choice(['auto', 'neural', 'dsp'], 'auto', { group: 'rhythm', advanced: true }),
  rhythmRuntime: choice(['auto', 'webgpu'], 'auto', { group: 'rhythm', advanced: true }),
  rhythmDevice: choice(['auto', 'cpu'], 'auto', { group: 'rhythm', advanced: true }),
  rhythmDrums: toggle(true, { group: 'rhythm', advanced: true }),
  rhythmStream: choice(['stream', 'full'], 'stream', { group: 'rhythm', advanced: true }),
  // diagnostics
  perfHud: toggle(false, { group: 'diagnostics', advanced: true, label: 's.set.perfHud', help: 's.set.perfHudHelp' }),
  debugLog: toggle(false, {
    group: 'diagnostics',
    advanced: true,
    label: 's.set.debugLog',
    help: 's.set.debugLogHelp',
  }),
  // the space: moving
  spaceImmersive: toggle(false, sp('move', 'immersive', true)),
  spaceFollow: toggle(false, sp('move', 'follow', true)),
  spaceWalk: range(0.5, 2, 0.1, 1, { ...sp('move', 'walk'), unit: 'times' }),
  spaceLook: range(0.4, 2, 0.1, 1, { ...sp('move', 'lookSpeed'), unit: 'times' }),
  spaceReduced: toggle(false, sp('move', 'reduced', true)),
  // the space: how the scene answers the song
  spaceTint: choice(['cover', 'fixed'], 'cover', sp('scene', 'tint', true)),
  spaceTintColor: text('#D97757', { group: 'space.scene', only: 'space' }),
  spaceBeams: toggle(true, sp('scene', 'beams')),
  spaceBeatBeams: toggle(true, sp('scene', 'beatBeams')),
  spacePulse: toggle(true, sp('scene', 'pulse', true)),
  spaceFxBeat: range(0, 2, 0.1, 1, { ...sp('scene', 'fx.beat'), unit: 'percent' }),
  spaceFxPulse: range(0, 2, 0.1, 1, { ...sp('scene', 'fx.pulse'), unit: 'percent' }),
  spaceFxTint: range(0, 1, 0.05, 1, { ...sp('scene', 'fx.tint'), unit: 'percent' }),
  spaceFxBeams: range(0, 2, 0.1, 1, { ...sp('scene', 'fx.beams'), unit: 'percent' }),
  // the space: its picture
  spaceDream: toggle(true, sp('picture', 'dream')),
  spaceLine: choice(['thin', 'mid', 'bold'], 'mid', sp('picture', 'line')),
  spaceShadow: choice(['high', 'mid', 'low'], 'high', {
    ...sp('picture', 'shadow'),
    optionLabel: (o) => ['sp.q.' + o],
  }),
  spaceScale: choice([1, 0.75, 0.5], 1, {
    group: 'space.picture',
    only: 'space',
    label: 's.set.scale',
    optionLabel: (o) => ['s.set.scale.p', { n: Math.round(+o * 100) }],
  }),
  // the space: its own music, its lyrics
  spaceAmbient: toggle(true, sp('sound', 'ambient', true)),
  spaceAmbientVol: range(0, 1, 0.05, 0.6, { ...sp('sound', 'ambientVol'), unit: 'percent' }),
  spaceFont: text('sansmed', { group: 'space.lyrics', only: 'space' }),
  spaceLyric: choice(['s', 'm', 'l'], 'm', { ...sp('lyrics', 'lyricSize'), optionLabel: (o) => ['sp.size.' + o] }),
};

export type SettingKey = keyof typeof SCHEMA;
// (a choice among words is one of those words; a choice among numbers is typed as a number — the options are what the
// page offers)
type Wide<T> = T extends number ? number : T;
type ValueOf<D> = D extends { kind: 'choice'; options: infer O extends readonly unknown[] }
  ? Wide<O[number]>
  : D extends { default: infer V }
    ? V
    : never;
/** What is saved: one value for each setting. */
export type SettingValues = { -readonly [K in SettingKey]: ValueOf<(typeof SCHEMA)[K]> };

export const DEFAULTS = Object.fromEntries(Object.entries(SCHEMA).map(([k, d]) => [k, d.default])) as SettingValues;

/** A saved value that the schema allows (a file from an older version, or edited by hand, may hold others). */
export function allowed(key: SettingKey, v: unknown): boolean {
  const d = SCHEMA[key] as { kind: string; options?: readonly unknown[]; min?: number; max?: number };
  if (d.kind === 'toggle') return typeof v === 'boolean';
  if (d.kind === 'choice') return d.options!.includes(v);
  if (d.kind === 'range') return typeof v === 'number' && v >= d.min! && v <= d.max!;
  return typeof v === 'string';
}
