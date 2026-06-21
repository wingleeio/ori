import {
  EditorController,
  blockId,
  createMonospaceMeasurer,
  createNoteDoc,
  getBlocks,
  isCollapsed,
} from "@wingleeio/ori-core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../NoteEditor";
import { domToModel } from "./dom";
import { EditorView } from "./view";

afterEach(cleanup);

function makeEditor(texts: string[], schema?: ConstructorParameters<typeof EditorController>[0]["schema"]) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  return new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 400, schema });
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
  const block = root.querySelectorAll("[data-block-id]")[bi] as HTMLElement;
  const [an, ao] = domPos(block, from);
  const [fn, fo] = domPos(block, to);
  const r = document.createRange();
  r.setStart(an, ao);
  r.setEnd(fn, fo);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

function caretDom(root: HTMLElement, bi: number, off: number) {
  const block = root.querySelectorAll("[data-block-id]")[bi] as HTMLElement;
  const [node, o] = domPos(block, off);
  const r = document.createRange();
  r.setStart(node, o);
  r.collapse(true);
  const s = window.getSelection()!;
  s.removeAllRanges();
  s.addRange(r);
}

/** Build a StaticRange-like target over a block's model offsets [from, to). */
function targetRange(root: HTMLElement, bi: number, from: number, to: number) {
  const block = root.querySelectorAll("[data-block-id]")[bi] as HTMLElement;
  const [sc, so] = domPos(block, from);
  const [ec, eo] = domPos(block, to);
  return { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo };
}

/**
 * Dispatch a beforeinput carrying an explicit target range — what iOS
 * autocorrect / IME / spellcheck do (the DOM selection stays collapsed at the
 * caret while the *replaced* range is reported via getTargetRanges()).
 */
function beforeinputTarget(
  ce: HTMLElement,
  inputType: string,
  data: string | null,
  range: ReturnType<typeof targetRange>,
) {
  const e = new InputEvent("beforeinput", { inputType, data: data ?? undefined, bubbles: true, cancelable: true });
  Object.defineProperty(e, "getTargetRanges", { value: () => [range] });
  ce.dispatchEvent(e);
  return e;
}

function beforeinput(ce: HTMLElement, inputType: string, data?: string) {
  ce.dispatchEvent(new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true }));
}

function setup(texts: string[], schema?: ConstructorParameters<typeof EditorController>[0]["schema"]) {
  const editor = makeEditor(texts, schema);
  const ids = getBlocks(editor.doc).map((b) => blockId(b));
  const { container } = render(<NoteEditor editor={editor} />);
  const ce = container.querySelector(".ori-ce") as HTMLElement;
  const text = (i: number) => editor.getBlockText(ids[i]);
  const blockEl = (i: number) => ce.querySelectorAll("[data-block-id]")[i] as HTMLElement;
  return { editor, ids, ce, text, blockEl };
}

