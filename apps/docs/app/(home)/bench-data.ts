/**
 * Editor load benchmark. Each editor was mounted with the SAME N-paragraph
 * document and measured for (a) the main-thread time to mount and lay out the
 * document and (b) the live DOM-node count. "Render time" is synchronous JS plus
 * a forced layout flush (paint excluded) — the work that blocks the main thread.
 * The imperative editors (TipTap/Lexical/Quill/CodeMirror) build their DOM
 * synchronously; the React editors (ori, Slate) are mounted via flushSync, so
 * every editor is measured for the same thing, with no animation-frame noise.
 * Numbers are the average of two median-of-five runs in Chromium (Playwright) on
 * Apple Silicon. Reproduce with `apps/bench` (pnpm --filter bench dev).
 *
 * Two editors virtualize their rendering — ori and CodeMirror — so they scale far
 * better than the editors that render the whole document. CodeMirror is fastest:
 * an imperative core (no React) and a lightweight text-buffer document. ori's time
 * still grows with the document because building its Yjs/CRDT block model is O(n)
 * (~12ms of the ~17ms at 5,000 blocks); only its *rendering* is windowed (flat node
 * count). This measures load only — not editing/scroll latency. CodeMirror also
 * powers rich-text editors (e.g. Obsidian); here it renders plain text.
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
  { id: "ori", label: "ori", color: "var(--color-fd-primary, #10b981)", ms: [3.9, 5.4, 6.4, 8.6, 16.6], nodes: [76, 76, 76, 76, 76] },
  { id: "codemirror", label: "CodeMirror", color: "#ec4899", ms: [1.3, 1.3, 1.4, 1.5, 1.8], nodes: [41, 41, 41, 41, 41] },
  { id: "lexical", label: "Lexical", color: "#8b5cf6", ms: [2.1, 6.1, 10.6, 19.7, 46.5], nodes: [201, 1001, 2001, 4001, 10001] },
  { id: "tiptap", label: "TipTap", color: "#f59e0b", ms: [3.8, 10.4, 18.0, 32.8, 76.8], nodes: [101, 501, 1001, 2001, 5001] },
  { id: "quill", label: "Quill", color: "#ef4444", ms: [3.1, 8.8, 16.3, 41.9, 171.4], nodes: [102, 502, 1002, 2002, 5002] },
  { id: "slate", label: "Slate", color: "#06b6d4", ms: [17.4, 68.8, 112.2, 153.0, 260.4], nodes: [401, 2001, 4001, 8001, 20001] },
];

export const BENCH_ENV = "Chromium · Apple Silicon · avg of two median-of-5 runs";
