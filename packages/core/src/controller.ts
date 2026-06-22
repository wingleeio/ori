import * as Y from "yjs";
import {
  DEFAULT_TYPOGRAPHY,
  caretForOffset,
  layoutBlock,
  lineHeightPx,
  lineIndexForOffset,
  offsetAtPoint,
  offsetAtXInLine,
  selectionRects,
  typographyKey,
  visualLineBounds,
  type BlockLayout,
  type InlineItem,
  type Marks,
  type Measurer,
  type Typography,
} from "@wingleeio/ori-pretext";
import { LayoutCache } from "./cache";
import {
  activeMarks as marksInRange,
  fullAttributes,
  intersectMarks,
  sliceTextPlain,
  textToInline,
  textToPlain,
  type AtomResolver,
} from "./delta";
import { Emitter } from "./emitter";
import { createSchema, type BlockNode, type EditorSchema } from "./nodes";
import {
  deleteRange,
  formatRange,
  insertBlockAfter,
  insertInlineEmbed,
  insertText,
  mergeWithPrevious,
  setBlockType,
  splitBlock,
} from "./operations";
import {
  blockAttrs,
  blockText,
  blockType,
  createNoteDoc,
  getBlocks,
  blockId as readBlockId,
  type BlockArray,
  type BlockMap,
  type BlockType,
} from "./schema";
import {
  caret,
  eqSelection,
  isCollapsed,
  orderedRange,
  position,
  wordBoundsAt,
  type Position,
  type Selection,
} from "./selection";
import { Virtualizer } from "./virtualizer";

/** Clip a block's inline items to the half-open offset range [from, to), re-based to 0. */
function clipInline(items: InlineItem[], from: number, to: number): InlineItem[] {
  const out: InlineItem[] = [];
  for (const it of items) {
    const itLen = it.atom ? 1 : it.text.length;
    const s = Math.max(from, it.start);
    const e = Math.min(to, it.start + itLen);
    if (s >= e) continue;
    if (it.atom) out.push({ ...it, start: s - from });
    else out.push({ text: it.text.slice(s - it.start, e - it.start), start: s - from, marks: it.marks });
  }
  return out;
}

export interface EditorOptions {
  /** Existing note document. A fresh one-paragraph doc is created if omitted. */
  doc?: Y.Doc;
  /** Text measurement backend (e.g. `createCanvasMeasurer()`). */
  measurer: Measurer;
  typography?: Typography;
  /** Initial content width in px (set later via {@link EditorController.setWidth}). */
  width?: number;
  /** Extra pixels rendered above & below the viewport. */
  overscan?: number;
  /** Vertical gap inserted above every block (except the first), in px. */
  blockSpacing?: number;
  /** Custom block/atom nodes, merged over the built-ins. */
  schema?: Partial<EditorSchema>;
}

export interface VisibleBlock {
  id: string;
  index: number;
  type: BlockType;
  /** Top edge of the block's slot in document space (px); its content starts
   * `spacing` px below this (the gap is the block's top margin). */
  top: number;
  /** Content height (px), excluding inter-block spacing. */
  height: number;
  /** Spacing (px) reserved above this block — the gap from the previous one
   * (0 for the first block). Rendered as the block's top margin. */
  spacing: number;
}

export interface EditorSnapshot {
  revision: number;
  totalHeight: number;
  width: number;
  blockCount: number;
  /** True when the note is a single empty block (drives placeholder UI). */
  empty: boolean;
  visible: VisibleBlock[];
  selection: Selection | null;
}

export interface CaretRect {
  x: number;
  y: number;
  height: number;
  blockId: string;
}

export interface SelectionRect {
  blockId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MoveDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "lineStart"
  | "lineEnd"
  | "docStart"
  | "docEnd";

/**
 * The framework-agnostic editor runtime. It is the single place where
 * `Y.Doc` (canonical state), Pretext (layout) and the {@link Virtualizer}
 * (windowing) meet. UI bindings subscribe via {@link subscribe} /
 * {@link getSnapshot} and call its imperative methods.
 */
export class EditorController {
  readonly doc: Y.Doc;
  private blocks: BlockArray;
  private measurer: Measurer;
  private typography: Typography;
  private schema: EditorSchema;
  private width: number;
  private overscan: number;
  private blockSpacing: number;

  private virtualizer: Virtualizer;
  private cache = new LayoutCache();
  private emitter = new Emitter();

  private versions = new Map<string, number>();
  private contentHeights = new Map<string, number>();
  private blockMap = new Map<string, BlockMap>();
  private textIndex = new Map<Y.Text, string>();

  private viewport = { scrollTop: 0, viewportHeight: 0 };
  /** Accumulated scroll compensation (px) from measurement; the host drains it
   *  via {@link takeScrollAdjust} and adds it to scrollTop. */
  private scrollAdjust = 0;
  private selection: Selection | null = null;
  private pendingMarks: Marks | null = null;
  private preferredX: number | null = null;

  private revision = 0;
  private cachedSnapshot: EditorSnapshot | null = null;
  private deepHandler: (events: Array<Y.YEvent<any>>) => void;
  private undoManager!: Y.UndoManager;
  private connected = false;

  constructor(options: EditorOptions) {
    this.doc = options.doc ?? createNoteDoc();
    this.blocks = getBlocks(this.doc);
    this.measurer = options.measurer;
    this.typography = options.typography ?? DEFAULT_TYPOGRAPHY;
    this.schema = createSchema(options.schema);
    this.width = options.width ?? 0;
    this.overscan = options.overscan ?? 800;
    this.blockSpacing = options.blockSpacing ?? 12;
    this.virtualizer = new Virtualizer(lineHeightPx(this.typography) + this.blockSpacing);

    this.reindex();
    const firstId = this.virtualizer.getOrder()[0];
    if (firstId) this.selection = caret(position(firstId, 0));

    this.deepHandler = (events) => this.onDeepChange(events);
    this.connect();
  }

