import { createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { EditorController } from "./controller";
import { blockId, createNoteDoc, getBlocks } from "./schema";
import { isCollapsed } from "./selection";

function make(texts?: string[]) {
  const doc = texts ? createNoteDoc(texts.map((t) => ({ text: t }))) : createNoteDoc();
  const ed = new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 200 });
  const firstId = blockId(getBlocks(doc).get(0));
  return { doc, ed, firstId };
}

const at = (blockId: string, offset: number) => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
});

describe("EditorController", () => {
  it("measures blocks and exposes a snapshot", () => {
    const { ed } = make(["hello"]);
    const snap = ed.getSnapshot();
    expect(snap.blockCount).toBe(1);
    expect(snap.totalHeight).toBeGreaterThan(0);
    expect(ed.getLayout(snap.visible[0].id)!.lineCount).toBe(1);
  });

  it("getSnapshot is referentially stable until a change", () => {
    const { ed, firstId } = make(["a"]);
    const s1 = ed.getSnapshot();
    expect(ed.getSnapshot()).toBe(s1);
    ed.setSelection(at(firstId, 1));
    expect(ed.getSnapshot()).not.toBe(s1);
  });

  it("insertText / split / merge update doc and selection", () => {
    const { ed, firstId } = make(["hello"]);
    ed.setSelection(at(firstId, 5));
    ed.insertText("!");
    expect(ed.getBlockText(firstId)).toBe("hello!");
    ed.insertParagraphBreak();
    expect(ed.getSnapshot().blockCount).toBe(2);
    ed.deleteBackward();
    expect(ed.getSnapshot().blockCount).toBe(1);
  });

  it("notifies subscribers on change", () => {
    const { ed, firstId } = make(["a"]);
    let calls = 0;
    const unsub = ed.subscribe(() => {
      calls += 1;
    });
    ed.setSelection(at(firstId, 1));
    ed.insertText("b");
    expect(calls).toBeGreaterThan(0);
    unsub();
  });

  it("undo / redo", () => {
    const { ed, firstId } = make([""]);
    ed.setSelection(at(firstId, 0));
    ed.insertText("hello");
    ed.undo();
    expect(ed.getBlockText(firstId)).toBe("");
    ed.redo();
    expect(ed.getBlockText(firstId)).toBe("hello");
  });

  it("toggleMark on a range and getActiveMarks", () => {
    const { ed, firstId } = make(["hello"]);
    ed.setSelection({ anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 5 } });
    ed.toggleMark("bold");
    expect(ed.getActiveMarks().bold).toBe(true);
  });

  it("getSelectedText returns the selected substring", () => {
    const { ed, firstId } = make(["hello world"]);
    ed.setSelection({ anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 5 } });
    expect(ed.getSelectedText()).toBe("hello");
  });

  it("selectWordAt / selectBlockAt select the word and the block (double/triple tap)", () => {
    const { ed, firstId } = make(["hello world"]);
    ed.selectWordAt({ blockId: firstId, offset: 8 });
    expect(ed.getSelectedText()).toBe("world");
    ed.selectBlockAt({ blockId: firstId, offset: 0 });
    expect(ed.getSelectedText()).toBe("hello world");
  });

  it("selectWordAt picks an inline atom as its own word", () => {
    const { ed, firstId } = make(["hi  there"]);
    ed.setSelection(at(firstId, 3));
    ed.insertInlineAtom({ type: "mention", label: "Ada" });
    // text is now "hi ￼ there"; double-tap on the atom selects just it
    ed.selectWordAt({ blockId: firstId, offset: 3 });
    expect(ed.getSelectedText()).toBe("Ada");
  });

  it("moves the caret across block boundaries", () => {
    const { ed, firstId } = make(["ab", "cd"]);
    ed.setSelection(at(firstId, 2));
    ed.moveCaret("right");
    const sel = ed.getSelection()!;
    expect(sel.focus.offset).toBe(0);
    expect(sel.focus.blockId).not.toBe(firstId);
  });

  it("measures a custom atomic block from the schema", () => {
    const doc = createNoteDoc();
    const ed = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 300,
      schema: { blocks: { divider: { type: "divider", text: false, measure: () => 33 } } },
    });
    ed.insertBlockAfterSelection("divider");
    const divider = ed.getSnapshot().visible.find((b) => b.type === "divider")!;
    expect(divider.height).toBe(33);
  });

  it("re-measures a width-dependent atomic block on resize", () => {
    const doc = createNoteDoc();
    const ed = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 320,
      schema: {
        blocks: { image: { type: "image", text: false, measure: ({ width }) => Math.round(width / 2) } },
      },
    });
    ed.insertBlockAfterSelection("image", { ratio: 2 });
    expect(ed.getSnapshot().visible.find((b) => b.type === "image")!.height).toBe(160);
    ed.setWidth(640);
    expect(ed.getSnapshot().visible.find((b) => b.type === "image")!.height).toBe(320);
  });

  it("measures inline atoms from the schema", () => {
    const doc = createNoteDoc([{ text: "" }]);
    const ed = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 300,
      schema: { atoms: { mention: { type: "mention", measure: () => 50 } } },
    });
    const id = blockId(getBlocks(doc).get(0));
    ed.setSelection(at(id, 0));
    ed.insertInlineAtom({ type: "mention", label: "X" });
    const atomFrag = ed.getLayout(id)!.lines[0].fragments.find((f) => f.atom);
    expect(atomFrag?.width).toBe(50);
  });

  it("getSelectedText includes inline mentions by label", () => {
    const doc = createNoteDoc([{ text: "" }]);
    const ed = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 300,
      schema: { atoms: { mention: { type: "mention", measure: () => 40 } } },
    });
    const id = blockId(getBlocks(doc).get(0));
    ed.setSelection(at(id, 0));
    ed.insertText("hi ");
    ed.insertInlineAtom({ type: "mention", label: "Ada" });
    ed.insertText(" there");
    ed.selectAll();
    expect(ed.getSelectedText()).toBe("hi Ada there");
  });

  it("setViewport drives the visible window", () => {
    const doc = createNoteDoc(Array.from({ length: 200 }, (_, i) => ({ text: `line ${i}` })));
    const ed = new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 300, blockSpacing: 8 });
    ed.setViewport(0, 300);
    const top = ed.getSnapshot();
    expect(top.visible.length).toBeGreaterThan(0);
    expect(top.visible.length).toBeLessThan(120);
    ed.setViewport(top.totalHeight - 300, 300);
    expect(ed.getSnapshot().visible.some((b) => b.index === 199)).toBe(true);
  });

  it("getSelectionInline clips a styled selection into marked runs", () => {
    const { ed, firstId } = make(["plain text"]);
    ed.setSelection({ anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 5 } });
    ed.toggleMark("bold");
    // select "ain te" (offsets 2..8), spanning the bold/plain boundary at 5
    ed.setSelection({ anchor: { blockId: firstId, offset: 2 }, focus: { blockId: firstId, offset: 8 } });
    const blocks = ed.getSelectionInline();
    expect(blocks.length).toBe(1);
    expect(blocks[0].map((r) => r.text).join("")).toBe("ain te");
    expect(blocks[0][0].marks?.bold).toBe(true); // "ain"
    expect(blocks[0][blocks[0].length - 1].marks?.bold).toBeFalsy(); // " te"
  });

  it("insertInline restores marks (copy → paste round-trip)", () => {
    const { ed, firstId } = make(["bold normal"]);
    ed.setSelection({ anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 4 } });
    ed.toggleMark("bold");
    ed.selectAll();
    const copied = ed.getSelectionInline();
    const len = ed.getBlockText(firstId).length;
    ed.setSelection(at(firstId, len));
    ed.insertInline(copied[0]);
    const items = ed.getInline(firstId);
    expect(ed.getBlockText(firstId)).toBe("bold normalbold normal");
    const pastedBold = items.find((r) => r.start === 11); // the re-pasted "bold"
    expect(pastedBold?.marks?.bold).toBe(true);
  });

  it("insertInline across blocks preserves block boundaries", () => {
    const { ed, firstId } = make(["start"]);
    ed.setSelection(at(firstId, 5));
    ed.insertInline([{ text: "a", start: 0 }]);
    ed.insertParagraphBreak();
    ed.insertInline([{ text: "b", start: 0 }]);
    expect(ed.blockIds().map((id) => ed.getBlockText(id))).toEqual(["starta", "b"]);
  });

  describe("editing operations", () => {
    const texts = (ed: EditorController) => ed.blockIds().map((id) => ed.getBlockText(id));

    it("deleteBackward removes the char before the caret", () => {
      const { ed, firstId } = make(["abcd"]);
      ed.setSelection(at(firstId, 2));
      ed.deleteBackward();
      expect(ed.getBlockText(firstId)).toBe("acd");
      expect(ed.getSelection()!.focus.offset).toBe(1);
    });

    it("deleteBackward at offset 0 merges into the previous block", () => {
      const { ed } = make(["one", "two"]);
      const [a, b] = ed.blockIds();
      ed.setSelection(at(b, 0));
      ed.deleteBackward();
      expect(texts(ed)).toEqual(["onetwo"]);
      const sel = ed.getSelection()!;
      expect(sel.focus.blockId).toBe(a);
      expect(sel.focus.offset).toBe(3);
    });

    it("deleteForward removes the char after the caret", () => {
      const { ed, firstId } = make(["abcd"]);
      ed.setSelection(at(firstId, 1));
      ed.deleteForward();
      expect(ed.getBlockText(firstId)).toBe("acd");
      expect(ed.getSelection()!.focus.offset).toBe(1);
    });

    it("deleteForward at block end merges the next block in", () => {
      const { ed } = make(["one", "two"]);
      const [a] = ed.blockIds();
      ed.setSelection(at(a, 3));
      ed.deleteForward();
      expect(texts(ed)).toEqual(["onetwo"]);
      expect(ed.getSelection()!.focus).toEqual({ blockId: a, offset: 3 });
    });

    it("deleting a non-collapsed selection removes the range", () => {
      const { ed, firstId } = make(["abcdef"]);
      ed.setSelection({ anchor: { blockId: firstId, offset: 1 }, focus: { blockId: firstId, offset: 4 } });
      ed.deleteBackward();
      expect(ed.getBlockText(firstId)).toBe("aef");
    });

    it("deleting a cross-block selection joins the ends", () => {
      const { ed } = make(["hello", "middle", "world"]);
      const [a, , c] = ed.blockIds();
      ed.setSelection({ anchor: { blockId: a, offset: 2 }, focus: { blockId: c, offset: 3 } });
      ed.deleteBackward();
      expect(texts(ed)).toEqual(["held"]);
    });

    it("insertParagraphBreak splits at the caret (start / middle / end)", () => {
      const mid = make(["abcd"]);
      mid.ed.setSelection(at(mid.firstId, 2));
      mid.ed.insertParagraphBreak();
      expect(texts(mid.ed)).toEqual(["ab", "cd"]);

      const start = make(["abcd"]);
      start.ed.setSelection(at(start.firstId, 0));
      start.ed.insertParagraphBreak();
      expect(texts(start.ed)).toEqual(["", "abcd"]);

      const end = make(["abcd"]);
      end.ed.setSelection(at(end.firstId, 4));
      end.ed.insertParagraphBreak();
      expect(texts(end.ed)).toEqual(["abcd", ""]);
      expect(end.ed.getSelection()!.focus.offset).toBe(0);
    });

    it("toggleMark on a collapsed caret stages a pending mark applied to the next text", () => {
      const { ed, firstId } = make(["x"]);
      ed.setSelection(at(firstId, 1));
      ed.toggleMark("bold");
      expect(ed.getActiveMarks().bold).toBe(true);
      ed.insertText("Y");
      const bold = ed.getInline(firstId).find((r) => r.text === "Y");
      expect(bold?.marks?.bold).toBe(true);
    });

    it("getActiveMarks over a partially-bold range reports the mark off", () => {
      const { ed, firstId } = make(["abcd"]);
      ed.setSelection({ anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 2 } });
      ed.toggleMark("bold");
      ed.setSelection({ anchor: { blockId: firstId, offset: 0 }, focus: { blockId: firstId, offset: 4 } });
      expect(ed.getActiveMarks().bold).toBeFalsy();
    });

    it("setBlockTypeAtSelection changes one block, then a multi-block range", () => {
      const { ed } = make(["a", "b", "c"]);
      const [x, y, z] = ed.blockIds();
      ed.setSelection(at(y, 0));
      ed.setBlockTypeAtSelection("quote");
      expect(ed.getBlockType(x)).toBe("paragraph");
      expect(ed.getBlockType(y)).toBe("quote");
      expect(ed.getBlockType(z)).toBe("paragraph");
      expect(ed.blockTypeAtSelection()).toBe("quote");

      ed.setSelection({ anchor: { blockId: x, offset: 0 }, focus: { blockId: z, offset: 1 } });
      ed.setBlockTypeAtSelection("heading");
      expect([x, y, z].map((id) => ed.getBlockType(id))).toEqual(["heading", "heading", "heading"]);
    });

    it("selectAll spans the whole document; collapse re-collapses it", () => {
      const { ed } = make(["a", "b", "c"]);
      const ids = ed.blockIds();
      ed.selectAll();
      const sel = ed.getSelection()!;
      expect(sel.anchor.blockId).toBe(ids[0]);
      expect(sel.focus.blockId).toBe(ids[2]);
      ed.collapse(sel.focus);
      expect(isCollapsed(ed.getSelection()!)).toBe(true);
    });

    it("getSelectionBlocks carries each block's type + clipped runs", () => {
      const { ed } = make(["Heading", "body text"]);
      const [h, p] = ed.blockIds();
      ed.setSelection(at(h, 0));
      ed.setBlockTypeAtSelection("heading");
      ed.setSelection({ anchor: { blockId: h, offset: 0 }, focus: { blockId: p, offset: 4 } });
      const blocks = ed.getSelectionBlocks();
      expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
      expect(blocks.map((b) => b.items.map((r) => r.text).join(""))).toEqual(["Heading", "body"]);
    });

    it("insertInlineAtom inserts one offset; deleteBackward removes the whole atom", () => {
      const { ed, firstId } = make(["ab"]);
      ed.setSelection(at(firstId, 2));
      ed.insertInlineAtom({ type: "mention", label: "Z" });
      ed.insertText("cd");
      expect(ed.getBlockText(firstId).length).toBe(5); // ab + atom(1) + cd
      expect(ed.getInline(firstId).some((r) => r.atom)).toBe(true);
      ed.setSelection(at(firstId, 3)); // right after the atom
      ed.deleteBackward();
      expect(ed.getBlockText(firstId)).toBe("abcd");
      expect(ed.getInline(firstId).some((r) => r.atom)).toBe(false);
    });
  });
});
