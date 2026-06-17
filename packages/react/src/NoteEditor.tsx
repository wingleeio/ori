import type { EditorController } from "@wingleeio/ori-core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { BlockView } from "./BlockView";
import { CaretLayer, SelectionLayer } from "./Overlay";
import { useEditorSnapshot } from "./hooks";
import { useCallbackRef } from "./internal";
import { handleKeyDown, pasteText } from "./keymap";
import { RenderersProvider, type AtomRenderer, type BlockRenderer } from "./renderers";

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
}

/**
 * A fully virtualized, Pretext-laid-out note editor. Renders only the blocks
 * intersecting the viewport; selection and caret are drawn from logical state
 * so they remain correct across offscreen content.
 */
export const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function NoteEditor(
  {
    editor,
    className,
    style,
    maxWidth = 720,
    placeholder = "Start writing…",
    autoFocus,
    readOnly,
    blockRenderers,
    atomRenderers,
  },
  ref,
) {
  const snapshot = useEditorSnapshot(editor);
  const renderers = useMemo(
    () => ({ blocks: blockRenderers ?? {}, atoms: atomRenderers ?? {} }),
    [blockRenderers, atomRenderers],
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draggingRef = useRef(false);
  const composingRef = useRef(false);
  const [focused, setFocused] = useState(false);

  useImperativeHandle(
    ref,
    (): NoteEditorHandle => ({
      focus: () => inputRef.current?.focus(),
      getCaretRect: () => {
        const c = editor.caretRect();
        const content = contentRef.current;
        if (!c || !content) return null;
        const r = content.getBoundingClientRect();
        return { x: r.left + c.x, y: r.top + c.y, height: c.height };
      },
      getSelectionRect: () => {
        const content = contentRef.current;
        if (!content) return null;
        const rects = editor.selectionRectsForViewport();
        if (rects.length === 0) return null;
        const r = content.getBoundingClientRect();
        let top = Infinity;
        let left = Infinity;
        let bottom = -Infinity;
        let right = -Infinity;
        for (const rc of rects) {
          top = Math.min(top, r.top + rc.y);
          left = Math.min(left, r.left + rc.x);
          bottom = Math.max(bottom, r.top + rc.y + rc.height);
          right = Math.max(right, r.left + rc.x + rc.width);
        }
        return { top, left, right, bottom, width: right - left, height: bottom - top };
      },
      getScrollElement: () => scrollerRef.current,
    }),
    [editor],
  );

  // Keep width + viewport in sync with the DOM.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const sync = () => {
      editor.setWidth(content.clientWidth);
      editor.setViewport(scroller.scrollTop, scroller.clientHeight);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(scroller);
    ro.observe(content);
    return () => ro.disconnect();
  }, [editor]);

  // Recompute measurements once web fonts have loaded.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) void fonts.ready.then(() => editor.invalidateMeasurements());
  }, [editor]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const pointToPosition = useCallbackRef((clientX: number, clientY: number) => {
    const content = contentRef.current;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    return editor.positionFromPoint(clientX - rect.left, clientY - rect.top);
  });

  // Drag-to-select with window-level listeners.
  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      if (!draggingRef.current) return;
      const pos = pointToPosition(e.clientX, e.clientY);
      const sel = editor.getSelection();
      if (pos && sel) editor.setSelection({ anchor: sel.anchor, focus: pos });
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [editor, pointToPosition]);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (scroller) editor.setViewport(scroller.scrollTop, scroller.clientHeight);
  };

  // Bound to the whole scroller (not just the text canvas) so clicking any
  // empty space — padding, the gutter below the last block — still focuses the
  // editor and drops the caret at the nearest position (positionFromPoint clamps).
  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    const scroller = scrollerRef.current;
    // Ignore the native scrollbar gutter so scrollbar drags keep working.
    if (scroller && e.clientX - scroller.getBoundingClientRect().left >= scroller.clientWidth) {
      return;
    }
    inputRef.current?.focus();
    const pos = pointToPosition(e.clientX, e.clientY);
    if (!pos) return;
    e.preventDefault();
    const sel = editor.getSelection();
    if (e.shiftKey && sel) {
      editor.setSelection({ anchor: sel.anchor, focus: pos });
    } else {
      editor.collapse(pos);
    }
    draggingRef.current = true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    handleKeyDown(editor, e, { readOnly });
  };

  const commitInput = () => {
    const el = inputRef.current;
    if (!el) return;
    const value = el.value;
    if (value) {
      if (!readOnly) editor.insertText(value);
      el.value = "";
    }
  };

  const onInput = (e: FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || (e.nativeEvent as InputEvent).isComposing) return;
    commitInput();
  };

  const onCompositionStart = () => {
    composingRef.current = true;
  };

  const onCompositionEnd = (e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const el = inputRef.current;
    if (el) {
      if (e.data && !readOnly) editor.insertText(e.data);
      el.value = "";
    }
  };

  const caret = editor.caretRect();
  const inputStyle: CSSProperties = {
    position: "absolute",
    left: caret ? caret.x : 0,
    top: caret ? caret.y : 0,
    width: 1,
    height: caret ? caret.height : 16,
    opacity: 0,
    padding: 0,
    border: 0,
    outline: "none",
    resize: "none",
    background: "transparent",
    caretColor: "transparent",
    color: "transparent",
    overflow: "hidden",
    whiteSpace: "pre",
    zIndex: 1,
  };

  return (
    <RenderersProvider value={renderers}>
      <div className={`ori-root${className ? ` ${className}` : ""}`} style={style}>
      <div className="ori-scroller" ref={scrollerRef} onScroll={onScroll} onMouseDown={onMouseDown}>
        <div
          className="ori-content"
          ref={contentRef}
          style={{ maxWidth, marginInline: "auto", position: "relative" }}
        >
          <div
            className="ori-canvas"
            style={{ position: "relative", width: "100%", height: snapshot.totalHeight }}
          >
            <SelectionLayer editor={editor} snapshot={snapshot} />
            {snapshot.visible.map((block) => (
              <BlockView key={block.id} editor={editor} block={block} />
            ))}
            <CaretLayer editor={editor} snapshot={snapshot} focused={focused} />
            {snapshot.empty && placeholder ? (
              <div className="ori-placeholder" aria-hidden>
                {placeholder}
              </div>
            ) : null}
            {!readOnly ? (
              <textarea
                ref={inputRef}
                className="ori-input"
                style={inputStyle}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onKeyDown={onKeyDown}
                onInput={onInput}
                onCompositionStart={onCompositionStart}
                onCompositionEnd={onCompositionEnd}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onCopy={(e) => {
                  e.preventDefault();
                  e.clipboardData.setData("text/plain", editor.getSelectedText());
                }}
                onCut={(e) => {
                  e.preventDefault();
                  e.clipboardData.setData("text/plain", editor.getSelectedText());
                  editor.deleteBackward();
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  pasteText(editor, e.clipboardData.getData("text/plain"));
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
      </div>
    </RenderersProvider>
  );
});
