import { describe, expect, it } from "vitest";
import {
  caret,
  eqSelection,
  isCollapsed,
  orderedRange,
  position,
  wordBoundsAt,
} from "./selection";

const idx = (id: string): number => ({ a: 0, b: 1, c: 2 })[id] ?? -1;

describe("selection", () => {
  it("isCollapsed", () => {
    expect(isCollapsed(caret(position("a", 3)))).toBe(true);
    expect(isCollapsed({ anchor: position("a", 1), focus: position("a", 2) })).toBe(false);
  });

  it("orderedRange orders by block index then offset", () => {
    const r = orderedRange({ anchor: position("c", 1), focus: position("a", 5) }, idx);
    expect(r.start).toMatchObject({ blockId: "a", offset: 5 });
    expect(r.end).toMatchObject({ blockId: "c", offset: 1 });

    const same = orderedRange({ anchor: position("b", 4), focus: position("b", 2) }, idx);
    expect(same.start.offset).toBe(2);
    expect(same.end.offset).toBe(4);
  });

  it("eqSelection compares both ends and handles null", () => {
    const s = caret(position("a", 1));
    expect(eqSelection(s, caret(position("a", 1)))).toBe(true);
    expect(eqSelection(s, caret(position("a", 2)))).toBe(false);
    expect(eqSelection(null, null)).toBe(true);
    expect(eqSelection(s, null)).toBe(false);
  });

  describe("wordBoundsAt", () => {
    const w = (text: string, offset: number) => {
      const { start, end } = wordBoundsAt(text, offset);
      return text.slice(start, end);
    };

    it("selects the word the offset lands inside", () => {
      expect(w("hello world", 2)).toBe("hello");
      expect(w("hello world", 8)).toBe("world");
    });

    it("at a word/space boundary, prefers the word", () => {
      expect(w("hello world", 5)).toBe("hello"); // caret right after 'hello'
      expect(w("hello world", 6)).toBe("world"); // caret right before 'world'
    });

    it("clusters whitespace and punctuation separately", () => {
      expect(w("a   b", 2)).toBe("   ");
      expect(w("foo...bar", 4)).toBe("...");
    });

    it("keeps digits and unicode letters in one word", () => {
      expect(w("café42 x", 3)).toBe("café42");
    });

    it("selects just the atom placeholder", () => {
      expect(wordBoundsAt("hi ￼ bye", 3)).toEqual({ start: 3, end: 4 });
    });

    it("handles empty text and clamps out-of-range offsets", () => {
      expect(wordBoundsAt("", 0)).toEqual({ start: 0, end: 0 });
      expect(w("word", 99)).toBe("word");
    });
  });
});