  // ---------------------------------------------------------------------------
  // Subscription (designed for React's useSyncExternalStore)
  // ---------------------------------------------------------------------------

  subscribe = (fn: () => void): (() => void) => this.emitter.subscribe(fn);

  getSnapshot = (): EditorSnapshot => {
    if (this.cachedSnapshot) return this.cachedSnapshot;
    const win = this.virtualizer.window(
      this.viewport.scrollTop,
      this.viewport.viewportHeight,
      this.overscan,
    );
    const visible: VisibleBlock[] = win.items.map((it) => {
      const block = this.blockMap.get(it.id);
      return {
        id: it.id,
        index: it.index,
        type: block ? blockType(block) : "paragraph",
        top: it.top,
        // Measured content height; if a block somehow isn't measured yet, fall
        // back to the slot estimate minus its spacing so the view (which adds
        // spacing back as the top margin) can't double-count the gap.
        height: this.contentHeights.get(it.id) ?? Math.max(0, it.height - this.spacingFor(it.id)),
        spacing: this.spacingFor(it.id),
      };
    });
    const order = this.virtualizer.getOrder();
    const empty = order.length === 1 && this.lengthOf(order[0]) === 0;
    this.cachedSnapshot = {
      revision: this.revision,
      totalHeight: win.totalHeight,
      width: this.width,
      blockCount: this.virtualizer.count(),
      empty,
      visible,
      selection: this.selection,
    };
    return this.cachedSnapshot;
  };

  private notify(): void {
    this.cachedSnapshot = null;
    this.revision += 1;
    this.emitter.emit();
  }

  /**
   * (Re)subscribe to the document and (re)build the undo stack. Idempotent, and
   * safe to call again after {@link disconnect}. This is what lets the controller
   * survive React StrictMode's dev mount → unmount → remount cycle: the hosting
   * hook disconnects on the simulated unmount and reconnects on the remount,
   * reusing the same controller (and all its state) instead of a dead one.
   */
  connect(): void {
    if (this.connected) return;
    this.connected = true;
    this.blocks.observeDeep(this.deepHandler);
    this.undoManager = new Y.UndoManager(this.blocks, { captureTimeout: 250 });
  }

  /** Tear down document subscriptions but keep the controller reusable. */
  disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.blocks.unobserveDeep(this.deepHandler);
    this.undoManager.destroy();
  }

  /** Terminal teardown: disconnect, then drop UI subscribers. */
  destroy(): void {
    this.disconnect();
    this.emitter.clear();
  }

  undo(): void {
    if (this.connected) this.undoManager.undo();
  }

  redo(): void {
    if (this.connected) this.undoManager.redo();
  }

  // ---------------------------------------------------------------------------
  // Indexing & layout
  // ---------------------------------------------------------------------------

  private byId(id: string): BlockMap | undefined {
    return this.blockMap.get(id);
  }

  private indexOf = (id: string): number => this.virtualizer.indexOf(id);

  /**
   * Spacing reserved *above* a block — rendered as its top margin, so a heading
   * can claim a section break above itself while binding tightly to the body
   * below. The first block has no gap above it (the scroller's own padding is
   * the document's top inset), and suppressing it here also keeps the empty-doc
   * placeholder aligned with the caret.
   */
  private spacingFor(id: string): number {
    if (this.virtualizer.getOrder()[0] === id) return 0;
    return this.nodeFor(id).spacing ?? this.blockSpacing;
  }

  /** The node spec for a block (falls back to a plain text node). */
  private nodeFor(id: string): BlockNode {
    const block = this.byId(id);
    const type = block ? blockType(block) : "paragraph";
    return this.schema.blocks[type] ?? { type, text: true };
  }

  /** Effective typography for a text block, derived from its node. */
  private typographyFor(id: string): Typography {
    const node = this.nodeFor(id);
    return node.typography ? node.typography(this.typography) : this.typography;
  }

  private tKeyFor(id: string): string {
    const node = this.nodeFor(id);
    if (node.text) return typographyKey(this.typographyFor(id));
    // Atomic blocks invalidate on type + attrs (width is tracked separately).
    const block = this.byId(id);
    return `${node.type}|${block ? JSON.stringify(blockAttrs(block)) : ""}`;
  }

  /** Public access to a block type's resolved typography (for renderers). */
  getBlockTypography(type: BlockType): Typography {
    const node = this.schema.blocks[type];
    return node?.typography ? node.typography(this.typography) : this.typography;
  }

  private atomResolver(): AtomResolver {
    return { atoms: this.schema.atoms, typography: this.typography, measurer: this.measurer };
  }

