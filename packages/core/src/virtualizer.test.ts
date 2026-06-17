import { describe, expect, it } from "vitest";
import { Virtualizer } from "./virtualizer";

function make() {
  const v = new Virtualizer(20);
  v.setOrder(["a", "b", "c", "d", "e"]);
  v.setHeight("a", 30);
  v.setHeight("b", 40);
  v.setHeight("c", 50);
  v.setHeight("d", 60);
  v.setHeight("e", 70);
  return v;
}

describe("Virtualizer", () => {
  it("totalHeight sums all heights", () => {
    expect(make().totalHeight()).toBe(250);
  });

  it("topOf is the prefix sum of preceding heights", () => {
    const v = make();
    expect(v.topOf("a")).toBe(0);
    expect(v.topOf("c")).toBe(70);
    expect(v.topOf("e")).toBe(180);
  });

  it("blockAt maps a y offset to its block and clamps", () => {
    const v = make();
    expect(v.blockAt(0)).toBe("a");
    expect(v.blockAt(35)).toBe("b");
    expect(v.blockAt(1000)).toBe("e");
  });

  it("window returns only blocks intersecting the viewport", () => {
    const v = make();
    const w = v.window(70, 60, 0); // scrollTop at start of c, 60px tall -> c, d
    expect(w.items.map((i) => i.id)).toEqual(["c", "d"]);
    expect(w.items[0].top).toBe(70);
    expect(w.totalHeight).toBe(250);
  });

  it("setHeight reports whether it changed", () => {
    const v = make();
    expect(v.setHeight("a", 30)).toBe(false);
    expect(v.setHeight("a", 100)).toBe(true);
    expect(v.totalHeight()).toBe(320);
  });

  it("setOrder prunes heights of removed blocks", () => {
    const v = make();
    v.setOrder(["a", "b"]);
    expect(v.count()).toBe(2);
    expect(v.totalHeight()).toBe(70);
  });

  it("an empty virtualizer yields an empty window", () => {
    const v = new Virtualizer(20);
    const w = v.window(0, 100);
    expect(w.items).toHaveLength(0);
    expect(w.totalHeight).toBe(0);
    expect(v.blockAt(0)).toBeNull();
  });
});
