// The workshop's project: a free lyric video with its own engine (its own canvas and clock), independent of the player.
// Everything it holds — lyrics, tempo, style, song titles, timing, cover, audio, background video — is one Session plus
// what the session cannot keep as plain data (decoded audio, imported files). The project is kept in this profile
// shortly after every change, and can be saved to a file and opened again.
import { createStore } from '../../core/emitter';
import { Engine, Session } from '../../engine';
import { analyzeInBackground, type RhythmAnalysis, type SongInfo } from '../../engine';
import { storedStyle, presetStyle, DEFAULT_THEME, DEFAULT_LYRIC_ASPECT } from '../../theme/style';
import { DEMO_LYRICS } from '../../theme/demo';
import { tx } from '../../i18n';
import { remember, keep } from '../state';
import { audioContext, sessionEnv } from '../playback/stage';
import { Lib } from '../bridge';
import { canEdit, editTask } from '../editing';
import { applyExistingPreset, type PresetChoice } from '../preset-choice';

export interface Project {
  app: 'cadenza';
  version: 1;
  lyrics: string;
  bpm: number;
  style: unknown;
  song: SongInfo;
  lshift: number;
  range: string;
  fade: boolean;
  endLen: number;
  cover: { data: string; name: string } | null;
}
export interface Incoming {
  project: Project;
  buffer: AudioBuffer | null;
  analysis: RhythmAnalysis | null;
  name: string;
}
const fresh = (): Project => ({
  app: 'cadenza',
  version: 1,
  lyrics: DEMO_LYRICS,
  bpm: 120,
  style: { ...storedStyle(presetStyle(DEFAULT_THEME)) },
  song: { on: true, title: tx('demo.title'), composer: tx('demo.composer') },
  lshift: 0,
  range: '',
  fade: true,
  endLen: 3.5,
  cover: null,
});

export const canvas = document.createElement('canvas');
export const engine = new Engine(canvas, { audioContext });
engine.loop = true;
export const ws = createStore({
  session: null as Session | null,
  rev: 0,
  projectId: 0,
  audioName: '',
  analyzing: false,
  video: { name: '', start: '', loop: true },
  status: { lyrics: '', audio: '', cover: '', video: '' } as Record<string, string>,
});
let cover: Project['cover'] = null,
  pending: Incoming | null = null,
  projectSequence = 0,
  saveTm = 0;
const bump = () => ws.set({ rev: ws.get().rev + 1 });
engine.on('change', bump);
function persist() {
  clearTimeout(saveTm);
  saveTm = window.setTimeout(() => {
    try {
      keep('project', projectData());
    } catch {
      /* full storage: the project still lives in memory */
    }
  }, 400);
}
export function projectData(): Project | null {
  const s = ws.get().session;
  if (!s) return null;
  return {
    app: 'cadenza',
    version: 1,
    lyrics: s.spec.lyrics,
    bpm: s.spec.bpm || 120,
    style: storedStyle(s.style),
    song: s.spec.song,
    lshift: s.spec.lshift || 0,
    range: s.spec.range || '',
    fade: s.spec.fade !== false,
    endLen: s.endLen,
    cover,
  };
}
/** Change the project's session and keep the change. */
export function edit(fn: (s: Session) => unknown) {
  if (!canEdit()) return;
  change(fn);
}
export function chooseWorkshopPreset(choice: PresetChoice) {
  change((session) => applyExistingPreset(session, choice));
}
function change(fn: (s: Session) => unknown) {
  const s = ws.get().session;
  if (!s) return;
  if (fn(s) === false) return;
  engine.invalidate();
  bump();
  persist();
}

async function openProject(
  p: Project,
  buffer: AudioBuffer | null = null,
  analysis: RhythmAnalysis | null = null,
  name = '',
) {
  const projectId = ++projectSequence;
  cover = p.cover || null;
  const s = await Session.open(
    {
      key: 'workshop',
      lyrics: p.lyrics || '',
      style: p.style,
      song: { ...p.song, on: p.song?.on !== false },
      coverUrl: cover?.data || '',
      audio: buffer,
      analysis,
      bpm: p.bpm || 120,
      lshift: p.lshift || 0,
      range: p.range || '',
      fade: p.fade !== false,
      endLen: p.endLen ?? 3.5,
    },
    sessionEnv(engine),
  );
  s.style.aspect ||= DEFAULT_LYRIC_ASPECT;
  engine.show(s, { play: false });
  ws.set({ session: s, projectId, audioName: buffer ? name : '' });
  bump();
  return s;
}
/** Open the workshop: a song sent from the library, the project kept from last time, or the demo. */
export async function start() {
  if (pending) {
    const x = pending;
    pending = null;
    await openProject(x.project, x.buffer, x.analysis, x.name);
    persist();
    return;
  }
  if (ws.get().session) return;
  const saved = remember<Project | null>('project', null);
  try {
    await openProject(saved && saved.app === 'cadenza' ? saved : fresh());
  } catch {
    await openProject(fresh());
  }
}
/** A library song becomes the workshop's next project, free to change without touching the song. */
export function queueImport(x: Incoming) {
  if (!canEdit()) return;
  pending = x;
  ws.set({ session: null });
}

/* ---------- the project's parts ---------- */
export const applyLyrics = (text: string, bpm: string | number) =>
  canEdit() ? editTask(() => applyProjectLyrics(text, bpm)) : Promise.resolve(false);
