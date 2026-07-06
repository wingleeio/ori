import type { BlockLayout } from "@wingleeio/ori-pretext";

/**
 * Cached layout for one block. `metrics` (height + line count) are always
 * present; the detailed `layout` (with fragments/geometry) is only computed for
 * visible blocks. An entry is valid only while its `version`, `width` and
 * `typographyKey` match the current editor state.
 */
export interface CacheEntry {
  version: number;
  width: number;
  typographyKey: string;
  height: number;
  lineCount: number;
  layout?: BlockLayout;
}

/**
 * Runtime layout cache. Lives entirely outside the Y.Doc — it is derived state
 * that can always be recomputed from content + width + typography.
 */
export class LayoutCache {
  private map = new Map<string, CacheEntry>();
  /** Ids of entries currently carrying detailed geometry, oldest-touched first. */
  private detailedLru = new Set<string>();

  get(id: string): CacheEntry | undefined {
    return this.map.get(id);
  }

  isValid(
    id: string,
    version: number,
    width: number,
    typographyKey: string,
  ): boolean {
    const e = this.map.get(id);
    return (
      !!e &&
      e.version === version &&
      e.width === width &&
      e.typographyKey === typographyKey
    );
  }

  /** True when a valid entry already carries detailed geometry. */
  hasDetailed(id: string, version: number, width: number, typographyKey: string): boolean {
    const hit = this.isValid(id, version, width, typographyKey) && !!this.map.get(id)?.layout;
    if (hit) this.touchDetailed(id);
    return hit;
  }

  set(id: string, entry: CacheEntry): void {
    this.map.set(id, entry);
    if (entry.layout) this.touchDetailed(id);
    else this.detailedLru.delete(id);
  }

  /** Mark a detailed entry as most-recently used. */
  private touchDetailed(id: string): void {
    this.detailedLru.delete(id);
    this.detailedLru.add(id);
  }

  /** Drop the detailed layout but keep cheap metrics (block scrolled offscreen). */
  dropDetailed(id: string): void {
    const e = this.map.get(id);
    if (e?.layout) e.layout = undefined;
    this.detailedLru.delete(id);
  }

  /** Number of entries currently holding detailed geometry. */
  detailedCount(): number {
    return this.detailedLru.size;
  }

  /**
   * Evict least-recently-used detailed layouts down to `max`, never touching
   * ids in `keep` (the current viewport window). Cheap metrics (height + line
   * count) are always retained, so eviction never causes visible jumps — a
   * re-visited block just recomputes its geometry on demand.
   */
  evictDetailed(keep: ReadonlySet<string>, max: number): void {
    if (this.detailedLru.size <= max) return;
    let excess = this.detailedLru.size - max;
    for (const id of [...this.detailedLru]) {
      if (excess <= 0) break;
      if (keep.has(id)) continue;
      this.dropDetailed(id);
      excess -= 1;
    }
  }

  invalidate(id: string): void {
    this.map.delete(id);
    this.detailedLru.delete(id);
  }

  retain(liveIds: Set<string>): void {
    for (const id of this.map.keys()) {
      if (!liveIds.has(id)) this.invalidate(id);
    }
  }

  clear(): void {
    this.map.clear();
    this.detailedLru.clear();
  }
}
