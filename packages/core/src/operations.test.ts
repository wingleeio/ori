import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  deleteRange,
  formatRange,
  insertBlockAfter,
  insertInlineEmbed,
  insertText,
  mergeWithPrevious,
  setBlockType,
  splitBlock,
} from "./operations";
import { blockId, blockText, blockType, createNoteDoc, getBlocks } from "./schema";
import { position } from "./selection";

function setup(texts: string[]) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  const blocks = getBlocks(doc);
  const id = (i: number) => blockId(blocks.get(i));
  const textOf = (i: number) => blockText(blocks.get(i)).toString();
  return { doc, blocks, id, textOf };
}

describe("operations", () => {
  it("insertText inserts and returns the caret after", () => {
    const { doc, blocks, id, textOf } = setup(["hello"]);
    const after = insertText(doc, blocks, position(id(0), 5), " world");
    expect(textOf(0)).toBe("hello world");
    expect(after.offset).toBe(11);
  });

  it("deleteRange within a block", () => {
    const { doc, blocks, id, textOf } = setup(["hello"]);
    deleteRange(doc, blocks, position(id(0), 1), position(id(0), 3));
    expect(textOf(0)).toBe("hlo");
  });

  it("deleteRange across blocks merges and keeps the tails", () => {
    const { doc, blocks, id, textOf } = setup(["hello", "world", "again"]);
    deleteRange(doc, blocks, position(id(0), 2), position(id(2), 2));
    expect(blocks.length).toBe(1);
    expect(textOf(0)).toBe("heain");
  });

  it("splitBlock splits text into two blocks", () => {
    const { doc, blocks, id, textOf } = setup(["hello"]);
    const after = splitBlock(doc, blocks, id(0), 2);
    expect(blocks.length).toBe(2);
    expect(textOf(0)).toBe("he");
    expect(textOf(1)).toBe("llo");
    expect(after.offset).toBe(0);
  });

  it("mergeWithPrevious joins into the predecessor", () => {
    const { doc, blocks, id, textOf } = setup(["he", "llo"]);
    const after = mergeWithPrevious(doc, blocks, id(1));
    expect(blocks.length).toBe(1);
    expect(textOf(0)).toBe("hello");
    expect(after?.offset).toBe(2);
  });

  it("mergeWithPrevious on the first block is a no-op", () => {
    const { doc, blocks, id } = setup(["a"]);
    expect(mergeWithPrevious(doc, blocks, id(0))).toBeNull();
  });

  it("formatRange applies a mark without bleeding", () => {
    const { doc, blocks, id } = setup(["hello"]);
    formatRange(doc, blocks, position(id(0), 0), position(id(0), 3), "bold", true);
    const delta = blockText(blocks.get(0)).toDelta() as Array<{
      insert: string;
      attributes?: Record<string, unknown>;
    }>;
    expect(delta[0].attributes?.bold).toBe(true);
    expect(delta[1].attributes?.bold).toBeUndefined();
  });

  it("setBlockType changes the type", () => {
    const { doc, blocks, id } = setup(["x"]);
    setBlockType(doc, blocks, id(0), "quote");
    expect(blockType(blocks.get(0))).toBe("quote");
  });

  it("insertInlineEmbed inserts a length-1 embed", () => {
    const { doc, blocks, id } = setup(["ab"]);
    const after = insertInlineEmbed(doc, blocks, position(id(0), 1), { type: "mention", label: "X" });
    expect(blockText(blocks.get(0)).length).toBe(3);
    expect(after.offset).toBe(2);
  });

  it("insertBlockAfter inserts an atomic block with attrs", () => {
    const { doc, blocks, id } = setup(["x"]);
    const after = insertBlockAfter(doc, blocks, id(0), "image", { ratio: 1.5 });
    expect(blocks.length).toBe(2);
    expect(blockType(blocks.get(1))).toBe("image");
    expect((blocks.get(1).get("attrs") as Y.Map<unknown>).get("ratio")).toBe(1.5);
    expect(after.blockId).toBe(blockId(blocks.get(1)));
  });
});
