import type { InlineItem, Marks } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks, type ContentBlock } from "./markdown";
import { MAX_LIST_LEVEL } from "./schema";

/** Inline text item (start is irrelevant for serialization). */
const t = (text: string, marks?: Marks): InlineItem => ({ text, start: 0, ...(marks ? { marks } : {}) });

const para = (...items: InlineItem[]): ContentBlock => ({ type: "paragraph", items });

describe("blocksToMarkdown", () => {
  it("serializes headings with their level (default 1)", () => {
    expect(blocksToMarkdown([{ type: "heading", items: [t("A")] }])).toBe("# A");
    expect(blocksToMarkdown([{ type: "heading", items: [t("B")], attrs: { level: 2 } }])).toBe("## B");
    expect(blocksToMarkdown([{ type: "heading", items: [t("C")], attrs: { level: 3 } }])).toBe("### C");
    // Out-of-range levels clamp through normalizeHeadingLevel.
    expect(blocksToMarkdown([{ type: "heading", items: [t("D")], attrs: { level: 9 } }])).toBe("### D");
  });

  it("serializes quotes and code fences", () => {
    expect(blocksToMarkdown([{ type: "quote", items: [t("wise\nwords")] }])).toBe("> wise\n> words");
    expect(blocksToMarkdown([{ type: "code", items: [t("const a = 1;\nconst b = 2;")], attrs: { lang: "ts" } }])).toBe(
      "```ts\nconst a = 1;\nconst b = 2;\n```",
    );
    // No lang, and content stays verbatim (no escaping inside a fence).
    expect(blocksToMarkdown([{ type: "code", items: [t("*not em*")] }])).toBe("```\n*not em*\n```");
  });

  it("serializes lists with indentation, todo state and ordered ordinals", () => {
    const blocks: ContentBlock[] = [
      { type: "bullet-list", items: [t("a")], attrs: { level: 0 } },
      { type: "bullet-list", items: [t("b")], attrs: { level: 1 } },
      { type: "ordered-list", items: [t("one")], attrs: { level: 0 } },
      { type: "ordered-list", items: [t("nested")], attrs: { level: 1 } },
      { type: "ordered-list", items: [t("two")], attrs: { level: 0 } },
      { type: "todo-list", items: [t("open")], attrs: { level: 0, checked: false } },
      { type: "todo-list", items: [t("done")], attrs: { level: 0, checked: true } },
    ];
    expect(blocksToMarkdown(blocks)).toBe(
      ["- a", "  - b", "1. one", "  1. nested", "2. two", "- [ ] open", "- [x] done"].join("\n"),
    );
  });

  it("resets ordered ordinals when the list run breaks", () => {
    const blocks: ContentBlock[] = [
      { type: "ordered-list", items: [t("a")], attrs: { level: 0 } },
      { type: "ordered-list", items: [t("b")], attrs: { level: 0 } },
      para(t("break")),
      { type: "ordered-list", items: [t("c")], attrs: { level: 0 } },
    ];
    expect(blocksToMarkdown(blocks)).toBe("1. a\n2. b\n\nbreak\n\n1. c");
  });

  it("nests inline marks (link outermost, code innermost) and renders underline as <u>", () => {
    const items = [
      t("b", { bold: true }),
      t(" "),
      t("i", { italic: true }),
      t(" "),
      t("s", { strike: true }),
      t(" "),
      t("c", { code: true }),
      t(" "),
      t("u", { underline: true }),
      t(" "),
      t("both", { bold: true, italic: true }),
      t(" "),
      t("go", { link: "https://x.io", bold: true }),
    ];
    expect(blocksToMarkdown([para(...items)])).toBe("**b** *i* ~~s~~ `c` <u>u</u> ***both*** [**go**](https://x.io)");
  });

  it("escapes markdown specials in plain text but not in code", () => {
    expect(blocksToMarkdown([para(t("a *b* _c_ `d` ~e~ [f]"))])).toBe("a \\*b\\* \\_c\\_ \\`d\\` \\~e\\~ \\[f\\]");
    // A literal backtick inside a code span needs a longer delimiter run.
    expect(blocksToMarkdown([para(t("a`b", { code: true }))])).toBe("``a`b``");
  });

  it("renders atoms as their @label and skips atomic custom blocks", () => {
    const mention: InlineItem = { text: "", start: 0, atom: { type: "mention", width: 0, data: { label: "alice" } } };
    expect(blocksToMarkdown([para(mention, t(" hi"))])).toBe("@alice hi");
    // The skipped image still breaks the bullet run (blank line, ordinal reset).
    const blocks: ContentBlock[] = [
      { type: "bullet-list", items: [t("a")], attrs: { level: 0 } },
      { type: "image", items: [], attrs: { src: "x.png" } },
      { type: "bullet-list", items: [t("b")], attrs: { level: 0 } },
    ];
    expect(blocksToMarkdown(blocks)).toBe("- a\n\n- b");
  });

  it("joins blocks with blank lines, list neighbours with a single newline, and hard-breaks paragraph newlines", () => {
    const blocks: ContentBlock[] = [
      para(t("one\ntwo")),
      { type: "bullet-list", items: [t("a")], attrs: { level: 0 } },
      { type: "todo-list", items: [t("b")], attrs: { level: 0, checked: false } },
      para(t("end")),
    ];
    expect(blocksToMarkdown(blocks)).toBe("one  \ntwo\n\n- a\n- [ ] b\n\nend");
    expect(blocksToMarkdown([])).toBe("");
  });
});

