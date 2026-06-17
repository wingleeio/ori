import { isCollapsed, type BlockType, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { ChevronDown } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BLOCK_OPTIONS, MARK_OPTIONS } from "@/lib/commands";
import { cn } from "@/lib/utils";

export interface SelectionMenuProps {
  editor: EditorController;
  editorRef: RefObject<NoteEditorHandle | null>;
}

const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

/**
 * A floating menu that appears over a non-empty selection: a block-type
 * "select" plus inline-mark toggles. Replaces the old static toolbar.
 */
export function SelectionMenu({ editor, editorRef }: SelectionMenuProps) {
  const snapshot = useEditorSnapshot(editor);
  const sel = snapshot.selection;
  if (!sel || isCollapsed(sel)) return null;

  const rect = editorRef.current?.getSelectionRect();
  if (!rect) return null;

  const marks = editor.getActiveMarks();
  const blockType = (editor.blockTypeAtSelection() ?? "paragraph") as BlockType;
  const current = BLOCK_OPTIONS.find((b) => b.type === blockType) ?? BLOCK_OPTIONS[0];

  const margin = 10;
  const placeBelow = rect.top < 84;
  const top = placeBelow ? rect.bottom + margin : rect.top - margin;
  const left = rect.left + rect.width / 2;

  return (
    <div
      className="fixed z-40"
      style={{ top, left, transform: placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)" }}
    >
      {/* Animation lives on an inner element so it can't clobber the
          positioning transform on the fixed parent (which caused jumpiness). */}
      <div className="flex animate-fade-in items-center gap-0.5 rounded-xl bg-popover p-1 shadow-lg ring-1 ring-border/60">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-medium">
              <current.icon className="size-3.5 opacity-70" />
              {current.label}
              <ChevronDown className="size-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            {BLOCK_OPTIONS.map((b) => (
              <DropdownMenuItem
                key={b.type}
                selected={b.type === blockType}
                onSelect={() => {
                  editor.setBlockTypeAtSelection(b.type);
                  editorRef.current?.focus();
                }}
              >
                <b.icon className="size-4 opacity-70" />
                {b.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-0.5 h-5 w-px bg-border/70" />

        {MARK_OPTIONS.map((m) => {
          const active = !!marks[m.key];
          return (
            <Button
              key={m.key}
              variant={active ? "secondary" : "ghost"}
              size="icon-sm"
              className={cn("size-7", active && "text-foreground")}
              aria-pressed={active}
              title={m.shortcut ? `${m.label} · ${m.shortcut}` : m.label}
              onMouseDown={keepFocus}
              onClick={() => editor.toggleMark(m.key)}
            >
              <m.icon className="size-3.5" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
