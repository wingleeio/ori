"use client";

import "@wingleeio/ori-react/styles.css";
import {
  DEFAULT_TYPOGRAPHY,
  attributesToMarks,
  createBlock,
  fullAttributes,
  getBlocks,
  resolveFont,
  type EditorController,
  type EditorSchema,
} from "@wingleeio/ori-core";
import {
  NoteEditor,
  useEditor,
  type AtomRenderer,
  type BlockRenderer,
  type NoteEditorHandle,
} from "@wingleeio/ori-react";
import { Minus, Plus } from "lucide-react";
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

    add("heading", [{ text: "Custom, measurable nodes" }], { level: 2 });
    add("paragraph", [
      { text: "Tables, images and dividers are " },
      { text: "custom nodes", marks: { bold: true } },
      { text: " — a measure() function plus a renderer. Hover the table for row/column controls; cells are editable." },
    ]);
    add("table", [], defaultTableAttrs());
    add("image", [], sampleImageAttrs());
    add("divider", []);

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

/* Table geometry — the measure() MUST equal the rendered CSS exactly. */
const TABLE_ROW_H = 36;
const TABLE_BORDER = 1;
const tableRows = (attrs: Record<string, unknown>): string[][] => {
  const rows = attrs.rows;
  if (Array.isArray(rows) && rows.length && rows.every((r) => Array.isArray(r))) {
    return rows as string[][];
  }
  return [
    ["", ""],
    ["", ""],
  ];
};

export function defaultTableAttrs(): Record<string, unknown> {
  return {
    rows: [
      ["Editor", "DOM nodes"],
      ["ori", "77"],
      ["everyone else", "every block"],
    ],
  };
}

/* A self-contained monochrome "photo" so the demo needs no network. */
const SAMPLE_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='700'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='#0a0a0a'/>
          <stop offset='0.55' stop-color='#1c2733'/>
          <stop offset='1' stop-color='#3291ff'/>
        </linearGradient>
        <radialGradient id='h' cx='0.8' cy='0.15' r='0.9'>
          <stop offset='0' stop-color='rgba(255,255,255,0.25)'/>
          <stop offset='1' stop-color='rgba(255,255,255,0)'/>
        </radialGradient>
      </defs>
      <rect width='1600' height='700' fill='url(#g)'/>
      <rect width='1600' height='700' fill='url(#h)'/>
    </svg>`,
  );
export const SAMPLE_IMAGE_RATIO = 1600 / 700;

export function sampleImageAttrs(): Record<string, unknown> {
  return { src: SAMPLE_IMAGE, ratio: SAMPLE_IMAGE_RATIO };
}

const schema: Partial<EditorSchema> = {
  blocks: {
    divider: { type: "divider", text: false, spacing: 10, measure: () => 33 },
    image: {
      type: "image",
      text: false,
      spacing: 14,
      measure: ({ width, attrs }) => {
        const r = Number(attrs.ratio);
        const ratio = Number.isFinite(r) && r > 0 ? r : SAMPLE_IMAGE_RATIO;
        return Math.max(80, Math.min(Math.round(width / ratio), 360));
      },
    },
    table: {
      type: "table",
      text: false,
      spacing: 14,
      measure: ({ attrs }) => tableRows(attrs).length * TABLE_ROW_H + TABLE_BORDER * 2,
    },
  },
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

/* Small solid control used by the table's hover rails. */
function TableRailButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="grid size-[20px] cursor-pointer place-items-center rounded-md text-fd-muted-foreground transition-colors hover:text-white"
      style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.14)" }}
    >
      {children}
    </button>
  );
}

/* Editable table cells commit on blur (a per-keystroke write would remount
   the focused input); `data-ori-widget` keeps events native to the inputs.
   Geometry contract: wrapper border (2px) + rows × 36px == the node's
   measure(), so single-sided cell borders draw the grid without any
   border-collapse rounding. */
function TableBlock({ editor, block }: { editor: EditorController; block: { id: string } }) {
  const rows = tableRows(editor.getBlockAttrs(block.id));
  const write = (next: string[][]) => editor.setBlockAttrs(block.id, { rows: next });
  const line = "rgba(255,255,255,0.09)";
  return (
    <div className="group/table relative" data-ori-widget>
      <div
        className="overflow-hidden rounded-lg"
        style={{ border: "1px solid rgba(255,255,255,0.14)", background: "#0c0c0c" }}
      >
        <table
          className="w-full text-sm"
          style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}
        >
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} style={r === 0 ? { background: "#161616" } : undefined}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="p-0 align-middle"
                    style={{
                      height: 36,
                      boxSizing: "border-box",
                      borderTop: r === 0 ? "none" : `1px solid ${r === 1 ? "rgba(255,255,255,0.14)" : line}`,
                      borderLeft: c === 0 ? "none" : `1px solid ${line}`,
                    }}
                  >
                    <input
                      defaultValue={cell}
                      aria-label={`Table cell row ${r + 1} column ${c + 1}`}
                      onBlur={(e) => {
                        if (rows[r]?.[c] === e.target.value) return;
                        const next = rows.map((x) => [...x]);
                        next[r][c] = e.target.value;
                        write(next);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className={`h-full w-full bg-transparent px-3 outline-none transition-colors focus:bg-white/[0.05] ${
                        r === 0
                          ? "text-[12px] font-medium uppercase tracking-wide text-fd-muted-foreground"
                          : "text-fd-foreground/90"
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* hover rails: columns on the right, rows underneath */}
      <div className="absolute -right-[26px] top-0 flex h-full flex-col items-center justify-center gap-1 opacity-0 transition-opacity duration-150 group-hover/table:opacity-100">
        <TableRailButton title="Add column" onClick={() => write(rows.map((row) => [...row, ""]))}>
          <Plus className="size-3" />
        </TableRailButton>
        {rows[0].length > 1 && (
          <TableRailButton title="Remove last column" onClick={() => write(rows.map((row) => row.slice(0, -1)))}>
            <Minus className="size-3" />
          </TableRailButton>
        )}
      </div>
      <div className="absolute -bottom-[26px] left-0 flex w-full items-center justify-center gap-1 opacity-0 transition-opacity duration-150 group-hover/table:opacity-100">
        <TableRailButton title="Add row" onClick={() => write([...rows, rows[0].map(() => "")])}>
          <Plus className="size-3" />
        </TableRailButton>
        {rows.length > 1 && (
          <TableRailButton title="Remove last row" onClick={() => write(rows.slice(0, -1))}>
            <Minus className="size-3" />
          </TableRailButton>
        )}
      </div>
    </div>
  );
}

const blockRenderers: Record<string, BlockRenderer> = {
  divider: () => (
    <div className="flex h-full items-center" aria-hidden>
      <div className="h-px w-full" style={{ background: "var(--hairline)" }} />
    </div>
  ),
  image: ({ editor, block }) => (
    <img
      src={String(editor.getBlockAttrs(block.id).src ?? "")}
      alt=""
      draggable={false}
      style={{
        display: "block",
        width: "100%",
        height: block.height,
        objectFit: "cover",
        borderRadius: 10,
        border: "1px solid var(--hairline)",
      }}
    />
  ),
  table: ({ editor, block }) => <TableBlock editor={editor} block={block} />,
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
        blockRenderers={blockRenderers}
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
