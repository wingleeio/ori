import type { InlineItem } from "@wingleeio/ori-core";
import { describe, expect, it } from "vitest";
import { blockElOf, buildRun, domToModel, esc, modelToDom } from "./dom";

/** Build a block element the way EditorView does: text runs as spans, atoms as
 *  data-atom spans, hard breaks as data-break <br>s. */
function buildBlock(id: string, items: InlineItem[]): HTMLElement {
  const root = document.createElement("div");
  const block = document.createElement("div");
  block.dataset.blockId = id;
  root.appendChild(block);
  for (const item of items) {
    if (item.atom) {
      const span = document.createElement("span");
      span.className = "ori-atom";
      span.dataset.atom = "true";
      span.dataset.off = String(item.start);
      span.dataset.len = "1";
      span.textContent = "￼";
      block.appendChild(span);
    } else if (item.text.includes("\n")) {
      let off = item.start;
      item.text.split("\n").forEach((part, i) => {
        if (i > 0) {
          const br = document.createElement("br");
          br.dataset.off = String(off);
          br.dataset.len = "1";
          br.dataset.break = "true";
          block.appendChild(br);
          off += 1;
        }
        if (part) {
          block.appendChild(buildRun({ text: part, start: off, marks: item.marks }));
          off += part.length;
        }
      });
    } else {
      block.appendChild(buildRun(item));
    }
  }
  if (!block.childNodes.length) block.appendChild(document.createElement("br"));
  return root;
}
const run = (text: string, start: number, marks?: InlineItem["marks"]): InlineItem => ({ text, start, marks });
const atom = (start: number): InlineItem => ({ text: "￼", start, atom: { type: "x", width: 0 } });

describe("dom mapping", () => {
  describe("esc", () => {
    it("escapes a value usable in a [data-block-id] selector", () => {
      const root = document.createElement("div");
      const block = document.createElement("div");
      block.dataset.blockId = "b_1:2";
      root.appendChild(block);
      expect(root.querySelector(`[data-block-id="${esc("b_1:2")}"]`)).toBe(block);
    });
  });

  describe("blockElOf", () => {
    it("finds the enclosing block element from a descendant", () => {
      const root = buildBlock("b1", [run("hello", 0)]);
      const textNode = root.querySelector("span")!.firstChild!;
      expect(blockElOf(textNode, root)?.dataset.blockId).toBe("b1");
    });
    it("returns null above the block", () => {
      const root = buildBlock("b1", [run("hi", 0)]);
      expect(blockElOf(root, root)).toBeNull();
    });
  });

  describe("buildRun", () => {
    it("encodes offset, length, text and mark classes", () => {
      const span = buildRun(run("hi", 5, { bold: true, italic: true }));
      expect(span.dataset.off).toBe("5");
      expect(span.dataset.len).toBe("2");
      expect(span.textContent).toBe("hi");
      expect(span.className).toContain("ori-m-bold");
      expect(span.className).toContain("ori-m-italic");
    });
  });

  describe("domToModel / modelToDom round-trip", () => {
    const cases: Array<{ name: string; items: InlineItem[]; len: number }> = [
      { name: "plain text", items: [run("hello world", 0)], len: 11 },
      { name: "multiple runs", items: [run("ab", 0, { bold: true }), run("cd", 2)], len: 4 },
      { name: "text + atom + text", items: [run("ab", 0), atom(2), run("cd", 3)], len: 5 },
      { name: "leading atom", items: [atom(0), run("xy", 1)], len: 3 },
      { name: "trailing atom", items: [run("xy", 0), atom(2)], len: 3 },
      { name: "hard break", items: [run("a\nb", 0)], len: 3 },
    ];
    for (const c of cases) {
      it(`maps every offset for: ${c.name}`, () => {
        const root = buildBlock("b1", c.items);
        for (let off = 0; off <= c.len; off++) {
          const dom = modelToDom(root, "b1", off);
          expect(dom, `modelToDom(${off})`).not.toBeNull();
          const back = domToModel(root, dom!.node, dom!.offset);
          expect(back?.blockId).toBe("b1");
          expect(back?.offset, `round-trip offset ${off}`).toBe(off);
        }
      });
    }

    it("maps an empty block to offset 0", () => {
      const root = buildBlock("b1", []);
      const dom = modelToDom(root, "b1", 0)!;
      expect(domToModel(root, dom.node, dom.offset)).toEqual({ blockId: "b1", offset: 0 });
    });

    it("clamps an out-of-range offset to the block end", () => {
      const root = buildBlock("b1", [run("abc", 0)]);
      const dom = modelToDom(root, "b1", 99)!;
      expect(domToModel(root, dom.node, dom.offset)?.offset).toBe(3);
    });

    it("returns null for a node outside any block", () => {
      const root = buildBlock("b1", [run("abc", 0)]);
      expect(domToModel(root, root, 0)).toBeNull();
    });
  });
});
