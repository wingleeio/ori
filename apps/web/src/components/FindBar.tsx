import type { EditorController, FindMatch } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

/** Cap on painted match highlights so a one-letter query can't flood the DOM. */
const MAX_HIGHLIGHTS = 300;

/**
 * Match highlights painted into the editor's content overlay (which scrolls
 * with the text). Native selection can't highlight matches while the find
 * input holds focus, so — like every production editor — matches are drawn as
 * overlay rectangles from the model's own geometry (`rectsForRange`), which
 * works even for blocks virtualization hasn't rendered.
 */
function MatchHighlights({
  editor,
  editorRef,
  matches,
  active,
  revision,
}: {
  editor: EditorController;
  editorRef: RefObject<NoteEditorHandle | null>;
  matches: FindMatch[];
  active: number;
  revision: number;
}) {
  void revision; // geometry depends on the document revision
  const overlay = editorRef.current?.getOverlayElement();
  if (!overlay || matches.length === 0) return null;
  const rects = matches.slice(0, MAX_HIGHLIGHTS).flatMap((m, i) =>
    editor
      .rectsForRange({ blockId: m.blockId, offset: m.start }, { blockId: m.blockId, offset: m.end })
      .map((r, j) => ({ ...r, key: `${i}:${j}`, isActive: i === active })),
  );
  return createPortal(
    <>
      {rects.map((r) => (
        <div
          key={r.key}
          aria-hidden
          style={{
            position: "absolute",
            left: r.x,
            top: r.y,
            width: Math.max(r.width, 2),
            height: r.height,
            borderRadius: 2,
            pointerEvents: "none",
            background: r.isActive ? "rgba(250, 204, 21, 0.45)" : "rgba(250, 204, 21, 0.18)",
            outline: r.isActive ? "1px solid rgba(202, 138, 4, 0.8)" : "none",
            zIndex: 1,
          }}
        />
      ))}
    </>,
    overlay,
  );
}

export interface FindBarProps {
  editor: EditorController;
  editorRef: RefObject<NoteEditorHandle | null>;
  open: boolean;
  onClose: () => void;
}

/**
 * Cmd+F find & replace bar. Matching runs against the model (`findAll`), so it
 * finds text in blocks that virtualization hasn't rendered; navigating scrolls
 * the match into view and selects it through the editor.
 */
export function FindBar({ editor, editorRef, open, onClose }: FindBarProps) {
  const snapshot = useEditorSnapshot(editor);
  const [query, setQuery] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Recompute matches when the query or the document changes.
  const matches = useMemo<FindMatch[]>(
    () => (open && query ? editor.findAll(query) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, open, query, snapshot.revision],
  );

  useEffect(() => {
    if (open) inputRef.current?.select();
  }, [open]);

  useEffect(() => {
    if (active >= matches.length) setActive(0);
  }, [matches.length, active]);

  if (!open) return null;

  const goTo = (index: number) => {
    const m = matches[index];
    if (!m) return;
    setActive(index);
    const sc = editorRef.current?.getScrollElement();
    if (sc) {
      const top = editor.getBlockTop(m.blockId);
      if (top < sc.scrollTop + 40 || top > sc.scrollTop + sc.clientHeight - 80) {
        sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
      }
    }
    editor.selectMatch(m);
  };
  const next = () => matches.length && goTo((active + 1) % matches.length);
  const prev = () => matches.length && goTo((active - 1 + matches.length) % matches.length);

  const replaceCurrent = () => {
    const m = matches[active];
    if (!m) return;
    editor.replaceMatch(m, replaceValue);
    // Matches recompute from the new revision; stay near the same index.
  };
  const replaceAll = () => {
    if (query) editor.replaceAll(query, replaceValue);
  };

  return (
    <>
    <MatchHighlights
      editor={editor}
      editorRef={editorRef}
      matches={matches}
      active={active}
      revision={snapshot.revision}
    />
    <div
      data-ori-overlay
      className="absolute right-6 top-3 z-40 flex flex-col gap-1 rounded-xl bg-popover p-2 shadow-lg ring-1 ring-border/60"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
          editorRef.current?.focus();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={query}
          placeholder="Find…"
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) prev();
              else next();
            }
          }}
          className="h-7 w-44 rounded-md border border-border/60 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="w-14 text-center text-xs tabular-nums text-muted-foreground">
          {matches.length ? `${Math.min(active + 1, matches.length)}/${matches.length}` : query ? "0/0" : ""}
        </span>
        <Button variant="ghost" size="icon-sm" className="size-6" title="Previous (Shift+Enter)" onClick={prev} disabled={!matches.length}>
          <ChevronUp className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-6" title="Next (Enter)" onClick={next} disabled={!matches.length}>
          <ChevronDown className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" className="size-6" title="Close (Esc)" onClick={() => { onClose(); editorRef.current?.focus(); }}>
          <X className="size-3.5" />
        </Button>
      </div>
      <div className="flex items-center gap-1">
        <input
          value={replaceValue}
          placeholder="Replace with…"
          onChange={(e) => setReplaceValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              replaceCurrent();
            }
          }}
          className="h-7 w-44 rounded-md border border-border/60 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={replaceCurrent} disabled={!matches.length}>
          Replace
        </Button>
        <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={replaceAll} disabled={!matches.length}>
          All
        </Button>
      </div>
    </div>
    </>
  );
}
