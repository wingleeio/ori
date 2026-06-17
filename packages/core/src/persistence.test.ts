import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { base64ToBytes, bytesToBase64, docFromUpdate, encodeDoc } from "./persistence";
import { createNoteDoc, getBlocks } from "./schema";

describe("persistence", () => {
  it("base64 round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("encodeDoc + docFromUpdate restores content", () => {
    const doc = createNoteDoc([{ text: "alpha" }, { type: "heading", text: "beta" }]);
    const restored = docFromUpdate(encodeDoc(doc));
    const blocks = getBlocks(restored);
    expect(blocks.length).toBe(2);
    expect((blocks.get(0).get("text") as Y.Text).toString()).toBe("alpha");
    expect(blocks.get(1).get("type")).toBe("heading");
  });

  it("docFromUpdate(null) yields an empty doc", () => {
    expect(getBlocks(docFromUpdate(null)).length).toBe(0);
  });
});
