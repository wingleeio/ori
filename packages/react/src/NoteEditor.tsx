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
} from "react";
import { BlockView } from "./BlockView";
import { CaretLayer, SelectionHandles, SelectionLayer } from "./Overlay";
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

/** The single contiguous edit between two strings (common prefix/suffix diff). */
function diffReplace(
  oldText: string,
  newText: string,
): { from: number; to: number; insert: string } {
  const max = Math.min(oldText.length, newText.length);
  let p = 0;
  while (p < max && oldText[p] === newText[p]) p++;
  let s = 0;
  while (s < max - p && oldText[oldText.length - 1 - s] === newText[newText.length - 1 - s]) s++;
  return { from: p, to: oldText.length - s, insert: newText.slice(p, newText.length - s) };
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
  const composingRef = useRef(false);
  // On touch devices the hidden input mirrors the focused block's text so the
  // native caret / iOS spacebar-trackpad / selection traverse real characters.
  const mirrorRef = useRef<{ blockId: string; text: string } | null>(null);
  const [focused, setFocused] = useState(false);
  // Coarse pointer (touch): show drag handles and suppress scroll while selecting.
  const [coarse, setCoarse] = useState(false);
  const [touchSelecting, setTouchSelecting] = useState(false);

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

  // Detect coarse (touch) pointers so we can show drag handles + tap gestures.
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  const gestureRef = useRef<{
    id: number;
    type: string;
    x: number;
    y: number;
    pos: ReturnType<typeof editor.positionFromPoint>;
    mode: "idle" | "mouseDrag" | "touchSelect" | "scroll";
    moved: boolean;
    longPress?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const lastTapRef = useRef({ t: 0, x: 0, y: 0, count: 0 });

  // Unified pointer + gesture handling (mouse / touch / pen): tap places the
  // caret, double-tap selects the word, triple-tap the block; touch long-press
  // selects the word; mouse-drag (or post-long-press touch-drag) extends the
  // selection; a plain vertical touch-drag scrolls (touch-action: pan-y).
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const TAP_SLOP = 10;
    const MULTI_DIST = 28;
    const MULTI_MS = 400;
    const LONG_MS = 480;

    const end = () => {
      const g = gestureRef.current;
      if (g?.longPress) clearTimeout(g.longPress);
      gestureRef.current = null;
      setTouchSelecting(false);
    };

    const tap = (x: number, y: number, type: string) => {
      const pos = pointToPosition(x, y);
      if (!pos) return;
      if (type !== "mouse") inputRef.current?.focus();
      const now = Date.now();
      const lt = lastTapRef.current;
      const near = Math.hypot(x - lt.x, y - lt.y) <= MULTI_DIST;
      const count = near && now - lt.t <= MULTI_MS ? Math.min(lt.count + 1, 3) : 1;
      lastTapRef.current = { t: now, x, y, count };
      if (count === 2) editor.selectWordAt(pos);
      else if (count === 3) editor.selectBlockAt(pos);
      else editor.collapse(pos);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Let the selection handles manage their own drag.
      if ((e.target as HTMLElement | null)?.closest?.(".ori-handle")) return;
      if (e.clientX - scroller.getBoundingClientRect().left >= scroller.clientWidth) return; // scrollbar
      const pos = pointToPosition(e.clientX, e.clientY);
      const g = {
        id: e.pointerId,
        type: e.pointerType,
        x: e.clientX,
        y: e.clientY,
        pos,
        mode: "idle" as "idle" | "mouseDrag" | "touchSelect" | "scroll",
        moved: false,
        longPress: undefined as ReturnType<typeof setTimeout> | undefined,
      };
      gestureRef.current = g;
      if (e.pointerType === "mouse") {
        inputRef.current?.focus();
        if (pos) {
          e.preventDefault();
          const sel = editor.getSelection();
          if (e.shiftKey && sel) editor.setSelection({ anchor: sel.anchor, focus: pos });
          else editor.collapse(pos);
          g.mode = "mouseDrag";
        }
      } else {
        g.longPress = setTimeout(() => {
          const gg = gestureRef.current;
          if (!gg || gg.mode !== "idle" || gg.moved || !gg.pos) return;
          gg.mode = "touchSelect";
          setTouchSelecting(true);
          inputRef.current?.focus();
          editor.selectWordAt(gg.pos);
        }, LONG_MS);
      }
    };

    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.id) return;
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) > TAP_SLOP) g.moved = true;
      if (g.mode === "mouseDrag" || g.mode === "touchSelect") {
        const pos = pointToPosition(e.clientX, e.clientY);
        const sel = editor.getSelection();
        if (pos && sel) editor.setSelection({ anchor: sel.anchor, focus: pos });
        e.preventDefault();
      } else if (g.mode === "idle" && g.moved && g.type !== "mouse") {
        if (g.longPress) clearTimeout(g.longPress); // a scroll, not a tap/long-press
        g.mode = "scroll";
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.id) return;
      const wasTap = g.mode === "idle" || (g.mode === "mouseDrag" && !g.moved);
      if (wasTap) tap(e.clientX, e.clientY, g.type);
      end();
    };

    // Keep focus in the hidden input. On iOS a touch tap is followed (~300ms) by
    // a synthesized mousedown on the tapped span; its default action moves focus
    // off the input and dismisses the keyboard (the "focus then blur" flicker).
    // Suppressing the mousedown default also stops native text selection on
    // desktop, where we manage selection ourselves.
    const onMouseDown = (e: MouseEvent) => {
      if (e.clientX - scroller.getBoundingClientRect().left >= scroller.clientWidth) return; // scrollbar
      e.preventDefault();
    };

    scroller.addEventListener("pointerdown", onDown, { passive: false });
    scroller.addEventListener("mousedown", onMouseDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", end);
    return () => {
      scroller.removeEventListener("pointerdown", onDown);
      scroller.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", end);
    };
  }, [editor, pointToPosition]);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (scroller) editor.setViewport(scroller.scrollTop, scroller.clientHeight);
  };

  // --- Native caret (touch): mirror the focused block into the hidden input ---

  // Editor → input: keep the input's text + selection mirroring the focus block,
  // so the native caret / trackpad / selection have real characters to move over.
  useEffect(() => {
    if (!coarse) return;
    const el = inputRef.current;
    if (!el || composingRef.current) return;
    const sel = editor.getSelection();
    if (!sel) {
      mirrorRef.current = null;
      return;
    }
    const blockId = sel.focus.blockId;
    const text = editor.getBlockText(blockId);
    // If the input is focused and its value has diverged from both the editor
    // and the last mirror, a native keystroke is in flight — don't overwrite it
    // (onInput will reconcile); just record the new base. Otherwise the editor
    // is the source of truth (tap, arrows, delete, remote edit) → push to input.
    const pendingNativeInput =
      document.activeElement === el && el.value !== text && el.value !== mirrorRef.current?.text;
    if (!pendingNativeInput) {
      if (el.value !== text) el.value = text;
      const a = sel.anchor.blockId === blockId ? sel.anchor.offset : sel.focus.offset;
      const f = sel.focus.offset;
      const start = Math.min(a, f);
      const end = Math.max(a, f);
      if (el.selectionStart !== start || el.selectionEnd !== end) {
        try {
          el.setSelectionRange(start, end, f < a ? "backward" : "forward");
        } catch {
          /* input not focused yet */
        }
      }
    }
    mirrorRef.current = { blockId, text };
  }, [coarse, editor, snapshot.revision]);

  // Input → editor: when the native caret/selection moves on its own (trackpad,
  // arrows handled natively, native selection), map it back into the editor.
  useEffect(() => {
    if (!coarse) return;
    const onSelChange = () => {
      const el = inputRef.current;
      const m = mirrorRef.current;
      if (!el || !m || composingRef.current || document.activeElement !== el) return;
      if (el.value !== m.text) return; // mid-edit; onInput will reconcile
      const a = el.selectionStart ?? 0;
      const b = el.selectionEnd ?? 0;
      const backward = el.selectionDirection === "backward";
      const anchorOff = backward ? b : a;
      const focusOff = backward ? a : b;
      const cur = editor.getSelection();
      if (
        cur &&
        cur.anchor.blockId === m.blockId &&
        cur.focus.blockId === m.blockId &&
        cur.anchor.offset === anchorOff &&
        cur.focus.offset === focusOff
      ) {
        return;
      }
      editor.setSelection({
        anchor: { blockId: m.blockId, offset: anchorOff },
        focus: { blockId: m.blockId, offset: focusOff },
      });
    };
    // iOS dispatches `selectionchange` on the <textarea> itself; other engines
    // dispatch it on `document`. Listen on both so the spacebar-trackpad and
    // native caret moves are caught everywhere.
    const el = inputRef.current;
    document.addEventListener("selectionchange", onSelChange);
    el?.addEventListener("selectionchange", onSelChange);
    return () => {
      document.removeEventListener("selectionchange", onSelChange);
      el?.removeEventListener("selectionchange", onSelChange);
    };
  }, [coarse, editor]);

  // Apply the difference between the mirrored block text and the input's new
  // value to the editor (used for native typing / autocorrect / IME on touch).
  const applyMirrorDiff = () => {
    const el = inputRef.current;
    const m = mirrorRef.current;
    if (!el || !m || readOnly) return;
    const { from, to, insert } = diffReplace(m.text, el.value);
    if (from === to && insert === "") return;
    editor.setSelection({
      anchor: { blockId: m.blockId, offset: from },
      focus: { blockId: m.blockId, offset: to },
    });
    if (to > from) editor.deleteBackward();
    if (insert) editor.insertText(insert);
    // Keep the mirror in lock-step synchronously — the effect that refreshes it
    // runs after render, which is too late for a fast burst of keystrokes.
    mirrorRef.current = { blockId: m.blockId, text: el.value };
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
    // Touch: reconcile the mirrored block by diff; desktop: append-and-clear.
    if (coarse && mirrorRef.current) applyMirrorDiff();
    else commitInput();
  };

  const onCompositionStart = () => {
    composingRef.current = true;
  };

  const onCompositionEnd = (e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    if (coarse && mirrorRef.current) {
      applyMirrorDiff(); // re-sync handled by the mirror effect (don't clear)
    } else {
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
    // 16px keeps iOS from zooming on focus and treats it as a real input the
    // spacebar-trackpad will engage.
    fontSize: "16px",
  };

  return (
    <RenderersProvider value={renderers}>
      <div className={`ori-root${className ? ` ${className}` : ""}`} style={style}>
      <div
        className="ori-scroller"
        ref={scrollerRef}
        onScroll={onScroll}
        data-touch-selecting={touchSelecting ? "" : undefined}
      >
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
            {coarse ? (
              <SelectionHandles editor={editor} snapshot={snapshot} pointToPosition={pointToPosition} />
            ) : null}
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
                autoComplete="off"
                inputMode="text"
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
