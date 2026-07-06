import { isCollapsed, type BlockType, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { ChevronDown, Link2, Link2Off } from "lucide-react";
import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSelectionToolbar } from "@/lib/caretMenu";
import { BLOCK_OPTIONS, currentBlockOption, MARK_OPTIONS } from "@/lib/commands";
import { cn } from "@/lib/utils";

export interface SelectionMenuProps {
  editor: EditorController;
  editorRef: RefObject<NoteEditorHandle | null>;
}

// Mouse only: keep the editor's selection alive when clicking a toolbar button.
// On touch we must NOT preventDefault — the synthesized event would suppress the
// tap's click on iOS (the selection is preserved anyway via [data-ori-overlay]).
const keepFocus = (e: ReactPointerEvent) => {
  if (e.pointerType === "mouse") e.preventDefault();
};

/**
 * A floating menu that appears over a non-empty selection: a block-type
 * "select" plus inline-mark toggles. Replaces the old static toolbar.
 */
export function SelectionMenu({ editor, editorRef }: SelectionMenuProps) {
  const snapshot = useEditorSnapshot(editor);
  const sel = snapshot.selection;
  const open = !!sel && !isCollapsed(sel);
  const ref = useSelectionToolbar(editorRef, open);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  useEffect(() => {
    if (!open) setLinkOpen(false);
  }, [open]);
  if (!open) return null;

  const marks = editor.getActiveMarks();
  const activeLink = editor.getActiveLink();
  const applyLink = () => {
    if (linkDraft.trim()) editor.setLink(linkDraft);
    else editor.removeLink();
    setLinkOpen(false);
    editorRef.current?.focus();
  };
  const blockType = (editor.blockTypeAtSelection() ?? "paragraph") as BlockType;
  const current = currentBlockOption(editor, blockType);

  // Float in a <body> portal, clamped to the viewport (rAF-positioned by the
  // hook) so the toolbar never gets clipped at the editor's edges.
  return createPortal(
    <div ref={ref} data-ori-overlay className="fixed z-40" style={{ top: 0, left: 0, visibility: "hidden" }}>
      {/* Animation lives on an inner element so it can't clobber the
          positioning transform on the fixed parent (which caused jumpiness). */}
      <div className="menu-panel menu-in p-1">
      <div className="flex items-center gap-0.5">
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
                key={b.label}
                selected={b === current}
                onSelect={() => {
                  editor.setBlockTypeAtSelection(b.type, b.attrs);
                  editorRef.current?.focus();
                }}
              >
                <b.icon className="size-4 opacity-70" />
                {b.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-0.5 h-4 w-px bg-border/80" />

        {MARK_OPTIONS.map((m) => {
          const active = !!marks[m.key];
          return (
            <Button
              key={m.key}
              variant="ghost"
              size="icon-sm"
              className={cn(
                "size-7 rounded-lg text-muted-foreground hover:text-foreground",
                active && "bg-foreground/[0.12] text-foreground hover:bg-foreground/[0.15]",
              )}
              aria-pressed={active}
              title={m.shortcut ? `${m.label} · ${m.shortcut}` : m.label}
              onPointerDown={keepFocus}
              onClick={() => {
                editor.toggleMark(m.key);
                // On touch the tap blurred the editor (keepFocus is mouse-only);
                // restore focus so the keyboard/caret return, like the other actions.
                editorRef.current?.focus();
              }}
            >
              <m.icon className="size-3.5" />
            </Button>
          );
        })}

        <span className="mx-0.5 h-4 w-px bg-border/80" />

        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(
            "size-7 rounded-lg text-muted-foreground hover:text-foreground",
            activeLink && "bg-foreground/[0.12] text-foreground hover:bg-foreground/[0.15]",
          )}
          aria-pressed={!!activeLink}
          title="Link · ⌘K"
          onPointerDown={keepFocus}
          onClick={() => {
            setLinkDraft(activeLink ?? "");
            setLinkOpen((v) => !v);
          }}
        >
          <Link2 className="size-3.5" />
        </Button>
      </div>

      {linkOpen && (
        <div className="mt-1 flex items-center gap-1 border-t border-border/60 pt-1">
          <input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              } else if (e.key === "Escape") {
                setLinkOpen(false);
                editorRef.current?.focus();
              }
            }}
            placeholder="Paste or type a link…"
            className="h-7 w-52 rounded-md border border-border/60 bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <Button size="sm" className="h-7 px-2 text-xs" onClick={applyLink}>
            Apply
          </Button>
          {activeLink && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7"
              title="Remove link"
              onPointerDown={keepFocus}
              onClick={() => {
                editor.removeLink();
                setLinkOpen(false);
                editorRef.current?.focus();
              }}
            >
              <Link2Off className="size-3.5" />
            </Button>
          )}
        </div>
      )}
      </div>
    </div>,
    document.body,
  );
}