describe("iOS autocorrect / IME (getTargetRanges)", () => {
  it("autocorrect replaces the targeted word, not the whole block", () => {
    // iOS: caret collapsed at the word end; the replaced range is the word.
    const { ce, text } = setup(["teh cat"]);
    caretDom(ce, 0, 3);
    const e = beforeinputTarget(ce, "insertReplacementText", "the", targetRange(ce, 0, 0, 3));
    expect(e.defaultPrevented).toBe(true);
    expect(text(0)).toBe("the cat");
  });

  it("a ranged deleteContentBackward (collapsed caret, word target range) deletes the whole word", () => {
    // Some keyboards report a ranged delete (caret at the word end, target range
    // = the word). The old code saw a collapsed selection and deleted one char.
    const { ce, text } = setup(["teh cat"]);
    caretDom(ce, 0, 3);
    const e = beforeinputTarget(ce, "deleteContentBackward", null, targetRange(ce, 0, 0, 3));
    expect(e.defaultPrevented).toBe(true);
    expect(text(0)).toBe(" cat");
  });

  it("autocorrect preserves marks on the replaced word", () => {
    const { ce, editor, ids, text } = setup(["teh cat"]);
    // Bold the whole first word.
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 3 } });
    editor.toggleMark("bold");
    act(() => {});
    caretDom(ce, 0, 3);
    beforeinputTarget(ce, "insertReplacementText", "the", targetRange(ce, 0, 0, 3));
    expect(text(0)).toBe("the cat");
    const runs = editor.getInline(ids[0]);
    expect(runs[0].text).toBe("the");
    expect(runs[0].marks?.bold).toBe(true);
  });

  it("a collapsed insertReplacementText without a target range stays native (no duplication)", () => {
    // Older browsers/iOS without getTargetRanges report a collapsed caret. The
    // browser performs the replacement natively (onInput reads it back); routing
    // it through the controller would skip the delete and duplicate ("tehthe").
    const { ce, text } = setup(["teh cat"]);
    caretDom(ce, 0, 3);
    const e = new InputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: "the",
      bubbles: true,
      cancelable: true,
    });
    ce.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(text(0)).toBe("teh cat"); // native path (jsdom can't apply it) — crucially not duplicated
  });

  it("typing over a styled selection inherits its marks", () => {
    const { ce, editor, ids, text } = setup(["bold plain"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 4 } });
    editor.toggleMark("bold");
    act(() => {});
    selectDom(ce, 0, 0, 4); // "bold"
    beforeinput(ce, "insertText", "X"); // non-collapsed -> controlled replace
    expect(text(0)).toBe("X plain");
    const runs = editor.getInline(ids[0]);
    expect(runs[0].text).toBe("X");
    expect(runs[0].marks?.bold).toBe(true);
  });

  it("a plain collapsed keystroke is left native (not intercepted)", () => {
    const { ce } = setup(["hi"]);
    caretDom(ce, 0, 2);
    // A collapsed insertText must not be preventDefault'd (native typing path).
    const e = beforeinputTarget(ce, "insertText", "x", targetRange(ce, 0, 2, 2));
    expect(e.defaultPrevented).toBe(false);
  });

  it("a collapsed insertReplacementText stays native even with a pending mark (no duplication)", () => {
    const { ce, editor, text } = setup(["teh cat"]);
    caretDom(ce, 0, 3);
    // Stage a pending bold mark, then an autocorrect replacement with no target
    // range. The replacement must still go native — not duplicate to "tehthe".
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
    expect(editor.hasPendingMarks()).toBe(true);
    const e = new InputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: "the",
      bubbles: true,
      cancelable: true,
    });
    ce.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(text(0)).toBe("teh cat");
  });

  it("typing after toggling bold on a collapsed caret inserts bold text and paints it", () => {
    const { ce, editor, ids } = setup(["x"]);
    caretDom(ce, 0, 1);
    // Cmd+B with no selection stages a pending bold mark.
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true, cancelable: true }));
    // The browser would type this unstyled; the pending mark forces the
    // controlled path so the inserted text is bold AND re-rendered as bold.
    const e = new InputEvent("beforeinput", { inputType: "insertText", data: "Y", bubbles: true, cancelable: true });
    ce.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    const y = editor.getInline(ids[0]).find((r) => r.text.includes("Y"));
    expect(y?.marks?.bold).toBe(true);
    const boldSpan = (ce.querySelector("[data-block-id]") as HTMLElement).querySelector(".ori-m-bold");
    expect(boldSpan?.textContent).toContain("Y");
  });

  it("active composition (insertCompositionText) is never intercepted", () => {
    const { ce } = setup(["abc"]);
    caretDom(ce, 0, 3);
    ce.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const e = beforeinputTarget(ce, "insertCompositionText", "d", targetRange(ce, 0, 3, 3));
    expect(e.defaultPrevented).toBe(false);
  });

  it("non-text input during composition (e.g. Backspace) is also left native", () => {
    const { ce, text } = setup(["abc"]);
    caretDom(ce, 0, 3);
    ce.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // A delete of a candidate character mid-composition must NOT be intercepted
    // (preventDefault + re-render would corrupt the IME candidate).
    const e = beforeinputTarget(ce, "deleteContentBackward", null, targetRange(ce, 0, 2, 3));
    expect(e.defaultPrevented).toBe(false);
    expect(text(0)).toBe("abc"); // model untouched until compositionend
  });
});

