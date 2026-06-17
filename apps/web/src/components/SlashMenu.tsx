import { isCollapsed, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { useEffect, useMemo, useState, type RefObject } from "react";
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

  if (!open) return null;
  const caret = editorRef.current?.getCaretRect();
  if (!caret) return null;

  const below = caret.y + caret.height + 6;
  const placeAbove = below + MAX_HEIGHT > window.innerHeight && caret.y > MAX_HEIGHT;
  const top = placeAbove ? caret.y - 6 : below;
  const left = Math.max(12, Math.min(caret.x, window.innerWidth - MENU_WIDTH - 12));

  return (
    <div
      className="fixed z-40"
      style={{ top, left, width: MENU_WIDTH, transform: placeAbove ? "translateY(-100%)" : undefined }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Animation on an inner element so it never overrides the parent's
          positioning transform (which caused the menu to jump on open). */}
      <div className="animate-fade-in overflow-hidden rounded-xl bg-popover p-1 shadow-xl ring-1 ring-border/60">
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Blocks & formatting
        </div>
        <div className="max-h-[280px] overflow-y-auto">
          {commands.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(c)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left",
                i === index ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                <c.icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium leading-tight">{c.label}</span>
                {c.hint ? (
                  <span className="block truncate text-xs text-muted-foreground">{c.hint}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
