import type { BlockType, InlineItem } from "@wingleeio/ori-core";
import { describe, expect, it } from "vitest";
import {
  deserializeOri,
  htmlToBlocks,
  serializeSelection,
  textToBlocks,
  type ClipBlock,
} from "./clipboard";

const run = (text: string, marks?: InlineItem["marks"]): InlineItem => ({ text, start: 0, marks });
const block = (type: BlockType, items: InlineItem[], attrs?: Record<string, unknown>): ClipBlock => ({
  type,
  items,
  ...(attrs ? { attrs } : {}),
});

describe("clipboard", () => {
  it("serializes marks to html + private json and round-trips them", () => {
    const blocks = [block("paragraph", [run("bold", { bold: true }), run(" plain")])];
    const { text, html, json } = serializeSelection(blocks);
    expect(text).toBe("bold plain");
    expect(html).toContain("<strong>bold</strong>");
    const back = deserializeOri(json)!;
    expect(back.length).toBe(1);
    expect(back[0].items[0].text).toBe("bold");
    expect(back[0].items[0].marks?.bold).toBe(true);
    expect(back[0].items[1].marks?.bold).toBeFalsy();
  });

  it("round-trips block types through the private json", () => {
    const blocks = [block("heading", [run("Title")]), block("quote", [run("Cited")]), block("code", [run("x=1")])];
    const back = deserializeOri(serializeSelection(blocks).json)!;
    expect(back.map((b) => b.type)).toEqual(["heading", "quote", "code"]);
    expect(back.map((b) => b.items.map((r) => r.text).join(""))).toEqual(["Title", "Cited", "x=1"]);
  });

  it("serializes block types to the right html tags", () => {
    const { html } = serializeSelection([block("heading", [run("H")]), block("quote", [run("Q")])]);
    expect(html).toContain("<h2>H</h2>");
    expect(html).toContain("<blockquote>Q</blockquote>");
  });

  it("keeps block boundaries through json", () => {
    const blocks = [block("paragraph", [run("one")]), block("paragraph", [run("two")])];
    const { text, json } = serializeSelection(blocks);
    expect(text).toBe("one\ntwo");
    expect(deserializeOri(json)!.map((b) => b.items.map((r) => r.text).join(""))).toEqual(["one", "two"]);
  });

  it("parses external html into typed, marked blocks", () => {
    const blocks = htmlToBlocks("<h1>Heading</h1><p>hi <b>there</b></p><blockquote>quoted</blockquote>");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "quote"]);
    expect(blocks[1].items.find((r) => r.text === "there")?.marks?.bold).toBe(true);
  });

  it("round-trips block attrs (e.g. an image's src/ratio)", () => {
    const blocks: ClipBlock[] = [{ type: "image", items: [], attrs: { src: "x.png", ratio: 1.5 } }];
    const { json } = serializeSelection(blocks);
    const back = deserializeOri(json)!;
    expect(back[0].type).toBe("image");
    expect(back[0].attrs).toEqual({ src: "x.png", ratio: 1.5 });
  });

  it("round-trips list levels through json and serializes list html", () => {
    const blocks = [
      block("bullet-list", [run("Parent")]),
      block("bullet-list", [run("Child")], { level: 1 }),
      block("ordered-list", [run("Step")], { level: 1 }),
    ];
    const { html, json } = serializeSelection(blocks);
    expect(html).toContain("<ul>");
    expect(html).toContain('data-ori-list-level="1"');
    expect(html).toContain("<ol>");
    const back = deserializeOri(json)!;
    expect(back.map((b) => b.type)).toEqual(["bullet-list", "bullet-list", "ordered-list"]);
    expect(back.map((b) => b.attrs?.level ?? 0)).toEqual([0, 1, 1]);
  });

  it("preserves whitespace and newlines inside <pre> (pasted code)", () => {
    const blocks = htmlToBlocks("<pre>  if (x) {\n    y();\n  }</pre>");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].items.map((i) => i.text).join("")).toBe("  if (x) {\n    y();\n  }");
  });

  it("reads legacy v1 (array-of-items) json as paragraphs", () => {
    const legacy = JSON.stringify({ v: 1, blocks: [[{ text: "old", marks: { bold: true } }]] });
    const back = deserializeOri(legacy)!;
    expect(back[0].type).toBe("paragraph");
    expect(back[0].items[0].marks?.bold).toBe(true);
  });

  it("splits plain text into one paragraph block per line", () => {
    const b = textToBlocks("a\nb");
    expect(b.map((x) => x.type)).toEqual(["paragraph", "paragraph"]);
    expect(b.map((x) => x.items.map((r) => r.text).join(""))).toEqual(["a", "b"]);
  });

  it("parses markdown-style plain-text lists with nesting", () => {
    const b = textToBlocks("- one\n  - two\n3. three");
    expect(b.map((x) => x.type)).toEqual(["bullet-list", "bullet-list", "ordered-list"]);
    expect(b.map((x) => x.attrs?.level ?? 0)).toEqual([0, 1, 0]);
    expect(b.map((x) => x.items.map((r) => r.text).join(""))).toEqual(["one", "two", "three"]);
  });

  it("parses external nested HTML lists into leveled list blocks", () => {
    const blocks = htmlToBlocks("<ol><li>One<ul><li>Child</li></ul></li><li>Two</li></ol>");
    expect(blocks.map((b) => b.type)).toEqual(["ordered-list", "bullet-list", "ordered-list"]);
    expect(blocks.map((b) => b.attrs?.level ?? 0)).toEqual([0, 1, 0]);
    expect(blocks.map((b) => b.items.map((r) => r.text.trim()).join(""))).toEqual(["One", "Child", "Two"]);
  });

  it("returns null for non-ori json", () => {
    expect(deserializeOri("not json")).toBeNull();
    expect(deserializeOri('{"nope":1}')).toBeNull();
  });
});
