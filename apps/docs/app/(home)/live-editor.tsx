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
  const add = (type: string, runs: Run[]) => {
    const block = createBlock(type);
    blocks.push([block]);
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
      { text: " for blocks and " },
      { text: "@", marks: { code: true } },
      { text: " to mention someone." },
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
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
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
