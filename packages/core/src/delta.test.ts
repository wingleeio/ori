import { DEFAULT_TYPOGRAPHY, createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  activeMarks,
  attributesToMarks,
  fullAttributes,
  marksToAttributes,
  normalizeAttributes,
  sliceTextPlain,
  textToInline,
  textToPlain,
} from "./delta";

const m = createMonospaceMeasurer();

function ytext(build: (t: Y.Text) => void): Y.Text {
  const doc = new Y.Doc();
  const t = doc.getText("t");
  build(t);
  return t;
}

describe("delta", () => {
  it("textToInline carries absolute offsets and marks", () => {
    const t = ytext((tt) => {
      tt.insert(0, "Hello ");
      tt.insert(6, "world", { bold: true });
    });
    const items = textToInline(t);
    expect(items.map((i) => [i.text, i.start])).toEqual([
      ["Hello ", 0],
      ["world", 6],
    ]);
    expect(items[1].marks?.bold).toBe(true);
  });

  it("textToInline resolves embeds to measured atoms of length 1", () => {
    const t = ytext((tt) => {
      tt.insert(0, "a");
      tt.insertEmbed(1, { type: "mention", label: "X" });
      tt.insert(2, "b");
    });
    const items = textToInline(t, {
      atoms: { mention: { type: "mention", measure: () => 42 } },
      typography: DEFAULT_TYPOGRAPHY,
      measurer: m,
    });
    expect(items.map((i) => i.start)).toEqual([0, 1, 2]);
    expect(items[1].atom).toMatchObject({ type: "mention", width: 42 });
  });

  it("attributesToMarks / marksToAttributes round-trip", () => {
    expect(attributesToMarks({ bold: true, italic: true })).toEqual({ bold: true, italic: true });
    expect(marksToAttributes({ code: true })).toEqual({ code: true });
    expect(attributesToMarks(undefined)).toEqual({});
  });

  it("fullAttributes makes every mark explicit so they can't bleed", () => {
    const a = fullAttributes({ bold: true });
    expect(a.bold).toBe(true);
    expect(a.italic).toBeNull();
    expect(a.code).toBeNull();
    expect(a.underline).toBeNull();
  });

  it("normalizeAttributes expands a partial attribute set", () => {
    expect(normalizeAttributes({ bold: true })).toMatchObject({ bold: true, italic: null });
    expect(normalizeAttributes(undefined)).toMatchObject({ bold: null, code: null });
  });

  it("textToPlain keeps offsets aligned (embed = one placeholder char)", () => {
    const t = ytext((tt) => {
      tt.insert(0, "ab");
      tt.insertEmbed(2, { type: "mention", label: "X" });
      tt.insert(3, "cd");
    });
    const plain = textToPlain(t);
    expect(plain.length).toBe(t.length); // 5
    expect(plain[2]).not.toBe("c"); // the embed occupies offset 2
  });

  it("sliceTextPlain renders embeds by their label and respects the range", () => {
    const t = ytext((tt) => {
      tt.insert(0, "hi ");
      tt.insertEmbed(3, { type: "mention", label: "Ada" });
      tt.insert(4, " there");
    });
    expect(sliceTextPlain(t, 0, t.length)).toBe("hi Ada there");
    expect(sliceTextPlain(t, 0, 3)).toBe("hi ");
  });

  it("activeMarks intersects the marks across a range", () => {
    const t = ytext((tt) => {
      tt.insert(0, "ab", { bold: true });
      tt.insert(2, "cd", { bold: true, italic: true });
    });
    expect(activeMarks(t, 0, 4)).toMatchObject({ bold: true });
    expect(activeMarks(t, 0, 4).italic).toBeUndefined();
    expect(activeMarks(t, 2, 4)).toMatchObject({ bold: true, italic: true });
  });
});
