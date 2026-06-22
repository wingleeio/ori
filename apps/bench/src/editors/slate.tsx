import { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { type Descendant, createEditor } from "slate";
import { withHistory } from "slate-history";
import { Editable, Slate, withReact } from "slate-react";
import { paragraphs } from "../content";

/** Slate (the React rich-text framework that Plate is built on) renders the
 *  whole document through React — no virtualization. */
function SlateApp({ n }: { n: number }) {
  const [editor] = useState(() => withHistory(withReact(createEditor())));
  const value = paragraphs(n).map((t) => ({
    type: "paragraph",
    children: [{ text: t }],
  })) as unknown as Descendant[];
  return (
    <Slate editor={editor} initialValue={value}>
      <Editable />
    </Slate>
  );
}

export function mountSlate(container: HTMLElement, n: number): void {
  flushSync(() => createRoot(container).render(<SlateApp n={n} />));
}
