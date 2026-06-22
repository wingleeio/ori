import { Moon, Plus, Sun, Trash2 } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { NoteMeta } from "@/lib/storage";
import { cn } from "@/lib/utils";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface SidebarProps {
  notes: NoteMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

interface NoteRowProps {
  note: NoteMeta;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * A single note row. Memoized (with stable `onSelect`/`onDelete` from the host)
 * so selecting a note only re-renders the two rows whose highlight changes, not
 * all of them — keeping a large note list off the note-open critical path.
 */
const NoteRow = memo(function NoteRow({ note, active, onSelect, onDelete }: NoteRowProps) {
  return (
    <div
      data-active={active ? "" : undefined}
      className={cn(
        "group flex items-center rounded-lg transition-colors",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(note.id)}
        className="min-w-0 flex-1 overflow-hidden px-2.5 py-2 text-left"
      >
        <div className="truncate text-sm font-medium leading-tight">{note.title || "Untitled"}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {note.blocks ? `${note.blocks.toLocaleString()} blocks · ` : ""}
          {relativeTime(note.updatedAt)}
        </div>
      </button>
      <button
        type="button"
        aria-label="Delete note"
        onClick={() => onDelete(note.id)}
        className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition hover:bg-background hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
});

export function Sidebar({
  notes,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  theme,
  onToggleTheme,
}: SidebarProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the selected note visible as it changes (click or ⌥↑/↓ navigation).
  // Query the active row instead of holding a ref on it, so the rows stay
  // memoized (a per-row ref would change identity and force a re-render).
  useEffect(() => {
    listRef.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col bg-muted/30">
      <header className="flex h-12 shrink-0 items-center px-2.5">
        <span className="px-1.5 text-xs font-medium text-muted-foreground/70">Notes</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={onCreate}
          aria-label="New note"
        >
          <Plus className="size-4" />
        </Button>
      </header>

      <div ref={listRef} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {notes.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">No notes yet</p>
        ) : (
          notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              active={note.id === activeId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <kbd className="rounded bg-foreground/10 px-1 font-sans">⌥</kbd>
          <kbd className="rounded bg-foreground/10 px-1 font-sans">↑↓</kbd>
          <span className="ml-1">switch · {notes.length} notes</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </footer>
    </aside>
  );
}
