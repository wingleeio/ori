export type Listener = () => void;

/** Minimal synchronous notifier used to drive `useSyncExternalStore`. */
export class Emitter {
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  emit(): void {
    for (const fn of this.listeners) fn();
  }

  clear(): void {
    this.listeners.clear();
  }
}
