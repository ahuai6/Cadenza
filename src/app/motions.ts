// Saved custom motion styles (我的風格): how the lyrics move, apart from the look, kept in this profile and offered in
// every song's style pane beside the built-in styles.
import { createStore } from '../core/emitter';
import { motionPart, type SavedMotion, type Style } from '../theme/style';
import { remember, keep, useStore } from './state';

export interface SavedMotionEntry {
  id: string;
  name: string;
  motion: SavedMotion;
}
export const motions = createStore({ list: remember<SavedMotionEntry[]>('motions', []) });
const persist = () => keep('motions', motions.get().list);
export const useMotions = () => useStore(motions, (x) => x.list);
/** Save a style's motion under a name: over the saved style it came from, or as a new one. Returns its id. */
export function saveMotion(st: Style, name: string, asNew: boolean): string {
  const list = motions.get().list.slice(),
    id = !asNew && st.motionId && list.some((m) => m.id === st.motionId) ? st.motionId : 'm' + Date.now().toString(36);
  const entry = { id, name, motion: motionPart(st) };
  const i = list.findIndex((m) => m.id === id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  motions.set({ list });
  persist();
  return id;
}
export function deleteMotion(id: string) {
  motions.set({ list: motions.get().list.filter((m) => m.id !== id) });
  persist();
}
