import { isCollapsed, type EditorController } from "@wingleeio/ori-core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { EditorView } from "./ce/view";
import { useEditorSnapshot } from "./hooks";
import type { AtomRenderer, BlockRenderer } from "./renderers";

export interface NoteEditorProps {
  editor: EditorController;
  className?: string;
  style?: CSSProperties;
  /** Max width of the centered content column, in px. */
  maxWidth?: number;
  placeholder?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
  /** Renderers for custom (atomic) block node types. */
  blockRenderers?: Record<string, BlockRenderer>;
  /** Renderers for custom inline atom types. */
  atomRenderers?: Record<string, AtomRenderer>;
  /**
   * Called on Cmd/Ctrl+K with the model selection already synced — show your
   * link UI, then call `editor.setLink(url)` / `editor.removeLink()`.
   */
  onLinkShortcut?: () => void;
  /** Accessible name for the editing surface (aria-label on the textbox). */
  ariaLabel?: string;
  /**
   * Show a hover drag handle in the left margin for reordering blocks
   * (mouse only; hidden on touch and when read-only). Default true.
   */
  dragHandle?: boolean;
  /**
   * App keyboard shortcuts (`"Mod-Shift-k": handler`), checked before the
   * editor's built-ins with the model selection already synced. Return `true`
   * from a handler to consume the event.
   */
  keymap?: Record<string, (editor: EditorController) => boolean | void>;
}

/** A viewport-space rectangle (client coordinates). */
export interface ViewportRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Imperative handle for building floating UI (slash / selection menus). */
export interface NoteEditorHandle {
  focus(): void;
  /** Caret position in viewport coordinates, or null if unavailable. */
  getCaretRect(): { x: number; y: number; height: number } | null;
  /** Bounding box of the current selection in viewport coordinates, or null. */
  getSelectionRect(): ViewportRect | null;
  /** The scrolling element, for scroll-aware positioning. */
  getScrollElement(): HTMLElement | null;
  /**
   * The content overlay element (a positioned layer that scrolls *with* the
   * text). Render floating UI into this with `position: absolute` and
   * content-relative coordinates so it rides the scroll natively instead of
   * trailing it (which causes a fixed-position toolbar to shake on scroll).
   */
  getOverlayElement(): HTMLElement | null;
}

const noop = (): void => {};

/** The caret position nearest a viewport point (Chrome/Safari + Firefox). */
function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const r = document.createRange();
  r.setStart(pos.offsetNode, pos.offset);
  r.collapse(true);
  return r;
}

function caretClientRect(): DOMRect | null {
  const s = window.getSelection();
  if (!s || s.rangeCount === 0) return null;
  const r = s.getRangeAt(0).cloneRange();
  r.collapse(s.focusNode === r.endContainer && s.focusOffset === r.endOffset ? false : true);
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const b = r.getBoundingClientRect();
  if (b.height || b.width) return b;
  const node = r.startContainer;
  // Caret sits just after an inline atom (a contentEditable=false chip) with no
  // text to measure: anchor it to the atom's right edge so it stays visible.
  if (node.nodeType === Node.ELEMENT_NODE && r.startOffset > 0) {
    const prev = (node as HTMLElement).childNodes[r.startOffset - 1];
    if (prev instanceof HTMLElement && prev.dataset.atom != null) {
      const pb = prev.getBoundingClientRect();
      if (pb.height || pb.width) return new DOMRect(pb.right, pb.top, 0, pb.height || 18);
    }
  }
  // Empty block (`<br>` only): a collapsed range there has no client rects, so
  // synthesize the caret from the block box + its line metrics. Without this the
  // custom caret would vanish on empty lines (the native caret is hidden).
  const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) ?? null;
  if (!el) return null;
  const eb = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 18;
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padT = parseFloat(cs.paddingTop) || 0;
  return new DOMRect(eb.left + padL, eb.top + padT, 0, lh);
}

/**
 * Visually-hidden document outline: a navigation landmark listing every
 * heading, with jump buttons. Virtualization keeps off-screen blocks out of
 * the DOM entirely, so a screen reader can't survey the document by reading —
 * this landmark restores whole-document structure (and gives keyboard users
 * jump-to-section for free). Recomputed per revision; it reads text only for
 * headings, so it stays cheap on large notes.
 */
