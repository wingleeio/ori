/**
 * Core data types for the Pretext layout engine.
 *
 * Pretext is intentionally free of any DOM, canvas, React or Yjs dependency.
 * It receives styled inline text and a {@link Measurer}, and produces pure
 * geometric layout data (lines, fragments, caret positions, selection rects).
 */

/** Inline formatting marks that can apply to a run of text. */
export interface Marks {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  underline?: boolean;
  strike?: boolean;
  link?: string;
}

/**
 * An inline atom: a non-text, indivisible unit embedded in a line (e.g. a
 * mention chip, an inline equation). It occupies exactly one offset and lays
 * out as a single fixed-width box. The host supplies `width` (already measured)
 * and `data` is passed through to the renderer; Pretext never interprets it.
 */
export interface InlineAtom {
  type: string;
  width: number;
  data?: unknown;
}

/**
 * A styled run of text with its absolute character offset within the block.
 * `start` is the offset of the first character of `text` in the block's source
 * string (the same coordinate space Yjs uses). When `atom` is set the item is a
 * single-offset inline atom and `text` is ignored for rendering.
 */
export interface InlineItem {
  text: string;
  start: number;
  marks?: Marks;
  atom?: InlineAtom;
}

/** Typography settings that fully determine layout for a block. */
export interface Typography {
  /** CSS font-family stack used for normal text. */
  fontFamily: string;
  /** Monospace stack used for `code` marks. */
  monoFamily: string;
  /** Base font size in CSS pixels. */
  fontSize: number;
  /** Base font weight for unmarked text. */
  fontWeight: number;
  /** Line height as a multiple of `fontSize`. */
  lineHeight: number;
  /** Extra tracking applied per character, in pixels. */
  letterSpacing: number;
}

/** A run resolved to a concrete font, ready for measurement & rendering. */
export interface ResolvedFont {
  /** CSS `font` shorthand, e.g. `"italic 700 16px Inter"`. */
  css: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  /** Line box height in pixels (constant across marks within a block). */
  lineHeight: number;
  letterSpacing: number;
}

/** A contiguous, single-style piece of a laid-out line, ready to render. */
export interface Fragment {
  text: string;
  /** Offset of the first character (inclusive). */
  start: number;
  /** Offset after the last character (exclusive). */
  end: number;
  marks: Marks;
  font: ResolvedFont;
  /** Left edge within the line, in pixels. */
  x: number;
  /** Measured width in pixels. */
  width: number;
  /** When set, this fragment is an inline atom — render it, not `text`. */
  atom?: InlineAtom;
}

/** A single visual line produced by wrapping a block. */
export interface Line {
  index: number;
  /** Top edge within the block, in pixels. */
  top: number;
  /** Line box height in pixels. */
  height: number;
  /** Total content width in pixels. */
  width: number;
  /** Offset of the first character on the line (inclusive). */
  start: number;
  /** Offset after the last character on the line (exclusive). */
  end: number;
  /** Whether the line ends at a hard line break (`\n`) rather than a wrap. */
  hardBreak: boolean;
  fragments: Fragment[];
}

/**
 * Full layout for a block. When produced with `detailed: false`, `lines`
 * carry geometry but no `fragments` (cheaper — used for offscreen height only).
 */
export interface BlockLayout {
  width: number;
  typographyKey: string;
  /** Total block height in pixels. */
  height: number;
  lineCount: number;
  /** Total text length (character count). */
  length: number;
  detailed: boolean;
  lines: Line[];
}

/** Caret geometry within a block's coordinate space. */
export interface Caret {
  x: number;
  y: number;
  height: number;
  lineIndex: number;
}

/** A rectangle within a block's coordinate space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