async function applyProjectLyrics(text: string, bpm: string | number) {
  const s = ws.get().session;
  if (!s) return false;
  edit((s) => {
    s.setLyrics(text);
    s.setTiming({ bpm: Math.max(40, Math.min(240, +bpm || 120)) });
  });
  await s.flush();
  ws.set({
    status: {
      ...ws.get().status,
      lyrics: s.hasLyrics
        ? tx('load.ok', {
            n: s.doc.lines.length,
            k: s.doc.lines.filter((L) => L.kar).length,
            shots: s.plan.camera.stops.length,
            dur: s.dur.toFixed(1),
            off: (s.doc.lines[0]?.t ?? 0).toFixed(2),
          })
        : tx('load.none'),
    },
  });
  bump();
  return true;
}
export const resetDemo = () => (canEdit() ? editTask(resetProject) : Promise.resolve());
async function resetProject() {
  await openProject(fresh());
  persist();
}
export const importAudio = (file?: File) => (canEdit() ? editTask(() => importProjectAudio(file)) : Promise.resolve());
async function importProjectAudio(f?: File) {
  const st = () => ws.get().status;
  const previousAudio = st().audio;
  let ticket: Awaited<ReturnType<NonNullable<typeof Lib>['openWorkshopAudio']>> = null;
  ws.set({ analyzing: true, status: { ...st(), audio: tx('aud.analyzing') } });
  try {
    if (!f) ticket = (await Lib?.openWorkshopAudio()) || null;
    const name = f?.name || ticket?.name;
    if (!name) {
      ws.set({ status: { ...st(), audio: previousAudio } });
      return;
    }
    let data: ArrayBuffer;
    if (f) data = await f.arrayBuffer();
    else {
      const response = await fetch('cadenza://workshop-audio/' + ticket!.id);
      if (!response.ok) throw new Error('workshop audio');
      data = await response.arrayBuffer();
    }
    const buf = await audioContext().decodeAudioData(data);
    const a = await analyzeInBackground(buf);
    edit((s) => s.setAudio(buf, a));
    const tempo = a.beatEvidence === 'none' ? '' : ` · ${a.tempo.bpm.toFixed(1)} BPM`;
    if (tempo) edit((s) => s.setTiming({ bpm: +a.tempo.bpm.toFixed(1) }));
    ws.set({
      audioName: name,
      status: {
        ...st(),
        audio: `${name} · ${tx(buf.numberOfChannels > 1 ? 'aud.stereo' : 'aud.mono')} · ${buf.duration.toFixed(1)} s${tempo}`,
      },
    });
  } catch {
    ws.set({ status: { ...st(), audio: tx('aud.bad') } });
  } finally {
    if (ticket) void Lib?.closeWorkshopAudio(ticket.id).catch(() => {});
    ws.set({ analyzing: false });
  }
}
export function clearAudio() {
  if (!canEdit()) return;
  edit((s) => s.setAudio(null, null));
  ws.set({ audioName: '', status: { ...ws.get().status, audio: '' } });
}
export const importCover = (file: File) => (canEdit() ? editTask(() => importProjectCover(file)) : Promise.resolve());
async function importProjectCover(f: File) {
  const data = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(f);
  });
  cover = { data, name: f.name };
  const s = ws.get().session;
  if (!s) return;
  await s.setCover(data, true);
  edit(() => {});
  ws.set({ status: { ...ws.get().status, cover: tx('cv.using', { name: f.name }) } });
}
export async function clearCover() {
  if (!canEdit()) return;
  cover = null;
  const s = ws.get().session;
  if (!s) return;
  await s.setCover('', false);
  edit(() => {});
  ws.set({ status: { ...ws.get().status, cover: '' } });
}
export const importVideo = (file: File) => (canEdit() ? editTask(() => importProjectVideo(file)) : Promise.resolve());
async function importProjectVideo(f: File) {
  const ok = await engine.video.open(URL.createObjectURL(f), f, f.name);
  ws.set({
    video: { ...ws.get().video, name: ok ? f.name : '' },
    status: {
      ...ws.get().status,
      video: ok
        ? tx('vd.using', { name: f.name, len: `${(engine.video.el?.duration || 0).toFixed(1)} s` })
        : tx('vd.bad'),
    },
  });
  if (ok)
    edit((s) => {
      if (s.custom) s.setStyle('bgStyle', 'video');
      else s.applyPreset('video');
    });
}
export function clearVideo() {
  if (!canEdit()) return;
  engine.video.close();
  ws.set({ video: { ...ws.get().video, name: '' }, status: { ...ws.get().status, video: '' } });
  engine.invalidate();
}
export function setVideoOpt(k: 'start' | 'loop', v: string | boolean) {
  if (!canEdit()) return;
  (engine.video as any)[k] = v;
  ws.set({ video: { ...ws.get().video, [k]: v } });
  engine.invalidate();
}
export const importProject = (file: File) =>
  canEdit() ? editTask(() => openImportedProject(file)) : Promise.resolve();
async function openImportedProject(f: File) {
  const p = JSON.parse(await f.text()) as Project;
  if (!p || typeof p !== 'object' || typeof p.lyrics !== 'string') throw new Error('bad');
  const s = ws.get().session,
    buf = s?.audio && (s.audio as AudioBuffer).getChannelData ? (s.audio as AudioBuffer) : null;
  await openProject({ ...fresh(), ...p, app: 'cadenza', version: 1 }, buf, s?.analysis || null, ws.get().audioName);
  persist();
}