describe("type then Backspace (native paint -> controlled delete) re-renders the DOM", () => {
  // The browser paints typed text natively; the Backspace's target range routes
  // the delete through the controller. If the model returns to a previously
  // rendered signature, the block must still re-render — otherwise the caret
  // moves but the typed char stays on screen.
  function nativeBackspaceTarget(tn: Text, from: number, to: number) {
    return { startContainer: tn, startOffset: from, endContainer: tn, endOffset: to };
  }
  function backspace(ce: HTMLElement, tn: Text, from: number, to: number) {
    const e = new InputEvent("beforeinput", { inputType: "deleteContentBackward", bubbles: true, cancelable: true });
    Object.defineProperty(e, "getTargetRanges", { value: () => [nativeBackspaceTarget(tn, from, to)] });
    ce.dispatchEvent(e);
  }

  it("typing into an empty block then Backspace clears it from the DOM (the @ / menu case)", () => {
    const { ce, text, blockEl } = setup([""]);
    // The browser inserts "@" into the empty block as a bare text node.
    blockEl(0).textContent = "@";
    const tn = blockEl(0).firstChild as Text;
    const r = document.createRange();
    r.setStart(tn, 1);
    r.collapse(true);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    ce.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(text(0)).toBe("@");
    backspace(ce, tn, 0, 1);
    expect(text(0)).toBe(""); // model cleared
    expect(blockEl(0).textContent).toBe(""); // DOM cleared too (bug left "@")
  });

  it("typing then Backspace that round-trips to a prior signature re-renders", () => {
    const { ce, text, blockEl } = setup(["abc"]);
    const span = blockEl(0).querySelector("[data-off]") as HTMLElement;
    const tn = span.firstChild as Text;
    tn.data = "abcd"; // browser extends the text node in place
    const r = document.createRange();
    r.setStart(tn, 4);
    r.collapse(true);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    ce.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(text(0)).toBe("abcd");
    backspace(ce, tn, 3, 4);
    expect(text(0)).toBe("abc");
    expect(blockEl(0).textContent).toBe("abc"); // DOM reflects the delete (bug left "abcd")
  });
});

describe("composition guard", () => {
  it("defers external re-renders during composition, then flushes on compositionend", () => {
    const { ce, editor, ids, text, blockEl } = setup(["abc", "xyz"]);
    caretDom(ce, 0, 3);
    ce.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));

    // Simulate the IME mutating the composing block's text node.
    const span = blockEl(0).querySelector("[data-off]") as HTMLElement;
    (span.firstChild as Text).data = "abcd";

    // An external command changes block 1 *during* composition.
    act(() => {
      editor.setSelection({ anchor: { blockId: ids[1], offset: 0 }, focus: { blockId: ids[1], offset: 0 } });
      editor.setBlockTypeAtSelection("quote");
    });
    // The re-render is deferred: block 1 still renders as a paragraph.
    expect(blockEl(1).className).toContain("ori-block-paragraph");

    ce.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    // The composed text is reconciled and the deferred change is now applied.
    expect(text(0)).toBe("abcd");
    expect(blockEl(1).className).toContain("ori-block-quote");
  });

  it("a concurrent edit to the composing block keeps the external edit (drops the IME draft)", () => {
    const { ce, editor, ids, text, blockEl } = setup(["abc"]);
    caretDom(ce, 0, 3);
    ce.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // The IME mutates the composing block's text node (draft "abcd").
    const span = blockEl(0).querySelector("[data-off]") as HTMLElement;
    (span.firstChild as Text).data = "abcd";
    // A remote/app edit prepends "X" to the *same* block during composition.
    act(() => {
      editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 0 } });
      editor.insertText("X");
    });
    ce.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    // The external edit must survive (not be reverted to the stale "abcd" draft).
    expect(text(0)).toBe("Xabc");
  });
});