  /** Lay out a block — text via Pretext, atomic via its node's `measure`. */
  private computeLayout(id: string, detailed: boolean): BlockLayout {
    const block = this.byId(id)!;
    const node = this.nodeFor(id);
    if (node.text) {
      const items = textToInline(blockText(block), this.atomResolver());
      // A block's CSS padding/border (code, quote) shifts its text in. Subtract
      // the horizontal inset from the wrap width and add the vertical inset to
      // the height so wrapping and virtualized height match the rendered DOM.
      const inset = node.inset;
      const wrapWidth =
        this.width > 0 && inset ? Math.max(1, this.width - inset.left - inset.right) : this.width;
      const layout = layoutBlock(items, {
        width: wrapWidth,
        typography: this.typographyFor(id),
        measurer: this.measurer,
        detailed,
      });
      if (inset && inset.top + inset.bottom > 0) {
        return { ...layout, height: layout.height + inset.top + inset.bottom };
      }
      return layout;
    }
    // Atomic block: one synthetic line. Its box height comes from the node;
    // the caret line keeps a normal height so it doesn't span the whole block.
    const lh = lineHeightPx(this.typography);
    const height = node.measure
      ? node.measure({ width: this.width, attrs: blockAttrs(block) })
      : lh;
    return {
      width: this.width,
      typographyKey: this.tKeyFor(id),
      height,
      lineCount: 1,
      length: 0,
      detailed,
      lines: [
        { index: 0, top: 0, height: lh, width: 0, start: 0, end: 0, hardBreak: false, fragments: [] },
      ],
    };
  }

  /** Rebuild order, id maps and the text→id index; remeasure as needed. */
  private reindex(): void {
    const ids: string[] = [];
    const live = new Set<string>();
    this.blockMap.clear();
    this.textIndex.clear();

    for (let i = 0; i < this.blocks.length; i += 1) {
      const block = this.blocks.get(i);
      const id = readBlockId(block);
      ids.push(id);
      live.add(id);
      this.blockMap.set(id, block);
      this.textIndex.set(blockText(block), id);
      if (!this.versions.has(id)) this.versions.set(id, 1);
    }

    this.virtualizer.setOrder(ids);
    this.cache.retain(live);

    // Re-apply the slot height for blocks we've already measured so a reorder
    // that flips a block's leading-gap suppression (spacing 0 ↔ blockSpacing)
    // stays exact; setHeight is a no-op when unchanged. We do NOT measure here:
    // unmeasured (and stale) blocks keep the virtualizer's estimate, and
    // measureViewport() measures just the visible ones. This keeps a structural
    // edit in a large note O(viewport) rather than re-measuring the whole doc.
    for (const id of ids) {
      const h = this.contentHeights.get(id);
      if (h !== undefined) this.virtualizer.setHeight(id, h + this.spacingFor(id));
    }
    this.measureViewport();

    for (const id of [...this.versions.keys()]) {
      if (!live.has(id)) {
        this.versions.delete(id);
        this.contentHeights.delete(id);
      }
    }

    this.clampSelection(live);
  }

  private clampSelection(live: Set<string>): void {
    const sel = this.selection;
    if (!sel) return;
    const order = this.virtualizer.getOrder();
    const fix = (p: Position): Position => {
      if (live.has(p.blockId)) {
        const block = this.byId(p.blockId);
        const len = block ? blockText(block).length : 0;
        return position(p.blockId, Math.min(p.offset, len));
      }
      const fallback = order[order.length - 1] ?? order[0];
      const block = fallback ? this.byId(fallback) : undefined;
      return position(fallback ?? "", block ? blockText(block).length : 0);
    };
    this.selection = { anchor: fix(sel.anchor), focus: fix(sel.focus) };
  }

  /** Cheap height-only measurement for a block. */
  private measure(id: string): void {
    if (!this.byId(id)) return;
    const layout = this.computeLayout(id, false);
    this.cache.set(id, {
      version: this.versions.get(id) ?? 1,
      width: this.width,
      typographyKey: this.tKeyFor(id),
      height: layout.height,
      lineCount: layout.lineCount,
    });
    this.contentHeights.set(id, layout.height);
    this.virtualizer.setHeight(id, layout.height + this.spacingFor(id));
  }

  /** Full detailed layout (fragments + geometry) for a visible block. */
  getLayout(id: string): BlockLayout | null {
    const block = this.byId(id);
    if (!block) return null;
    const version = this.versions.get(id) ?? 1;
    if (this.cache.hasDetailed(id, version, this.width, this.tKeyFor(id))) {
      return this.cache.get(id)!.layout!;
    }
    const layout = this.computeLayout(id, true);
    this.cache.set(id, {
      version,
      width: this.width,
      typographyKey: this.tKeyFor(id),
      height: layout.height,
      lineCount: layout.lineCount,
      layout,
    });
    this.contentHeights.set(id, layout.height);
    this.virtualizer.setHeight(id, layout.height + this.spacingFor(id));
    return layout;
  }

  private bump(id: string): void {
    this.versions.set(id, (this.versions.get(id) ?? 1) + 1);
  }

