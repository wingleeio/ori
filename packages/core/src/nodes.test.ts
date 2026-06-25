import { DEFAULT_TYPOGRAPHY, createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { DEFAULT_BLOCKS, createSchema } from "./nodes";

describe("nodes / schema", () => {
  it("DEFAULT_BLOCKS contains the built-in text nodes", () => {
    expect(Object.keys(DEFAULT_BLOCKS).sort()).toEqual([
      "bullet-list",
      "code",
      "heading",
      "ordered-list",
      "paragraph",
      "quote",
      "todo-list",
    ]);
    expect(Object.values(DEFAULT_BLOCKS).every((n) => n.text)).toBe(true);
  });

  it("createSchema merges custom nodes over the built-ins", () => {
    const schema = createSchema({
      blocks: { divider: { type: "divider", text: false, measure: () => 33 } },
      atoms: { mention: { type: "mention", measure: () => 50 } },
    });
    expect(schema.blocks.paragraph).toBeDefined();
    expect(schema.blocks.heading.text).toBe(true);
    expect(schema.blocks.divider.text).toBe(false);
    expect(schema.blocks.divider.measure?.({ width: 100, attrs: {} })).toBe(33);
    expect(
      schema.atoms.mention.measure({ data: {}, typography: DEFAULT_TYPOGRAPHY, measurer: createMonospaceMeasurer() }),
    ).toBe(50);
  });

  it("heading derives larger typography", () => {
    const t = DEFAULT_BLOCKS.heading.typography?.(DEFAULT_TYPOGRAPHY);
    expect(t!.fontSize).toBeGreaterThan(DEFAULT_TYPOGRAPHY.fontSize);
    // Matches the rendered CSS weight (.ori-block-heading: 600) so measurement
    // agrees with the DOM.
    expect(t!.fontWeight).toBe(600);
  });
});