describe("history via beforeinput (trackpad / menu undo)", () => {
  it("historyUndo / historyRedo route through the controller", () => {
    const { ce, editor, ids } = setup(["abc"]);
    act(() => {
      editor.setSelection({ anchor: { blockId: ids[0], offset: 3 }, focus: { blockId: ids[0], offset: 3 } });
      editor.insertText("d");
    });
    expect(editor.getBlockText(ids[0])).toBe("abcd");
    const undo = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true });
    ce.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(true);
    expect(editor.getBlockText(ids[0])).toBe("abc");
    const redo = new InputEvent("beforeinput", { inputType: "historyRedo", bubbles: true, cancelable: true });
    ce.dispatchEvent(redo);
    expect(editor.getBlockText(ids[0])).toBe("abcd");
  });
});

function drop(ce: HTMLElement, plain: string) {
  const dt = { getData: (t: string) => (t === "text/plain" ? plain : "") };
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: dt });
  ce.dispatchEvent(e);
  return e;
}

describe("drag & drop", () => {
  it("dropped plain text (external) is inserted through the controller, not natively", () => {
    const { ce, editor, ids, text } = setup(["hello"]);
    // No caretRangeFromPoint in jsdom -> the handler falls back to the selection.
    editor.setSelection({ anchor: { blockId: ids[0], offset: 5 }, focus: { blockId: ids[0], offset: 5 } });
    const e = drop(ce, " world");
    expect(e.defaultPrevented).toBe(true);
    expect(text(0)).toBe("hello world");
  });

  it("internal drag to a later point moves the text (no duplication)", () => {
    const { ce, editor, ids, text } = setup(["hello world"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 5 } }); // "hello"
    ce.dispatchEvent(new Event("dragstart", { bubbles: true }));
    // Drop at the end (jsdom has no caretFromPoint -> uses the model selection).
    editor.setSelection({ anchor: { blockId: ids[0], offset: 11 }, focus: { blockId: ids[0], offset: 11 } });
    drop(ce, "hello");
    expect(text(0)).toBe(" worldhello");
    expect(text(0).length).toBe(11); // moved, not duplicated
    // Caret ends at the dropped content (so the next keystroke lands there),
    // not back at the deleted source.
    expect(editor.getSelection()?.focus).toEqual({ blockId: ids[0], offset: 11 });
  });

  it("internal drag to an earlier point moves the text", () => {
    const { ce, editor, ids, text } = setup(["hello world"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 6 }, focus: { blockId: ids[0], offset: 11 } }); // "world"
    ce.dispatchEvent(new Event("dragstart", { bubbles: true }));
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 0 } });
    drop(ce, "world");
    expect(text(0)).toBe("worldhello ");
  });

  it("internal move preserves marks (rich payload written on dragstart)", () => {
    const { ce, editor, ids, text } = setup(["bold tail"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 4 } });
    editor.toggleMark("bold");
    act(() => {});
    // Drag the bold word "bold" to the end of the line.
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 4 } });
    const store: Record<string, string> = {};
    const dt = {
      setData: (t: string, v: string) => {
        store[t] = v;
      },
      getData: (t: string) => store[t] ?? "",
    };
    const ds = new Event("dragstart", { bubbles: true });
    Object.defineProperty(ds, "dataTransfer", { value: dt });
    ce.dispatchEvent(ds);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 9 }, focus: { blockId: ids[0], offset: 9 } });
    const dr = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(dr, "dataTransfer", { value: dt });
    ce.dispatchEvent(dr);
    expect(text(0)).toBe(" tailbold");
    const boldRun = editor.getInline(ids[0]).find((r) => r.marks?.bold);
    expect(boldRun?.text).toBe("bold"); // mark survived the move (not flattened to plain text)
  });

  it("a drop with no text payload does not alter the target block", () => {
    const { ce, editor, ids, text } = setup(["title"]);
    act(() => editor.setBlockTypeAtSelection("heading"));
    editor.setSelection({ anchor: { blockId: ids[0], offset: 5 }, focus: { blockId: ids[0], offset: 5 } });
    const e = drop(ce, ""); // a dragged file/image: empty text payload
    expect(e.defaultPrevented).toBe(true);
    expect(text(0)).toBe("title");
    expect(editor.getBlockType(ids[0])).toBe("heading"); // not retyped to paragraph
  });

  it("an Option/Alt copy-drag duplicates instead of moving (source kept)", () => {
    const { ce, editor, ids, text } = setup(["hello world"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 5 } });
    ce.dispatchEvent(new Event("dragstart", { bubbles: true }));
    editor.setSelection({ anchor: { blockId: ids[0], offset: 11 }, focus: { blockId: ids[0], offset: 11 } });
    const dt = { getData: (t: string) => (t === "text/plain" ? "hello" : ""), dropEffect: "copy" };
    const e = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "dataTransfer", { value: dt });
    Object.defineProperty(e, "altKey", { value: true });
    ce.dispatchEvent(e);
    expect(text(0)).toBe("hello worldhello");
    expect(text(0).length).toBe(16); // duplicated, source kept
  });

  it("dropping inside the dragged range leaves the text unchanged", () => {
    const { ce, editor, ids, text } = setup(["hello world"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 0 }, focus: { blockId: ids[0], offset: 5 } });
    ce.dispatchEvent(new Event("dragstart", { bubbles: true }));
    editor.setSelection({ anchor: { blockId: ids[0], offset: 2 }, focus: { blockId: ids[0], offset: 2 } });
    drop(ce, "hello");
    expect(text(0)).toBe("hello world");
  });
});

