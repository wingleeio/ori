import { isCollapsed, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useCaretMenu } from "@/lib/caretMenu";
import { filterSlashCommands, type SlashCommand } from "@/lib/commands";
import { cn } from "@/lib/utils";

export interface SlashMenuProps {
  editor: EditorController;
  editorRef: RefObject<NoteEditorHandle | null>;
}

interface SlashContext {
  blockId: string;
  query: string;
  slashOffset: number;
  caretOffset: number;
}

const MENU_WIDTH = 264;
const MAX_HEIGHT = 320;

/**
 * A Notion-style "/" command palette. Triggered by typing `/` at the start of a
 * block or after whitespace; filters as you type; applies a block-type change
 * or mark toggle and removes the typed `/query`.
 */
export function SlashMenu({ editor, editorRef }: SlashMenuProps) {
  const snapshot = useEditorSnapshot(editor);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  // Derive the active slash context from editor state on every change.
  const ctx = useMemo<SlashContext | null>(() => {
    const sel = editor.getSelection();
    if (!sel || !isCollapsed(sel)) return null;
    const before = editor.getBlockText(sel.focus.blockId).slice(0, sel.focus.offset);
    const m = before.match(/(?:^|\s)\/(\S*)$/);
    if (!m) return null;
    const query = m[1];
    return {
      blockId: sel.focus.blockId,
      query,
      slashOffset: sel.focus.offset - query.length - 1,
      caretOffset: sel.focus.offset,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.revision, editor]);

  const key = ctx ? `${ctx.blockId}:${ctx.slashOffset}` : null;
  const commands = useMemo(() => (ctx ? filterSlashCommands(ctx.query) : []), [ctx]);
  const open = !!ctx && dismissedKey !== key && commands.length > 0;

  // Reset highlight when the query changes; clear stale dismissal.
  useEffect(() => {
    setIndex(0);
  }, [ctx?.query]);
  useEffect(() => {
    if (!ctx) setDismissedKey(null);
  }, [ctx]);
  // Keep the active row visible while arrowing through a scrolled list; the
  // list's scroll-padding keeps a gutter so edge rows are never pinned flush.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const apply = (cmd?: SlashCommand) => {
    if (!ctx || !cmd) return;
    // Remove the "/query" text, then run the command on the now-clean block.
    editor.setSelection({
      anchor: { blockId: ctx.blockId, offset: ctx.slashOffset },
      focus: { blockId: ctx.blockId, offset: ctx.caretOffset },
    });
    editor.deleteBackward();
    cmd.run(editor);
    editorRef.current?.focus();
    setDismissedKey(key);
  };

  // While open, intercept navigation keys before they reach the editor.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => Math.min(i + 1, commands.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        apply(commands[index]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setDismissedKey(key);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, commands, index, key]);

  const menuRef = useCaretMenu(editorRef, open, MENU_WIDTH, MAX_HEIGHT);
  // A click anywhere outside the menu closes it — without this, the menu's
  // model context survives the click (the editor keeps its selection on blur)
  // and the panel would chase the relocated DOM caret across the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setDismissedKey(key);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

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
      {/* Animation on an inner element so it never overrides the parent's
          positioning transform (which caused the menu to jump on open). */}
      <div className="menu-panel menu-in overflow-hidden">
        <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
          <span className="menu-label">{ctx?.query ? `“${ctx.query}”` : "Insert"}</span>
          <span className="flex items-center gap-1">
            <span className="kbd-chip">↑</span>
            <span className="kbd-chip">↓</span>
            <span className="kbd-chip">↵</span>
          </span>
        </div>
        <div ref={listRef} className="menu-list p-1.5 pt-0.5">
          {commands.map((c, i) => {
            const groupStart = i === 0 || commands[i - 1].group !== c.group;
            return (
              <div key={c.id}>
                {groupStart && i !== 0 && <div className="mx-2 my-1 h-px bg-border/70" />}
                {groupStart && <div className="menu-label px-2 pb-1 pt-1.5">{c.group}</div>}
                <button
                  type="button"
                  data-index={i}
                  data-selected={i === index}
                  onPointerEnter={() => setIndex(i)}
                  // Apply on click (a clean tap, not a scroll-drag). apply() sets the
                  // selection itself and re-focuses, so it works even if the tap blurred
                  // the editor on touch — no pointer-down preventDefault needed here.
                  onClick={() => apply(c)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-[13px] transition-colors duration-75",
                    i === index ? "bg-foreground/[0.07] text-foreground" : "text-foreground/80",
                  )}
                >
                  <span className="menu-tile shrink-0">
                    <c.icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                  {c.hint ? (
                    <span
                      className={cn(
                        "truncate text-[11px]",
                        i === index ? "text-muted-foreground" : "text-muted-foreground/60",
                      )}
                    >
                      {c.hint}
                    </span>
                  ) : null}
                  {i === index && <CornerDownLeft className="size-3 shrink-0 text-muted-foreground/70" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
