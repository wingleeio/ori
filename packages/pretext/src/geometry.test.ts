import { describe, expect, it } from "vitest";
import {
  caretForOffset,
  lineIndexForOffset,
  offsetAtPoint,
  selectionRects,
  visualLineBounds,
} from "./geometry";
import { layoutBlock } from "./layout";
import { createMonospaceMeasurer } from "./measurer";
import { DEFAULT_TYPOGRAPHY, lineHeightPx } from "./typography";
import type { InlineItem } from "./types";

const m = createMonospaceMeasurer();
const CW = 16 * 0.6; // 9.6 px/char
const lh = lineHeightPx(DEFAULT_TYPOGRAPHY);
const lay = (items: InlineItem[], width: number) =>
  layoutBlock(items, { width, typography: DEFAULT_TYPOGRAPHY, measurer: m, detailed: true });

describe("geometry", () => {
  it("caretForOffset is monotonic and reports line height", () => {
    const l = lay([{ text: "abcdef", start: 0 }], 1000);
    expect(caretForOffset(l, 0, m).x).toBeCloseTo(0, 5);
    expect(caretForOffset(l, 3, m).x).toBeCloseTo(3 * CW, 5);
    expect(caretForOffset(l, 6, m).x).toBeCloseTo(6 * CW, 5);
    expect(caretForOffset(l, 6, m).y).toBe(0);
    expect(caretForOffset(l, 6, m).height).toBe(lh);
  });

  it("caretForOffset clamps out-of-range offsets", () => {
    const l = lay([{ text: "abc", start: 0 }], 1000);
    expect(caretForOffset(l, -5, m).x).toBeCloseTo(0, 5);
    expect(caretForOffset(l, 99, m).x).toBeCloseTo(3 * CW, 5);
  });

  it("offsetAtPoint round-trips with caretForOffset", () => {
    const l = lay([{ text: "abcdef", start: 0 }], 1000);
    for (const off of [0, 1, 3, 6]) {
      const x = caretForOffset(l, off, m).x;
      expect(offsetAtPoint(l, x, 2, m)).toBe(off);
    }
  });

  it("offsetAtPoint selects the correct line by y", () => {
    const l = lay([{ text: "alpha beta gamma delta", start: 0 }], 100);
    expect(lineIndexForOffset(l, 0)).toBe(0);
    const second = l.lines[1];
    const off = offsetAtPoint(l, 0, lh + 2, m);
    expect(off).toBeGreaterThanOrEqual(second.start);
    expect(off).toBeLessThanOrEqual(second.end);
  });

  it("selectionRects: empty when collapsed, one rect within a line", () => {
    const l = lay([{ text: "abcdef", start: 0 }], 1000);
    expect(selectionRects(l, 2, 2, m)).toHaveLength(0);
    const rects = selectionRects(l, 1, 4, m);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBeCloseTo(CW, 5);
    expect(rects[0].width).toBeCloseTo(3 * CW, 5);
    expect(rects[0].height).toBe(lh);
  });

  it("selectionRects spans every wrapped line", () => {
    const l = lay([{ text: "alpha beta gamma delta", start: 0 }], 100);
    const rects = selectionRects(l, 0, l.length, m);
    expect(rects.length).toBe(l.lineCount);
  });

  it("visualLineBounds returns the owning line's bounds", () => {
    const l = lay([{ text: "ab\ncd", start: 0 }], 1000);
    expect(visualLineBounds(l, 1)).toMatchObject({ start: 0, end: 2, lineIndex: 0 });
    expect(visualLineBounds(l, 4)).toMatchObject({ start: 3, end: 5, lineIndex: 1 });
  });

  it("atom caret snaps to its edges", () => {
    const l = lay(
      [
        { text: "a", start: 0 },
        { text: "", start: 1, atom: { type: "x", width: 40 } },
        { text: "b", start: 2 },
      ],
      1000,
    );
    const before = caretForOffset(l, 1, m).x;
    const after = caretForOffset(l, 2, m).x;
    expect(after - before).toBeCloseTo(40, 5);
    expect(offsetAtPoint(l, before + 5, 2, m)).toBe(1);
    expect(offsetAtPoint(l, after - 5, 2, m)).toBe(2);
  });
});