describe("selection toolbar / overlay blur", () => {
  it("a tap into an editor overlay keeps the selection (iOS: focus stays on body)", async () => {
    const { ce, editor, ids } = setup(["abcdef"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 4 } });
    const overlay = document.createElement("div");
    overlay.setAttribute("data-ori-overlay", "");
    const btn = document.createElement("button");
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
    // iOS: the tap fires pointerdown on the button but does NOT move focus there.
    btn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    ce.dispatchEvent(new FocusEvent("blur"));
    await new Promise((r) => setTimeout(r, 0));
    expect(isCollapsed(editor.getSelection()!)).toBe(false); // toolbar stays usable
    hasFocus.mockRestore();
    overlay.remove();
  });

  it("a tap on an SVG icon inside an overlay still keeps the selection", async () => {
    const { ce, editor, ids } = setup(["abcdef"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 4 } });
    const overlay = document.createElement("div");
    overlay.setAttribute("data-ori-overlay", "");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    overlay.appendChild(svg);
    document.body.appendChild(overlay);
    path.dispatchEvent(new Event("pointerdown", { bubbles: true })); // SVGElement target
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    ce.dispatchEvent(new FocusEvent("blur"));
    await new Promise((r) => setTimeout(r, 0));
    expect(isCollapsed(editor.getSelection()!)).toBe(false);
    hasFocus.mockRestore();
    overlay.remove();
  });

  it("a focus-preserving overlay click does not exempt a later keyboard/programmatic blur", async () => {
    const { ce, editor, ids } = setup(["abcdef"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 4 } });
    const overlay = document.createElement("div");
    overlay.setAttribute("data-ori-overlay", "");
    const btn = document.createElement("button");
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    // A mouse overlay click that preventDefaults fires pointerdown + pointerup
    // but NO blur (focus is preserved). pointerup must clear the press target.
    btn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    btn.dispatchEvent(new Event("pointerup", { bubbles: true }));
    // A much-later blur (Tab away, programmatic) with no fresh pointer-down must
    // collapse — it isn't caused by the stale overlay press.
    ce.dispatchEvent(new FocusEvent("blur"));
    await new Promise((r) => setTimeout(r, 0));
    expect(isCollapsed(editor.getSelection()!)).toBe(true);
    hasFocus.mockRestore();
    overlay.remove();
  });

  it("clicking outside while focus is in an overlay collapses the stale selection", () => {
    // The dropdown-dismiss case: focus already left the editor into an overlay
    // (so no editor blur fires), then a press lands outside everything.
    const { editor, ids } = setup(["abcdef"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 4 } });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(isCollapsed(editor.getSelection()!)).toBe(true);
    outside.remove();
  });

  it("pressing inside an overlay while unfocused keeps the selection", () => {
    const { editor, ids } = setup(["abcdef"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 4 } });
    const overlay = document.createElement("div");
    overlay.setAttribute("data-ori-overlay", "");
    const btn = document.createElement("button");
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
    btn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(isCollapsed(editor.getSelection()!)).toBe(false);
    overlay.remove();
  });

  it("a tap outside any overlay collapses the selection (toolbar hides)", async () => {
    const { ce, editor, ids } = setup(["abcdef"]);
    editor.setSelection({ anchor: { blockId: ids[0], offset: 1 }, focus: { blockId: ids[0], offset: 4 } });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    ce.dispatchEvent(new FocusEvent("blur"));
    await new Promise((r) => setTimeout(r, 0));
    expect(isCollapsed(editor.getSelection()!)).toBe(true);
    hasFocus.mockRestore();
    outside.remove();
  });
});

