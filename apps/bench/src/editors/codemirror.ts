import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { paragraphs } from "../content";

/** A fixed-height scroller so CodeMirror virtualizes (renders only the visible
 *  lines) — the same windowing setup ori uses. CodeMirror is a code/plain-text
 *  editor, not a rich block editor, but it's the other well-known editor that
 *  virtualizes, so it's a useful point of comparison. */
const fixedHeight = EditorView.theme({
  "&": { height: "600px" },
  ".cm-scroller": { overflow: "auto" },
});

export function mountCodemirror(container: HTMLElement, n: number): void {
  new EditorView({
    state: EditorState.create({
      doc: paragraphs(n).join("\n"),
      extensions: [fixedHeight],
    }),
    parent: container,
  });
}
