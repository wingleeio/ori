import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { paragraphs } from "../content";

/** TipTap (ProseMirror engine) renders the full document to the DOM up front. */
export function mountTiptap(container: HTMLElement, n: number): void {
  const content = paragraphs(n)
    .map((t) => `<p>${t}</p>`)
    .join("");
  new Editor({ element: container, extensions: [StarterKit], content });
}