function OutlineNav({
  editor,
  revision,
  scrollerRef,
}: {
  editor: EditorController;
  revision: number;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  void revision; // re-render trigger; the outline itself comes from the editor
  const outline = editor.getOutline();
  if (outline.length === 0) return null;
  return (
    <nav aria-label="Document outline" className="ori-visually-hidden">
      <ul>
        {outline.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => {
                const sc = scrollerRef.current;
                if (sc) sc.scrollTop = editor.getBlockTop(h.id);
                editor.setSelection({
                  anchor: { blockId: h.id, offset: 0 },
                  focus: { blockId: h.id, offset: 0 },
                });
              }}
            >
              {`H${h.level}: ${h.text || "(empty heading)"}`}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Hover drag handle for reordering blocks (the Notion-style grip). Lives in
 * the content overlay so it scrolls with the text. Mouse-only by design: it's
 * a hover affordance, and touch text-selection would fight a touch drag.
 *
 * Dragging never uses HTML5 DnD (which would serialize the block into a data
 * transfer and fight the text-range drag in the view) — it's a pointer-capture
 * loop that picks an insertion index from the rendered blocks' midpoints and
 * calls `editor.moveBlock` on drop. Virtualization note: targets are the
 * *rendered* blocks, which always cover the viewport, so every drop the user
 * can see is reachable; auto-scroll at the edges extends the range.
 */
function DragHandles({
  editor,
  scrollerRef,
  contentRef,
  overlayRef,
}: {
  editor: EditorController;
  scrollerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const [hover, setHover] = useState<{ id: string; top: number; height: number } | null>(null);
  const [dropTop, setDropTop] = useState<number | null>(null);
  const dragRef = useRef<{ id: string; lastIndex: number | null } | null>(null);

  // Track the hovered block from mouse movement over the scroller.
  useEffect(() => {
    const sc = scrollerRef.current;
    const overlay = overlayRef.current;
    if (!sc || !overlay) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || dragRef.current) return;
      const content = contentRef.current;
      if (!content) return;
      const blocks = [...content.querySelectorAll("[data-block-id]")] as HTMLElement[];
      const overlayRect = overlay.getBoundingClientRect();
      for (const b of blocks) {
        const r = b.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          setHover({
            id: b.dataset.blockId as string,
            top: r.top - overlayRect.top,
            height: r.height,
          });
          return;
        }
      }
      setHover(null);
    };
    const onLeave = () => {
      if (!dragRef.current) setHover(null);
    };
    sc.addEventListener("pointermove", onMove);
    sc.addEventListener("pointerleave", onLeave);
    return () => {
      sc.removeEventListener("pointermove", onMove);
      sc.removeEventListener("pointerleave", onLeave);
    };
  }, [editor, scrollerRef, contentRef, overlayRef]);

  /** Insertion index (in document order) for a pointer Y, from rendered blocks. */
  const insertionAt = (clientY: number): { index: number; top: number } | null => {
    const content = contentRef.current;
    const overlay = overlayRef.current;
    if (!content || !overlay) return null;
    const overlayRect = overlay.getBoundingClientRect();
    const visible = editor.getSnapshot().visible;
    const byId = new Map(visible.map((v) => [v.id, v] as const));
    const blocks = [...content.querySelectorAll("[data-block-id]")] as HTMLElement[];
    for (const b of blocks) {
      const v = byId.get(b.dataset.blockId as string);
      if (!v) continue;
      const r = b.getBoundingClientRect();
      if (clientY < (r.top + r.bottom) / 2) {
        return { index: v.index, top: r.top - overlayRect.top };
      }
    }
    // Past the last rendered block → insert after it.
    const last = blocks[blocks.length - 1];
    const lastV = last ? byId.get(last.dataset.blockId as string) : undefined;
    if (!last || !lastV) return null;
    return { index: lastV.index + 1, top: last.getBoundingClientRect().bottom - overlayRect.top };
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!hover) return;
    e.preventDefault(); // don't move focus / start a text selection
    const id = hover.id;
    dragRef.current = { id, lastIndex: null };
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const sc = scrollerRef.current;
      // Auto-scroll near the viewport edges so long documents are reachable.
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (ev.clientY < r.top + 32) sc.scrollTop -= 12;
        else if (ev.clientY > r.bottom - 32) sc.scrollTop += 12;
      }
      const at = insertionAt(ev.clientY);
      dragRef.current = { id, lastIndex: at ? at.index : null };
      setDropTop(at ? at.top : null);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      const drag = dragRef.current;
      dragRef.current = null;
      setDropTop(null);
      if (!drag || drag.lastIndex == null) return;
      const from = editor.getBlockIndex(drag.id);
      if (from < 0) return;
      // `lastIndex` is "insert before block currently at this index"; removing
      // the dragged block first shifts later indices down by one.
      const to = drag.lastIndex > from ? drag.lastIndex - 1 : drag.lastIndex;
      editor.moveBlock(drag.id, to);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <>
      {hover ? (
        <div
          className="ori-drag-handle"
          style={{
            position: "absolute",
            left: -24,
            top: hover.top + Math.max(0, (Math.min(hover.height, 28) - 18) / 2),
            cursor: dragRef.current ? "grabbing" : "grab",
          }}
          contentEditable={false}
          aria-hidden
          onPointerDown={onHandleDown}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2.5" cy="2" r="1.4" />
            <circle cx="7.5" cy="2" r="1.4" />
            <circle cx="2.5" cy="7" r="1.4" />
            <circle cx="7.5" cy="7" r="1.4" />
            <circle cx="2.5" cy="12" r="1.4" />
            <circle cx="7.5" cy="12" r="1.4" />
          </svg>
        </div>
      ) : null}
      {dropTop != null ? (
        <div
          className="ori-drop-indicator"
          style={{ position: "absolute", left: 0, right: 0, top: dropTop - 1 }}
          aria-hidden
        />
      ) : null}
    </>
  );
}

