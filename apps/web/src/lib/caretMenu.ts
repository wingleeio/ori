import type { NoteEditorHandle } from "@wingleeio/ori-react";
import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keep a caret-anchored menu (slash / mention) glued to the caret. The menu is
 * a fixed overlay portaled to <body>, so it floats above the editor and never
 * affects the editor's scroll size (only text drives overflow). A rAF loop
 * re-reads the caret each frame so it rides the scroll without shaking, and
 * flips above/below relative to the scroll viewport's edge.
 *
 * Returns a ref to attach to the (body-portaled, position:fixed) menu element.
 */
export function useCaretMenu(
  editorRef: RefObject<NoteEditorHandle | null>,
  open: boolean,
  width: number,
  maxHeight = 320,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const el = ref.current;
      const c = editorRef.current?.getCaretRect();
      if (el && c) {
        const sc = editorRef.current?.getScrollElement()?.getBoundingClientRect();
        const vpTop = sc ? sc.top : 0;
        const vpBottom = sc ? sc.bottom : window.innerHeight;
        const above = c.y + c.height + maxHeight > vpBottom && c.y - vpTop > maxHeight;
        el.style.top = `${above ? c.y - 6 : c.y + c.height + 6}px`;
        el.style.left = `${Math.max(8, Math.min(c.x, window.innerWidth - width - 8))}px`;
        el.style.transform = above ? "translateY(-100%)" : "";
        el.style.visibility = "visible";
      }
    };
    place();
    const loop = () => {
      place();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, editorRef, width, maxHeight]);
  return ref;
}
