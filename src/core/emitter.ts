// A typed event emitter and a tiny observable store. No DOM.

export class Emitter<E extends Record<string, unknown>> {
  private map = new Map<keyof E, Set<(p: any) => void>>();
  on<K extends keyof E>(ev: K, f: (p: E[K]) => void): () => void {
    let s = this.map.get(ev);
    if (!s) {
      s = new Set();
      this.map.set(ev, s);
    }
    s.add(f);
    return () => {
      s!.delete(f);
    };
  }
  emit<K extends keyof E>(ev: K, p: E[K]) {
    const s = this.map.get(ev);
    if (!s) return;
    for (const f of [...s]) {
      try {
        f(p);
      } catch (e) {
        console.warn(e);
      }
    }
  }
}

export interface Store<T extends object> {
  get(): T;
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(f: (s: T, prev: T) => void): () => void;
}
export function createStore<T extends object>(init: T): Store<T> {
  let state = init;
  const subs = new Set<(s: T, p: T) => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k in p)
        if ((p as any)[k] !== (state as any)[k]) {
          changed = true;
          break;
        }
      if (!changed) return;
      const prev = state;
      state = { ...state, ...p };
      for (const f of [...subs]) {
        try {
          f(state, prev);
        } catch (e) {
          console.warn(e);
        }
      }
    },
    subscribe(f) {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
  };
}
