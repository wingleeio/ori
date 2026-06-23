import { mountLexical } from "./editors/lexical";
import { mountOri } from "./editors/ori";
import { mountQuill } from "./editors/quill";
import { mountSlate } from "./editors/slate";
import { mountTiptap } from "./editors/tiptap";

/**
 * Benchmark harness. Loaded as `?editor=<id>&n=<blocks>`, it mounts one editor
 * with N identical paragraphs and records the **main-thread time to mount and
 * lay out the document** (synchronous JS + a forced layout flush; paint
 * excluded) plus the live DOM-node count, on `window.__bench`.
 *
 * Every editor's initialization runs synchronously: the imperative editors
 * (TipTap/Lexical/Quill) build their DOM synchronously, and the React editors
 * (ori, Slate) are mounted via flushSync — so each is measured for the same
 * thing (the work that blocks the main thread), with no animation-frame noise.
 */
type Mount = (container: HTMLElement, n: number) => void;
const MOUNT: Record<string, Mount> = {
  ori: mountOri,
  tiptap: mountTiptap,
  lexical: mountLexical,
  quill: mountQuill,
  slate: mountSlate,
};

const params = new URLSearchParams(location.search);
const editor = params.get("editor") ?? "ori";
const n = Number(params.get("n") ?? "1000");
const container = document.getElementById("app") as HTMLElement;

const t0 = performance.now();
MOUNT[editor](container, n);
// Force a synchronous layout so each editor pays its layout cost before we stop
// the clock (the non-virtualized editors lay out the whole document here).
void container.getBoundingClientRect();
const ms = performance.now() - t0;

(window as unknown as { __bench: unknown }).__bench = {
  editor,
  n,
  ms: Number(ms.toFixed(2)),
  nodes: container.querySelectorAll("*").length,
};