describe("markdownToBlocks", () => {
  it("parses headings up to level 3 and leaves #### as a paragraph", () => {
    expect(markdownToBlocks("# A\n\n## B\n\n### C")).toEqual([
      { type: "heading", items: [{ text: "A", start: 0 }], attrs: { level: 1 } },
      { type: "heading", items: [{ text: "B", start: 0 }], attrs: { level: 2 } },
      { type: "heading", items: [{ text: "C", start: 0 }], attrs: { level: 3 } },
    ]);
    expect(markdownToBlocks("#### D")).toEqual([{ type: "paragraph", items: [{ text: "#### D", start: 0 }] }]);
  });

  it("parses fenced code with a language, verbatim content, and an unclosed fence to EOF", () => {
    expect(markdownToBlocks("```ts\nconst x = 1\n**raw**\n```")).toEqual([
      { type: "code", items: [{ text: "const x = 1\n**raw**", start: 0 }], attrs: { lang: "ts" } },
    ]);
    expect(markdownToBlocks("```\nabc")).toEqual([{ type: "code", items: [{ text: "abc", start: 0 }] }]);
  });

  it("merges consecutive quote lines into one quote block", () => {
    expect(markdownToBlocks("> a\n> b\n>\n> c")).toEqual([
      { type: "quote", items: [{ text: "a\nb\n\nc", start: 0 }] },
    ]);
  });

  it("parses bullets (-, *, +), ordered (. or )), and todos with 2-space indent nesting", () => {
    expect(markdownToBlocks("- a\n* b\n+ c\n  - d")).toEqual([
      { type: "bullet-list", items: [{ text: "a", start: 0 }], attrs: { level: 0 } },
      { type: "bullet-list", items: [{ text: "b", start: 0 }], attrs: { level: 0 } },
      { type: "bullet-list", items: [{ text: "c", start: 0 }], attrs: { level: 0 } },
      { type: "bullet-list", items: [{ text: "d", start: 0 }], attrs: { level: 1 } },
    ]);
    expect(markdownToBlocks("1. x\n2) y")).toEqual([
      { type: "ordered-list", items: [{ text: "x", start: 0 }], attrs: { level: 0 } },
      { type: "ordered-list", items: [{ text: "y", start: 0 }], attrs: { level: 0 } },
    ]);
    expect(markdownToBlocks("- [ ] open\n- [X] done")).toEqual([
      { type: "todo-list", items: [{ text: "open", start: 0 }], attrs: { level: 0, checked: false } },
      { type: "todo-list", items: [{ text: "done", start: 0 }], attrs: { level: 0, checked: true } },
    ]);
    // Absurd indentation clamps to the schema's maximum nesting level.
    const deep = markdownToBlocks(`${" ".repeat(40)}- deep`);
    expect(deep[0].attrs).toEqual({ level: MAX_LIST_LEVEL });
  });

  it("merges plain lines into one paragraph and honours two-space hard breaks", () => {
    expect(markdownToBlocks("one  \ntwo\nthree\n\nfour")).toEqual([
      { type: "paragraph", items: [{ text: "one\ntwo\nthree", start: 0 }] },
      { type: "paragraph", items: [{ text: "four", start: 0 }] },
    ]);
    // A structural line ends the paragraph run without a blank line.
    expect(markdownToBlocks("text\n- item").map((b) => b.type)).toEqual(["paragraph", "bullet-list"]);
  });

  it("parses inline marks with correct plain-text start offsets", () => {
    expect(markdownToBlocks("hi **b** _i_ `c` ~~s~~ <u>u</u>")[0].items).toEqual([
      { text: "hi ", start: 0 },
      { text: "b", start: 3, marks: { bold: true } },
      { text: " ", start: 4 },
      { text: "i", start: 5, marks: { italic: true } },
      { text: " ", start: 6 },
      { text: "c", start: 7, marks: { code: true } },
      { text: " ", start: 8 },
      { text: "s", start: 9, marks: { strike: true } },
      { text: " ", start: 10 },
      { text: "u", start: 11, marks: { underline: true } },
    ]);
    expect(markdownToBlocks("__b__ and *i*")[0].items).toEqual([
      { text: "b", start: 0, marks: { bold: true } },
      { text: " and ", start: 1 },
      { text: "i", start: 6, marks: { italic: true } },
    ]);
  });

  it("parses links (with nested emphasis and parens in the url) but not links inside links", () => {
    expect(markdownToBlocks("[**bold** link](https://a.io/x_(y))")[0].items).toEqual([
      { text: "bold", start: 0, marks: { bold: true, link: "https://a.io/x_(y)" } },
      { text: " link", start: 4, marks: { link: "https://a.io/x_(y)" } },
    ]);
    // Balanced brackets stay inside the outer link's text, and links never
    // nest — the inner "[b](u)" is literal text of the outer link.
    expect(markdownToBlocks("[a [b](u)](v)")[0].items[0]).toEqual({
      text: "a [b](u)",
      start: 0,
      marks: { link: "v" },
    });
  });

  it("keeps unmatched delimiters literal", () => {
    expect(markdownToBlocks("**bold*")[0].items).toEqual([{ text: "**bold*", start: 0 }]);
    expect(markdownToBlocks("a `code and [link(x")[0].items).toEqual([{ text: "a `code and [link(x", start: 0 }]);
    expect(markdownToBlocks("****")[0].items).toEqual([{ text: "****", start: 0 }]);
    expect(markdownToBlocks("<u>never closed")[0].items).toEqual([{ text: "<u>never closed", start: 0 }]);
  });

  it("honours backslash escapes and keeps delimiters inside code spans literal", () => {
    expect(markdownToBlocks("\\*not\\* \\[x\\]")[0].items).toEqual([{ text: "*not* [x]", start: 0 }]);
    expect(markdownToBlocks("`a*b`")[0].items).toEqual([{ text: "a*b", start: 0, marks: { code: true } }]);
    // The * inside the code span must not close the emphasis opened outside.
    expect(markdownToBlocks("*a `b*` c*")[0].items).toEqual([
      { text: "a ", start: 0, marks: { italic: true } },
      { text: "b*", start: 2, marks: { italic: true, code: true } },
      { text: " c", start: 4, marks: { italic: true } },
    ]);
    // Double-backtick delimiters carry a literal backtick.
    expect(markdownToBlocks("``a`b``")[0].items).toEqual([{ text: "a`b", start: 0, marks: { code: true } }]);
  });

  it("returns no blocks for an empty or blank document", () => {
    expect(markdownToBlocks("")).toEqual([]);
    expect(markdownToBlocks("\n\n   \n")).toEqual([]);
  });
});

