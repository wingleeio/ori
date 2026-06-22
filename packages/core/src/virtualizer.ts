/**
 * Block virtualizer. Owns an ordered list of block ids and their pixel heights,
 * and answers: total height, y-position of a block, and which blocks intersect
 * a scroll viewport. Heights come from Pretext; this class knows nothing about
 * text or the DOM.
 */

export interface VirtualItem {
  id: string;
  index: number;
  /** Top edge of the block's slot in document space (px). When spacing is the
   * block's top margin, its content starts that many px below this edge. */
  top: number;
  /** Slot height including inter-block spacing (px). */
  height: number;
}

export interface VirtualWindow {
  totalHeight: number;
  startIndex: number;
  endIndex: number;
  items: VirtualItem[];
}

export class Virtualizer {
  private order: string[] = [];
  private heights = new Map<string, number>();
  /** Prefix offsets: `tops[i]` is the top of block `i`; `tops[n]` is total. */
  private tops: number[] = [0];
  private dirty = true;
  private defaultHeight: number;

  constructor(defaultHeight = 32) {
    this.defaultHeight = defaultHeight;
  }

  setOrder(ids: string[]): void {
    this.order = ids;
    // Drop heights for blocks that no longer exist.
    if (this.heights.size > ids.length) {
      const live = new Set(ids);
      for (const id of this.heights.keys()) {
        if (!live.has(id)) this.heights.delete(id);
      }
    }
    this.dirty = true;
  }

  getOrder(): readonly string[] {
    return this.order;
  }

  count(): number {
    return this.order.length;
  }

  indexOf(id: string): number {
    return this.order.indexOf(id);
  }

  /** Returns true when the height actually changed. */
  setHeight(id: string, height: number): boolean {
    const prev = this.heights.get(id);
    if (prev === height) return false;
    this.heights.set(id, height);
    this.dirty = true;
    return true;
  }

  getHeight(id: string): number {
    return this.heights.get(id) ?? this.defaultHeight;
  }

  private rebuild(): void {
    const n = this.order.length;
    const tops = new Array<number>(n + 1);
    tops[0] = 0;
    for (let i = 0; i < n; i += 1) {
      tops[i + 1] = tops[i] + (this.heights.get(this.order[i]) ?? this.defaultHeight);
    }
    this.tops = tops;
    this.dirty = false;
  }

  private ensure(): void {
    if (this.dirty) this.rebuild();
  }

  totalHeight(): number {
    this.ensure();
    return this.tops[this.tops.length - 1];
  }

  topOf(id: string): number {
    this.ensure();
    const i = this.order.indexOf(id);
    return i < 0 ? 0 : this.tops[i];
  }

  /** Lowest index whose bottom edge is greater than `y` (binary search). */
  private indexAtOffset(y: number): number {
    this.ensure();
    const tops = this.tops;
    let lo = 0;
    let hi = this.order.length - 1;
    if (hi < 0) return 0;
    let ans = hi;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid + 1] > y) {
        ans = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return ans;
  }

  /** Block whose slot contains document-space `y`. */
  blockAt(y: number): string | null {
    if (this.order.length === 0) return null;
    return this.order[this.indexAtOffset(y)];
  }

  /** Compute the visible window for a viewport, padded by `overscan` px. */
  window(scrollTop: number, viewportHeight: number, overscan = 600): VirtualWindow {
    this.ensure();
    const n = this.order.length;
    if (n === 0) {
      return { totalHeight: 0, startIndex: 0, endIndex: -1, items: [] };
    }
    const top = Math.max(0, scrollTop - overscan);
    const bottom = scrollTop + viewportHeight + overscan;

    const startIndex = this.indexAtOffset(top);
    let endIndex = startIndex;
    const items: VirtualItem[] = [];
    for (let i = startIndex; i < n; i += 1) {
      const itemTop = this.tops[i];
      if (itemTop >= bottom) break;
      items.push({
        id: this.order[i],
        index: i,
        top: itemTop,
        height: this.tops[i + 1] - itemTop,
      });
      endIndex = i;
    }
    return {
      totalHeight: this.tops[n],
      startIndex,
      endIndex,
      items,
    };
  }
}
