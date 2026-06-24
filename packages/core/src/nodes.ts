import type { Measurer, Typography } from "@wingleeio/ori-pretext";
import { listInsetLeft, normalizeListLevel } from "./schema";

/**
 * The extension schema. Block nodes describe how a block type is measured and
 * laid out; inline atom nodes describe the width of single-offset embeds. The
 * controller drives all measurement through this schema, so hosts can register
 * custom, measurable nodes without forking the engine.
 */

/** Context passed to an atomic block node's measurer. */
export interface BlockMeasureContext {
  /** Available content width in px. */
  width: number;
  /** The block's `attrs` as a plain object. */
  attrs: Record<string, unknown>;
}

/**
 * Content inset (px) for a text block whose rendered CSS adds padding/border
 * that shifts its text in from the block box (e.g. a code block's padding or a
 * quote's bar + indent). The layout engine subtracts the horizontal inset from
 * the wrap width and adds the vertical inset to the height, so measurement —
 * and thus wrapping and virtualized scroll height — matches the DOM exactly.
 * These MUST be kept in sync with the host's CSS padding/border.
 */
export interface BlockInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BlockInsetContext {
  /** The block's `attrs` as a plain object. */
  attrs: Record<string, unknown>;
}

export type BlockInsetSpec = BlockInset | ((ctx: BlockInsetContext) => BlockInset);

export interface BlockNode {
  type: string;
  /**
   * `true` for editable-text blocks (paragraph, heading…), which are laid out
   * by Pretext. `false` for atomic blocks (divider, image…) that provide their
   * own height via {@link measure} and render themselves.
   */
  text: boolean;
  /** Derive this node's typography from the base (text nodes only). */
  typography?: (base: Typography) => Typography;
  /** Spacing in px above this block — its top margin / section break
   * (defaults to the editor's blockSpacing; the first block always gets 0). */
  spacing?: number;
  /** Content inset (px) matching the block's rendered CSS padding/border. */
  inset?: BlockInsetSpec;
  /** Height in px for an atomic block, as a function of width + attrs. */
  measure?: (ctx: BlockMeasureContext) => number;
}

/** Context passed to an inline atom's width measurer. */
export interface AtomMeasureContext {
  /** The embed payload (the object stored in the Y.Text). */
  data: Record<string, unknown>;
  typography: Typography;
  measurer: Measurer;
}

export interface InlineAtomNode {
  type: string;
  /** Width in px of this atom given its data + typography. */
  measure: (ctx: AtomMeasureContext) => number;
}

export interface EditorSchema {
  blocks: Record<string, BlockNode>;
  atoms: Record<string, InlineAtomNode>;
}

const listInset = ({ attrs }: BlockInsetContext): BlockInset => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: listInsetLeft(normalizeListLevel(attrs.level)),
});

/** Built-in editable-text block nodes. */
export const DEFAULT_BLOCKS: Record<string, BlockNode> = {
  paragraph: { type: "paragraph", text: true },
  heading: {
    type: "heading",
    text: true,
    // A generous gap above (it binds tightly to the body below, whose own
    // smaller spacing is the gap under the heading) reads as a section break.
    spacing: 28,
    typography: (b) => ({
      ...b,
      // No rounding: the rendered CSS uses 1.6em / 1.3, so the model must use the
      // exact fractional values to wrap and size identically.
      fontSize: b.fontSize * 1.6,
      // Match the rendered CSS weight (.ori-block-heading: 600) so width
      // measurement — and thus wrapping/line count — agrees with the DOM.
      fontWeight: 600,
      lineHeight: 1.3,
    }),
  },
  // Insets mirror the rendered CSS (styles.css): the quote's 3px bar + 12px
  // indent, and the code block's 8px/12px padding. Keeping them here lets the
  // layout engine reduce the wrap width and add the vertical padding so its
  // measurement matches the DOM.
  quote: { type: "quote", text: true, inset: { top: 0, right: 0, bottom: 0, left: 15 } },
  code: {
    type: "code",
    text: true,
    inset: { top: 8, right: 12, bottom: 8, left: 12 },
    typography: (b) => ({
      ...b,
      fontFamily: b.monoFamily,
      // No rounding: matches the rendered CSS (0.95em / 1.7) exactly.
      fontSize: b.fontSize * 0.95,
      lineHeight: 1.7,
    }),
  },
  "bullet-list": { type: "bullet-list", text: true, spacing: 4, inset: listInset },
  "ordered-list": { type: "ordered-list", text: true, spacing: 4, inset: listInset },
};

export const DEFAULT_SCHEMA: EditorSchema = { blocks: DEFAULT_BLOCKS, atoms: {} };

/** Merge custom block/atom nodes over the built-in defaults. */
export function createSchema(extra?: Partial<EditorSchema>): EditorSchema {
  return {
    blocks: { ...DEFAULT_BLOCKS, ...(extra?.blocks ?? {}) },
    atoms: { ...(extra?.atoms ?? {}) },
  };
}
