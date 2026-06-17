import { describe, expect, it } from "vitest";
import { layoutBlock } from "./layout";
import { createMonospaceMeasurer } from "./measurer";
import { DEFAULT_TYPOGRAPHY, lineHeightPx } from "./typography";
import type { InlineItem } from "./types";

const m = createMonospaceMeasurer(); // 0.6 -> 9.6 px/char at 16px
const lh = lineHeightPx(DEFAULT_TYPOGRAPHY); // 27
const lay = (items: InlineItem[], width: number, detailed = true) =>
  layoutBlock(items, { width, typography: DEFAULT_TYPOGRAPHY, measurer: m, detailed });

describe("layoutBlock", () => {
  it("empty block has one empty line", () => {
    const l = lay([], 200);
    expect(l.lineCount).toBe(1);
    expect(l.length).toBe(0);
    expect(l.height).toBe(lh);
    expect(l.lines[0].fragments).toHaveLength(0);
    expect(l.lines[0]).toMatchObject({ start: 0, end: 0 });
  });

  it("lays out a single line within width", () => {
    const l = lay([{ text: "hello world", start: 0 }], 1000);
    expect(l.lineCount).toBe(1);
    expect(l.length).toBe(11);
    expect(l.lines[0].start).toBe(0);
    expect(l.lines[0].end).toBe(11);
    expect(l.lines[0].fragments.map((f) => f.text).join("")).toBe("hello world");
  });

  it("wraps when content exceeds width and stays contiguous", () => {
    const l = lay([{ text: "alpha beta gamma delta", start: 0 }], 100);
    expect(l.lineCount).toBeGreaterThan(1);
    expect(l.lines[0].start).toBe(0);
    expect(l.lines.at(-1)!.end).toBe(l.length);
    expect(l.height).toBe(l.lineCount * lh);
    // each line's start equals the previous line's end (soft wraps)
    for (let i = 1; i < l.lines.length; i += 1) {
      expect(l.lines[i].start).toBe(l.lines[i - 1].end);
    }
  });

  it("char-breaks a single word wider than the line", () => {
    const l = lay([{ text: "abcdefghijklmnop", start: 0 }], 50);
    expect(l.lineCount).toBeGreaterThan(1);
    expect(l.lines.at(-1)!.end).toBe(16);
  });

  it("handles a hard line break and skips its offset", () => {
    const l = lay([{ text: "ab\ncd", start: 0 }], 1000);
    expect(l.lineCount).toBe(2);
    expect(l.lines[0].hardBreak).toBe(true);
    expect(l.lines[0].end).toBe(2);
    expect(l.lines[1].start).toBe(3);
    expect(l.lines[1].end).toBe(5);
  });

  it("emits a trailing empty line after a final newline", () => {
    const l = lay([{ text: "abc\n", start: 0 }], 1000);
    expect(l.lineCount).toBe(2);
    expect(l.lines[1]).toMatchObject({ start: 4, end: 4 });
  });

  it("non-detailed layout omits fragments but keeps geometry", () => {
    const l = lay([{ text: "hello world foo bar", start: 0 }], 80, false);
    expect(l.lineCount).toBeGreaterThan(1);
    expect(l.lines.every((ln) => ln.fragments.length === 0)).toBe(true);
    expect(l.height).toBe(l.lineCount * lh);
  });

  it("lays out an inline atom as a fixed-width unit of length 1", () => {
    const l = lay(
      [
        { text: "a", start: 0 },
        { text: "", start: 1, atom: { type: "chip", width: 40 } },
        { text: "b", start: 2 },
      ],
      1000,
    );
    expect(l.length).toBe(3);
    const atomFrag = l.lines[0].fragments.find((f) => f.atom)!;
    expect(atomFrag.width).toBe(40);
    expect(atomFrag.start).toBe(1);
    expect(atomFrag.end).toBe(2);
  });

  it("treats width <= 0 as no wrapping", () => {
    const l = lay([{ text: "a very long line that would otherwise wrap", start: 0 }], 0);
    expect(l.lineCount).toBe(1);
  });
});
