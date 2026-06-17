import type { EditorController, EditorSnapshot } from "@wingleeio/ori-core";
import { isCollapsed } from "@wingleeio/ori-core";

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
