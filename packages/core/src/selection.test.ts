import { describe, expect, it } from "vitest";
import { caret, eqSelection, isCollapsed, orderedRange, position } from "./selection";

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
});
