import { createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { EditorController } from "./controller";
import { linkBoundsAt } from "./delta";
import { sanitizeUrl } from "./link";
import { blockId, blockText, createNoteDoc, getBlocks } from "./schema";

function make(texts: string[]) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  const ed = new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 400 });
  const ids = texts.map((_, i) => blockId(getBlocks(doc).get(i)));
  return { doc, ed, ids };
}

const range = (blockId: string, from: number, to: number) => ({
  anchor: { blockId, offset: from },
  focus: { blockId, offset: to },
});
const at = (blockId: string, offset: number) => range(blockId, offset, offset);

describe("sanitizeUrl", () => {
  it("allows http/https/mailto/tel", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
    expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
    expect(sanitizeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(sanitizeUrl("tel:+123")).toBe("tel:+123");
  });

  it("rejects javascript:, data: and other script schemes", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("JavaScript:alert(1)")).toBeNull();
    expect(sanitizeUrl("data:text/html,<script>x</script>")).toBeNull();
    expect(sanitizeUrl("vbscript:x")).toBeNull();
  });

  it("prefixes bare domains and passes relative URLs through", () => {
    expect(sanitizeUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(sanitizeUrl("/local/path")).toBe("/local/path");
    expect(sanitizeUrl("#anchor")).toBe("#anchor");
  });

  it("rejects empty and non-URL text", () => {
    expect(sanitizeUrl("")).toBeNull();
    expect(sanitizeUrl("   ")).toBeNull();
    expect(sanitizeUrl("not a url")).toBeNull();
  });
});

describe("link commands", () => {
  it("links a range and reports it active", () => {
    const { ed, ids } = make(["hello world"]);
    ed.setSelection(range(ids[0], 0, 5));
    expect(ed.setLink("example.com")).toBe(true);
    expect(ed.getActiveLink()).toBe("https://example.com");
    // Caret inside the run also sees it.
    ed.setSelection(at(ids[0], 3));
    expect(ed.getActiveLink()).toBe("https://example.com");
    // Caret outside does not.
    ed.setSelection(at(ids[0], 9));
    expect(ed.getActiveLink()).toBeNull();
  });

  it("retargets a whole link run from a collapsed caret", () => {
    const { ed, ids } = make(["hello world"]);
    ed.setSelection(range(ids[0], 0, 5));
    ed.setLink("https://a.com");
    ed.setSelection(at(ids[0], 3));
    ed.setLink("https://b.com");
    ed.setSelection(range(ids[0], 0, 5));
    expect(ed.getActiveMarks().link).toBe("https://b.com");
  });

  it("removes a whole link run from a collapsed caret", () => {
    const { ed, ids } = make(["hello world"]);
    ed.setSelection(range(ids[0], 0, 5));
    ed.setLink("https://a.com");
    ed.setSelection(at(ids[0], 2));
    expect(ed.removeLink()).toBe(true);
    ed.setSelection(range(ids[0], 0, 5));
    expect(ed.getActiveMarks().link).toBeUndefined();
  });

  it("inserts the URL as linked text at a bare caret", () => {
    const { ed, ids } = make([""]);
    ed.setSelection(at(ids[0], 0));
    expect(ed.setLink("https://ori.dev")).toBe(true);
    expect(ed.getBlockText(ids[0])).toBe("https://ori.dev");
    ed.setSelection(at(ids[0], 5));
    expect(ed.getActiveLink()).toBe("https://ori.dev");
  });

  it("refuses unsafe URLs (acts as remove)", () => {
    const { ed, ids } = make(["hello"]);
    ed.setSelection(range(ids[0], 0, 5));
    ed.setLink("javascript:alert(1)");
    expect(ed.getActiveMarks().link).toBeUndefined();
    expect(ed.getBlockText(ids[0])).toBe("hello"); // nothing inserted either
  });

  it("links across multiple blocks", () => {
    const { ed, ids } = make(["aaa", "bbb"]);
    ed.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[1], offset: 2 } });
    ed.setLink("https://x.com");
    expect(ed.getActiveLink()).toBe("https://x.com");
  });
});

describe("linkBoundsAt", () => {
  it("merges adjacent delta runs with the same url (marks split the ops)", () => {
    const doc = createNoteDoc([{ text: "abcdef" }]);
    const text = blockText(getBlocks(doc).get(0));
    doc.transact(() => {
      text.format(0, 6, { link: "https://x.com" });
      text.format(2, 2, { bold: true }); // splits the run into three ops
    });
    expect(linkBoundsAt(text, 3)).toEqual({ start: 0, end: 6, url: "https://x.com" });
  });

  it("returns null off-link and handles run edges left-biased", () => {
    const doc = createNoteDoc([{ text: "abcdef" }]);
    const text = blockText(getBlocks(doc).get(0));
    doc.transact(() => text.format(2, 2, { link: "https://x.com" }));
    expect(linkBoundsAt(text, 1)).toBeNull(); // before the run
    expect(linkBoundsAt(text, 2)).toBeNull(); // at run start: mark comes from the left
    expect(linkBoundsAt(text, 3)?.url).toBe("https://x.com");
    expect(linkBoundsAt(text, 4)?.url).toBe("https://x.com"); // at run end (left-biased: inside)
    expect(linkBoundsAt(text, 5)).toBeNull();
  });
});
