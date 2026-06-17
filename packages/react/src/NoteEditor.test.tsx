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

describe("<NoteEditor>", () => {
  it("renders block text as materialized lines", () => {
    const editor = makeEditor(["hello world"]);
    render(<NoteEditor editor={editor} />);
    expect(screen.getByText("hello world")).toBeDefined();
  });

  it("renders custom block and inline-atom nodes via their renderers", () => {
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
          mention: ({ atom }) => (
            <span data-testid="chip">@{(atom.data as { label: string }).label}</span>
          ),
        }}
      />,
    );
    expect(screen.getByTestId("divider")).toBeDefined();
    expect(screen.getByTestId("chip").textContent).toBe("@Ada");
  });

  it("re-renders when the editor state changes", () => {
    const editor = makeEditor(["abc"]);
    render(<NoteEditor editor={editor} />);
    const id = blockId(getBlocks(editor.doc).get(0));
    act(() => {
      editor.setSelection(at(id, 3));
      editor.insertText("d");
    });
    expect(screen.getByText("abcd")).toBeDefined();
  });

  it("shows the placeholder for an empty document", () => {
    const editor = makeEditor([""]);
    render(<NoteEditor editor={editor} placeholder="Write here" />);
    expect(screen.getByText("Write here")).toBeDefined();
  });

  it("stays reactive under StrictMode (subscriptions survive the dev double-mount)", () => {
    const doc = createNoteDoc([{ text: "abc" }]);
    let editor!: EditorController;
    function Harness() {
      editor = useEditor({ doc, measurer: createMonospaceMeasurer() });
      return <NoteEditor editor={editor} />;
    }
    // StrictMode mounts → unmounts → remounts effects in dev. If the controller's
    // observeDeep/undo subscriptions are torn down on the simulated unmount and
    // never reconnected, the edit below never re-measures and the text is stale.
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
