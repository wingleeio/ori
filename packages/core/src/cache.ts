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
    return this.isValid(id, version, width, typographyKey) && !!this.map.get(id)?.layout;
  }

  set(id: string, entry: CacheEntry): void {
    this.map.set(id, entry);
  }

  /** Drop the detailed layout but keep cheap metrics (block scrolled offscreen). */
  dropDetailed(id: string): void {
    const e = this.map.get(id);
    if (e?.layout) e.layout = undefined;
  }

  invalidate(id: string): void {
    this.map.delete(id);
  }

  retain(liveIds: Set<string>): void {
    for (const id of this.map.keys()) {
      if (!liveIds.has(id)) this.map.delete(id);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
