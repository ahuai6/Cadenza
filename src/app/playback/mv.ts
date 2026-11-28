// The MV bound to the shown song: opened with its scene, turned on and off, moved in time, bound and unbound. Each step
// that waits checks that the same scene is still shown (a scene belongs to one selection of one song).
import { Lib } from '../bridge';
import { canEdit, editTask } from '../editing';
import { engine } from './stage';
import { NO_MV, player, projection } from './projection';
import { saveSong, writeSong } from './song-data';

const stillShown = (id: string, session: unknown) => player.get().shownId === id && player.get().session === session;

export async function loadMv(id: string, mv: { offset: number }, on: boolean) {
  const session = player.get().session;
  engine.mv.offset = mv.offset || 0;
  const ok = await engine.mv.open(`cadenza://mv/${id}?v=${Date.now()}`);
  if (!stillShown(id, session)) return;
  projection.set({ mv: { ...player.get().mv, ready: ok, on: ok && on } });
  if (ok && on) engine.mv.setOn(true);
}
export const bindMv = () => (canEdit() ? editTask(bindSelectedMv) : Promise.resolve(false));
async function bindSelectedMv() {
  const p = player.get();
  if (!p.shownId || !Lib) return false;
  const { shownId: id, session } = p;
  if (!(await writeSong(id)) || !stillShown(id, session)) return false;
  const r = await Lib.bindMv(id);
  if (!r || !stillShown(id, session)) return false;
  // (kept on before the clip is opened: binding it changes the library, and a song opened again meanwhile reads what
  // is kept — it would find the MV off, and turn it off)
  projection.set({
    mv: { bound: true, name: r.name, offset: r.offset, on: false, ready: false },
    song: { ...(p.song || {}), mv: r, mvOn: true },
  });
  saveSong({ mv: r, mvOn: true });
  await loadMv(id, r, true);
  return true;
}
export function setMvOn(on: boolean) {
  const p = player.get();
  if (!p.mv.ready) return;
  engine.mv.setOn(on);
  projection.set({ mv: { ...p.mv, on } });
  saveSong({ mvOn: on });
}
export function setMvOffset(x: number) {
  if (!canEdit()) return;
  const p = player.get();
  engine.mv.offset = +x || 0;
  engine.invalidate();
  projection.set({ mv: { ...p.mv, offset: +x || 0 } });
  saveSong({ mv: { ...(p.song?.mv || { name: p.mv.name }), offset: +x || 0 } });
}
export async function unbindMv() {
  if (!canEdit()) return;
  engine.mv.setOn(false);
  engine.mv.close();
  projection.set({ mv: NO_MV });
  saveSong({ mv: null, mvOn: false, unbind: true });
}
