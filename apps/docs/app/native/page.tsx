"use client";

import { createNoteDoc, getBlocks } from "@wingleeio/ori-core";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

/** Minimal prefix/suffix diff so an edit becomes a precise Y.Text splice. */
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

function Block({ yt }: { yt: Y.Text }) {
  const ref = useRef<HTMLDivElement>(null);
  // Seed the text once; thereafter the browser owns the DOM (native editing).
  useEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== yt.toString()) el.textContent = yt.toString();
  }, [yt]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onInput={(e) => syncYText(yt, e.currentTarget.textContent ?? "")}
      style={{ outline: "none", padding: "4px 0", WebkitUserSelect: "text", userSelect: "text" }}
    />
  );
}

export default function NativePrototype() {
  const [doc] = useState(() =>
    createNoteDoc([
      { text: "contentEditable prototype." },
      { text: "Tap to place the caret. Hold the spacebar to get the trackpad and slide through the text." },
      { text: "Select a word or run — the native iOS menu (Copy / Look Up / Translate) should appear." },
      { text: "Type, use dictation, autocorrect — every edit splices straight into the Y.Doc shown below." },
    ]),
  );
  const blocks = getBlocks(doc);
  const [model, setModel] = useState<string[]>([]);

  useEffect(() => {
    const update = () =>
      setModel(blocks.toArray().map((b) => (b.get("text") as Y.Text).toString()));
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
      <p
        className="ff-mono"
        style={{
          fontSize: 11,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: "var(--color-fd-muted-foreground)",
        }}
      >
        spike · native text engine
      </p>
      <h1 className="ff-display" style={{ fontSize: 30, margin: "6px 0 8px", letterSpacing: "-0.02em" }}>
        contentEditable + Y.Doc
      </h1>
      <p style={{ color: "var(--color-fd-muted-foreground)", lineHeight: 1.6 }}>
        Real browser text editing (caret, trackpad, selection menus, IME) wired straight into Ori&apos;s
        Y.Doc model. Try it on your phone — does it feel native?
      </p>

      <div style={{ marginTop: 28, fontSize: 18, lineHeight: 1.7 }}>
        {blocks.toArray().map((b, i) => (
          <Block key={i} yt={b.get("text") as Y.Text} />
        ))}
      </div>

      <h2
        className="ff-mono"
        style={{
          marginTop: 44,
          fontSize: 11,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--color-fd-muted-foreground)",
        }}
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
