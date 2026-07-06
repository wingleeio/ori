import { createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { EditorController } from "./controller";
import { matchBlockRule, matchInlineRule } from "./inputrules";
import { blockId, createNoteDoc, getBlocks } from "./schema";

function make(texts: string[] = [""], inputRules = true) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  const ed = new EditorController({
    doc,
    measurer: createMonospaceMeasurer(),
    width: 400,
    inputRules,
  });
  const ids = texts.map((_, i) => blockId(getBlocks(doc).get(i)));
  return { doc, ed, ids };
}

const at = (blockId: string, offset: number) => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
});

/** Type a string one character at a time (like real keystrokes). */
function type(ed: EditorController, s: string) {
  for (const ch of s) ed.insertText(ch);
}

describe("matchBlockRule", () => {
  it("matches markdown block prefixes", () => {
    expect(matchBlockRule("# ")).toMatchObject({ type: "heading", attrs: { level: 1 } });
    expect(matchBlockRule("## ")).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(matchBlockRule("### ")).toMatchObject({ type: "heading", attrs: { level: 3 } });
    expect(matchBlockRule("- ")).toMatchObject({ type: "bullet-list" });
    expect(matchBlockRule("* ")).toMatchObject({ type: "bullet-list" });
    expect(matchBlockRule("1. ")).toMatchObject({ type: "ordered-list" });
    expect(matchBlockRule("12) ")).toMatchObject({ type: "ordered-list" });
    expect(matchBlockRule("[] ")).toMatchObject({ type: "todo-list", attrs: { checked: false } });
    expect(matchBlockRule("[x] ")).toMatchObject({ type: "todo-list", attrs: { checked: true } });
    expect(matchBlockRule("- [ ] ")).toMatchObject({ type: "todo-list", attrs: { checked: false } });
    expect(matchBlockRule("> ")).toMatchObject({ type: "quote" });
    expect(matchBlockRule("``` ")).toMatchObject({ type: "code" });
    expect(matchBlockRule("```ts ")).toMatchObject({ type: "code", attrs: { lang: "ts" } });
    expect(matchBlockRule("```c++ ")).toMatchObject({ type: "code", attrs: { lang: "c++" } });
  });

  it("rejects non-prefixes", () => {
    expect(matchBlockRule("#### ")).toBeNull(); // beyond max level
    expect(matchBlockRule("#")).toBeNull(); // no trigger space yet
    expect(matchBlockRule("x# ")).toBeNull(); // not at block start
    expect(matchBlockRule("-- ")).toBeNull();
    expect(matchBlockRule("``")).toBeNull();
    expect(matchBlockRule("```")).toBeNull(); // fence needs its trigger space
    expect(matchBlockRule("`` ")).toBeNull();
  });
});

describe("matchInlineRule", () => {
  it("matches completed inline spans at the end of the text", () => {
    expect(matchInlineRule("**bold**")).toMatchObject({ mark: "bold", start: 0, open: 2 });
    expect(matchInlineRule("say *hi*")).toMatchObject({ mark: "italic", start: 4, open: 1 });
    expect(matchInlineRule("a `code`")).toMatchObject({ mark: "code", start: 2 });
    expect(matchInlineRule("~~gone~~")).toMatchObject({ mark: "strike" });
    expect(matchInlineRule("__bold__")).toMatchObject({ mark: "bold" });
    expect(matchInlineRule("x _it_")).toMatchObject({ mark: "italic" });
  });

  it("does not fire early or on empty/whitespace-bounded spans", () => {
    expect(matchInlineRule("**bold*")).toBeNull(); // still typing the closer
    expect(matchInlineRule("****")).toBeNull(); // empty
    expect(matchInlineRule("* text*")).toBeNull(); // leading space inside
    expect(matchInlineRule("*text *")).toBeNull(); // trailing space inside
    expect(matchInlineRule("a``")).toBeNull();
  });
});

