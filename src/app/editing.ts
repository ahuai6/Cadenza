import { useEffect, useState } from 'react';
import { createStore } from '../core/emitter';
import { tx } from '../i18n';
import { D } from './bridge';
import { toast, ui, useStore } from './state';

const mode = createStore({ enabled: !D, switching: false });
const drafts = new Map<string, unknown>();
const pending = new Set<Promise<unknown>>();
let flush = async () => true;

export const canEdit = () => mode.get().enabled && !mode.get().switching;
export const useEditing = () => useStore(mode, (s) => s.enabled);
export const useEditSwitch = () => useStore(mode, (s) => s.switching);

export function beforeEditingExit(save: () => Promise<boolean>) {
  flush = save;
}

/** Admitted edits can finish before disabling the capability. New edits are refused during the switch. */
export function editTask<T>(operation: () => Promise<T>): Promise<T> {
  const work = operation();
  pending.add(work);
  void work.then(
    () => pending.delete(work),
    () => pending.delete(work),
  );
  return work;
}

export async function toggleEditing() {
  if (!D || mode.get().switching) return false;
  const on = !mode.get().enabled;
  if (!on && pending.size) {
    toast(tx('edit.saving'));
    return false;
  }
  mode.set({ switching: true });
  try {
    if ((!on && !(await flush())) || !(await D.setEditing(on))) {
      toast(tx('edit.failed'));
      return false;
    }
    mode.set({ enabled: on });
    ui.set({ menu: null });
    if (!on && drafts.size) toast(tx('edit.draftKept'));
    return true;
  } catch {
    toast(tx('edit.failed'));
    return false;
  } finally {
    mode.set({ switching: false });
  }
}

export function bindEditingKey() {
  const key = (event: KeyboardEvent) => {
    if (event.repeat || event.isComposing || !event.ctrlKey || !event.shiftKey || event.altKey || event.code !== 'KeyE')
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void toggleEditing();
  };
  addEventListener('keydown', key, true);
  return () => removeEventListener('keydown', key, true);
}

/** Uncommitted input belongs to its document even if changing tabs, songs or UI capability unmounts the field. */
export function useEditingDraft<T>(key: string, read: () => T) {
  const [value, setValue] = useState(() => (drafts.has(key) ? (drafts.get(key) as T) : read()));
  useEffect(() => {
    setValue(drafts.has(key) ? (drafts.get(key) as T) : read());
  }, [key]);
  const update = (next: T) => {
    if (!canEdit()) return;
    drafts.set(key, next);
    setValue(next);
  };
  const clear = (next = read()) => {
    drafts.delete(key);
    setValue(next);
  };
  const sync = (next: T) => {
    if (!drafts.has(key)) setValue(next);
  };
  return [value, update, clear, sync] as const;
}
