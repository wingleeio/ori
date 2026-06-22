import Quill from "quill";
import "quill/dist/quill.core.css";
import { paragraphs } from "../content";

/** Quill renders every line to the DOM up front. */
export function mountQuill(container: HTMLElement, n: number): void {
  const el = document.createElement("div");
  container.appendChild(el);
  const q = new Quill(el);
  // One line per block; Quill wraps each line in its own block element.
  q.setText(`${paragraphs(n).join("\n")}\n`);
}
