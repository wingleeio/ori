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
  linkBoundsAt,
  sliceTextPlain,
  textToInline,
  textToPlain,
  type AtomResolver,
} from "./delta";
import { resolveExtensions, type EditorExtension, type ResolvedExtensions } from "./extension";
import { defaultHighlighter, normalizeLang, type Highlighter, type HighlightToken } from "./highlight";
import { matchBlockRule, matchInlineRule } from "./inputrules";
import { sanitizeUrl } from "./link";
import { blocksToMarkdown, type ContentBlock } from "./markdown";
import { Emitter } from "./emitter";
import { createSchema, type BlockNode, type EditorSchema } from "./nodes";
import {
  deleteRange,
  formatRange,
  insertBlockAfter,
  insertInlineEmbed,
  insertText,
  mergeWithPrevious,
  moveBlock,
  setBlockType,
  splitBlock,
} from "./operations";
import {
  blockAttrs,
  blockHeadingLevel,
  blockListLevel,
  blockText,
  blockTodoChecked,
  blockType,
  createNoteDoc,
  getBlocks,
  HEADING_LEVEL_ATTR,
  isListBlockType,
  LIST_LEVEL_ATTR,
  LOCAL_ORIGIN,
  normalizeHeadingLevel,
  blockId as readBlockId,
  listInsetLeft,
  normalizeListLevel,
  TODO_CHECKED_ATTR,
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
  /**
   * Maximum number of off-screen blocks whose *detailed* layout (fragments +
   * caret geometry) stays cached. Cheap height metrics are always kept for
   * every visited block, so eviction never causes scroll jumps — it only
   * bounds memory in long sessions over large notes. Default 256.
   */
  maxDetailedLayouts?: number;
  /**
   * Live markdown autoformatting while typing (`# `→heading, `- `→bullet,
   * `1. `→numbered, `[] `→todo, `> `→quote, ```` ``` ````→code block,
   * `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`). Each conversion is its
   * own undo step, so one undo restores the literal text. Default true.
   */
  inputRules?: boolean;
  /**
   * Syntax highlighter for code blocks (colors only — it can never change the
   * measured text). Defaults to the built-in lightweight highlighter; pass
   * `null` to disable, or your own {@link Highlighter} (e.g. shiki-backed) for
   * richer grammars.
   */
  highlighter?: Highlighter | null;
  /**
   * Composable feature bundles: custom nodes + input rules + commands as one
   * unit (see {@link EditorExtension}). Extension schema merges over `schema`;
   * extension rules run before the built-ins; commands run via {@link exec}.
   */
  extensions?: EditorExtension[];
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

/** One find() occurrence: a half-open text range within a block. */
export interface FindMatch {
  blockId: string;
  start: number;
  end: number;
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
  private maxDetailedLayouts: number;
  private inputRulesEnabled: boolean;
  private highlighter: Highlighter | null;
  private extensions: ResolvedExtensions;

  private virtualizer: Virtualizer;
  private cache = new LayoutCache();
  private emitter = new Emitter();

  private versions = new Map<string, number>();
  private contentHeights = new Map<string, number>();
  private blockMap = new Map<string, BlockMap>();

  private viewport = { scrollTop: 0, viewportHeight: 0 };
  /** Accumulated scroll compensation (px) from measurement; the host drains it
   *  via {@link takeScrollAdjust} and adds it to scrollTop. */
  private scrollAdjust = 0;
  private selection: Selection | null = null;
  private pendingMarks: Marks | null = null;
  private preferredX: number | null = null;

  private revision = 0;
  private cachedSnapshot: EditorSnapshot | null = null;
  private batchDepth = 0;
  private pendingNotify = false;
  private pendingMeasureCursor = 0;
  private deepHandler: (events: Array<Y.YEvent<any>>) => void;
  private undoManager!: Y.UndoManager;
  private connected = false;
  /** Selection captured by the last popped undo/redo stack item. */
  private restoreSelection: Selection | null | undefined = undefined;
  /** True after an input rule transformed the doc beyond the typed character. */
  private inputRuleApplied = false;

  constructor(options: EditorOptions) {
    this.doc = options.doc ?? createNoteDoc();
    this.blocks = getBlocks(this.doc);
    this.measurer = options.measurer;
    this.typography = options.typography ?? DEFAULT_TYPOGRAPHY;
    this.extensions = resolveExtensions(options.extensions);
    // Extension nodes merge over host schema, which merges over built-ins.
    this.schema = createSchema({
      blocks: { ...(options.schema?.blocks ?? {}), ...(this.extensions.schema.blocks ?? {}) },
      atoms: { ...(options.schema?.atoms ?? {}), ...(this.extensions.schema.atoms ?? {}) },
    });
    this.width = options.width ?? 0;
    this.overscan = options.overscan ?? 800;
    this.blockSpacing = options.blockSpacing ?? 12;
    this.maxDetailedLayouts = Math.max(1, options.maxDetailedLayouts ?? 256);
    this.inputRulesEnabled = options.inputRules ?? true;
    this.highlighter = options.highlighter === undefined ? defaultHighlighter : options.highlighter;
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

  private emitNow(): void {
    this.cachedSnapshot = null;
    this.revision += 1;
    this.emitter.emit();
  }

  private notify(): void {
    this.cachedSnapshot = null;
    if (this.batchDepth > 0) {
      this.pendingNotify = true;
      return;
    }
    this.emitNow();
  }

  /** Coalesce multiple internal mutations into a single subscriber update. */
  batch<T>(fn: () => T): T {
    this.batchDepth += 1;
    try {
      return fn();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.pendingNotify) {
        this.pendingNotify = false;
        this.emitNow();
      }
    }
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
    // Track ONLY editor-originated transactions: persistence restores and
    // collaboration providers use their own origins, so remote edits are never
    // undoable locally. (Yjs adds the UndoManager itself so redo keeps working.)
    this.undoManager = new Y.UndoManager(this.blocks, {
      captureTimeout: 250,
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    // Selection-aware undo: remember where the caret was when each stack item
    // was created, and restore it when that item is undone/redone. A merged
    // keystroke run (captureTimeout) keeps the selection of its FIRST edit, so
    // undo lands at the start of the typed run, matching mature editors.
    this.undoManager.on("stack-item-added", (e: { stackItem: { meta: Map<unknown, unknown> } }) => {
      if (!e.stackItem.meta.has("selection")) {
        e.stackItem.meta.set("selection", this.selection);
      }
    });
    this.undoManager.on("stack-item-popped", (e: { stackItem: { meta: Map<unknown, unknown> } }) => {
      this.restoreSelection = (e.stackItem.meta.get("selection") as Selection | null) ?? null;
    });
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

  /**
   * Run a named extension command. Returns the command's result, or
   * `undefined` when no such command is registered (see {@link hasCommand}).
   */
  exec(name: string, ...args: unknown[]): unknown {
    const command = this.extensions.commands.get(name);
    return command ? command(this, ...args) : undefined;
  }

  /** Whether an extension registered a command under `name`. */
  hasCommand(name: string): boolean {
    return this.extensions.commands.has(name);
  }

  undo(): void {
    this.historyStep(() => this.undoManager.undo());
  }

  redo(): void {
    this.historyStep(() => this.undoManager.redo());
  }

  /** Run an undo/redo step, then restore the selection captured with it. */
  private historyStep(step: () => void): void {
    if (!this.connected) return;
    this.restoreSelection = undefined;
    step();
    const sel = this.restoreSelection as Selection | null | undefined;
    this.restoreSelection = undefined;
    const valid = sel ? this.sanitizeSelection(sel) : null;
    if (valid) {
      this.selection = valid;
      this.pendingMarks = null;
      this.preferredX = null;
      this.notify();
    }
  }

  /** Clamp a remembered selection to the current doc; null if a block is gone. */
  private sanitizeSelection(sel: Selection): Selection | null {
    const fix = (p: Position): Position | null => {
      const block = this.byId(p.blockId);
      if (!block) return null;
      return position(p.blockId, Math.min(p.offset, blockText(block).length));
    };
    const anchor = fix(sel.anchor);
    const focus = fix(sel.focus);
    return anchor && focus ? { anchor, focus } : null;
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

  /** Effective typography for a text block, derived from its node (+ attrs). */
  private typographyFor(id: string): Typography {
    const node = this.nodeFor(id);
    if (!node.typography) return this.typography;
    const block = this.byId(id);
    return node.typography(this.typography, block ? blockAttrs(block) : undefined);
  }

  private tKeyFor(id: string): string {
    const node = this.nodeFor(id);
    if (node.text) return typographyKey(this.typographyFor(id));
    // Atomic blocks invalidate on type + attrs (width is tracked separately).
    const block = this.byId(id);
    return `${node.type}|${block ? JSON.stringify(blockAttrs(block)) : ""}`;
  }

  /** Public access to a block type's resolved typography (for renderers). */
  getBlockTypography(type: BlockType, attrs?: Record<string, unknown>): Typography {
    const node = this.schema.blocks[type];
    return node?.typography ? node.typography(this.typography, attrs) : this.typography;
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
      const inset = this.insetOf(id);
      const wrapWidth =
        this.width > 0 ? Math.max(1, this.width - inset.left - inset.right) : this.width;
      const layout = layoutBlock(items, {
        width: wrapWidth,
        typography: this.typographyFor(id),
        measurer: this.measurer,
        detailed,
      });
      if (inset.top + inset.bottom > 0) {
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

    for (let i = 0; i < this.blocks.length; i += 1) {
      const block = this.blocks.get(i);
      const id = readBlockId(block);
      ids.push(id);
      live.add(id);
      this.blockMap.set(id, block);
      if (!this.versions.has(id)) this.versions.set(id, 1);
    }

    this.virtualizer.setOrder(ids);
    this.pendingMeasureCursor = 0;
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
      // A block's own text, its `attrs`, or a Y.Map / Y.Array / Y.Text nested
      // arbitrarily deep within reports that inner type as the target; walk up to
      // the OWNING BLOCK — the Y.Map that is a direct child of the blocks array —
      // so it re-measures/re-renders. (Keying on the first nested map with an
      // "id" would stop at a nested entity's own id, not the block's.)
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
    this.pendingMeasureCursor = 0;
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
      // Bound detailed-geometry memory: keep the current window (plus overscan)
      // hot and evict the least-recently-used detailed layouts beyond the cap.
      const win = this.virtualizer.window(
        this.viewport.scrollTop,
        this.viewport.viewportHeight,
        this.overscan,
      );
      const keep = new Set(win.items.map((it) => it.id));
      this.cache.evictDetailed(keep, Math.max(this.maxDetailedLayouts, keep.size));
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
    const order = this.virtualizer.getOrder();
    const count = order.length;
    if (count === 0) return false;
    let measured = 0;
    let more = false;
    this.withScrollAnchor(() => {
      let scanned = 0;
      let i = Math.min(this.pendingMeasureCursor, count - 1);
      while (scanned < count) {
        const current = i;
        const id = order[current];
        if (!this.cache.isValid(id, this.versions.get(id) ?? 1, this.width, this.tKeyFor(id))) {
          if (measured >= budget) {
            more = true;
            i = current;
            break;
          }
          this.measure(id);
          measured += 1;
        }
        i = (current + 1) % count;
        scanned += 1;
      }
      this.pendingMeasureCursor = i;
    });
    if (measured > 0) this.notify();
    return more;
  }

  setTypography(typography: Typography): void {
    this.typography = typography;
    this.measurer.clear?.();
    this.cache.clear();
    this.pendingMeasureCursor = 0;
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
    this.pendingMeasureCursor = 0;
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
    const inset = this.nodeFor(id).inset;
    if (!inset) return { top: 0, right: 0, bottom: 0, left: 0 };
    if (typeof inset === "function") {
      const block = this.byId(id);
      return inset({ attrs: block ? blockAttrs(block) : {} });
    }
    return inset;
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

  /**
   * Rectangles (document space) for an ARBITRARY text range — the building
   * block for host overlays like find-match highlights. Unlike
   * {@link selectionRectsForViewport} it doesn't depend on the current
   * selection, and it resolves offscreen blocks too (their detailed layout is
   * computed on demand).
   */
  rectsForRange(start: Position, end: Position): SelectionRect[] {
    const startIdx = this.indexOf(start.blockId);
    const endIdx = this.indexOf(end.blockId);
    if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return [];
    const order = this.virtualizer.getOrder();
    const out: SelectionRect[] = [];
    for (let i = startIdx; i <= endIdx; i += 1) {
      const id = order[i];
      const layout = this.getLayout(id);
      if (!layout) continue;
      const from = id === start.blockId ? start.offset : 0;
      const to = id === end.blockId ? end.offset : layout.length;
      const top = this.contentTopOf(id);
      const left = this.insetOf(id).left;
      for (const r of selectionRects(layout, from, to, this.measurer)) {
        out.push({ blockId: id, x: r.x + left, y: r.y + top, width: r.width, height: r.height });
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
    return orderedRange(this.selection, this.indexOf);
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

  /** True for an atomic/custom block (divider, image…) — one whose content isn't
   *  editable text. Hosts use it to keep native text input off such blocks. */
  isAtomicBlock(id: string): boolean {
    return !this.nodeFor(id).text;
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
  getSelectionBlocks(): { type: BlockType; items: InlineItem[]; attrs: Record<string, unknown> }[] {
    const sel = this.selection;
    if (!sel || isCollapsed(sel)) return [];
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const si = this.indexOf(start.blockId);
    const ei = this.indexOf(end.blockId);
    const out: { type: BlockType; items: InlineItem[]; attrs: Record<string, unknown> }[] = [];
    for (let i = si; i <= ei; i += 1) {
      const id = order[i];
      const items = this.getInline(id);
      const len = blockText(this.byId(id)!).length;
      const from = i === si ? start.offset : 0;
      const to = i === ei ? end.offset : len;
      // Carry block attrs (e.g. an image's src/ratio) so atomic blocks survive
      // copy/paste — otherwise a pasted image would reset to defaults.
      out.push({ type: this.getBlockType(id), items: clipInline(items, from, to), attrs: blockAttrs(this.byId(id)!) });
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

  /** A list item's nesting level, clamped to the supported range. */
  getListLevel(id: string): number {
    const block = this.byId(id);
    return block ? blockListLevel(block) : 0;
  }

  /** A heading block's level (1–3); 1 for non-headings or when unset. */
  getHeadingLevel(id: string): number {
    const block = this.byId(id);
    return block ? blockHeadingLevel(block) : 1;
  }

  /** A code block's language (normalized alias, e.g. "javascript"→"js"). */
  getCodeLang(id: string): string {
    const block = this.byId(id);
    if (!block || blockType(block) !== "code") return "";
    const lang = blockAttrs(block).lang;
    return normalizeLang(typeof lang === "string" ? lang : undefined);
  }

  /** Set a code block's language (drives syntax highlighting). */
  setCodeLang(id: string, lang: string): void {
    const block = this.byId(id);
    if (!block || blockType(block) !== "code") return;
    this.setBlockAttr(id, "lang", lang || undefined);
  }

  /**
   * Syntax tokens for a code block's current text — colors only, computed by
   * the configured {@link Highlighter}. Empty for non-code blocks, unknown
   * languages, or when highlighting is disabled.
   */
  getHighlightTokens(id: string): HighlightToken[] {
    if (!this.highlighter) return [];
    const block = this.byId(id);
    if (!block || blockType(block) !== "code") return [];
    const lang = this.getCodeLang(id);
    if (!lang) return [];
    return this.highlighter(textToPlain(blockText(block)), lang);
  }

  /** The rendered left content inset for a list item at its current level. */
  getListInsetLeft(id: string): number {
    return listInsetLeft(this.getListLevel(id));
  }

  /**
   * A block's content inset (px) — the padding/border that shifts its text in
   * (a list's marker gutter, a quote's bar, a code block's padding). Lets the UI
   * align overlays like the placeholder with where the block's text/caret begins.
   */
  getBlockInset(id: string): { top: number; right: number; bottom: number; left: number } {
    return this.insetOf(id);
  }

  /**
   * Ordered-list item number among contiguous siblings at the same level. Deeper
   * nested items are skipped; a shallower item or non-list block starts a new
   * sibling sequence.
   */
  getListOrdinal(id: string): number {
    const block = this.byId(id);
    if (!block || blockType(block) !== "ordered-list") return 1;
    const level = blockListLevel(block);
    const order = this.virtualizer.getOrder();
    let ordinal = 1;
    for (let i = this.indexOf(id) - 1; i >= 0; i -= 1) {
      const prev = this.byId(order[i]);
      if (!prev) continue;
      const prevType = blockType(prev);
      const prevLevel = blockListLevel(prev);
      if (!isListBlockType(prevType)) break;
      if (prevLevel < level) break;
      if (prevLevel === level && prevType !== "ordered-list") break;
      if (prevLevel === level) ordinal += 1;
    }
    return ordinal;
  }

  /** Whether a todo-list item is checked. */
  getTodoChecked(id: string): boolean {
    const block = this.byId(id);
    return block ? blockTodoChecked(block) : false;
  }

  /**
   * Toggle a todo-list item's checked state. No-op (returns the unchanged
   * state) for blocks that aren't todo items.
   */
  toggleTodoChecked(id: string): boolean {
    const block = this.byId(id);
    if (!block || blockType(block) !== "todo-list") return false;
    const next = !blockTodoChecked(block);
    this.setBlockAttr(id, TODO_CHECKED_ATTR, next);
    return next;
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
    // Live markdown autoformat — only single keystrokes qualify, so pasted or
    // programmatic text never reformats.
    if (this.inputRulesEnabled && text.length === 1) this.applyInputRules(after);
  }

  /**
   * Check + apply markdown input rules at a caret that just received a typed
   * character. Each conversion breaks the undo capture group first, so a
   * single undo restores the literal markdown text.
   */
  private applyInputRules(pos: Position): void {
    const block = this.byId(pos.blockId);
    if (!block || !this.nodeFor(pos.blockId).text) return;
    const type = blockType(block);
    if (type === "code") return; // never autoformat inside code blocks
    const text = blockText(block);
    const before = textToPlain(text).slice(0, pos.offset);

    if (type === "paragraph") {
      // Extension rules first (so a host can claim a prefix like ":: "
      // before the built-ins see it), then the built-in markdown set.
      let bm = null as ReturnType<typeof matchBlockRule>;
      for (const rule of this.extensions.blockRules) {
        bm = rule(before);
        if (bm) break;
      }
      bm ??= matchBlockRule(before);
      if (bm) {
        if (this.connected) this.undoManager.stopCapturing();
        this.doc.transact(() => {
          text.delete(0, bm.prefixLength);
          block.set("type", bm.type);
          const attrMap = block.get("attrs");
          if (attrMap instanceof Y.Map) {
            if (isListBlockType(bm.type)) attrMap.set(LIST_LEVEL_ATTR, 0);
            for (const [k, v] of Object.entries(bm.attrs ?? {})) attrMap.set(k, v);
          }
        }, LOCAL_ORIGIN);
        this.setSelection(caret(position(pos.blockId, 0)));
        if (this.connected) this.undoManager.stopCapturing();
        this.inputRuleApplied = true;
        return;
      }
    }

    let im = null as ReturnType<typeof matchInlineRule>;
    for (const rule of this.extensions.inlineRules) {
      im = rule(before);
      if (im) break;
    }
    im ??= matchInlineRule(before);
    if (im) {
      // Never treat characters of an existing code span as delimiters/content:
      // if ANY character of the would-be match (except the just-typed closer)
      // already carries the code mark, the delimiters are literal code text.
      const items = textToInline(text);
      const scanEnd = im.end - im.close;
      const touchesCode = items.some((it) => {
        const len = it.atom ? 1 : it.text.length;
        return it.marks?.code && it.start < scanEnd && it.start + len > im.start;
      });
      if (touchesCode) return;
      if (this.connected) this.undoManager.stopCapturing();
      this.doc.transact(() => {
        text.delete(im.end - im.close, im.close);
        text.format(im.start + im.open, im.end - im.close - im.start - im.open, {
          [im.mark]: true,
        });
        text.delete(im.start, im.open);
      }, LOCAL_ORIGIN);
      const after = im.end - im.open - im.close;
      this.setSelection(caret(position(pos.blockId, after)));
      // The next character typed continues UNmarked (the span is closed).
      this.pendingMarks = { ...marksInRange(text, after, after), [im.mark]: false };
      if (this.connected) this.undoManager.stopCapturing();
      this.inputRuleApplied = true;
      this.notify();
    }
  }

  /**
   * Whether an input rule transformed the document beyond the last typed
   * character (block conversion / delimiter stripping), clearing the flag.
   * Views use this after a native keystroke read-back to know the DOM must be
   * re-rendered from the model rather than trusting what the browser painted.
   */
  takeInputRuleApplied(): boolean {
    const v = this.inputRuleApplied;
    this.inputRuleApplied = false;
    return v;
  }

  insertParagraphBreak(): void {
    const startPos = this.collapsedStart();
    const block = this.byId(startPos.blockId);
    if (block && isListBlockType(blockType(block)) && blockText(block).length === 0) {
      const level = blockListLevel(block);
      if (level > 0) {
        this.setListLevel(startPos.blockId, level - 1);
      } else {
        this.setBlockTypeAtSelection("paragraph");
      }
      this.setSelection(caret(position(startPos.blockId, 0)));
      return;
    }
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

  /**
   * Move a block to `toIndex` (its final document index) as a single,
   * self-contained undo step. The block's id is preserved, so the selection —
   * and any host UI keyed on the id — stays valid across the move.
   */
  moveBlock(id: string, toIndex: number): boolean {
    if (this.connected) this.undoManager.stopCapturing();
    const moved = moveBlock(this.doc, this.blocks, id, toIndex);
    if (moved && this.connected) this.undoManager.stopCapturing();
    return moved;
  }

  /** A block's current document index, or -1 if it doesn't exist. */
  getBlockIndex(id: string): number {
    return this.indexOf(id);
  }

  /** Insert a new block (typically a custom atomic node) after the selection. */
  insertBlockAfterSelection(type: BlockType, attrs?: Record<string, unknown>): void {
    const order = this.virtualizer.getOrder();
    const afterId = this.selection?.focus.blockId ?? order[order.length - 1];
    if (!afterId) return;
    const after = insertBlockAfter(this.doc, this.blocks, afterId, type, attrs);
    this.setSelection(caret(after));
  }

  /** True for a schema block type whose content isn't editable text (atomic). */
  isAtomicType(type: BlockType): boolean {
    const node = this.schema.blocks[type];
    return node ? !node.text : false;
  }

  /**
   * Insert an atomic/custom block (image, divider…) at the caret as its own
   * block. An empty text block simply becomes it; otherwise the text block is
   * split at the caret so the atomic block lands between the two halves — never
   * merging text into its hidden Y.Text. Used when pasting/dropping a block atom.
   */
  insertAtomicBlockAtSelection(type: BlockType, attrs?: Record<string, unknown>): void {
    const startPos = this.collapsedStart();
    const block = this.byId(startPos.blockId);
    if (!block) return;
    const len = blockText(block).length;
    let atomicId: string;
    if (this.nodeFor(startPos.blockId).text && len === 0) {
      // Reuse the empty paragraph as the atomic block.
      setBlockType(this.doc, this.blocks, startPos.blockId, type);
      atomicId = startPos.blockId;
      if (attrs) {
        this.setSelection(caret(position(atomicId, 0)));
        this.setBlockAttrsAtSelection(attrs);
      }
    } else {
      // Split a non-empty text block so the atomic block lands between the halves.
      if (this.nodeFor(startPos.blockId).text && startPos.offset < len) {
        splitBlock(this.doc, this.blocks, startPos.blockId, startPos.offset);
      }
      atomicId = insertBlockAfter(this.doc, this.blocks, startPos.blockId, type, attrs).blockId;
    }
    // Always leave a text block after the atomic one (so the document never ends
    // up as a single uneditable atomic block) and put the caret there.
    const nextId = this.virtualizer.getOrder()[this.indexOf(atomicId) + 1];
    if (nextId && this.nodeFor(nextId).text) {
      this.setSelection(caret(position(nextId, 0)));
    } else {
      this.setSelection(caret(insertBlockAfter(this.doc, this.blocks, atomicId, "paragraph")));
    }
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
    // Caret on an atomic (non-text) block — Backspace removes the block itself,
    // or, if it's the only block, turns it back into an empty paragraph so the
    // document never gets stuck as a single undeletable atomic block.
    if (idx >= 0 && !this.nodeFor(pos.blockId).text) {
      if (order.length === 1) {
        setBlockType(this.doc, this.blocks, pos.blockId, "paragraph");
        this.setSelection(caret(position(pos.blockId, 0)));
        return;
      }
      const prev = order[idx - 1];
      this.deleteBlock(pos.blockId);
      this.setSelection(
        caret(prev ? position(prev, this.lengthOf(prev)) : position(order[idx + 1], 0)),
      );
      return;
    }
    const block = this.byId(pos.blockId);
    if (block && pos.offset === 0 && isListBlockType(blockType(block))) {
      const level = blockListLevel(block);
      if (level > 0) this.setListLevel(pos.blockId, level - 1);
      else this.setBlockTypeAtSelection("paragraph");
      this.setSelection(caret(position(pos.blockId, 0)));
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
    // Caret on an atomic block — Delete removes the block itself, or turns a lone
    // atomic block back into an empty paragraph (never a stuck single block).
    if (idx >= 0 && !this.nodeFor(pos.blockId).text) {
      if (order.length === 1) {
        setBlockType(this.doc, this.blocks, pos.blockId, "paragraph");
        this.setSelection(caret(position(pos.blockId, 0)));
        return;
      }
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
    this.doc.transact(() => this.blocks.delete(idx, 1), LOCAL_ORIGIN);
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

  // ---------------------------------------------------------------------------
  // Links
  // ---------------------------------------------------------------------------

  /**
   * Apply `url` as a link. The URL is sanitized ({@link sanitizeUrl}) — unsafe
   * schemes such as `javascript:` are rejected and bare domains get `https://`.
   *
   * - Range selection → the whole range is linked.
   * - Collapsed caret on an existing link → that link run is retargeted.
   * - Collapsed caret elsewhere → the URL itself is inserted as linked text.
   * - An empty/invalid URL removes the link instead (see {@link removeLink}).
   *
   * Returns whether the document changed.
   */
  setLink(url: string): boolean {
    const sel = this.selection;
    if (!sel) return false;
    const clean = sanitizeUrl(url);
    if (!clean) return this.removeLink();
    if (isCollapsed(sel)) {
      const id = sel.focus.blockId;
      const block = this.byId(id);
      if (!block || !this.nodeFor(id).text) return false;
      const bounds = linkBoundsAt(blockText(block), sel.focus.offset);
      if (bounds) {
        formatRange(
          this.doc,
          this.blocks,
          position(id, bounds.start),
          position(id, bounds.end),
          "link",
          clean,
        );
        return true;
      }
      const after = insertText(this.doc, this.blocks, sel.focus, clean, {
        ...fullAttributes({}),
        link: clean,
      });
      this.setSelection(caret(after));
      return true;
    }
    const { start, end } = orderedRange(sel, this.indexOf);
    formatRange(this.doc, this.blocks, start, end, "link", clean);
    return true;
  }

  /**
   * Remove the link at the selection: a range selection unlinks the range; a
   * collapsed caret on a link unlinks that whole contiguous run. Returns
   * whether the document changed.
   */
  removeLink(): boolean {
    const sel = this.selection;
    if (!sel) return false;
    if (isCollapsed(sel)) {
      const id = sel.focus.blockId;
      const block = this.byId(id);
      if (!block || !this.nodeFor(id).text) return false;
      const bounds = linkBoundsAt(blockText(block), sel.focus.offset);
      if (!bounds) return false;
      formatRange(
        this.doc,
        this.blocks,
        position(id, bounds.start),
        position(id, bounds.end),
        "link",
        null,
      );
      return true;
    }
    const { start, end } = orderedRange(sel, this.indexOf);
    formatRange(this.doc, this.blocks, start, end, "link", null);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Content export
  // ---------------------------------------------------------------------------

  /**
   * Every block as plain content — type, styled inline runs, attrs. The
   * framework-agnostic export surface (`docFromContent` is its inverse).
   */
  getContentBlocks(): ContentBlock[] {
    const out: ContentBlock[] = [];
    for (const id of this.virtualizer.getOrder()) {
      const block = this.byId(id);
      if (!block) continue;
      const attrs = blockAttrs(block);
      out.push({
        type: blockType(block),
        items: this.getInline(id),
        ...(Object.keys(attrs).length ? { attrs } : {}),
      });
    }
    return out;
  }

  /** The whole document as GitHub-flavored markdown. */
  exportMarkdown(): string {
    return blocksToMarkdown(this.getContentBlocks());
  }

  /**
   * The document's heading outline (id, level, text) in order — drives tables
   * of contents and the accessible outline nav. O(blocks), but reads text only
   * for headings, so it's cheap even on very large notes.
   */
  getOutline(): Array<{ id: string; level: number; text: string }> {
    const out: Array<{ id: string; level: number; text: string }> = [];
    for (const id of this.virtualizer.getOrder()) {
      const block = this.byId(id);
      if (!block || blockType(block) !== "heading") continue;
      out.push({ id, level: blockHeadingLevel(block), text: textToPlain(blockText(block)) });
    }
    return out;
  }

  /** A block's slot top in document space (px) — for scroll-to-block UI. */
  getBlockTop(id: string): number {
    return this.virtualizer.topOf(id);
  }

  // ---------------------------------------------------------------------------
  // Find & replace
  // ---------------------------------------------------------------------------

  /**
   * All non-overlapping occurrences of `query` across the document's text
   * blocks, in document order. Case-insensitive by default. Inline atoms
   * occupy one placeholder character and never match text queries.
   */
  findAll(query: string, opts?: { caseSensitive?: boolean }): FindMatch[] {
    const out: FindMatch[] = [];
    if (!query) return out;
    const cs = opts?.caseSensitive ?? false;
    const q = cs ? query : query.toLowerCase();
    for (const id of this.virtualizer.getOrder()) {
      const block = this.byId(id);
      if (!block || !this.nodeFor(id).text) continue;
      const plain = textToPlain(blockText(block));
      const hay = cs ? plain : plain.toLowerCase();
      let i = 0;
      while ((i = hay.indexOf(q, i)) !== -1) {
        out.push({ blockId: id, start: i, end: i + q.length });
        i += q.length;
      }
    }
    return out;
  }

  /** Select a match (so the host can highlight/scroll to it). */
  selectMatch(match: FindMatch): void {
    this.setSelection({
      anchor: position(match.blockId, match.start),
      focus: position(match.blockId, match.end),
    });
  }

  /**
   * Replace one match, inheriting the marks at the match start. The caret
   * lands after the replacement. Returns whether the document changed.
   */
  replaceMatch(match: FindMatch, replacement: string): boolean {
    const block = this.byId(match.blockId);
    if (!block || !this.nodeFor(match.blockId).text) return false;
    const text = blockText(block);
    if (match.end > text.length || match.end <= match.start) return false;
    if (this.connected) this.undoManager.stopCapturing();
    this.doc.transact(() => {
      const attrs = fullAttributes(marksInRange(text, match.start, match.start + 1));
      text.delete(match.start, match.end - match.start);
      if (replacement) text.insert(match.start, replacement, attrs);
    }, LOCAL_ORIGIN);
    this.setSelection(caret(position(match.blockId, match.start + replacement.length)));
    return true;
  }

  /**
   * Replace every occurrence of `query` in one transaction (one undo step).
   * Returns the number of replacements.
   */
  replaceAll(query: string, replacement: string, opts?: { caseSensitive?: boolean }): number {
    const matches = this.findAll(query, opts);
    if (matches.length === 0) return 0;
    if (this.connected) this.undoManager.stopCapturing();
    this.doc.transact(() => {
      // Back-to-front so earlier offsets stay valid within each block.
      for (let i = matches.length - 1; i >= 0; i -= 1) {
        const m = matches[i];
        const block = this.byId(m.blockId);
        if (!block) continue;
        const text = blockText(block);
        const attrs = fullAttributes(marksInRange(text, m.start, m.start + 1));
        text.delete(m.start, m.end - m.start);
        if (replacement) text.insert(m.start, replacement, attrs);
      }
    }, LOCAL_ORIGIN);
    if (this.connected) this.undoManager.stopCapturing();
    const last = matches[matches.length - 1];
    this.setSelection(caret(position(last.blockId, last.start + replacement.length)));
    return matches.length;
  }

  /**
   * URL of the link under the caret (whole run, left-biased like mark
   * resolution) or common to the entire selection; `null` when none.
   */
  getActiveLink(): string | null {
    const sel = this.selection;
    if (!sel) return null;
    if (isCollapsed(sel)) {
      const block = this.byId(sel.focus.blockId);
      if (!block || !this.nodeFor(sel.focus.blockId).text) return null;
      return linkBoundsAt(blockText(block), sel.focus.offset)?.url ?? null;
    }
    return this.getActiveMarks().link ?? null;
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

  private setBlockAttr(id: string, key: string, value: unknown): void {
    const block = this.byId(id);
    const attrMap = block?.get("attrs");
    if (!(attrMap instanceof Y.Map)) return;
    this.doc.transact(() => {
      if (value === undefined) attrMap.delete(key);
      else attrMap.set(key, value);
    }, LOCAL_ORIGIN);
  }

  private setListLevel(id: string, level: number): void {
    this.setBlockAttr(id, LIST_LEVEL_ATTR, normalizeListLevel(level));
  }

  adjustListLevelAtSelection(delta: number): boolean {
    const sel = this.selection;
    if (!sel || delta === 0) return false;
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const si = this.indexOf(start.blockId);
    const ei = this.indexOf(end.blockId);
    let changed = false;
    this.doc.transact(() => {
      for (let i = si; i <= ei; i += 1) {
        const block = this.byId(order[i]);
        if (!block || !isListBlockType(blockType(block))) continue;
        const attrMap = block.get("attrs");
        if (!(attrMap instanceof Y.Map)) continue;
        const next = normalizeListLevel(blockListLevel(block) + delta);
        if (next === blockListLevel(block)) continue;
        attrMap.set("level", next);
        changed = true;
      }
    }, LOCAL_ORIGIN);
    return changed;
  }

  increaseListLevelAtSelection(): boolean {
    return this.adjustListLevelAtSelection(1);
  }

  decreaseListLevelAtSelection(): boolean {
    return this.adjustListLevelAtSelection(-1);
  }

  setBlockTypeAtSelection(type: BlockType, attrs?: Record<string, unknown>): void {
    const sel = this.selection;
    if (!sel) return;
    const { start, end } = orderedRange(sel, this.indexOf);
    const order = this.virtualizer.getOrder();
    const si = this.indexOf(start.blockId);
    const ei = this.indexOf(end.blockId);
    this.doc.transact(() => {
      for (let i = si; i <= ei; i += 1) {
        const block = this.byId(order[i]);
        if (!block) continue;
        const previous = blockType(block);
        block.set("type", type);
        const attrMap = block.get("attrs");
        if (!(attrMap instanceof Y.Map)) continue;
        if (isListBlockType(type)) {
          const level = isListBlockType(previous) ? blockListLevel(block) : 0;
          attrMap.set("level", normalizeListLevel(level));
        } else if (type === "heading") {
          // `level` doubles as the heading level (1–3); normalize or reset it
          // so a former list item's nesting can't leak in as a heading level.
          attrMap.set(
            HEADING_LEVEL_ATTR,
            normalizeHeadingLevel(attrs?.[HEADING_LEVEL_ATTR] ?? 1),
          );
        } else {
          attrMap.delete("level");
        }
        // `checked` only means anything on a todo item — drop it on any other
        // type so a former todo doesn't carry a stale (or reappearing) state.
        if (type !== "todo-list") attrMap.delete(TODO_CHECKED_ATTR);
        // Merge any remaining explicit attrs (skip the ones handled above).
        if (attrs) {
          for (const [k, v] of Object.entries(attrs)) {
            if (k === "level" || k === TODO_CHECKED_ATTR) continue;
            if (v === undefined) attrMap.delete(k);
            else attrMap.set(k, v);
          }
        }
      }
    }, LOCAL_ORIGIN);
  }

  blockTypeAtSelection(): BlockType | null {
    const sel = this.selection;
    if (!sel) return null;
    const block = this.byId(sel.focus.blockId);
    return block ? blockType(block) : null;
  }

  /** Merge attrs onto the block at the caret — restores a pasted atomic block's
   *  attrs (e.g. an image's src/ratio) so it doesn't reset to defaults. */
  setBlockAttrsAtSelection(attrs: Record<string, unknown>): void {
    const id = this.selection?.focus.blockId;
    if (id) this.setBlockAttrs(id, attrs);
  }

  /**
   * Merge attrs onto a block by id (delete a key by passing `undefined`).
   * This is how a custom block's renderer persists its own state — e.g. a
   * table writing its cells — so the change syncs, undoes, and re-measures
   * like any other edit.
   */
  setBlockAttrs(id: string, attrs: Record<string, unknown>): void {
    const block = this.byId(id);
    const attrMap = block?.get("attrs");
    if (!(attrMap instanceof Y.Map)) return;
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined) attrMap.delete(k);
        else attrMap.set(k, v);
      }
    }, LOCAL_ORIGIN);
  }
}
