/**
 * Editor load benchmark. Each editor was mounted with the SAME N-paragraph
 * document and measured for (a) the main-thread time to mount and lay out the
 * document and (b) the live DOM-node count. "Render time" is synchronous JS plus
 * a forced layout flush (paint excluded) — the work that blocks the main thread.
 * The imperative editors (TipTap/Lexical/Quill) build their DOM synchronously;
 * the React editors (ori, Slate) are mounted via flushSync, so every editor is
 * measured for the same thing, with no animation-frame noise.
 * Load numbers are the average of two median-of-five runs, after two warmups,
 * in Chrome for Testing (Playwright) on Apple Silicon. Reproduce with
 * `apps/bench` (pnpm --filter bench build && pnpm --filter bench preview).
 *
 * ori is the only editor in this rich-text/block-editor set that virtualizes its
 * rendering, so its DOM stays flat while the others render the whole document.
 * ori's load time still grows with the document because building its Yjs/CRDT
 * block model is O(n); only its *rendering* is windowed.
 *
 * `editMs` is the other half of the story: the main-thread scripting time per
 * keystroke, measured by typing real characters into each editor. It is the median
 * insert-text event cost from three typed phrase runs (beforeinput + input when the
 * editor emits both events). Here virtualization pays off for ori — typing only
 * touches the active block, so it stays flat at the measurement floor at any size.
 * Slate still re-renders enough of the document per keystroke to scale visibly.
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
  /** Main-thread scripting time per keystroke (ms), one per size. */
  editMs: number[];
}

export const BENCH_SERIES: BenchSeries[] = [
  { id: "ori", label: "ori", color: "var(--color-fd-primary, #10b981)", ms: [3.4, 4.6, 5.6, 7.2, 14.9], nodes: [77, 77, 77, 77, 77], editMs: [0.1, 0.1, 0.1, 0.1, 0.1] },
  { id: "lexical", label: "Lexical", color: "#8b5cf6", ms: [1.8, 5.4, 9.5, 17.0, 41.5], nodes: [201, 1001, 2001, 4001, 10001], editMs: [0.0, 0.0, 0.0, 0.1, 0.2] },
  { id: "tiptap", label: "TipTap", color: "#f59e0b", ms: [3.6, 9.8, 17.2, 30.5, 74.6], nodes: [101, 501, 1001, 2001, 5001], editMs: [0.1, 0.1, 0.2, 0.2, 0.5] },
  { id: "quill", label: "Quill", color: "#ef4444", ms: [2.8, 8.1, 14.2, 33.9, 132.8], nodes: [102, 502, 1002, 2002, 5002], editMs: [0.1, 0.1, 0.15, 0.2, 0.4] },
  { id: "slate", label: "Slate", color: "#06b6d4", ms: [3.7, 11.0, 19.0, 37.8, 82.9], nodes: [401, 2001, 4001, 8001, 20001], editMs: [0.4, 1.1, 2.15, 4.05, 9.75] },
];

export const BENCH_ENV = "Chrome for Testing · Apple Silicon · load: avg of two median-of-5 runs";