describe("view recreation (readOnly toggle / editor swap)", () => {
  it("restores the DOM caret when recreated on a focused element", () => {
    const editor = makeEditor(["hello"]);
    const id = getBlocks(editor.doc).map((b) => blockId(b))[0];
    const root = document.createElement("div");
    document.body.appendChild(root);
    const opts = { renderAtom: () => undefined, renderBlock: () => undefined };
    const v1 = new EditorView(root, editor, opts);
    root.focus();
    editor.setSelection({ anchor: { blockId: id, offset: 3 }, focus: { blockId: id, offset: 3 } });
    v1.destroy(); // clears the DOM and collapses the browser selection onto root
    const v2 = new EditorView(root, editor, opts);
    const s = window.getSelection()!;
    // The new view restored the caret from the controller (not offset 0).
    expect(domToModel(root, s.focusNode, s.focusOffset)).toEqual({ blockId: id, offset: 3 });
    v2.destroy();
    root.remove();
  });
});

describe("deletion / boundary edge cases", () => {
  it("Backspace at the very start of the first block is a no-op", () => {
    const { ce, editor, text } = setup(["abc"]);
    caretDom(ce, 0, 0);
    beforeinput(ce, "deleteContentBackward");
    expect(editor.blockIds().length).toBe(1);
    expect(text(0)).toBe("abc");
  });

  it("Delete at the very end of the last block is a no-op", () => {
    const { ce, editor, text } = setup(["abc"]);
    caretDom(ce, 0, 3);
    beforeinput(ce, "deleteContentForward");
    expect(editor.blockIds().length).toBe(1);
    expect(text(0)).toBe("abc");
  });

  it("Enter inside a code block keeps the new block as code", () => {
    const { ce, editor } = setup(["const x = 1"]);
    act(() => editor.setBlockTypeAtSelection("code"));
    caretDom(ce, 0, 11);
    beforeinput(ce, "insertParagraph");
    const after = editor.blockIds();
    expect(after.length).toBe(2);
    expect(editor.getBlockType(after[0])).toBe("code");
    expect(editor.getBlockType(after[1])).toBe("code");
  });

  it("selecting all then typing replaces every block with the new text", () => {
    const { ce, editor, text } = setup(["one", "two", "three"]);
    // A real cross-block DOM selection (block 0 start -> last block end).
    const blocks = ce.querySelectorAll("[data-block-id]");
    const [an, ao] = domPos(blocks[0] as HTMLElement, 0);
    const [fn, fo] = domPos(blocks[2] as HTMLElement, 5);
    const r = document.createRange();
    r.setStart(an, ao);
    r.setEnd(fn, fo);
    const s = window.getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
    beforeinput(ce, "insertText", "X"); // non-collapsed -> controlled replace
    expect(editor.blockIds().length).toBe(1);
    expect(text(0)).toBe("X");
  });
});
