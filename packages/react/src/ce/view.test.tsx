import {
  EditorController,
  blockId,
  createMonospaceMeasurer,
  createNoteDoc,
  getBlocks,
} from "@wingleeio/ori-core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteEditor } from "../NoteEditor";
import { domToModel } from "./dom";

afterEach(cleanup);

function makeEditor(texts: string[]) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  return new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 400 });
}

/** Resolve a {block, modelOffset} to a DOM (node, offset) using the run spans. */
function domPos(block: HTMLElement, off: number): [Node, number] {
  const nodes = [...block.querySelectorAll("[data-off]")] as HTMLElement[];
  for (const nd of nodes) {
    const start = Number(nd.dataset.off);
    const len = nd.dataset.len != null ? Number(nd.dataset.len) : (nd.textContent ?? "").length;
    if (off <= start + len) {
      if (nd.dataset.atom != null || nd.dataset.break != null) {
        const idx = [...block.childNodes].indexOf(nd);
        return [block, off <= start ? idx : idx + 1];
      }
      const tn = nd.firstChild ?? nd;
      return [tn, Math.max(0, Math.min(off - start, (tn.textContent ?? "").length))];
    }
  }
  if (!nodes.length) return [block, 0];
  const last = nodes[nodes.length - 1];
  const tn = last.firstChild ?? last;
  return [tn, (tn.textContent ?? "").length];
}

