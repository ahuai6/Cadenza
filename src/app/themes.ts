// Saved custom themes: kept in this profile, shared by the workshop and every song's panel.
import { createStore } from '../core/emitter';
import { storedStyle, type Style } from '../theme/style';
import { remember, keep, useStore } from './state';

export interface SavedTheme {
  id: string;
  name: string;
  style: unknown;
}
export const themes = createStore({ list: remember<SavedTheme[]>('themes', []) });
const persist = () => keep('themes', themes.get().list);
export const useThemes = () => useStore(themes, (x) => x.list);
/** Save a style under a name: over the theme it came from, or as a new one. Returns its id. */
export function saveTheme(st: Style, name: string, asNew: boolean): string {
  const list = themes.get().list.slice(),
    id = !asNew && st.id && list.some((t) => t.id === st.id) ? st.id : 't' + Date.now().toString(36);
  const entry = { id, name, style: { ...storedStyle(st), id, name, preset: 'custom' } };
  const i = list.findIndex((t) => t.id === id);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  themes.set({ list });
  persist();
  return id;
}
export function deleteTheme(id: string) {
  themes.set({ list: themes.get().list.filter((t) => t.id !== id) });
  persist();
}
