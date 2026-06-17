import { describe, expect, it } from "vitest";
import { createMonospaceMeasurer } from "./measurer";
import { mergeItems, tokenize } from "./tokenize";
import { DEFAULT_TYPOGRAPHY } from "./typography";
import type { InlineItem } from "./types";

const m = createMonospaceMeasurer();
const tok = (items: InlineItem[]) => tokenize(items, DEFAULT_TYPOGRAPHY, m);

describe("tokenize", () => {
  it("splits into word / space / newline tokens with correct offsets", () => {
    const ts = tok([{ text: "ab c\nd", start: 0 }]);
    expect(ts.map((t) => [t.text, t.kind, t.start])).toEqual([
      ["ab", "word", 0],
      [" ", "space", 2],
      ["c", "word", 3],
      ["\n", "newline", 4],
      ["d", "word", 5],
    ]);
  });

  it("measures word width via the measurer", () => {
    const [w] = tok([{ text: "hello", start: 0 }]);
    expect(w.width).toBeCloseTo(5 * 16 * 0.6, 5);
  });

  it("preserves absolute offsets across multiple items", () => {
    const ts = tok([
      { text: "foo ", start: 0 },
      { text: "bar", start: 4, marks: { bold: true } },
    ]);
    expect(ts.map((t) => t.start)).toEqual([0, 3, 4]);
    expect(ts[2].marks.bold).toBe(true);
  });
});

describe("mergeItems", () => {
  it("merges adjacent same-mark items, splits on different marks", () => {
    const merged = mergeItems([
      { text: "foo", start: 0 },
      { text: "bar", start: 3 },
      { text: "baz", start: 6, marks: { bold: true } },
    ]);
    expect(merged.map((i) => i.text)).toEqual(["foobar", "baz"]);
  });

  it("never merges across atoms and keeps the atom item", () => {
    const merged = mergeItems([
      { text: "a", start: 0 },
      { text: "", start: 1, atom: { type: "x", width: 20 } },
      { text: "b", start: 2 },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[1].atom?.width).toBe(20);
  });

  it("tokenize emits an atom token of the given width", () => {
    const ts = tok([
      { text: "a", start: 0 },
      { text: "", start: 1, atom: { type: "chip", width: 33 } },
      { text: "b", start: 2 },
    ]);
    expect(ts.map((t) => t.kind)).toEqual(["word", "atom", "word"]);
    const atom = ts.find((t) => t.kind === "atom")!;
    expect(atom.width).toBe(33);
    expect(atom.start).toBe(1);
  });
});