function selectDom(root: HTMLElement, bi: number, from: number, to: number) {
  const blocks = root.querySelectorAll("[data-block-id]");
  const a = domPos(blocks[bi] as HTMLElement, from);
  const f = domPos(blocks[to < from ? bi : bi] as HTMLElement, to);
  const r = document.createRange();
  r.setStart(a[0], a[1]);
  r.setEnd(f[0], f[1]);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

function caretDom(root: HTMLElement, bi: number, off: number) {
  selectDom(root, bi, off, off);
}

/** Dispatch a beforeinput as the browser would for a keystroke. */
function beforeinput(ce: HTMLElement, inputType: string, data?: string) {
  ce.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
}

function setup(texts: string[]) {
  const editor = makeEditor(texts);
  const ids = getBlocks(editor.doc).map((b) => blockId(b));
  const { container } = render(<NoteEditor editor={editor} />);
  const ce = container.querySelector(".ori-ce") as HTMLElement;
  const text = (i: number) => editor.getBlockText(ids[i]);
  return { editor, ids, ce, text };
}

describe("EditorView input routing (beforeinput)", () => {
  it("Backspace over a selection deletes the whole range (not one char)", () => {
    const { ce, text } = setup(["abcdef"]);
    selectDom(ce, 0, 1, 4); // "bcd"
    beforeinput(ce, "deleteContentBackward");
    expect(text(0)).toBe("aef");
  });

  it("Delete over a selection deletes the range", () => {
    const { ce, text } = setup(["abcdef"]);
    selectDom(ce, 0, 0, 3); // "abc"
    beforeinput(ce, "deleteContentForward");
    expect(text(0)).toBe("def");
  });

  it("Backspace over a cross-block selection joins the ends", () => {
    const { ce, editor, text } = setup(["hello", "world"]);
    const blocks = ce.querySelectorAll("[data-block-id]");
    const a = domPos(blocks[0] as HTMLElement, 2);
    const f = domPos(blocks[1] as HTMLElement, 3);
    const r = document.createRange();
    r.setStart(a[0], a[1]);
    r.setEnd(f[0], f[1]);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    beforeinput(ce, "deleteContentBackward");
    expect(editor.blockIds().length).toBe(1);
    expect(text(0)).toBe("held");
  });

  it("Backspace at offset 0 merges into the previous block", () => {
    const { ce, editor, text } = setup(["one", "two"]);
    caretDom(ce, 1, 0);
    beforeinput(ce, "deleteContentBackward");
    expect(editor.blockIds().length).toBe(1);
    expect(text(0)).toBe("onetwo");
  });

  it("Enter splits the block at the caret", () => {
    const { ce, editor } = setup(["splitme"]);
    caretDom(ce, 0, 5);
    beforeinput(ce, "insertParagraph");
    const ids = editor.blockIds();
    expect(ids.length).toBe(2);
    expect(editor.getBlockText(ids[0])).toBe("split");
    expect(editor.getBlockText(ids[1])).toBe("me");
  });

  it("paste-style insertReplacementText over a selection replaces it", () => {
    const { ce, text } = setup(["replaceme"]);
    selectDom(ce, 0, 0, 7); // "replace"
    beforeinput(ce, "insertReplacementText", "X");
    expect(text(0)).toBe("Xme");
  });

  it("Backspace right after an inline atom removes the atom", () => {
    const doc = createNoteDoc([{ text: "ab" }]);
    const editor = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 400,
      schema: { atoms: { mention: { type: "mention", measure: () => 20 } } },
    });
    const id = blockId(getBlocks(doc).get(0));
    editor.setSelection({ anchor: { blockId: id, offset: 2 }, focus: { blockId: id, offset: 2 } });
    editor.insertInlineAtom({ type: "mention", label: "Z" });
    editor.insertText("cd");
    const { container } = render(<NoteEditor editor={editor} atomRenderers={{ mention: () => <span>@Z</span> }} />);
    const ce = container.querySelector(".ori-ce") as HTMLElement;
    caretDom(ce, 0, 3); // right after the atom
    beforeinput(ce, "deleteContentBackward");
    expect(editor.getBlockText(id)).toBe("abcd");
    expect(editor.getInline(id).some((r) => r.atom)).toBe(false);
  });

  it("Cmd+B toggles bold on the selection", () => {
    const { ce, editor, ids } = setup(["bolded"]);
    selectDom(ce, 0, 0, 4); // "bold"
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
    const runs = editor.getInline(ids[0]);
    expect(runs[0].text).toBe("bold");
    expect(runs[0].marks?.bold).toBe(true);
    expect(runs[1].marks?.bold).toBeFalsy();
  });

  it("Cmd+A selects the whole document (in the model), not just the rendered window", () => {
    const { ce, editor, ids } = setup(["one", "two", "three"]);
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true }));
    const sel = editor.getSelection()!;
    expect(sel.anchor.blockId).toBe(ids[0]);
    expect(sel.anchor.offset).toBe(0);
    expect(sel.focus.blockId).toBe(ids[2]);
    expect(sel.focus.offset).toBe(editor.getBlockText(ids[2]).length);
  });

  it("Cmd+A works in a read-only editor (so it can be copied whole)", () => {
    const editor = makeEditor(["one", "two"]);
    const ids = getBlocks(editor.doc).map((b) => blockId(b));
    const { container } = render(<NoteEditor editor={editor} readOnly />);
    const ce = container.querySelector(".ori-ce") as HTMLElement;
    expect(ce.tabIndex).toBe(0); // focusable despite contenteditable=false
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true, cancelable: true }));
    const sel = editor.getSelection()!;
    expect(sel.focus.blockId).toBe(ids[1]);
    expect(sel.focus.offset).toBe(editor.getBlockText(ids[1]).length);
  });

  it("Cmd+Z undoes / Cmd+Shift+Z redoes the last edit", () => {
    const { ce, editor, ids } = setup(["abc"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 3 }, focus: { blockId: ids[0], offset: 3 } });
    editor.insertText("d");
    expect(editor.getBlockText(ids[0])).toBe("abcd");
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
    expect(editor.getBlockText(ids[0])).toBe("abc");
    ce.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    expect(editor.getBlockText(ids[0])).toBe("abcd");
  });

  it("Delete at the end of a block merges the next block in", () => {
    const { ce, editor, text } = setup(["one", "two"]);
    caretDom(ce, 0, 3);
    beforeinput(ce, "deleteContentForward");
    expect(editor.blockIds().length).toBe(1);
    expect(text(0)).toBe("onetwo");
  });

  it("places the caret after an inline atom inserted via a model command (mention)", () => {
    const doc = createNoteDoc([{ text: "hi " }]);
    const editor = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 400,
      schema: { atoms: { mention: { type: "mention", measure: () => 20 } } },
    });
    const id = blockId(getBlocks(doc).get(0));
    const { container } = render(<NoteEditor editor={editor} atomRenderers={{ mention: () => <span>@Z</span> }} />);
    const ce = container.querySelector(".ori-ce") as HTMLElement;
    act(() => {
      // what a mention menu does: replace the trigger, insert the atom + a space.
      editor.setSelection({ anchor: { blockId: id, offset: 3 }, focus: { blockId: id, offset: 3 } });
      editor.insertInlineAtom({ type: "mention", label: "Z" });
      editor.insertText(" ");
    });
    expect(editor.getBlockText(id).length).toBe(5); // "hi " + atom + " "
    // The DOM caret must sit at the model end (5), not collapse to the block start.
    const s = window.getSelection()!;
    const mapped = domToModel(ce, s.focusNode, s.focusOffset);
    expect(mapped).toEqual({ blockId: id, offset: 5 });
  });

  it("a content re-render in another block does not collapse a live selection (then Backspace still deletes it)", () => {
    const { ce, editor, ids, text } = setup(["abcdef", "other"]);
    selectDom(ce, 0, 1, 4); // "bcd" in block 0
    // External change to block 1 -> async sync()/renderBlocks.
    editor.setSelection({ anchor: { blockId: ids[1], offset: 0 }, focus: { blockId: ids[1], offset: 0 } });
    editor.setBlockTypeAtSelection("quote");
    // Re-establish the user's selection in block 0 (the model selection moved to
    // block 1 above; the live DOM selection is what Backspace must honour).
    selectDom(ce, 0, 1, 4);
    beforeinput(ce, "deleteContentBackward");
    expect(text(0)).toBe("aef");
  });
});
