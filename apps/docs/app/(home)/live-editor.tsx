"use client";

import "@wingleeio/ori-react/styles.css";
import {
  DEFAULT_TYPOGRAPHY,
  attributesToMarks,
  createBlock,
  fullAttributes,
  getBlocks,
  resolveFont,
  type EditorSchema,
} from "@wingleeio/ori-core";
import { NoteEditor, useEditor, type AtomRenderer, type NoteEditorHandle } from "@wingleeio/ori-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { MentionMenu, SelectionMenu, SlashMenu } from "./editor-menus";

interface Run {
  text?: string;
  marks?: Record<string, unknown>;
  embed?: Record<string, unknown>;
}

function seedDoc(): Y.Doc {
  const doc = new Y.Doc();
  const blocks = getBlocks(doc);
  const add = (type: string, runs: Run[], attrs?: Record<string, unknown>) => {
    const block = createBlock(type);
    blocks.push([block]);
    if (attrs) {
      const attrMap = block.get("attrs") as Y.Map<unknown>;
      for (const [k, v] of Object.entries(attrs)) attrMap.set(k, v);
    }
    const text = block.get("text") as Y.Text;
    let at = 0;
    for (const run of runs) {
      if (run.embed) {
        text.insertEmbed(at, run.embed);
        at += 1;
      } else {
        const t = run.text ?? "";
        text.insert(at, t, fullAttributes(attributesToMarks(run.marks)));
        at += t.length;
      }
    }
  };
  doc.transact(() => {
    add("heading", [{ text: "Field notes" }]);
    add("paragraph", [
      { text: "This is a real editor, running on the page. " },
      { text: "Marks", marks: { bold: true } },
      { text: " live inside the " },
      { text: "Y.Text", marks: { code: true } },
      { text: ", layout comes from Pretext, and " },
      { embed: { type: "mention", label: "you" } },
      { text: " can edit any of it." },
    ]);
    add("paragraph", [
      { text: "Select text for the formatting menu, or press " },
      { text: "/", marks: { code: true } },
      { text: " for blocks, including bullet and numbered lists, and " },
      { text: "@", marks: { code: true } },
      { text: " to mention someone." },
    ]);
    add("bullet-list", [{ text: "Lists are ordinary text blocks with measured gutters." }]);
    add("bullet-list", [{ text: "Press Tab to nest the current list item." }], { level: 1 });
    add("ordered-list", [{ text: "Ordered siblings keep numbering across nested children." }]);
    add("ordered-list", [{ text: "Shift+Tab lifts a nested item back out." }], { level: 1 });
    add("todo-list", [{ text: "Click the checkbox to toggle a to-do item." }], { checked: true });
    add("todo-list", [{ text: "Checked state lives in the block's attrs, like any mark." }]);

    add("heading", [{ text: "How it fits together" }]);
    add("paragraph", [
      { text: "Every block is a row in a " },
      { text: "Y.Array", marks: { code: true } },
      { text: ", so structure and text are " },
      { text: "collaborative by default", marks: { italic: true } },
      { text: ". Press " },
      { text: "Enter", marks: { code: true } },
      { text: " to split a paragraph, " },
      { text: "Backspace", marks: { code: true } },
      { text: " at the start to merge it back." },
    ]);
    add("quote", [
      { text: "Layout is derived, never stored — Pretext re-flows the runs into lines on demand.", marks: { italic: true } },
    ]);
    add("paragraph", [{ text: "A slash command can turn any line into a heading, quote, or code block:" }]);
    add("code", [{ text: "const update = Y.encodeStateAsUpdate(doc);" }]);
    add("paragraph", [
      { text: "Copy a few of these blocks and paste them anywhere — marks " },
      { text: "and", marks: { bold: true } },
      { text: " block types come along. Happy editing, " },
      { embed: { type: "mention", label: "friend" } },
      { text: "." },
    ]);
  });
  return doc;
}

const CHIP_FONT = 14;

const schema: Partial<EditorSchema> = {
  atoms: {
    mention: {
      type: "mention",
      measure: ({ data, typography, measurer }) => {
        const label = String((data as { label?: string }).label ?? "");
        const font = resolveFont({ ...typography, fontSize: CHIP_FONT, fontWeight: 500 }, {});
        return Math.ceil(measurer.measure(`@${label}`, font)) + 14;
      },
    },
  },
};

const atomRenderers: Record<string, AtomRenderer> = {
  mention: ({ atom }) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        fontSize: CHIP_FONT,
        fontWeight: 500,
        lineHeight: 1.5,
        padding: "0 7px",
        borderRadius: 6,
        background: "color-mix(in oklab, var(--accent) 16%, transparent)",
        color: "var(--accent)",
      }}
    >
      @{String((atom.data as { label?: string }).label ?? "")}
    </span>
  ),
};

const typography = {
  ...DEFAULT_TYPOGRAPHY,
  fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif",
};

function EditorInner() {
  const doc = useMemo(() => seedDoc(), []);
  const editor = useEditor({ doc, schema, typography });
  const editorRef = useRef<NoteEditorHandle>(null);
  return (
    <>
      <NoteEditor
        ref={editorRef}
        editor={editor}
        maxWidth={620}
        placeholder="Write something…"
        atomRenderers={atomRenderers}
        className="h-full"
      />
      <SelectionMenu editor={editor} editorRef={editorRef} />
      <SlashMenu editor={editor} editorRef={editorRef} />
      <MentionMenu editor={editor} editorRef={editorRef} />
    </>
  );
}

export function LiveEditor() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="live-editor overflow-hidden rounded-2xl border border-fd-border bg-fd-card shadow-[0_24px_60px_-30px_rgba(0,0,0,0.4)]">
      <div className="flex items-center gap-3 border-b border-fd-border px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-fd-primary/70" />
          <span className="size-2.5 rounded-full bg-fd-muted-foreground/30" />
          <span className="size-2.5 rounded-full bg-fd-muted-foreground/30" />
        </div>
        <span className="ff-mono text-[11px] text-fd-muted-foreground">untitled.note</span>
        <span className="ff-mono ml-auto flex items-center gap-1.5 text-[11px] text-fd-muted-foreground">
          <span className="size-1.5 rounded-full bg-fd-primary" />
          live
        </span>
      </div>
      <div className="h-[360px]">
        {mounted ? <EditorInner /> : <div className="size-full" aria-hidden />}
      </div>
    </div>
  );
}
