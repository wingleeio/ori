import { createNoteDoc } from "@wingleeio/ori-core";
import { NoteEditor, useEditor } from "@wingleeio/ori-react";
import "@wingleeio/ori-react/styles.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { paragraphs } from "../content";

function OriApp({ doc }: { doc: ReturnType<typeof createNoteDoc> }) {
  const editor = useEditor({ doc });
  return createElement(NoteEditor, { editor, maxWidth: 720 });
}

/** Mount ori exactly as an app would (useEditor + <NoteEditor>), but flushed
 *  synchronously so its render work is measured the same way the imperative
 *  editors' synchronous init is. It virtualizes — only the blocks that fit the
 *  600px viewport are rendered. */
export function mountOri(container: HTMLElement, n: number): void {
  const doc = createNoteDoc(paragraphs(n).map((text) => ({ text })));
  flushSync(() => createRoot(container).render(createElement(OriApp, { doc })));
}