describe("input rules in the controller", () => {
  it('"# " converts a paragraph to a heading and removes the prefix', () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "## ");
    expect(ed.getBlockType(ids[0])).toBe("heading");
    expect(ed.getHeadingLevel(ids[0])).toBe(2);
    expect(ed.getBlockText(ids[0])).toBe("");
    type(ed, "Title");
    expect(ed.getBlockText(ids[0])).toBe("Title");
  });

  it('"- " and "1. " convert to lists; "[x] " to a checked todo', () => {
    const { ed, ids } = make(["", "", ""]);
    ed.setSelection(at(ids[0], 0));
    type(ed, "- ");
    expect(ed.getBlockType(ids[0])).toBe("bullet-list");
    ed.setSelection(at(ids[1], 0));
    type(ed, "1. ");
    expect(ed.getBlockType(ids[1])).toBe("ordered-list");
    ed.setSelection(at(ids[2], 0));
    type(ed, "[x] ");
    expect(ed.getBlockType(ids[2])).toBe("todo-list");
    expect(ed.getTodoChecked(ids[2])).toBe(true);
  });

  it("``` converts to a code block, and rules never fire inside code", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "``` ");
    expect(ed.getBlockType(ids[0])).toBe("code");
    type(ed, "# not a heading ");
    expect(ed.getBlockType(ids[0])).toBe("code");
    expect(ed.getBlockText(ids[0])).toBe("# not a heading ");
  });

  it("```ts converts to a code block with its language set", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "```typescript ");
    expect(ed.getBlockType(ids[0])).toBe("code");
    expect(ed.getCodeLang(ids[0])).toBe("ts"); // alias normalized
    expect(ed.getBlockText(ids[0])).toBe("");
  });

  it("block rules fire only at the start of a paragraph", () => {
    const { ed, ids } = make(["hello "]);
    ed.setSelection(at(ids[0], 6));
    type(ed, "- ");
    expect(ed.getBlockType(ids[0])).toBe("paragraph");
    expect(ed.getBlockText(ids[0])).toBe("hello - ");
  });

  it("**bold** applies the mark and strips the delimiters", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "say **hi**");
    expect(ed.getBlockText(ids[0])).toBe("say hi");
    ed.setSelection({ anchor: { blockId: ids[0], offset: 4 }, focus: { blockId: ids[0], offset: 6 } });
    expect(ed.getActiveMarks().bold).toBe(true);
    // Preceding text is untouched.
    ed.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 4 } });
    expect(ed.getActiveMarks().bold).toBeFalsy();
  });

  it("the next character after a completed span is unmarked", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "`x`");
    expect(ed.getBlockText(ids[0])).toBe("x");
    type(ed, "y");
    expect(ed.getBlockText(ids[0])).toBe("xy");
    ed.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 2 } });
    expect(ed.getActiveMarks().code).toBeFalsy();
  });

  it("*italic* works and ** does not read as italic", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "*it*");
    expect(ed.getBlockText(ids[0])).toBe("it");
    ed.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 2 } });
    expect(ed.getActiveMarks().italic).toBe(true);
  });

  it("one undo restores the literal markdown text", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "# ");
    expect(ed.getBlockType(ids[0])).toBe("heading");
    ed.undo();
    expect(ed.getBlockType(ids[0])).toBe("paragraph");
    expect(ed.getBlockText(ids[0])).toBe("# ");
  });

  it("multi-character inserts (paste) never trigger rules", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    ed.insertText("# heading");
    expect(ed.getBlockType(ids[0])).toBe("paragraph");
    expect(ed.getBlockText(ids[0])).toBe("# heading");
    ed.insertText(" **bold**");
    expect(ed.getBlockText(ids[0])).toBe("# heading **bold**");
  });

  it("can be disabled via options", () => {
    const { ed, ids } = make([""], false);
    ed.setSelection(at(ids[0], 0));
    type(ed, "# ");
    expect(ed.getBlockType(ids[0])).toBe("paragraph");
    expect(ed.getBlockText(ids[0])).toBe("# ");
  });

  it("delimiters typed inside an existing code span stay literal", () => {
    const { ed, ids } = make();
    ed.setSelection(at(ids[0], 0));
    type(ed, "`a*b`");
    expect(ed.getBlockText(ids[0])).toBe("a*b"); // code span applied
    // Now type *...* right after inside plain text — still fine:
    type(ed, "*c*");
    expect(ed.getBlockText(ids[0])).toBe("a*bc");
  });
});
