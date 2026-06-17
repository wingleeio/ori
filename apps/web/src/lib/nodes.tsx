import {
  resolveFont,
  type AtomMeasureContext,
  type BlockMeasureContext,
  type BlockNode,
  type EditorSchema,
  type InlineAtomNode,
} from "@wingleeio/ori-core";
import type { AtomRenderer, BlockRenderer } from "@wingleeio/ori-react";

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

export const editorNodes: Partial<EditorSchema> = {
  blocks: { divider: dividerNode, image: imageNode },
  atoms: { mention: mentionAtom },
};

export function sampleImageAttrs(): Record<string, unknown> {
  return { type: "image", src: SAMPLE_IMAGE, ratio: SAMPLE_IMAGE_RATIO };
}

// --- renderers --------------------------------------------------------------

export const blockRenderers: Record<string, BlockRenderer> = {
  divider: () => (
    <div className="flex h-full items-center" aria-hidden>
      <div className="h-px w-full bg-border" />
    </div>
  ),
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
        className="inline-flex w-full items-center justify-center rounded-md bg-primary/15 font-medium text-primary"
        style={{
          boxSizing: "border-box",
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
