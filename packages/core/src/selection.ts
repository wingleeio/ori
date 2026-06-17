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
