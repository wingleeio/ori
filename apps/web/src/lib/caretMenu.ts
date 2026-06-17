import type { NoteEditorHandle } from "@wingleeio/ori-react";
import type { CSSProperties, RefObject } from "react";

/**
 * Position a caret-anchored menu (slash / mention) inside the editor's content
 * overlay with content-relative coordinates, so it rides the scroll natively
 * rather than trailing it (the same approach as the selection toolbar). Render
 * the returned `style` on an element portaled into `overlay`.
 */
export function caretMenu(
  editorRef: RefObject<NoteEditorHandle | null>,
  width: number,
  maxHeight = 320,
): { style: CSSProperties; overlay: HTMLElement } | null {
  const c = editorRef.current?.getCaretRect();
  const overlay = editorRef.current?.getOverlayElement();
  if (!c || !overlay) return null;
  const box = overlay.getBoundingClientRect();
  const sc = editorRef.current?.getScrollElement()?.getBoundingClientRect();
  const vpBottom = sc ? sc.bottom : window.innerHeight;
  const vpTop = sc ? sc.top : 0;
  const placeAbove = c.y + c.height + maxHeight > vpBottom && c.y - vpTop > maxHeight;
  const topVp = placeAbove ? c.y - 6 : c.y + c.height + 6;
  const left = Math.max(0, Math.min(c.x - box.left, box.width - width - 8));
  return {
    style: {
      position: "absolute",
      top: topVp - box.top,
      left,
      width,
      transform: placeAbove ? "translateY(-100%)" : undefined,
    },
    overlay,
  };
}
