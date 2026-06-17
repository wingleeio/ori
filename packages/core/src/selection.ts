/**
 * Logical selection model. Selection lives entirely independent of the DOM so
 * it remains valid for offscreen (un-rendered) blocks under virtualization.
 */

/** A caret position: a block plus a character offset within its text. */
export interface Position {
  blockId: string;
  offset: number;
}

/** A directional selection. `anchor` is fixed; `focus` is the moving end. */
export interface Selection {
  anchor: Position;
  focus: Position;
}

export function position(blockId: string, offset: number): Position {
  return { blockId, offset };
}

export function caret(pos: Position): Selection {
  return { anchor: pos, focus: pos };
}

export function isCollapsed(sel: Selection): boolean {
  return sel.anchor.blockId === sel.focus.blockId && sel.anchor.offset === sel.focus.offset;
}

export function eqPosition(a: Position, b: Position): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
}

export function eqSelection(a: Selection | null, b: Selection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return eqPosition(a.anchor, b.anchor) && eqPosition(a.focus, b.focus);
}

type CharClass = "word" | "space" | "atom" | "other";

const WORD_RE = /[\p{L}\p{N}\p{M}_]/u;

function charClass(ch: string): CharClass {
  if (ch === "￼") return "atom"; // inline atom placeholder (one offset)
  if (/\s/.test(ch)) return "space";
  if (WORD_RE.test(ch)) return "word";
  return "other";
}

// Rank so a tap landing on a boundary prefers the most "selectable" side
// (a word over adjacent whitespace), matching native double-tap behavior.
const rank: Record<CharClass, number> = { word: 3, atom: 2, other: 1, space: 0 };

/**
 * The bounds of the "word" (run of same-class characters) at `offset` in
 * `text`, for double-tap / long-press selection. Letters+digits form a word,
 * whitespace and punctuation each cluster on their own, and an inline atom
 * (the `￼` placeholder) selects just itself. Offsets map 1:1 to block
 * positions because `textToPlain` emits one char per atom.
 */
export function wordBoundsAt(text: string, offset: number): { start: number; end: number } {
  const len = text.length;
  if (len === 0) return { start: 0, end: 0 };
  const i = Math.max(0, Math.min(offset, len));

  const right = i < len ? charClass(text[i]) : null;
  const left = i > 0 ? charClass(text[i - 1]) : null;

  let cls: CharClass;
  let anchor: number;
  if (right !== null && (left === null || rank[right] >= rank[left])) {
    cls = right;
    anchor = i;
  } else {
    cls = left as CharClass;
    anchor = i - 1;
  }

  if (cls === "atom") return { start: anchor, end: anchor + 1 };

  let start = anchor;
  let end = anchor + 1;
  while (start > 0 && charClass(text[start - 1]) === cls) start--;
  while (end < len && charClass(text[end]) === cls) end++;
  return { start, end };
}

/**
 * Order a selection's two ends into `[start, end]` using a block index lookup.
 * Returns `start` before `end` in document order.
 */
export function orderedRange(
  sel: Selection,
  indexOf: (blockId: string) => number,
): { start: Position; end: Position } {
  const a = sel.anchor;
  const b = sel.focus;
  const ai = indexOf(a.blockId);
  const bi = indexOf(b.blockId);
  if (ai < bi || (ai === bi && a.offset <= b.offset)) {
    return { start: a, end: b };
  }
  return { start: b, end: a };
}
