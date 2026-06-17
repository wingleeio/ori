import { createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { EditorController } from "./controller";
import { blockId, createNoteDoc, getBlocks } from "./schema";

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
});
