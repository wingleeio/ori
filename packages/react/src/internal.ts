import { useMemo, useRef } from "react";

/**
 * Wrap a frequently-changing callback in a stable identity so it can be used in
 * effect dependency lists without re-subscribing. The latest closure is always
 * invoked.
 */
export function useCallbackRef<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const ref = useRef(fn);
  ref.current = fn;
  return useMemo(() => (...args: Args) => ref.current(...args), []);
}
