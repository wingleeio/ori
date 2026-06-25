import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  blockAttrs,
  blockId,
  blockListLevel,
  blockText,
  blockTodoChecked,
  blockType,
  createBlock,
  createNoteDoc,
  genId,
  getBlocks,
  isListBlockType,
  listInsetLeft,
  normalizeListLevel,
  snapshotBlocks,
} from "./schema";

describe("schema", () => {
  it("createNoteDoc seeds one empty paragraph by default", () => {
    const blocks = getBlocks(createNoteDoc());
    expect(blocks.length).toBe(1);
    expect(blockType(blocks.get(0))).toBe("paragraph");
    expect(blockText(blocks.get(0)).toString()).toBe("");
  });

  it("createBlock sets id / type / text once attached", () => {
    // A prelim (detached) Y.Map returns undefined from .get(); attach first.
    const doc = new Y.Doc();
    const blocks = getBlocks(doc);
    const b = createBlock("heading", "Hi", "id1");
    blocks.push([b]);
    expect(blockId(b)).toBe("id1");
    expect(blockType(b)).toBe("heading");
    expect(blockText(b).toString()).toBe("Hi");
  });

  it("blockAttrs reads the attrs map as a plain object", () => {
    const doc = new Y.Doc();
    const blocks = getBlocks(doc);
    const b = createBlock("image");
    blocks.push([b]);
    (b.get("attrs") as Y.Map<unknown>).set("ratio", 1.5);
    expect(blockAttrs(b)).toEqual({ ratio: 1.5 });
  });

  it("normalizes list levels and list insets", () => {
    const doc = new Y.Doc();
    const blocks = getBlocks(doc);
    const b = createBlock("bullet-list", "", "id1", { level: 999 });
    blocks.push([b]);
    expect(isListBlockType(blockType(b))).toBe(true);
    expect(blockListLevel(b)).toBe(7);
    expect(normalizeListLevel(-4)).toBe(0);
    expect(listInsetLeft(2)).toBe(76);
  });

  it("treats todo-list as a list type and reads its checked attr", () => {
    const doc = new Y.Doc();
    const blocks = getBlocks(doc);
    const unchecked = createBlock("todo-list", "buy milk", "t1", { level: 1 });
    const checked = createBlock("todo-list", "done", "t2", { checked: true });
    blocks.push([unchecked, checked]);
    expect(isListBlockType("todo-list")).toBe(true);
    expect(blockListLevel(unchecked)).toBe(1);
    expect(blockTodoChecked(unchecked)).toBe(false);
    expect(blockTodoChecked(checked)).toBe(true);
  });

  it("genId returns distinct ids", () => {
    expect(genId()).not.toBe(genId());
  });

  it("snapshotBlocks returns plain data", () => {
    const doc = createNoteDoc([{ text: "x" }]);
    expect(snapshotBlocks(doc)).toEqual([
      { id: expect.any(String), type: "paragraph", text: "x" },
    ]);
  });
});
