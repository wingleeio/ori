import {
  resolveFont,
  type AtomMeasureContext,
  type BlockMeasureContext,
  type BlockNode,
  type EditorSchema,
  type InlineAtomNode,
} from "@wingleeio/ori-core";
import type { AtomRenderer, BlockRenderer } from "@wingleeio/ori-react";
import { Minus as MinusIcon, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Custom, measurable nodes registered with the editor. This file is the entire
 * surface a host needs to add a node: a `measure` (how tall / how wide) and a
 * renderer (how it looks). The engine handles layout, virtualization, caret and
 * selection around them.
 */

// A self-contained 16:9 gradient "image" so the demo needs no network.
const SAMPLE_IMAGE =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'>
      <defs>
        <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0' stop-color='#6366f1'/>
          <stop offset='0.5' stop-color='#8b5cf6'/>
          <stop offset='1' stop-color='#ec4899'/>
        </linearGradient>
      </defs>
      <rect width='1600' height='900' fill='url(#g)'/>
    </svg>`,
  );

export const SAMPLE_IMAGE_RATIO = 16 / 9;

// --- inline mention atom (width measured to match the rendered chip) --------

const CHIP_FONT_SIZE = 14;
const CHIP_PAD = 7; // px on each side -> 14px total, matches `padding: 0 7px`

const mentionLabel = (data: Record<string, unknown>): string => String(data.label ?? "mention");

const mentionAtom: InlineAtomNode = {
  type: "mention",
  measure: ({ data, typography, measurer }: AtomMeasureContext) => {
    const font = resolveFont({ ...typography, fontSize: CHIP_FONT_SIZE, fontWeight: 500 }, {});
    return Math.ceil(measurer.measure(`@${mentionLabel(data)}`, font)) + CHIP_PAD * 2;
  },
};

// --- atomic blocks ----------------------------------------------------------

const dividerNode: BlockNode = {
  type: "divider",
  text: false,
  spacing: 10,
  measure: (_ctx: BlockMeasureContext) => 33,
};

const ratioOf = (attrs: Record<string, unknown>): number => {
  const r = Number(attrs.ratio);
  return Number.isFinite(r) && r > 0 ? r : SAMPLE_IMAGE_RATIO;
};

const imageNode: BlockNode = {
  type: "image",
  text: false,
  spacing: 14,
  // Height is a pure function of width + aspect ratio — re-measured on resize.
  measure: ({ width, attrs }: BlockMeasureContext) =>
    Math.max(80, Math.min(Math.round(width / ratioOf(attrs)), 460)),
};

// --- table (an editable grid as a measurable atomic block) -------------------

/** Row height + chrome must match the renderer's CSS exactly (measure = DOM). */
const TABLE_ROW_H = 36;
const TABLE_BORDER = 1; // outer border top+bottom = 2 total

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

const tableNode: BlockNode = {
  type: "table",
  text: false,
  spacing: 14,
  // Height is a pure function of the row count — re-measured whenever the
  // attrs change (adding/removing rows), like the image on resize.
  measure: ({ attrs }: BlockMeasureContext) => tableRows(attrs).length * TABLE_ROW_H + TABLE_BORDER * 2,
};

export function defaultTableAttrs(): Record<string, unknown> {
  return {
    rows: [
      ["Name", "Value"],
      ["", ""],
      ["", ""],
    ],
  };
}

export const editorNodes: Partial<EditorSchema> = {
  blocks: { divider: dividerNode, image: imageNode, table: tableNode },
  atoms: { mention: mentionAtom },
};

export function sampleImageAttrs(): Record<string, unknown> {
  return { type: "image", src: SAMPLE_IMAGE, ratio: SAMPLE_IMAGE_RATIO };
}

// --- renderers --------------------------------------------------------------

/**
 * An editable table. Cells are uncontrolled inputs committing to the block's
 * attrs on blur — a per-keystroke write would re-render (remount) the block
 * and drop input focus, while blur-commit keeps typing native and still makes
 * every change sync/undo/measure like any other edit. Row/column controls
 * appear on hover. Copy/paste of the whole block round-trips via block attrs.
 */
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
      className="grid size-[20px] cursor-pointer place-items-center rounded-md border border-border bg-popover text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}

function TableBlock({ editor, block }: { editor: import("@wingleeio/ori-core").EditorController; block: { id: string } }) {
  const rows = (() => {
    const attrs = editor.getBlockAttrs(block.id).rows;
    return Array.isArray(attrs) ? (attrs as string[][]) : [["", ""], ["", ""]];
  })();
  const cols = rows[0]?.length ?? 2;
  const write = (next: string[][]) => editor.setBlockAttrs(block.id, { rows: next });
  const setCell = (r: number, c: number, v: string) => {
    if (rows[r]?.[c] === v) return;
    const next = rows.map((row) => [...row]);
    next[r][c] = v;
    write(next);
  };
  // Geometry contract: wrapper border (2px) + rows × 36px == the node's
  // measure(); single-sided cell borders draw the grid without any
  // border-collapse rounding.
  return (
    <div className="group/table relative" data-ori-widget>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table
          className="w-full text-sm"
          style={{ tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0 }}
        >
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={r === 0 ? "bg-muted/60" : ""}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "p-0 align-middle",
                      r > 0 && "border-t",
                      c > 0 && "border-l",
                      r === 1 ? "border-t-border" : "border-t-border/60",
                      "border-l-border/60",
                    )}
                    style={{ height: 36, boxSizing: "border-box" }}
                  >
                    {/* contenteditable (not <input>) so the cell's selection is
                        the DOCUMENT selection — the editor's own branded caret
                        overlay draws in here, identical to the text surface. */}
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      tabIndex={0}
                      role="textbox"
                      aria-label={`Table cell row ${r + 1} column ${c + 1}`}
                      dangerouslySetInnerHTML={{
                        __html: cell.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
                      }}
                      onBlur={(e) => setCell(r, c, e.currentTarget.textContent ?? "")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          (e.currentTarget as HTMLElement).blur();
                        }
                      }}
                      className={cn(
                        "flex h-full w-full items-center overflow-hidden whitespace-nowrap px-3 outline-none transition-colors focus:bg-primary/5",
                        r === 0
                          ? "text-xs font-medium uppercase tracking-wide text-muted-foreground"
                          : "text-foreground/90",
                      )}
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
        {cols > 1 && (
          <TableRailButton title="Remove last column" onClick={() => write(rows.map((row) => row.slice(0, -1)))}>
            <MinusIcon className="size-3" />
          </TableRailButton>
        )}
      </div>
      <div className="absolute -bottom-[26px] left-0 flex w-full items-center justify-center gap-1 opacity-0 transition-opacity duration-150 group-hover/table:opacity-100">
        <TableRailButton title="Add row" onClick={() => write([...rows, rows[0].map(() => "")])}>
          <Plus className="size-3" />
        </TableRailButton>
        {rows.length > 1 && (
          <TableRailButton title="Remove last row" onClick={() => write(rows.slice(0, -1))}>
            <MinusIcon className="size-3" />
          </TableRailButton>
        )}
      </div>
    </div>
  );
}

export const blockRenderers: Record<string, BlockRenderer> = {
  divider: () => (
    <div className="flex h-full items-center" aria-hidden>
      <div className="h-px w-full bg-border" />
    </div>
  ),
  table: ({ editor, block }) => <TableBlock editor={editor} block={block} />,
  image: ({ editor, block }) => {
    const src = String(editor.getBlockAttrs(block.id).src ?? "");
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          display: "block",
          width: "100%",
          height: block.height,
          objectFit: "cover",
          borderRadius: 10,
        }}
      />
    );
  },
};

export const atomRenderers: Record<string, AtomRenderer> = {
  mention: ({ atom }) => {
    const label = mentionLabel((atom.data as Record<string, unknown>) ?? {});
    return (
      <span
        className="inline-flex items-center rounded-md bg-primary/15 font-medium text-primary"
        style={{
          fontSize: CHIP_FONT_SIZE,
          fontWeight: 500,
          padding: `0 ${CHIP_PAD}px`,
          whiteSpace: "nowrap",
          lineHeight: 1.5,
        }}
      >
        @{label}
      </span>
    );
  },
};