describe("round trip", () => {
  it("serialize → parse → serialize is stable for a mixed document", () => {
    const doc: ContentBlock[] = [
      { type: "heading", items: [t("Notes")], attrs: { level: 1 } },
      para(t("Hello "), t("world", { bold: true }), t(" and "), t("x*y", { code: true })),
      para(t("soft\nbreak with *specials* [ok]")),
      { type: "quote", items: [t("wise\nwords, "), t("loud", { bold: true })] },
      { type: "code", items: [t("const a = 1;\nconst b = `2`;")], attrs: { lang: "ts" } },
      { type: "bullet-list", items: [t("one")], attrs: { level: 0 } },
      { type: "bullet-list", items: [t("nested", { italic: true })], attrs: { level: 1 } },
      { type: "ordered-list", items: [t("first")], attrs: { level: 0 } },
      { type: "ordered-list", items: [t("second")], attrs: { level: 0 } },
      { type: "todo-list", items: [t("done", { strike: true })], attrs: { level: 0, checked: true } },
      { type: "todo-list", items: [t("later")], attrs: { level: 1, checked: false } },
      para(t("see "), t("the site", { link: "https://a.io/x_(y)" }), t(" or "), t("under", { underline: true })),
    ];
    const md = blocksToMarkdown(doc);
    const reparsed = markdownToBlocks(md);
    expect(blocksToMarkdown(reparsed)).toBe(md);
    // Structure survives too, not just the text.
    expect(reparsed.map((b) => b.type)).toEqual(doc.map((b) => b.type));
  });

  it("parse → serialize is stable for hand-written markdown", () => {
    const md = [
      "# Title",
      "",
      "A paragraph with **bold**, *italic*, `code`, ~~strike~~ and [a link](https://example.com).",
      "",
      "> quoted",
      "> lines",
      "",
      "- top",
      "  - child",
      "1. one",
      "2. two",
      "- [x] shipped",
      "",
      "```js",
      "if (a < b) return `x`;",
      "```",
    ].join("\n");
    expect(blocksToMarkdown(markdownToBlocks(md))).toBe(md);
  });
});
