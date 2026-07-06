import { isCollapsed, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useCaretMenu } from "@/lib/caretMenu";
import { avatarColor, filterPeople, initials, type Person } from "@/lib/people";
import { cn } from "@/lib/utils";

export interface MentionMenuProps {
  editor: EditorController;
  editorRef: RefObject<NoteEditorHandle | null>;
}

interface MentionContext {
  blockId: string;
  query: string;
  atOffset: number;
  caretOffset: number;
}

const MENU_WIDTH = 280;
const MAX_HEIGHT = 320;

/**
 * A real "@" mention autocomplete. Typing `@` (at a block start or after
 * whitespace) opens a people picker; choosing one removes the typed `@query`
 * and inserts a `mention` inline atom — the same measurable custom node the
 * editor lays out and renders as a chip.
 */
export function MentionMenu({ editor, editorRef }: MentionMenuProps) {
  const snapshot = useEditorSnapshot(editor);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const ctx = useMemo<MentionContext | null>(() => {
    const sel = editor.getSelection();
    if (!sel || !isCollapsed(sel)) return null;
    const before = editor.getBlockText(sel.focus.blockId).slice(0, sel.focus.offset);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) return null;
    const query = m[1];
    return {
      blockId: sel.focus.blockId,
      query,
      atOffset: sel.focus.offset - query.length - 1,
      caretOffset: sel.focus.offset,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.revision, editor]);

  const key = ctx ? `${ctx.blockId}:${ctx.atOffset}` : null;
  const people = useMemo(() => (ctx ? filterPeople(ctx.query) : []), [ctx]);
  const open = !!ctx && dismissedKey !== key && people.length > 0;

  useEffect(() => {
    setIndex(0);
  }, [ctx?.query]);
  useEffect(() => {
    if (!ctx) setDismissedKey(null);
  }, [ctx]);

  const apply = (person?: Person) => {
    if (!ctx || !person) return;
    // Replace the typed "@query" with a mention atom, then a trailing space.
    editor.setSelection({
      anchor: { blockId: ctx.blockId, offset: ctx.atOffset },
      focus: { blockId: ctx.blockId, offset: ctx.caretOffset },
    });
    editor.deleteBackward();
    editor.insertInlineAtom({ type: "mention", label: person.name });
    editor.insertText(" ");
    editorRef.current?.focus();
    setDismissedKey(key);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => Math.min(i + 1, people.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        apply(people[index]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedKey(key);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, people, index, key]);

  const menuRef = useCaretMenu(editorRef, open, MENU_WIDTH, MAX_HEIGHT);
  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-ori-overlay
      className="fixed z-40"
      style={{ top: 0, left: 0, width: MENU_WIDTH, visibility: "hidden" }}
      // Mouse only: keep the editor focused/selected when clicking the menu. On
      // touch we must NOT preventDefault — it both kills list scrolling and
      // (via the synthesized event) suppresses the tap's click on iOS.
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") e.preventDefault();
      }}
    >
      <div className="menu-panel menu-in overflow-hidden">
        <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
          <span className="menu-label">People</span>
          <span className="flex items-center gap-1">
            <span className="kbd-chip">↑</span>
            <span className="kbd-chip">↓</span>
            <span className="kbd-chip">↵</span>
          </span>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-1 pt-0.5">
          {people.map((p, i) => (
            <button
              key={p.name}
              type="button"
              data-selected={i === index}
              onPointerEnter={() => setIndex(i)}
              // Apply on click (a clean tap, not a scroll-drag). apply() sets the
              // selection itself and re-focuses, so it works even if the tap blurred
              // the editor on touch — no pointer-down preventDefault needed here.
              onClick={() => apply(p)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-[13px] transition-colors duration-75",
                i === index ? "bg-foreground/[0.07] text-foreground" : "text-foreground/80",
              )}
            >
              <span
                className={cn(
                  "grid size-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold ring-1 ring-border/60",
                  avatarColor(p.name),
                )}
              >
                {initials(p.name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span
                className={cn(
                  "truncate text-[11px]",
                  i === index ? "text-muted-foreground" : "text-muted-foreground/60",
                )}
              >
                {p.role}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
