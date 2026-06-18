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
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState<{ x: number; y: number; h: number } | null>(null);

  // Keep the latest renderers reachable without recreating the view.
  const renderersRef = useRef({ blockRenderers, atomRenderers });
  renderersRef.current = { blockRenderers, atomRenderers };

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      focus: () => contentRef.current?.focus(),
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

  useEffect(() => {
    if (autoFocus) contentRef.current?.focus();
  }, [autoFocus]);

  // Position the custom caret from the live DOM selection.
  useEffect(() => {
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
    document.addEventListener("selectionchange", update);
    const ro = new ResizeObserver(update);
    if (contentRef.current) ro.observe(contentRef.current);
    update();
    return () => {
      document.removeEventListener("selectionchange", update);
      ro.disconnect();
    };
  }, []);

  // Drive virtualization: keep the controller's width + viewport in sync.
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    const content = contentRef.current;
    if (!sc || !content) return;
    const sync = () => {
      editor.setWidth(content.clientWidth);
      editor.setViewport(sc.scrollTop, sc.clientHeight);
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
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    // Only act on the editor's own empty surface — not on blocks (the browser
    // places the caret) and not on floating UI (menus) layered into the overlay.
    const t = e.target as HTMLElement;
    const onSurface =
      t === scrollerRef.current ||
      t === overlayRef.current ||
      t.classList.contains("ori-ce") ||
      t.dataset.spacer != null;
    if (!onSurface) return;
    const content = contentRef.current;
    const blocks = content?.querySelectorAll("[data-block-id]");
    const last = blocks && (blocks[blocks.length - 1] as HTMLElement | undefined);
    if (!content || !last) return;
    if (e.clientY <= last.getBoundingClientRect().bottom) return; // beside text, not below
    e.preventDefault();
    content.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(last);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
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
