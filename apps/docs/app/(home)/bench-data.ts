/**
 * Editor load benchmark. Each editor was mounted with the SAME N-paragraph
 * document and measured for (a) the main-thread time to mount and lay out the
 * document and (b) the live DOM-node count. "Render time" is synchronous JS plus
 * a forced layout flush (paint excluded) — the work that blocks the main thread
 * and causes jank. The imperative editors (TipTap/Lexical/Quill) build their DOM
 * synchronously; the React editors (ori, Slate) are mounted via flushSync, so
 * every editor is measured for the same thing, with no animation-frame noise.
 * Numbers are the average of two median-of-five runs in Chromium (Playwright) on
 * Apple Silicon. Reproduce with `apps/bench` (pnpm --filter bench dev).
 *
 * The point isn't the absolute milliseconds (they vary by machine) — it's the
 * shape: ori virtualizes, so its cost stays flat as the document grows, while
 * the others render the whole document and scale with block count. ori carries a
 * small fixed overhead, so a lean imperative editor (Lexical) is faster below
 * ~350 blocks; past that ori wins and the gap widens with scale.
 */
export const BENCH_SIZES = [100, 500, 1000, 2000, 5000] as const;

export interface BenchSeries {
  id: string;
  label: string;
  /** Brand color stands out; competitors get distinct hues (dark/light safe). */
  color: string;
  /** Main-thread mount + layout time (ms), one per size in BENCH_SIZES. */
  ms: number[];
  /** Live DOM nodes in the editor, one per size. */
  nodes: number[];
}

export const BENCH_SERIES: BenchSeries[] = [
  { id: "ori", label: "ori", color: "var(--color-fd-primary, #10b981)", ms: [4.6, 5.5, 6.3, 8.8, 17.5], nodes: [76, 76, 76, 76, 76] },
  { id: "tiptap", label: "TipTap", color: "#f59e0b", ms: [3.9, 10.5, 18.2, 33.6, 79.2], nodes: [101, 501, 1001, 2001, 5001] },
  { id: "lexical", label: "Lexical", color: "#8b5cf6", ms: [2.3, 6.5, 10.8, 19.7, 46.2], nodes: [201, 1001, 2001, 4001, 10001] },
  { id: "quill", label: "Quill", color: "#ef4444", ms: [3.0, 8.9, 16.5, 42.6, 176.4], nodes: [102, 502, 1002, 2002, 5002] },
  { id: "slate", label: "Slate", color: "#06b6d4", ms: [17.8, 68.6, 111.1, 153.7, 265.2], nodes: [401, 2001, 4001, 8001, 20001] },
];

export const BENCH_ENV = "Chromium · Apple Silicon · avg of two median-of-5 runs";
