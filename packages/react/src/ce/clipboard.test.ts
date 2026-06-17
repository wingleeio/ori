import type { InlineItem } from "@wingleeio/ori-core";
import { describe, expect, it } from "vitest";
import { deserializeOri, htmlToBlocks, serializeSelection, textToBlocks } from "./clipboard";

const run = (text: string, marks?: InlineItem["marks"]): InlineItem => ({ text, start: 0, marks });

describe("clipboard", () => {
  it("serializes marks to html + private json and round-trips them", () => {
    const blocks: InlineItem[][] = [[run("bold", { bold: true }), run(" plain")]];
    const { text, html, json } = serializeSelection(blocks);
    expect(text).toBe("bold plain");
    expect(html).toContain("<strong>bold</strong>");
    const back = deserializeOri(json)!;
    expect(back.length).toBe(1);
    expect(back[0][0].text).toBe("bold");
    expect(back[0][0].marks?.bold).toBe(true);
    expect(back[0][1].marks?.bold).toBeFalsy();
  });

  it("keeps block boundaries through json", () => {
    const blocks: InlineItem[][] = [[run("one")], [run("two")]];
    const { text, json } = serializeSelection(blocks);
    expect(text).toBe("one\ntwo");
    expect(deserializeOri(json)!.map((b) => b.map((r) => r.text).join(""))).toEqual(["one", "two"]);
  });

  it("parses external html into marked runs + blocks", () => {
    const blocks = htmlToBlocks("<p>hi <b>there</b></p><p><i>world</i></p>");
    expect(blocks.length).toBe(2);
    expect(blocks[0].map((r) => r.text).join("")).toBe("hi there");
    expect(blocks[0].find((r) => r.text === "there")?.marks?.bold).toBe(true);
    expect(blocks[1][0].marks?.italic).toBe(true);
  });

  it("splits plain text into one block per line", () => {
    expect(textToBlocks("a\nb").map((b) => b.map((r) => r.text).join(""))).toEqual(["a", "b"]);
  });

  it("returns null for non-ori json", () => {
    expect(deserializeOri("not json")).toBeNull();
    expect(deserializeOri('{"nope":1}')).toBeNull();
  });
});
