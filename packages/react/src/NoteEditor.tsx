import type { EditorController } from "@wingleeio/ori-core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
 * A contentEditable note editor: the browser owns caret, selection, trackpad,
 * native menus and IME on the live text, while edits are routed through the
 * {@link EditorController} (Y.Doc). A custom caret is drawn on top so it can be
 * branded/animated independently of the (hidden) native one.
 */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  { editor, className, style, maxWidth = 720, placeholder, autoFocus, readOnly, blockRenderers, atomRenderers },
  ref,
) {
  const snapshot = useEditorSnapshot(editor);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // (Re)starts the idle background-measurement loop; set by its effect below.
  const restartBgRef = useRef<() => void>(noop);
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState<{ x: number; y: number; h: number } | null>(null);

  // Keep the latest renderers reachable without recreating the view.
  const renderersRef = useRef({ blockRenderers, atomRenderers });
  renderersRef.current = { blockRenderers, atomRenderers };

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      focus: () => (viewRef.current ? viewRef.current.focus() : contentRef.current?.focus()),
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

  // Create the imperative contentEditable view once.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const view = new EditorView(el, editor, {
      readOnly,
      renderAtom: (t) => renderersRef.current.atomRenderers?.[t],
      renderBlock: (t) => renderersRef.current.blockRenderers?.[t],
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
    if (autoFocus) contentRef.current?.focus();
  }, [autoFocus]);

  // Position the custom caret from the live DOM selection.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const content = contentRef.current;
      const s = window.getSelection();
      if (!content || !s || s.rangeCount === 0 || !s.isCollapsed || !content.contains(s.anchorNode)) {
        setCaret(null);
        return;
      }
      const r = caretClientRect();
      const box = content.getBoundingClientRect();
      if (r) setCaret({ x: r.left - box.left, y: r.top - box.top, h: r.height || 18 });
    };
    // Measure now, then again after layout settles — an inline atom (mention)
    // mounts its renderer asynchronously, so its width (and the caret position
    // beside it) isn't known on the first measure.
    const schedule = () => {
      update();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => requestAnimationFrame(update));
    };
    document.addEventListener("selectionchange", schedule);
    const ro = new ResizeObserver(update);
    if (contentRef.current) ro.observe(contentRef.current);
    schedule();
    return () => {
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
    content.focus();
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

  const showCaret = focused && !!caret && !readOnly;

  return (
    <div className={`ori-root${className ? ` ${className}` : ""}`} style={style}>
      <div className="ori-scroller" ref={scrollerRef} onScroll={onScroll} onPointerDown={onPointerDown}>
        <div className="ori-content" ref={overlayRef} style={{ maxWidth, marginInline: "auto", position: "relative" }}>
          <div
            className="ori-canvas ori-ce"
            ref={contentRef}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            suppressContentEditableWarning
          />
          {showCaret && caret ? (
            <div
              className="ori-caret"
              style={{ position: "absolute", left: caret.x, top: caret.y, height: caret.h, pointerEvents: "none" }}
              aria-hidden
            />
          ) : null}
          {snapshot.empty && placeholder ? (
            <div className="ori-placeholder" aria-hidden>
              {placeholder}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
