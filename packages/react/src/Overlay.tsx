import type { EditorController, EditorSnapshot, Position } from "@wingleeio/ori-core";
import { isCollapsed } from "@wingleeio/ori-core";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/** Selection rectangles for visible blocks (rendered beneath the text). */
export function SelectionLayer({
  editor,
  snapshot,
}: {
  editor: EditorController;
  snapshot: EditorSnapshot;
}) {
  // Tie recomputation to the snapshot revision.
  void snapshot.revision;
  const rects = editor.selectionRectsForViewport();
  if (rects.length === 0) return null;
  return (
    <div className="ori-selection-layer" aria-hidden>
      {rects.map((r, i) => (
        <div
          key={`${r.blockId}:${i}`}
          className="ori-selection-rect"
          style={{ position: "absolute", left: r.x, top: r.y, width: r.width, height: r.height }}
        />
      ))}
    </div>
  );
}

type PointFn = (clientX: number, clientY: number) => Position | null;

/**
 * iOS-style draggable selection handles (touch only). A knob sits above the
 * selection start and below the selection end; dragging a knob extends that
 * edge while the opposite edge stays anchored.
 */
export function SelectionHandles({
  editor,
  snapshot,
  pointToPosition,
}: {
  editor: EditorController;
  snapshot: EditorSnapshot;
  pointToPosition: PointFn;
}) {
  void snapshot.revision;
  const drag = useRef<{ fixed: Position } | null>(null);
  const sel = snapshot.selection;
  if (!sel || isCollapsed(sel)) return null;
  const range = editor.orderedSelection();
  if (!range) return null;
  const rects = editor.selectionRectsForViewport();
  if (rects.length === 0) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];

  const start =
    (which: "start" | "end") => (e: ReactPointerEvent) => {
      const r = editor.orderedSelection();
      if (!r) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = { fixed: which === "start" ? r.end : r.start };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic / already-released pointer */
      }
    };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    const pos = pointToPosition(e.clientX, e.clientY);
    if (pos) editor.setSelection({ anchor: d.fixed, focus: pos });
  };
  const up = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag.current = null;
  };

  const handle = (kind: "start" | "end", x: number, y: number, h: number) => (
    <div
      className={`ori-handle ori-handle-${kind}`}
      style={{ position: "absolute", left: x, top: y, height: h }}
      onPointerDown={start(kind)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="ori-handle-knob" />
      <span className="ori-handle-bar" />
    </div>
  );

  return (
    <div className="ori-handles" aria-hidden>
      {handle("start", first.x, first.y, first.height)}
      {handle("end", last.x + last.width, last.y, last.height)}
    </div>
  );
}

/** Blinking caret, shown only when focused and the selection is collapsed. */
export function CaretLayer({
  editor,
  snapshot,
  focused,
}: {
  editor: EditorController;
  snapshot: EditorSnapshot;
  focused: boolean;
}) {
  const sel = snapshot.selection;
  if (!focused || !sel || !isCollapsed(sel)) return null;
  const rect = editor.caretRect();
  if (!rect) return null;
  return (
    <div
      className="ori-caret"
      style={{ position: "absolute", left: rect.x, top: rect.y, height: rect.height }}
      aria-hidden
    />
  );
}
