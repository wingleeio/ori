import type { Measurer } from "./measurer";
import type { BlockLayout, Caret, Line, Rect } from "./types";

/** Index of the line that owns `offset` for caret placement (left affinity). */
export function lineIndexForOffset(layout: BlockLayout, offset: number): number {
  const lines = layout.lines;
  for (let i = 0; i < lines.length; i += 1) {
    if (offset <= lines[i].end) return i;
  }
  return Math.max(0, lines.length - 1);
}

/** Horizontal caret position for `offset` within a single line. */
function caretXInLine(line: Line, offset: number, measurer: Measurer): number {
  if (offset <= line.start) return 0;
  for (const frag of line.fragments) {
    if (offset <= frag.end) {
      // Atoms are indivisible: the caret sits at one edge or the other.
      if (frag.atom) return offset >= frag.end ? frag.x + frag.width : frag.x;
      return frag.x + measurer.measure(frag.text.slice(0, offset - frag.start), frag.font);
    }
  }
  return line.width;
}

/** Full caret geometry (x, y, height) for an offset within a block. */
export function caretForOffset(
  layout: BlockLayout,
  offset: number,
  measurer: Measurer,
): Caret {
  const clamped = Math.max(0, Math.min(offset, layout.length));
  const index = lineIndexForOffset(layout, clamped);
  const line = layout.lines[index];
  return {
    x: caretXInLine(line, clamped, measurer),
    y: line.top,
    height: line.height,
    lineIndex: index,
  };
}

/** Character offset for a horizontal position `x` within a line. */
function offsetAtX(line: Line, x: number, measurer: Measurer): number {
  if (line.fragments.length === 0) return line.start;
  if (x <= 0) return line.start;
  for (const frag of line.fragments) {
    if (x < frag.x + frag.width) {
      const localX = x - frag.x;
      // Atoms snap to the nearer edge.
      if (frag.atom) return localX < frag.width / 2 ? frag.start : frag.end;
      const text = frag.text;
      let prev = 0;
      for (let i = 1; i <= text.length; i += 1) {
        const w = measurer.measure(text.slice(0, i), frag.font);
        if (w >= localX) {
          const mid = (prev + w) / 2;
          return frag.start + (localX <= mid ? i - 1 : i);
        }
        prev = w;
      }
      return frag.end;
    }
  }
  return line.end;
}

/** Offset for a horizontal position `x` on a specific visual line. */
export function offsetAtXInLine(
  layout: BlockLayout,
  lineIndex: number,
  x: number,
  measurer: Measurer,
): number {
  const line = layout.lines[Math.max(0, Math.min(lineIndex, layout.lines.length - 1))];
  return offsetAtX(line, x, measurer);
}

/** Hit-test: map a point in block-local coordinates to a character offset. */
export function offsetAtPoint(
  layout: BlockLayout,
  x: number,
  y: number,
  measurer: Measurer,
): number {
  let line = layout.lines[0];
  for (const l of layout.lines) {
    line = l;
    if (y < l.top + l.height) break;
  }
  return offsetAtX(line, x, measurer);
}

/** Start/end offsets of the visual line containing `offset` (for Home/End). */
export function visualLineBounds(
  layout: BlockLayout,
  offset: number,
): { start: number; end: number; lineIndex: number } {
  const index = lineIndexForOffset(layout, offset);
  const line = layout.lines[index];
  return { start: line.start, end: line.end, lineIndex: index };
}

/**
 * Selection rectangles (block-local) for the range `[from, to]`. Lines whose
 * trailing line break is inside the range get a small pad so the break reads as
 * selected. Returns nothing for a collapsed range.
 */
export function selectionRects(
  layout: BlockLayout,
  from: number,
  to: number,
  measurer: Measurer,
): Rect[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return [];

  const rects: Rect[] = [];
  for (const line of layout.lines) {
    if (end < line.start) break;
    if (start > line.end) continue;

    const a = Math.max(start, line.start);
    const b = Math.min(end, line.end);
    const left = caretXInLine(line, a, measurer);
    let right = caretXInLine(line, b, measurer);

    const selectsBreak = end > line.end && line.hardBreak;
    if (selectsBreak) right = line.width + Math.round(line.height * 0.25);

    if (right <= left && !selectsBreak) continue;

    rects.push({
      x: left,
      y: line.top,
      width: Math.max(right - left, selectsBreak ? Math.round(line.height * 0.25) : 0),
      height: line.height,
    });
  }
  return rects;
}
