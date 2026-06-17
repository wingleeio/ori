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
  type Marks,
  type Measurer,
  type Typography,
} from "@wingleeio/ori-pretext";
import { LayoutCache } from "./cache";
import {
  activeMarks as marksInRange,
  fullAttributes,
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
  type Position,
  type Selection,
} from "./selection";
import { Virtualizer } from "./virtualizer";

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
  /** Vertical gap inserted below every block, in px. */
  blockSpacing?: number;
  /** Custom block/atom nodes, merged over the built-ins. */
  schema?: Partial<EditorSchema>;
}

export interface VisibleBlock {
  id: string;
  index: number;
  type: BlockType;
  /** Top edge in document space (px). */
  top: number;
  /** Content height (px), excluding inter-block spacing. */
  height: number;
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
  private selection: Selection | null = null;
  private pendingMarks: Marks | null = null;
  private preferredX: number | null = null;

  private revision = 0;
  private cachedSnapshot: EditorSnapshot | null = null;
  private deepHandler: (events: Array<Y.YEvent<any>>) => void;
  private undoManager: Y.UndoManager;

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
    this.blocks.observeDeep(this.deepHandler);
    this.undoManager = new Y.UndoManager(this.blocks, { captureTimeout: 250 });
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
        height: this.contentHeights.get(it.id) ?? it.height,
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

  destroy(): void {
    this.blocks.unobserveDeep(this.deepHandler);
    this.undoManager.destroy();
    this.emitter.clear();
  }

  undo(): void {
    this.undoManager.undo();
  }

  redo(): void {
    this.undoManager.redo();
  }

  // ---------------------------------------------------------------------------
  // Indexing & layout
  // ---------------------------------------------------------------------------

  private byId(id: string): BlockMap | undefined {
    return this.blockMap.get(id);
  }

  private indexOf = (id: string): number => this.virtualizer.indexOf(id);

  private spacingFor(id: string): number {
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
      return layoutBlock(items, {
        width: this.width,
        typography: this.typographyFor(id),
        measurer: this.measurer,
        detailed,
      });
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

    for (const id of ids) {
      if (
        !this.contentHeights.has(id) ||
        !this.cache.isValid(id, this.versions.get(id) ?? 1, this.width, this.tKeyFor(id))
      ) {
        this.measure(id);
      }
    }

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
      } else if (target instanceof Y.Text) {
        const id = this.textIndex.get(target);
        if (id) changed.add(id);
      } else if (target instanceof Y.Map) {
        const id = target.get("id") as string | undefined;
        if (id) changed.add(id);
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
    this.notify();
  }

  setWidth(width: number): void {
    if (width === this.width || width <= 0) return;
    this.width = width;
    this.cache.clear();
    for (const id of this.virtualizer.getOrder()) this.measure(id);
    this.notify();
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

  positionFromPoint(xContent: number, yDoc: number): Position | null {
    const id = this.virtualizer.blockAt(yDoc);
    if (!id) return null;
    const layout = this.getLayout(id);
    if (!layout) return null;
    const top = this.virtualizer.topOf(id);
    const offset = offsetAtPoint(layout, xContent, yDoc - top, this.measurer);
    return position(id, offset);
  }

  caretRect(): CaretRect | null {
    const sel = this.selection;
    if (!sel) return null;
    const layout = this.getLayout(sel.focus.blockId);
    if (!layout) return null;
    const c = caretForOffset(layout, sel.focus.offset, this.measurer);
    const top = this.virtualizer.topOf(sel.focus.blockId);
    return { x: c.x, y: top + c.y, height: c.height, blockId: sel.focus.blockId };
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
      const top = this.virtualizer.topOf(it.id);
      for (const r of selectionRects(layout, from, to, this.measurer)) {
        out.push({ blockId: it.id, x: r.x, y: r.y + top, width: r.width, height: r.height });
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

  private lengthOf(id: string): number {
    const block = this.byId(id);
    return block ? blockText(block).length : 0;
  }

  /** The plain text of a block (O(1) lookup; embeds become one placeholder char). */
  getBlockText(id: string): string {
    const block = this.byId(id);
    return block ? textToPlain(blockText(block)) : "";
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
    const { start, end } = orderedRange(sel, this.indexOf);
    return deleteRange(this.doc, this.blocks, start, end);
  }

  insertText(text: string): void {
    if (text.length === 0) return;
    const startPos = this.collapsedStart();
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

  deleteBackward(): void {
    const sel = this.selection;
    if (!sel) return;
    if (!isCollapsed(sel)) {
      const { start, end } = orderedRange(sel, this.indexOf);
      const after = deleteRange(this.doc, this.blocks, start, end);
      this.setSelection(caret(after));
      return;
    }
    const pos = sel.focus;
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
    const merged = mergeWithPrevious(this.doc, this.blocks, pos.blockId);
    if (merged) this.setSelection(caret(merged));
  }

  deleteForward(): void {
    const sel = this.selection;
    if (!sel) return;
    if (!isCollapsed(sel)) {
      const { start, end } = orderedRange(sel, this.indexOf);
      const after = deleteRange(this.doc, this.blocks, start, end);
      this.setSelection(caret(after));
      return;
    }
    const pos = sel.focus;
    const len = this.lengthOf(pos.blockId);
    if (pos.offset < len) {
      deleteRange(this.doc, this.blocks, pos, position(pos.blockId, pos.offset + 1));
      this.setSelection(caret(pos));
      return;
    }
    const order = this.virtualizer.getOrder();
    const idx = this.indexOf(pos.blockId);
    const next = order[idx + 1];
    if (next) {
      mergeWithPrevious(this.doc, this.blocks, next);
      this.setSelection(caret(pos));
    }
  }

  // ---------------------------------------------------------------------------
  // Inline marks & block types
  // ---------------------------------------------------------------------------

  getActiveMarks(): Marks {
    const sel = this.selection;
    if (!sel) return {};
    if (isCollapsed(sel)) {
      if (this.pendingMarks) return this.pendingMarks;
      const block = this.byId(sel.focus.blockId);
      return block ? marksInRange(blockText(block), sel.focus.offset, sel.focus.offset) : {};
    }
    const { start, end } = orderedRange(sel, this.indexOf);
    const block = this.byId(start.blockId);
    if (!block) return {};
    const to = end.blockId === start.blockId ? end.offset : blockText(block).length;
    return marksInRange(blockText(block), start.offset, to);
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
