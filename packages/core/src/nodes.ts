import type { Measurer, Typography } from "@wingleeio/ori-pretext";

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
      fontSize: Math.round(b.fontSize * 1.6),
      // Match the rendered CSS weight (.ori-block-heading: 600) so width
      // measurement — and thus wrapping/line count — agrees with the DOM.
      fontWeight: 600,
      lineHeight: 1.3,
    }),
  },
  quote: { type: "quote", text: true },
  code: {
    type: "code",
    text: true,
    typography: (b) => ({
      ...b,
      fontFamily: b.monoFamily,
      fontSize: Math.round(b.fontSize * 0.95),
      lineHeight: 1.7,
    }),
  },
};

export const DEFAULT_SCHEMA: EditorSchema = { blocks: DEFAULT_BLOCKS, atoms: {} };

/** Merge custom block/atom nodes over the built-in defaults. */
export function createSchema(extra?: Partial<EditorSchema>): EditorSchema {
  return {
    blocks: { ...DEFAULT_BLOCKS, ...(extra?.blocks ?? {}) },
    atoms: { ...(extra?.atoms ?? {}) },
  };
}
