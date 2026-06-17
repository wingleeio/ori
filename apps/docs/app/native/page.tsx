"use client";

import {
  blockId,
  createNoteDoc,
  deleteRange,
  getBlocks,
  insertText,
  mergeWithPrevious,
  position,
  splitBlock,
} from "@wingleeio/ori-core";
import { memo, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

/** Minimal prefix/suffix diff so a browser edit becomes a precise Y.Text splice. */
function syncYText(yt: Y.Text, next: string) {
  const cur = yt.toString();
  if (cur === next) return;
  const max = Math.min(cur.length, next.length);
  let p = 0;
  while (p < max && cur[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s++;
  const del = cur.length - p - s;
  if (del > 0) yt.delete(p, del);
  const ins = next.slice(p, next.length - s);
  if (ins) yt.insert(p, ins);
}

/**
 * A single contentEditable holding every block (so native selection spans
 * across them). The browser handles caret / selection / trackpad / menus / IME;
 * `beforeinput` translates structural + cross-block edits into Y.Doc ops, while
 * smooth in-block typing flows natively and is read back into the model.
 */
const NativeEditor = memo(function NativeEditor({ doc }: { doc: Y.Doc }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const blocks = getBlocks(doc);

    const blockElOf = (node: Node | null): HTMLElement | null => {
      let n: Node | null = node;
      while (n && n !== root) {
        if (n instanceof HTMLElement && n.dataset.b) return n;
        n = n.parentNode;
      }
      return null;
    };

    const render = () => {
      const arr = blocks.toArray();
      arr.forEach((b, i) => {
        const id = blockId(b);
        const text = (b.get("text") as Y.Text).toString();
        let el = root.children[i] as HTMLElement | undefined;
        if (!el) {
          el = document.createElement("div");
          el.className = "ce-block";
          root.appendChild(el);
        }
        if (el.dataset.b !== id) el.dataset.b = id;
        if (el.textContent !== text) el.textContent = text;
      });
      while (root.children.length > arr.length) root.lastElementChild?.remove();
    };

    const pt = (node: Node | null, offset: number) => {
      const el = blockElOf(node);
      if (!el) return null;
      const off =
        node && node.nodeType === Node.TEXT_NODE ? offset : offset > 0 ? (el.textContent ?? "").length : 0;
      return { id: el.dataset.b as string, idx: Array.prototype.indexOf.call(root.children, el), offset: off };
    };
    const domSel = () => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return null;
      const a = pt(s.anchorNode, s.anchorOffset);
      const f = pt(s.focusNode, s.focusOffset);
      if (!a || !f) return null;
      const start = a.idx < f.idx || (a.idx === f.idx && a.offset <= f.offset) ? a : f;
      const end = start === a ? f : a;
      return { start, end, collapsed: start.id === end.id && start.offset === end.offset };
    };
    const setCaret = (id: string, offset: number) => {
      const el = root.querySelector(`[data-b="${CSS.escape(id)}"]`) as HTMLElement | null;
      if (!el) return;
      const node = el.firstChild ?? el;
      const max = (node.textContent ?? "").length;
      const r = document.createRange();
      r.setStart(node, Math.min(offset, max));
      r.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(r);
    };

    const onBeforeInput = (e: InputEvent) => {
      const sel = domSel();
      if (!sel) return;
      const t = e.inputType;
      const isText = t === "insertText" || t === "insertReplacementText" || t === "insertFromPaste";
      const isPara = t === "insertParagraph";
      const isDel = t.startsWith("delete");

      // Let the browser handle the smooth common case: collapsed edits in one block.
      if (sel.collapsed && isText) return;
      if (sel.collapsed && t === "deleteContentForward") return;
      if (sel.collapsed && t === "deleteContentBackward" && sel.start.offset > 0) return;
      if (!(isText || isPara || isDel)) return;

      e.preventDefault();
      let caret = { id: sel.start.id, offset: sel.start.offset };
      if (!sel.collapsed) {
        const after = deleteRange(
          doc,
          blocks,
          position(sel.start.id, sel.start.offset),
          position(sel.end.id, sel.end.offset),
        );
        caret = { id: after.blockId, offset: after.offset };
      } else if (isDel) {
        const m = mergeWithPrevious(doc, blocks, caret.id); // backspace at block start
        if (!m) {
          render();
          setCaret(caret.id, caret.offset);
          return;
        }
        caret = { id: m.blockId, offset: m.offset };
      }
      if (isPara) {
        const p = splitBlock(doc, blocks, caret.id, caret.offset);
        caret = { id: p.blockId, offset: p.offset };
      } else if (isText && e.data) {
        const p = insertText(doc, blocks, position(caret.id, caret.offset), e.data);
        caret = { id: p.blockId, offset: p.offset };
      }
      render();
      setCaret(caret.id, caret.offset);
    };

    const onInput = () => {
      blocks.toArray().forEach((b, i) => {
        const el = root.children[i] as HTMLElement | undefined;
        if (el && el.dataset.b === blockId(b)) syncYText(b.get("text") as Y.Text, el.textContent ?? "");
      });
    };

    render();
    root.addEventListener("beforeinput", onBeforeInput);
    root.addEventListener("input", onInput);
    return () => {
      root.removeEventListener("beforeinput", onBeforeInput);
      root.removeEventListener("input", onInput);
    };
  }, [doc]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className="ce-root"
      style={{ outline: "none", fontSize: 18, lineHeight: 1.7, WebkitUserSelect: "text", userSelect: "text" }}
    />
  );
});

export default function NativePrototype() {
  const [doc] = useState(() =>
    createNoteDoc([
      { text: "contentEditable prototype — now one editable surface." },
      { text: "Selection spans across blocks: drag from here down into the next paragraph." },
      { text: "Enter splits, Backspace at a line start merges, and it all stays native." },
      { text: "Every edit splices into the Y.Doc shown below." },
    ]),
  );
  const blocks = getBlocks(doc);
  const [model, setModel] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setModel(blocks.toArray().map((b) => (b.get("text") as Y.Text).toString()));
    update();
    doc.on("update", update);
    return () => doc.off("update", update);
  }, [doc, blocks]);

  return (
    <main
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "44px 20px 96px",
        fontFamily: "var(--font-body, ui-sans-serif, system-ui)",
        color: "var(--color-fd-foreground, #111)",
      }}
    >
      <style>{`.ce-block{min-height:1.7em;white-space:pre-wrap;word-break:break-word}`}</style>
      <p
        className="ff-mono"
        style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "var(--color-fd-muted-foreground)" }}
      >
        spike · single contentEditable
      </p>
      <h1 className="ff-display" style={{ fontSize: 30, margin: "6px 0 8px", letterSpacing: "-0.02em" }}>
        contentEditable + Y.Doc
      </h1>
      <p style={{ color: "var(--color-fd-muted-foreground)", lineHeight: 1.6 }}>
        One native editable surface, all blocks — cross-block selection now works. Try it on your phone.
      </p>

      <div style={{ marginTop: 28 }}>
        <NativeEditor doc={doc} />
      </div>

      <h2
        className="ff-mono"
        style={{ marginTop: 44, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--color-fd-muted-foreground)" }}
      >
        Y.Doc model (live)
      </h2>
      <pre
        style={{
          marginTop: 8,
          padding: 16,
          borderRadius: 10,
          background: "color-mix(in oklab, var(--ink, #000) 6%, transparent)",
          border: "1px solid var(--color-fd-border)",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
        }}
      >
        {model.map((t, i) => `${i}  ${JSON.stringify(t)}`).join("\n")}
      </pre>
    </main>
  );
}
