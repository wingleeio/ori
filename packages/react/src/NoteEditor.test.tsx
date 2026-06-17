import {
  EditorController,
  blockId,
  createMonospaceMeasurer,
  createNoteDoc,
  getBlocks,
} from "@wingleeio/ori-core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NoteEditor } from "./NoteEditor";
import { useEditor } from "./useEditor";

afterEach(cleanup);

function makeEditor(texts: string[]) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  return new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 400 });
}

const at = (id: string, offset: number) => ({
  anchor: { blockId: id, offset },
  focus: { blockId: id, offset },
});

describe("<NoteEditor> (contentEditable)", () => {
  it("renders block text into a single editable surface", () => {
    const editor = makeEditor(["hello world", "second"]);
    const { container } = render(<NoteEditor editor={editor} />);
    expect(screen.getByText("hello world")).toBeDefined();
    const ce = container.querySelector(".ori-ce") as HTMLElement;
    expect(ce.getAttribute("contenteditable")).toBe("true");
    expect(ce.querySelectorAll("[data-block-id]").length).toBe(2);
  });

  it("re-renders when the model changes", () => {
    const editor = makeEditor(["abc"]);
    render(<NoteEditor editor={editor} />);
    const id = blockId(getBlocks(editor.doc).get(0));
    act(() => {
      editor.setSelection(at(id, 3));
      editor.insertText("d");
    });
    expect(screen.getByText("abcd")).toBeDefined();
  });

  it("renders marks as styled spans", () => {
    const doc = createNoteDoc([{ text: "x" }]);
    const editor = new EditorController({ doc, measurer: createMonospaceMeasurer(), width: 400 });
    const id = blockId(getBlocks(doc).get(0));
    act(() => {
      editor.setSelection({ anchor: { blockId: id, offset: 0 }, focus: { blockId: id, offset: 1 } });
      editor.toggleMark("bold");
    });
    const { container } = render(<NoteEditor editor={editor} />);
    expect(container.querySelector(".ori-m-bold")?.textContent).toBe("x");
  });

  it("renders custom block and inline-atom nodes via their renderers", async () => {
    const doc = createNoteDoc([{ text: "x" }]);
    const editor = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 400,
      schema: {
        blocks: { divider: { type: "divider", text: false, measure: () => 20 } },
        atoms: { mention: { type: "mention", measure: () => 40 } },
      },
    });
    const id0 = blockId(getBlocks(doc).get(0));
    editor.setSelection(at(id0, 1));
    editor.insertInlineAtom({ type: "mention", label: "Ada" });
    editor.insertBlockAfterSelection("divider");

    render(
      <NoteEditor
        editor={editor}
        blockRenderers={{ divider: () => <hr data-testid="divider" /> }}
        atomRenderers={{
          mention: ({ atom }) => <span data-testid="chip">@{(atom.data as { label: string }).label}</span>,
        }}
      />,
    );
    expect(await screen.findByTestId("divider")).toBeDefined();
    expect((await screen.findByTestId("chip")).textContent).toBe("@Ada");
  });

  it("shows the placeholder for an empty document", () => {
    const editor = makeEditor([""]);
    render(<NoteEditor editor={editor} placeholder="Write here" />);
    expect(screen.getByText("Write here")).toBeDefined();
  });

  it("survives React StrictMode (view + controller re-created cleanly)", () => {
    const doc = createNoteDoc([{ text: "abc" }]);
    let editor!: ReturnType<typeof useEditor>;
    function Harness() {
      editor = useEditor({ doc, measurer: createMonospaceMeasurer() });
      return <NoteEditor editor={editor} />;
    }
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const id = blockId(getBlocks(doc).get(0));
    act(() => {
      editor.setSelection(at(id, 3));
      editor.insertText("d");
    });
    expect(screen.getByText("abcd")).toBeDefined();
  });
});
