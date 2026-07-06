import { createMonospaceMeasurer } from "@wingleeio/ori-pretext";
import { describe, expect, it } from "vitest";
import { LayoutCache, type CacheEntry } from "./cache";
import { EditorController } from "./controller";
import { createNoteDoc } from "./schema";

const entry = (detailed: boolean): CacheEntry => ({
  version: 1,
  width: 100,
  typographyKey: "t",
  height: 20,
  lineCount: 1,
  layout: detailed
    ? {
        width: 100,
        typographyKey: "t",
        height: 20,
        lineCount: 1,
        length: 0,
        detailed: true,
        lines: [],
      }
    : undefined,
});

describe("LayoutCache eviction", () => {
  it("tracks detailed entry count", () => {
    const c = new LayoutCache();
    c.set("a", entry(true));
    c.set("b", entry(false));
    c.set("c", entry(true));
    expect(c.detailedCount()).toBe(2);
    c.dropDetailed("a");
    expect(c.detailedCount()).toBe(1);
    expect(c.get("a")).toBeDefined(); // metrics survive
    expect(c.get("a")!.layout).toBeUndefined();
  });

  it("evicts least-recently-used detailed layouts beyond max", () => {
    const c = new LayoutCache();
    c.set("a", entry(true));
    c.set("b", entry(true));
    c.set("c", entry(true));
    // Touch "a" so "b" becomes the oldest.
    c.hasDetailed("a", 1, 100, "t");
    c.evictDetailed(new Set(), 2);
    expect(c.detailedCount()).toBe(2);
    expect(c.get("b")!.layout).toBeUndefined();
    expect(c.get("a")!.layout).toBeDefined();
    expect(c.get("c")!.layout).toBeDefined();
  });

  it("never evicts kept ids", () => {
    const c = new LayoutCache();
    c.set("a", entry(true));
    c.set("b", entry(true));
    c.set("c", entry(true));
    c.evictDetailed(new Set(["a", "b"]), 1);
    expect(c.get("a")!.layout).toBeDefined();
    expect(c.get("b")!.layout).toBeDefined();
    expect(c.get("c")!.layout).toBeUndefined();
  });

  it("invalidate and clear drop LRU bookkeeping", () => {
    const c = new LayoutCache();
    c.set("a", entry(true));
    c.invalidate("a");
    expect(c.detailedCount()).toBe(0);
    c.set("b", entry(true));
    c.clear();
    expect(c.detailedCount()).toBe(0);
  });
});

describe("EditorController detailed-layout eviction", () => {
  it("bounds detailed layouts as the viewport scrolls a large note", () => {
    const texts = Array.from({ length: 400 }, (_, i) => `block ${i}`);
    const doc = createNoteDoc(texts.map((t) => ({ text: t })));
    const ed = new EditorController({
      doc,
      measurer: createMonospaceMeasurer(),
      width: 200,
      overscan: 0,
      maxDetailedLayouts: 8,
    });
    ed.setViewport(0, 100);
    // Visit many blocks' detailed layouts by scrolling through the note.
    const order = ed.getSnapshot();
    expect(order.blockCount).toBe(400);
    for (let top = 0; top < 8000; top += 100) {
      ed.setViewport(top, 100);
      for (const v of ed.getSnapshot().visible) ed.getLayout(v.id);
    }
    // Force one more eviction pass and count what survived.
    ed.setViewport(8100, 100);
    // Internal cache is private; verify via the public invariant instead:
    // re-fetching an evicted block still works (recomputes) and the editor
    // stays consistent.
    const snap = ed.getSnapshot();
    for (const v of snap.visible) {
      expect(ed.getLayout(v.id)).not.toBeNull();
    }
    // Reach into the cache to assert the bound holds (test-only access).
    const cache = (ed as unknown as { cache: LayoutCache }).cache;
    // Window size can exceed the cap; the bound is max(cap, window size).
    expect(cache.detailedCount()).toBeLessThanOrEqual(8 + snap.visible.length);
  });
});