/**
 * A contentEditable note editor: the browser owns caret, selection, trackpad,
 * native menus and IME on the live text, while edits are routed through the
 * {@link EditorController} (Y.Doc). A custom caret is drawn on top so it can be
 * branded/animated independently of the (hidden) native one.
 */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { editor, className, style, maxWidth = 720, placeholder, autoFocus, readOnly, blockRenderers, atomRenderers, onLinkShortcut, ariaLabel, dragHandle = true, keymap },
  ref,
) {
  const snapshot = useEditorSnapshot(editor);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // (Re)starts the idle background-measurement loop; set by its effect below.
  const restartBgRef = useRef<() => void>(noop);
  const focusedRef = useRef(false);
  const readOnlyRef = useRef(readOnly);
  const requestCaretUpdateRef = useRef<() => void>(noop);
  readOnlyRef.current = readOnly;

  // Keep the latest renderers/callbacks reachable without recreating the view.
  const renderersRef = useRef({ blockRenderers, atomRenderers, onLinkShortcut, keymap });
  renderersRef.current = { blockRenderers, atomRenderers, onLinkShortcut, keymap };

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      focus: () => (viewRef.current ? viewRef.current.focus() : contentRef.current?.focus({ preventScroll: true })),
      getCaretRect: () => {
        const r = caretClientRect();
        return r ? { x: r.left, y: r.top, height: r.height || 16 } : null;
      },
      getSelectionRect: () => {
        const s = window.getSelection();
        if (!s || s.rangeCount === 0 || s.isCollapsed) return null;
        const b = s.getRangeAt(0).getBoundingClientRect();
        if (!b.width && !b.height) return null;
        return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
      },
      getScrollElement: () => scrollerRef.current,
      getOverlayElement: () => overlayRef.current,
    }),
    [],
  );

  // Create the imperative contentEditable view once. A layout effect (not a
  // passive one) builds the visible window *before the first paint*, so the
  // document shows up a frame sooner — no flash of an empty editor.
  //
  // On the *first* mount (controller not yet sized) seed width/viewport from the
  // DOM so that first render already measures and windows at the real size (no
  // width-0 reflow). We only do this when width is still 0: on later re-runs of
  // this effect (e.g. `readOnly` toggled) the width is owned by the width-sync
  // effect's ResizeObserver — seeding here would set width ahead of it and make
  // its "did width change?" background-measure restart guard miss a real change.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const sc = scrollerRef.current;
    if (sc && editor.getSnapshot().width === 0) {
      editor.setWidth(el.clientWidth);
      editor.setViewport(sc.scrollTop, sc.clientHeight);
    }
    const view = new EditorView(el, editor, {
      readOnly,
      ariaLabel,
      renderAtom: (t) => renderersRef.current.atomRenderers?.[t],
      renderBlock: (t) => renderersRef.current.blockRenderers?.[t],
      // Only intercept Cmd/Ctrl+K when the host actually handles it.
      onLinkShortcut: onLinkShortcut ? () => renderersRef.current.onLinkShortcut?.() : undefined,
      // Live getter so an inline keymap prop stays fresh without recreating
      // the view (which would reset the editing surface).
      get keymap() {
        return renderersRef.current.keymap;
      },
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [editor, readOnly]);

  // Reconcile the view when the model changes externally (app commands, undo,
  // remote). The view ignores revisions it produced itself (native typing).
  useEffect(() => {
    viewRef.current?.sync();
  }, [snapshot.revision]);

  // Lazy measurement makes the first paint O(viewport) but leaves total height
  // an estimate. Finish measuring off-screen blocks from idle time so the
  // scrollbar and scroll-to-bottom become exact, without blocking open; the
  // view's scroll-anchoring keeps content from jumping as heights resolve. The
  // loop is restartable so a resize (which re-invalidates offscreen heights at
  // the new width) re-runs it — see the width/viewport sync below.
  useEffect(() => {
    let cancelled = false;
    let handle: number | undefined;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const schedule = w.requestIdleCallback
      ? (cb: () => void) => w.requestIdleCallback!(cb, { timeout: 200 })
      : (cb: () => void) => window.setTimeout(cb, 16) as unknown as number;
    const cancel = w.cancelIdleCallback ?? ((h: number) => window.clearTimeout(h));
    const step = () => {
      handle = undefined;
      if (cancelled) return;
      if (editor.measurePending(300)) handle = schedule(step);
    };
    const start = () => {
      if (cancelled) return;
      if (handle != null) cancel(handle);
      handle = schedule(step);
    };
    restartBgRef.current = start;
    start();
    return () => {
      cancelled = true;
      restartBgRef.current = noop;
      if (handle != null) cancel(handle);
    };
  }, [editor]);

  useEffect(() => {
    if (autoFocus) contentRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // Position the custom caret from the live DOM selection.
  useEffect(() => {
    let raf = 0;
    const hide = () => {
      const caret = caretRef.current;
      if (caret) caret.style.visibility = "hidden";
    };
    const update = () => {
      const content = contentRef.current;
      const caret = caretRef.current;
      const s = window.getSelection();
      // The custom caret draws wherever the DOCUMENT selection lives: the
      // text surface itself, or a widget's own contenteditable (a table
      // cell), whose selection is also readable here. Form controls (inputs)
      // keep their private selection, so the overlay hides for them — they
      // show the native caret instead of ours drawing at a stale position.
      const active = document.activeElement;
      const activeEditable =
        active === content ||
        (active instanceof HTMLElement && content?.contains(active) === true && active.isContentEditable);
      if (
        !content ||
        !caret ||
        readOnlyRef.current ||
        !focusedRef.current ||
        !activeEditable ||
        !s ||
        s.rangeCount === 0 ||
        !s.isCollapsed ||
        !content.contains(s.anchorNode)
      ) {
        hide();
        return;
      }
      const r = caretClientRect();
      const box = content.getBoundingClientRect();
      if (!r) {
        hide();
        return;
      }
      caret.style.transform = `translate3d(${r.left - box.left}px, ${r.top - box.top}px, 0)`;
      caret.style.height = `${r.height || 18}px`;
      caret.style.visibility = "visible";
    };
    // Measure now, then again after layout settles — an inline atom (mention)
    // mounts its renderer asynchronously, so its width (and the caret position
    // beside it) isn't known on the first measure.
    const schedule = () => {
      update();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => requestAnimationFrame(update));
    };
    requestCaretUpdateRef.current = schedule;
    document.addEventListener("selectionchange", schedule);
    const ro = new ResizeObserver(update);
    if (contentRef.current) ro.observe(contentRef.current);
    schedule();
    return () => {
      requestCaretUpdateRef.current = noop;
      document.removeEventListener("selectionchange", schedule);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  // Drive virtualization: keep the controller's width + viewport in sync.
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    const content = contentRef.current;
    if (!sc || !content) return;
    const sync = () => {
      const before = editor.getSnapshot().width;
      editor.setWidth(content.clientWidth);
      editor.setViewport(sc.scrollTop, sc.clientHeight);
      // A width change invalidates every offscreen height; re-run the background
      // pass so total height becomes exact again at the new width.
      if (editor.getSnapshot().width !== before) restartBgRef.current();
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(sc);
    ro.observe(content);
    return () => ro.disconnect();
  }, [editor]);

  const onScroll = () => {
    const sc = scrollerRef.current;
    if (sc) editor.setViewport(sc.scrollTop, sc.clientHeight);
  };

  // Clicking the empty region below the content should focus the editor and put
  // the caret at the document end (the usual "click to keep writing" affordance).
  // Clicking the editor's empty surface (the margins beside a line, or the space
  // below the content) should place the caret at the nearest text position — like
  // a real editor — instead of letting the browser drop it at the document start.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    // Only the editor's own surface; blocks/atoms/menus are handled natively.
    const t = e.target as HTMLElement;
    const onSurface =
      t === scrollerRef.current || t === overlayRef.current || t.classList.contains("ori-ce");
    if (!onSurface) return;
    const content = contentRef.current;
    const blocks = content ? ([...content.querySelectorAll("[data-block-id]")] as HTMLElement[]) : [];
    if (!content || !blocks.length) return;
    e.preventDefault();
    // preventScroll: focusing must never reveal-scroll to the remembered
    // selection — the caret is being placed at the click right below.
    content.focus({ preventScroll: true });
    // Pick the block containing the click's Y, else the block vertically nearest
    // to it, then the line nearest the click within it, then place the caret at
    // that line's start or end depending on which side was clicked — like a real
    // editor, instead of dropping the caret at the document start. "Nearest" (not
    // "last") matters because a click can land in the inter-block spacing gap: the
    // nearest block is the adjacent (on-screen) one, so caretRangeFromPoint below
    // resolves — picking the last rendered block (off-screen in overscan) would
    // not, leaving the native selection stranded on the contentEditable root.
    const distToY = (b: HTMLElement) => {
      const r = b.getBoundingClientRect();
      return e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
    };
    const block =
      blocks.find((b) => distToY(b) === 0) ??
      blocks.reduce((best, b) => (distToY(b) < distToY(best) ? b : best));
    // Fragment rects (a block's own getClientRects is just its box; a range over
    // its contents yields one rect per inline run — multiple per visual line).
    const lineRange = document.createRange();
    lineRange.selectNodeContents(block);
    const frags = [...lineRange.getClientRects()].filter((r) => r.width || r.height);
    if (!frags.length) return;
    // The fragment nearest the click's Y, then every fragment on that visual line.
    const nearest = frags.reduce((a, b) =>
      Math.abs((b.top + b.bottom) / 2 - e.clientY) < Math.abs((a.top + a.bottom) / 2 - e.clientY) ? b : a,
    );
    const midY = (nearest.top + nearest.bottom) / 2;
    const onLine = frags.filter((r) => Math.abs((r.top + r.bottom) / 2 - midY) <= (nearest.bottom - nearest.top) / 2 + 1);
    const lineLeft = Math.min(...onLine.map((r) => r.left));
    const lineRight = Math.max(...onLine.map((r) => r.right));
    const atEnd = e.clientX >= (lineLeft + lineRight) / 2;
    const range = caretRangeFromPoint(atEnd ? lineRight - 1 : lineLeft + 1, midY);
    const sel = window.getSelection();
    if (range && sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  return (
    <div className={`ori-root${className ? ` ${className}` : ""}`} style={style}>
      <OutlineNav editor={editor} revision={snapshot.revision} scrollerRef={scrollerRef} />
      <div className="ori-scroller" ref={scrollerRef} onScroll={onScroll} onPointerDown={onPointerDown}>
        <div className="ori-content" ref={overlayRef} style={{ maxWidth, marginInline: "auto", position: "relative" }}>
          <div
            className="ori-canvas ori-ce"
            ref={contentRef}
            onFocus={() => {
              focusedRef.current = true;
              requestCaretUpdateRef.current();
            }}
            onBlur={() => {
              focusedRef.current = false;
              const caret = caretRef.current;
              if (caret) caret.style.visibility = "hidden";
            }}
            suppressContentEditableWarning
          />
          {!readOnly && dragHandle ? (
            <DragHandles
              editor={editor}
              scrollerRef={scrollerRef}
              contentRef={contentRef}
              overlayRef={overlayRef}
            />
          ) : null}
          {!readOnly ? (
            <div
              ref={caretRef}
              className="ori-caret"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: 18,
                pointerEvents: "none",
                transform: "translate3d(0, 0, 0)",
                visibility: "hidden",
              }}
              aria-hidden
            />
          ) : null}
          {(() => {
            if (!placeholder) return null;
            // Show the placeholder on the empty block at the caret (so a freshly
            // created empty paragraph/list item/quote hints what to type), and on
            // a brand-new empty document even before it's focused. Position it in
            // document space at the block's content start — top accounts for the
            // block's slot + spacing, left/top for its inset (a list's marker
            // gutter, a quote's bar) — so it sits exactly where the caret does.
            const sel = snapshot.selection;
            const caretId =
              sel && isCollapsed(sel) ? sel.focus.blockId : null;
            const target =
              snapshot.visible.find(
                (b) => b.id === caretId && editor.getBlockText(b.id).length === 0,
              ) ?? (snapshot.empty ? snapshot.visible[0] : undefined);
            if (!target) return null;
            // Atomic blocks (table, image, divider) render their own content —
            // their empty hidden Y.Text must not summon the typing hint.
            if (editor.isAtomicType(target.type)) return null;
            const inset = editor.getBlockInset(target.id);
            return (
              <div
                className="ori-placeholder"
                aria-hidden
                style={{ top: target.top + target.spacing + inset.top, left: inset.left }}
              >
                {placeholder}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
});