  private onDeepChange(events: Array<Y.YEvent<any>>): void {
    let structural = false;
    const changed = new Set<string>();
    for (const e of events) {
      const target = e.target;
      if (target === this.blocks) {
        structural = true;
        continue;
      }
      // A block's own text has a fast path via the text→id index.
      if (target instanceof Y.Text) {
        const id = this.textIndex.get(target);
        if (id) {
          changed.add(id);
          continue;
        }
      }
      // Anything else nested in a block (its `attrs`, or a Y.Map / Y.Array /
      // Y.Text nested arbitrarily deep within) reports that inner type as the
      // target; walk up to the OWNING BLOCK — the Y.Map that is a direct child of
      // the blocks array — so it re-measures/re-renders. (Keying on the first
      // nested map with an "id" would stop at a nested entity's own id, not the
      // block's.)
      let node: unknown = target;
      while (node instanceof Y.AbstractType) {
        if (node.parent === this.blocks && node instanceof Y.Map) {
          const id = node.get("id") as string | undefined;
          if (id) changed.add(id);
          break;
        }
        node = node.parent;
      }
    }
    if (structural) this.reindex();
    for (const id of changed) {
      this.bump(id);
      this.measure(id);
    }
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Viewport / typography
  // ---------------------------------------------------------------------------

  setViewport(scrollTop: number, viewportHeight: number): void {
    if (this.viewport.scrollTop === scrollTop && this.viewport.viewportHeight === viewportHeight) {
      return;
    }
    this.viewport = { scrollTop, viewportHeight };
    this.measureViewport();
    this.notify();
  }

  setWidth(width: number): void {
    if (width === this.width || width <= 0) return;
    this.width = width;
    // Every cached height is stale at the new width; drop the cache and
    // re-measure lazily. Off-screen blocks keep their prior height as an
    // estimate until they scroll back into the window.
    this.cache.clear();
    this.measureViewport();
    this.notify();
  }

  /**
   * Measure the blocks in (and within `overscan` of) the viewport that aren't
   * already valid at the current width. Measurement is lazy: off-screen blocks
   * keep the virtualizer's height estimate until they scroll near, so opening a
   * large note costs O(viewport), not O(blocks). Because the overscan window
   * extends beyond the visible area, a block is measured before it scrolls
   * on-screen, so heights resolve off-screen and the visible content never
   * jumps; only the scrollbar refines as estimates become exact.
   */
  private measureViewport(): void {
    if (this.width <= 0 || this.virtualizer.count() === 0) return;
    this.withScrollAnchor(() => {
      // Measuring a block changes its height, shifting which blocks the window
      // covers — so iterate to a fixed point. This is monotonic (a measured
      // block never reverts), so it converges; the loop is bounded by how many
      // times the window can grow. The cap is generous so even a viewport full
      // of blocks far shorter than the estimate (each pass reveals many more)
      // still fully resolves rather than leaving visible tail blocks on an
      // estimate.
      for (let pass = 0; pass < 24; pass += 1) {
        const win = this.virtualizer.window(
          this.viewport.scrollTop,
          this.viewport.viewportHeight,
          this.overscan,
        );
        let measuredAny = false;
        for (const it of win.items) {
          if (!this.cache.isValid(it.id, this.versions.get(it.id) ?? 1, this.width, this.tKeyFor(it.id))) {
            this.measure(it.id);
            measuredAny = true;
          }
        }
        if (!measuredAny) break;
      }
    });
  }

  /**
   * Run a measurement batch while keeping the block at the viewport's top edge
   * pinned: measuring blocks above it shifts its document-space top, so the net
   * shift is accumulated into {@link scrollAdjust} for the host to add to its
   * scrollTop. Model-based (not DOM-based), so it stays correct even when the
   * anchor block isn't currently mounted.
   */
  private withScrollAnchor(fn: () => void): void {
    const scrollTop = this.viewport.scrollTop;
    const anchorId = scrollTop > 0 ? this.virtualizer.blockAt(scrollTop) : null;
    const before = anchorId ? this.virtualizer.topOf(anchorId) : 0;
    fn();
    if (anchorId) this.scrollAdjust += this.virtualizer.topOf(anchorId) - before;
  }

  /** Drain the scroll compensation accumulated since the last call (px). */
  takeScrollAdjust(): number {
    const a = this.scrollAdjust;
    this.scrollAdjust = 0;
    return a;
  }

  /**
   * Measure up to `budget` not-yet-measured blocks (in document order), for a
   * host to drive from idle time after the first paint. Lazy measurement makes
   * the first paint O(viewport), but leaves total height an estimate; running
   * this to completion makes the scrollbar and scroll-to-bottom exact without
   * blocking open. Scroll-anchoring in the view keeps the content from jumping
   * as these resolve. Returns true while blocks remain unmeasured.
   */
  measurePending(budget = 200): boolean {
    if (this.width <= 0) return false;
    let measured = 0;
    let more = false;
    this.withScrollAnchor(() => {
      for (const id of this.virtualizer.getOrder()) {
        if (this.cache.isValid(id, this.versions.get(id) ?? 1, this.width, this.tKeyFor(id))) continue;
        if (measured >= budget) {
          more = true;
          return;
        }
        this.measure(id);
        measured += 1;
      }
    });
    if (measured > 0) this.notify();
    return more;
  }

  setTypography(typography: Typography): void {
    this.typography = typography;
    this.measurer.clear?.();
    this.cache.clear();
    for (const id of this.virtualizer.getOrder()) this.measure(id);
    this.notify();
  }

  getTypography(): Typography {
    return this.typography;
  }

  /** Call after web fonts finish loading so cached widths are recomputed. */
  invalidateMeasurements(): void {
    this.measurer.clear?.();
    this.cache.clear();
    for (const id of this.virtualizer.getOrder()) this.measure(id);
    this.notify();
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers (document space)
  // ---------------------------------------------------------------------------

  topOf(id: string): number {
    return this.virtualizer.topOf(id);
  }

  /** The block's content inset (px), or zero. */
  private insetOf(id: string): { top: number; right: number; bottom: number; left: number } {
    return this.nodeFor(id).inset ?? { top: 0, right: 0, bottom: 0, left: 0 };
  }

  /**
   * Document-space y where a block's *content* starts. A block's slot is its
   * spacing (the gap above it) plus its content height, so the content sits
   * `spacingFor(id)` px below the slot top that {@link topOf} returns; an inset
   * block's padding pushes it `inset.top` further. Pretext geometry is
   * block-relative, so callers must offset by this, not `topOf`.
   */
  private contentTopOf(id: string): number {
    return this.virtualizer.topOf(id) + this.spacingFor(id) + this.insetOf(id).top;
  }

  positionFromPoint(xContent: number, yDoc: number): Position | null {
    const id = this.virtualizer.blockAt(yDoc);
    if (!id) return null;
    const layout = this.getLayout(id);
    if (!layout) return null;
    // A point in the block's top gap yields a negative local y; offsetAtPoint
    // clamps it to the first line, placing the caret at the nearest content.
    // Both axes are shifted in by the inset (content starts at inset.left/.top).
    const offset = offsetAtPoint(
      layout,
      xContent - this.insetOf(id).left,
      yDoc - this.contentTopOf(id),
      this.measurer,
    );
    return position(id, offset);
  }

  caretRect(): CaretRect | null {
    const sel = this.selection;
    if (!sel) return null;
    const layout = this.getLayout(sel.focus.blockId);
    if (!layout) return null;
    const c = caretForOffset(layout, sel.focus.offset, this.measurer);
    const top = this.contentTopOf(sel.focus.blockId);
    const left = this.insetOf(sel.focus.blockId).left;
    return { x: c.x + left, y: top + c.y, height: c.height, blockId: sel.focus.blockId };
  }

  /** Selection rectangles for visible blocks only (document space). */
  selectionRectsForViewport(): SelectionRect[] {
    const sel = this.selection;
    if (!sel || isCollapsed(sel)) return [];
    const { start, end } = orderedRange(sel, this.indexOf);
    const startIdx = this.indexOf(start.blockId);
    const endIdx = this.indexOf(end.blockId);
    const win = this.virtualizer.window(
      this.viewport.scrollTop,
      this.viewport.viewportHeight,
      this.overscan,
    );
    const out: SelectionRect[] = [];
    for (const it of win.items) {
      if (it.index < startIdx || it.index > endIdx) continue;
      const layout = this.getLayout(it.id);
      if (!layout) continue;
      const from = it.id === start.blockId ? start.offset : 0;
      const to = it.id === end.blockId ? end.offset : layout.length;
      const top = this.contentTopOf(it.id);
      const left = this.insetOf(it.id).left;
      for (const r of selectionRects(layout, from, to, this.measurer)) {
        out.push({ blockId: it.id, x: r.x + left, y: r.y + top, width: r.width, height: r.height });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  getSelection(): Selection | null {
    return this.selection;
  }

  /** The current selection ordered `{ start, end }` in document order, or null. */
  orderedSelection(): { start: Position; end: Position } | null {
    if (!this.selection) return null;
    const order = this.virtualizer.getOrder();
    return orderedRange(this.selection, (id) => order.indexOf(id));
  }

  setSelection(sel: Selection | null, opts?: { keepPreferredX?: boolean }): void {
    if (eqSelection(this.selection, sel)) return;
    this.selection = sel;
    this.pendingMarks = null;
    if (!opts?.keepPreferredX) this.preferredX = null;
    this.notify();
  }

  collapse(pos: Position): void {
    this.setSelection(caret(pos));
  }

  selectAll(): void {
    const order = this.virtualizer.getOrder();
    if (order.length === 0) return;
    const first = order[0];
    const last = order[order.length - 1];
    const lastBlock = this.byId(last);
    const len = lastBlock ? blockText(lastBlock).length : 0;
    this.setSelection({ anchor: position(first, 0), focus: position(last, len) });
  }

  /** Select the word (or punctuation/atom cluster) at a position — double-tap. */
  selectWordAt(pos: Position): void {
    const { start, end } = wordBoundsAt(this.getBlockText(pos.blockId), pos.offset);
    this.setSelection({
      anchor: position(pos.blockId, start),
      focus: position(pos.blockId, end),
    });
  }

  /** Select a whole block's text — triple-tap. */
  selectBlockAt(pos: Position): void {
    this.setSelection({
      anchor: position(pos.blockId, 0),
      focus: position(pos.blockId, this.lengthOf(pos.blockId)),
    });
  }

  private lengthOf(id: string): number {
    const block = this.byId(id);
    return block ? blockText(block).length : 0;
  }

  /** The plain text of a block (O(1) lookup; embeds become one placeholder char). */
  getBlockText(id: string): string {
    const block = this.byId(id);
    return block ? textToPlain(blockText(block)) : "";
  }

  /** All block ids in document order. */
  blockIds(): string[] {
    return [...this.virtualizer.getOrder()];
  }

  /** A block's type (paragraph/heading/… or a custom type). */
  getBlockType(id: string): BlockType {
    const block = this.byId(id);
    return block ? blockType(block) : "paragraph";
  }

  /** A block's pre-wrap inline runs + atoms (for contentEditable rendering). */
  getInline(id: string): InlineItem[] {
    const block = this.byId(id);
    return block ? textToInline(blockText(block), this.atomResolver()) : [];
  }

  /**
   * The current selection's content as `{ type, items }` per spanned block — the
   * block type plus its inline runs, clipped to the selection's start/end offsets.
   * Used to put styled content on the clipboard so marks *and* block types survive
   * copy/paste. Empty if nothing is selected.
   */
  getSelectionBlocks(): { type: BlockType; items: InlineItem[] }[] {
    const sel = this.selection;
    if (!sel || isCollapsed(sel)) return [];
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const si = this.indexOf(start.blockId);
    const ei = this.indexOf(end.blockId);
    const out: { type: BlockType; items: InlineItem[] }[] = [];
    for (let i = si; i <= ei; i += 1) {
      const id = order[i];
      const items = this.getInline(id);
      const len = blockText(this.byId(id)!).length;
      const from = i === si ? start.offset : 0;
      const to = i === ei ? end.offset : len;
      out.push({ type: this.getBlockType(id), items: clipInline(items, from, to) });
    }
    return out;
  }

  /**
   * The selection's content as inline runs, one array per spanned block. A
   * type-less view of {@link getSelectionBlocks}.
   */
  getSelectionInline(): InlineItem[][] {
    return this.getSelectionBlocks().map((b) => b.items);
  }

  /** A block's `attrs` as a plain object (for custom block renderers). */
  getBlockAttrs(id: string): Record<string, unknown> {
    const block = this.byId(id);
    return block ? blockAttrs(block) : {};
  }

  /** Plain text of the current selection (blocks joined by newlines). */
  getSelectedText(): string {
    const sel = this.selection;
    if (!sel || isCollapsed(sel)) return "";
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const si = this.indexOf(start.blockId);
    const ei = this.indexOf(end.blockId);
    let out = "";
    for (let i = si; i <= ei; i += 1) {
      const block = this.byId(order[i]);
      if (!block) continue;
      const text = blockText(block);
      const from = i === si ? start.offset : 0;
      const to = i === ei ? end.offset : text.length;
      out += sliceTextPlain(text, from, to);
      if (i < ei) out += "\n";
    }
    return out;
  }

  /** Compute a new focus position for an arrow-key move. */
  private computeMove(focus: Position, dir: MoveDirection): { pos: Position; preferX: boolean } {
    const order = this.virtualizer.getOrder();
    const idx = this.indexOf(focus.blockId);

    switch (dir) {
      case "left": {
        if (focus.offset > 0) return { pos: position(focus.blockId, focus.offset - 1), preferX: false };
        if (idx > 0) {
          const prev = order[idx - 1];
          return { pos: position(prev, this.lengthOf(prev)), preferX: false };
        }
        return { pos: focus, preferX: false };
      }
      case "right": {
        if (focus.offset < this.lengthOf(focus.blockId)) {
          return { pos: position(focus.blockId, focus.offset + 1), preferX: false };
        }
        if (idx < order.length - 1) return { pos: position(order[idx + 1], 0), preferX: false };
        return { pos: focus, preferX: false };
      }
      case "lineStart": {
        const layout = this.getLayout(focus.blockId);
        if (!layout) return { pos: focus, preferX: false };
        return { pos: position(focus.blockId, visualLineBounds(layout, focus.offset).start), preferX: false };
      }
      case "lineEnd": {
        const layout = this.getLayout(focus.blockId);
        if (!layout) return { pos: focus, preferX: false };
        return { pos: position(focus.blockId, visualLineBounds(layout, focus.offset).end), preferX: false };
      }
      case "docStart":
        return { pos: position(order[0], 0), preferX: false };
      case "docEnd": {
        const last = order[order.length - 1];
        return { pos: position(last, this.lengthOf(last)), preferX: false };
      }
      case "up":
      case "down": {
        const layout = this.getLayout(focus.blockId);
        if (!layout) return { pos: focus, preferX: true };
        const c = caretForOffset(layout, focus.offset, this.measurer);
        const x = this.preferredX ?? c.x;
        const lineIdx = lineIndexForOffset(layout, focus.offset);

        if (dir === "up") {
          if (lineIdx > 0) {
            const off = offsetAtXInLine(layout, lineIdx - 1, x, this.measurer);
            this.preferredX = x;
            return { pos: position(focus.blockId, off), preferX: true };
          }
          if (idx > 0) {
            const prev = order[idx - 1];
            const prevLayout = this.getLayout(prev);
            if (prevLayout) {
              const off = offsetAtXInLine(prevLayout, prevLayout.lineCount - 1, x, this.measurer);
              this.preferredX = x;
              return { pos: position(prev, off), preferX: true };
            }
          }
          this.preferredX = x;
          return { pos: position(focus.blockId, 0), preferX: true };
        }
        // down
        if (lineIdx < layout.lineCount - 1) {
          const off = offsetAtXInLine(layout, lineIdx + 1, x, this.measurer);
          this.preferredX = x;
          return { pos: position(focus.blockId, off), preferX: true };
        }
        if (idx < order.length - 1) {
          const next = order[idx + 1];
          const nextLayout = this.getLayout(next);
          if (nextLayout) {
            const off = offsetAtXInLine(nextLayout, 0, x, this.measurer);
            this.preferredX = x;
            return { pos: position(next, off), preferX: true };
          }
        }
        this.preferredX = x;
        return { pos: position(focus.blockId, this.lengthOf(focus.blockId)), preferX: true };
      }
      default:
        return { pos: focus, preferX: false };
    }
  }

  moveCaret(dir: MoveDirection, extend = false): void {
    const sel = this.selection;
    if (!sel) return;

    // Collapsing a non-extended horizontal move onto the selection edge.
    if (!extend && !isCollapsed(sel) && (dir === "left" || dir === "right")) {
      const { start, end } = orderedRange(sel, this.indexOf);
      this.setSelection(caret(dir === "left" ? start : end));
      return;
    }

    const { pos, preferX } = this.computeMove(sel.focus, dir);
    const next: Selection = extend ? { anchor: sel.anchor, focus: pos } : caret(pos);
    if (preferX) {
      if (eqSelection(this.selection, next)) {
        this.notify();
        return;
      }
      this.selection = next;
      this.pendingMarks = null;
      this.notify();
    } else {
      this.setSelection(next);
    }
  }

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  private collapsedStart(): Position {
    const sel = this.selection ?? caret(position(this.virtualizer.getOrder()[0] ?? "", 0));
    if (isCollapsed(sel)) return sel.focus;
    return this.deleteSelectedRange();
  }

  /**
   * Ensure an insertion point lies in a text block. An atomic block's `Y.Text`
   * isn't rendered, so text typed/pasted while the caret sits on one would vanish
   * — instead, drop a fresh paragraph right after it and insert there.
   */
  private textInsertionPoint(pos: Position): Position {
    if (this.nodeFor(pos.blockId).text) return pos;
    return insertBlockAfter(this.doc, this.blocks, pos.blockId, "paragraph");
  }

  insertText(text: string): void {
    if (text.length === 0) return;
    const startPos = this.textInsertionPoint(this.collapsedStart());
    const block = this.byId(startPos.blockId);
    const base = block ? marksInRange(blockText(block), startPos.offset, startPos.offset) : {};
    const effective = this.pendingMarks ?? base;
    const after = insertText(this.doc, this.blocks, startPos, text, fullAttributes(effective));
    this.setSelection(caret(after));
  }

  insertParagraphBreak(): void {
    const startPos = this.collapsedStart();
    const after = splitBlock(this.doc, this.blocks, startPos.blockId, startPos.offset);
    this.setSelection(caret(after));
  }

  /**
   * Insert a soft line break — a newline *within* the block (the multi-line
   * affordance for code blocks). The view renders the `\n` as a `<br>` plus a
   * filler `<br>` for a trailing newline, so the caret lands on the new line.
   * Replaces any selected range first.
   */
  insertSoftBreak(): void {
    const sel = this.selection;
    if (sel && !isCollapsed(sel)) this.deleteBackward();
    this.insertText("\n");
  }

  /** Insert a new block (typically a custom atomic node) after the selection. */
  insertBlockAfterSelection(type: BlockType, attrs?: Record<string, unknown>): void {
    const order = this.virtualizer.getOrder();
    const afterId = this.selection?.focus.blockId ?? order[order.length - 1];
    if (!afterId) return;
    const after = insertBlockAfter(this.doc, this.blocks, afterId, type, attrs);
    this.setSelection(caret(after));
  }

  /** Insert an inline atom (custom embed) at the current selection. */
  insertInlineAtom(embed: Record<string, unknown>): void {
    const startPos = this.collapsedStart();
    const after = insertInlineEmbed(this.doc, this.blocks, startPos, embed);
    this.setSelection(caret(after));
  }

  /**
   * Insert a sequence of styled runs / atoms at the caret, advancing as it goes.
   * The counterpart to {@link getSelectionInline} — used to restore marked
   * content on paste. Each run keeps its own marks (independent of pending marks).
   */
  insertInline(items: InlineItem[]): void {
    for (const item of items) {
      const startPos = this.textInsertionPoint(this.collapsedStart());
      if (item.atom) {
        const embed = (item.atom.data as Record<string, unknown>) ?? { type: item.atom.type };
        this.setSelection(caret(insertInlineEmbed(this.doc, this.blocks, startPos, embed)));
      } else if (item.text) {
        const after = insertText(this.doc, this.blocks, startPos, item.text, fullAttributes(item.marks ?? {}));
        this.setSelection(caret(after));
      }
    }
    this.pendingMarks = null;
  }

  /**
   * Delete the (non-collapsed) selection. Leading atomic blocks are removed
   * first so {@link deleteRange} starts on a text block — otherwise it would
   * merge the range's tail into an atomic block's hidden Y.Text, hiding it.
   */
  private deleteSelectedRange(): Position {
    let { start, end } = orderedRange(this.selection!, this.indexOf);
    while (start.blockId !== end.blockId && !this.nodeFor(start.blockId).text) {
      const next = this.virtualizer.getOrder()[this.indexOf(start.blockId) + 1];
      this.deleteBlock(start.blockId);
      start = position(next, 0);
    }
    // The whole multi-block selection reduced to a single atomic block: it spanned
    // over that block, so remove it too (deleteRange would no-op on its empty,
    // unrenderable Y.Text) and land the caret on an adjacent text position.
    if (start.blockId === end.blockId && !this.nodeFor(start.blockId).text) {
      const order = this.virtualizer.getOrder();
      const idx = this.indexOf(start.blockId);
      const prev = order[idx - 1];
      const next = order[idx + 1];
      if (!prev && !next) {
        // It was the only block — leave an empty paragraph so the doc isn't empty.
        const para = insertBlockAfter(this.doc, this.blocks, start.blockId, "paragraph");
        this.deleteBlock(start.blockId);
        return para;
      }
      this.deleteBlock(start.blockId);
      return prev ? position(prev, this.lengthOf(prev)) : position(next, 0);
    }
    return deleteRange(this.doc, this.blocks, start, end);
  }

  deleteBackward(): void {
    const sel = this.selection;
    if (!sel) return;
    if (!isCollapsed(sel)) {
      this.setSelection(caret(this.deleteSelectedRange()));
      return;
    }
    const pos = sel.focus;
    const order = this.virtualizer.getOrder();
    const idx = this.indexOf(pos.blockId);
    // Caret on an atomic (non-text) block — Backspace removes the block itself.
    if (idx >= 0 && !this.nodeFor(pos.blockId).text && order.length > 1) {
      const prev = order[idx - 1];
      this.deleteBlock(pos.blockId);
      this.setSelection(
        caret(prev ? position(prev, this.lengthOf(prev)) : position(order[idx + 1], 0)),
      );
      return;
    }
    if (pos.offset > 0) {
      const after = deleteRange(
        this.doc,
        this.blocks,
        position(pos.blockId, pos.offset - 1),
        pos,
      );
      this.setSelection(caret(after));
      return;
    }
    const prevId = order[idx - 1];
    if (prevId && !this.nodeFor(prevId).text) {
      // The previous block is atomic (divider/image): delete it rather than
      // merging this block's text into its hidden Y.Text, which would make the
      // text disappear. Backspace at a block start removes the divider above it.
      this.deleteBlock(prevId);
      this.setSelection(caret(position(pos.blockId, 0)));
      return;
    }
    const merged = mergeWithPrevious(this.doc, this.blocks, pos.blockId);
    if (merged) this.setSelection(caret(merged));
  }

  deleteForward(): void {
    const sel = this.selection;
    if (!sel) return;
    if (!isCollapsed(sel)) {
      this.setSelection(caret(this.deleteSelectedRange()));
      return;
    }
    const pos = sel.focus;
    const order = this.virtualizer.getOrder();
    const idx = this.indexOf(pos.blockId);
    // Caret on an atomic block — Delete removes the block itself.
    if (idx >= 0 && !this.nodeFor(pos.blockId).text && order.length > 1) {
      const next = order[idx + 1];
      this.deleteBlock(pos.blockId);
      this.setSelection(
        caret(next ? position(next, 0) : position(order[idx - 1], this.lengthOf(order[idx - 1]))),
      );
      return;
    }
    const len = this.lengthOf(pos.blockId);
    if (pos.offset < len) {
      deleteRange(this.doc, this.blocks, pos, position(pos.blockId, pos.offset + 1));
      this.setSelection(caret(pos));
      return;
    }
    const next = order[idx + 1];
    if (!next) return;
    if (!this.nodeFor(next).text) {
      // The next block is atomic: delete it instead of merging it into this one
      // (which would append its empty hidden text and leave a stray block).
      this.deleteBlock(next);
      this.setSelection(caret(pos));
      return;
    }
    mergeWithPrevious(this.doc, this.blocks, next);
    this.setSelection(caret(pos));
  }

  /** Remove a block entirely (used to delete atomic blocks like dividers). */
  private deleteBlock(id: string): void {
    const idx = this.indexOf(id);
    if (idx < 0) return;
    this.doc.transact(() => this.blocks.delete(idx, 1));
  }

  // ---------------------------------------------------------------------------
  // Inline marks & block types
  // ---------------------------------------------------------------------------

  /** True when a mark has been staged for the next insertion at a collapsed
   *  caret (a toggle with no selection) but not yet written into any text. */
  hasPendingMarks(): boolean {
    return this.pendingMarks != null;
  }

  getActiveMarks(): Marks {
    const sel = this.selection;
    if (!sel) return {};
    if (isCollapsed(sel)) {
      if (this.pendingMarks) return this.pendingMarks;
      const block = this.byId(sel.focus.blockId);
      return block ? marksInRange(blockText(block), sel.focus.offset, sel.focus.offset) : {};
    }
    // A mark is "active" only if EVERY character in the selection carries it —
    // so toggling a mixed-mark range applies it (rather than removing it, which
    // checking only the first block would wrongly do). Intersect across blocks.
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const startIdx = this.indexOf(start.blockId);
    const endIdx = this.indexOf(end.blockId);
    let common: Marks | null = null;
    for (let i = startIdx; i <= endIdx; i += 1) {
      const block = this.byId(order[i]);
      if (!block) continue;
      const text = blockText(block);
      const from = i === startIdx ? start.offset : 0;
      const to = i === endIdx ? end.offset : text.length;
      if (to <= from) continue; // empty sub-range (e.g. selection ends at offset 0)
      const m = marksInRange(text, from, to);
      common = common === null ? m : intersectMarks(common, m);
    }
    return common ?? {};
  }

  toggleMark(mark: "bold" | "italic" | "code" | "underline" | "strike"): void {
    const sel = this.selection;
    if (!sel) return;
    if (isCollapsed(sel)) {
      const block = this.byId(sel.focus.blockId);
      const base = block ? marksInRange(blockText(block), sel.focus.offset, sel.focus.offset) : {};
      const current = this.pendingMarks ?? { ...base };
      this.pendingMarks = { ...current, [mark]: !current[mark] };
      this.notify();
      return;
    }
    const active = this.getActiveMarks();
    const { start, end } = orderedRange(sel, this.indexOf);
    formatRange(this.doc, this.blocks, start, end, mark, active[mark] ? null : true);
  }

  /**
   * If the caret sits in an EMPTY, non-paragraph *text* block (heading, quote,
   * code, …), reset it to a paragraph. The view calls this after a deletion so
   * that clearing all of a heading's text drops the heading style instead of
   * leaving an empty heading — especially when it's the only/first block and
   * there's nothing to merge into. No-op for paragraphs, atomic/custom (non-text)
   * blocks, or non-empty blocks. Returns whether it changed the type.
   */
  demoteEmptyBlock(): boolean {
    const sel = this.selection;
    if (!sel) return false;
    const id = sel.focus.blockId;
    const block = this.byId(id);
    if (!block) return false;
    if (blockType(block) === "paragraph") return false;
    if (!this.nodeFor(id).text) return false; // atomic/custom node, not editable text
    if (blockText(block).length !== 0) return false;
    setBlockType(this.doc, this.blocks, id, "paragraph");
    return true;
  }

  setBlockTypeAtSelection(type: BlockType): void {
    const sel = this.selection;
    if (!sel) return;
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const si = this.indexOf(start.blockId);
    const ei = this.indexOf(end.blockId);
    for (let i = si; i <= ei; i += 1) {
      setBlockType(this.doc, this.blocks, order[i], type);
    }
  }

  blockTypeAtSelection(): BlockType | null {
    const sel = this.selection;
    if (!sel) return null;
    const block = this.byId(sel.focus.blockId);
    return block ? blockType(block) : null;
  }
}
