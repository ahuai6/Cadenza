// The slice of framer-motion's MotionValue Folia's visualizers read: a value with get/set and
// change listeners. Cadenza drives these from its own clock and rhythm (src/folia/engines).
export interface MotionValue<T = number> {
  get(): T;
  set(value: T): void;
  on(event: 'change', listener: (value: T) => void): () => void;
}

export function motionValue<T>(initial: T): MotionValue<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set(v: T) {
      if (Object.is(v, value)) return;
      value = v;
      for (const l of listeners) l(v);
    },
    on(_event, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
