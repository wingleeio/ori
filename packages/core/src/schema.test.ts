import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  blockAttrs,
  blockId,
  blockText,
  blockType,
  createBlock,
  createNoteDoc,
  genId,
  getBlocks,
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
