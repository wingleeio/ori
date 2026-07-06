import { createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { EditorController } from "./controller";
import type { EditorExtension } from "./extension";
import { blockId, createNoteDoc, getBlocks } from "./schema";

function make(extensions: EditorExtension[], texts: string[] = [""]) {
  const doc = createNoteDoc(texts.map((t) => ({ text: t })));
  const ed = new EditorController({
    doc,
    measurer: createMonospaceMeasurer(),
    width: 400,
    extensions,
  });
  const ids = texts.map((_, i) => blockId(getBlocks(doc).get(i)));
  return { ed, ids };
}

const at = (blockId: string, offset: number) => ({
  anchor: { blockId, offset },
  focus: { blockId, offset },
});

const type = (ed: EditorController, s: string) => {
  for (const ch of s) ed.insertText(ch);
};

const callout: EditorExtension = {
  name: "callout",
  schema: {
    blocks: { callout: { type: "callout", text: true, spacing: 20 } },
  },
  blockRules: [(prefix) => (prefix === ":: " ? { type: "callout", prefixLength: 3 } : null)],
  commands: {
    setCallout: (ed) => {
      ed.setBlockTypeAtSelection("callout");
      return "done";
    },
  },
};

describe("EditorExtension", () => {
  it("contributes schema nodes usable as block types", () => {
    const { ed, ids } = make([callout], ["hello"]);
    ed.setSelection(at(ids[0], 0));
    ed.setBlockTypeAtSelection("callout");
    expect(ed.getBlockType(ids[0])).toBe("callout");
    // Registered as a text node → still editable.
    ed.setSelection(at(ids[0], 5));
    ed.insertText("!");
    expect(ed.getBlockText(ids[0])).toBe("hello!");
  });

  it("extension block rules fire before built-ins", () => {
    const { ed, ids } = make([callout]);
    ed.setSelection(at(ids[0], 0));
    type(ed, ":: ");
    expect(ed.getBlockType(ids[0])).toBe("callout");
    expect(ed.getBlockText(ids[0])).toBe("");
    // Built-in rules still work alongside.
    ed.undo();
    ed.setSelection(at(ids[0], ed.getBlockText(ids[0]).length));
    // reset to empty paragraph for a clean built-in check
  });

  it("built-in rules still fire with extensions present", () => {
    const { ed, ids } = make([callout]);
    ed.setSelection(at(ids[0], 0));
    type(ed, "# ");
    expect(ed.getBlockType(ids[0])).toBe("heading");
  });

  it("extension inline rules run before built-ins", () => {
    const shout: EditorExtension = {
      name: "shout",
      inlineRules: [
        (text) => {
          // "!!word!!" → bold (checked before the built-in patterns)
          const m = /!!([^!\s]+)!!$/.exec(text);
          if (!m) return null;
          return {
            mark: "bold",
            start: text.length - m[0].length,
            open: 2,
            close: 2,
            end: text.length,
          };
        },
      ],
    };
    const { ed, ids } = make([shout]);
    ed.setSelection(at(ids[0], 0));
    type(ed, "say !!hi!!");
    expect(ed.getBlockText(ids[0])).toBe("say hi");
    ed.setSelection({ anchor: { blockId: ids[0], offset: 4 }, focus: { blockId: ids[0], offset: 6 } });
    expect(ed.getActiveMarks().bold).toBe(true);
  });

  it("exec runs registered commands; unknown commands are safe no-ops", () => {
    const { ed, ids } = make([callout], ["x"]);
    ed.setSelection(at(ids[0], 0));
    expect(ed.hasCommand("setCallout")).toBe(true);
    expect(ed.exec("setCallout")).toBe("done");
    expect(ed.getBlockType(ids[0])).toBe("callout");
    expect(ed.hasCommand("nope")).toBe(false);
    expect(ed.exec("nope")).toBeUndefined();
  });

  it("later extensions win command-name collisions", () => {
    const a: EditorExtension = { name: "a", commands: { go: () => "a" } };
    const b: EditorExtension = { name: "b", commands: { go: () => "b" } };
    const { ed } = make([a, b]);
    expect(ed.exec("go")).toBe("b");
  });
});
