import { registerRichText } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { paragraphs } from "../content";

/** Lexical (Meta) renders the full document on the initial (discrete) update. */
export function mountLexical(container: HTMLElement, n: number): void {
  const el = document.createElement("div");
  el.contentEditable = "true";
  el.style.outline = "none";
  container.appendChild(el);

  const editor = createEditor({ namespace: "bench", onError: (e) => console.error(e) });
  editor.setRootElement(el);
  registerRichText(editor);

  editor.update(
    () => {
      const root = $getRoot();
      for (const t of paragraphs(n)) {
        const p = $createParagraphNode();
        p.append($createTextNode(t));
        root.append(p);
      }
    },
    { discrete: true },
  );
}
