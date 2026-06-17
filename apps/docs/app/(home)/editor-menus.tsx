"use client";

import { isCollapsed, type BlockType, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Italic,
  Pilcrow,
  Quote,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

type Ref = RefObject<NoteEditorHandle | null>;
type MarkKey = "bold" | "italic" | "code";

const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

/* ── slash command palette ─────────────────────────────────────────────── */
interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
  run: (e: EditorController) => void;
}

const SLASH: SlashCommand[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", icon: Pilcrow, keywords: ["text", "paragraph", "p"], run: (e) => e.setBlockTypeAtSelection("paragraph") },
  { id: "heading", label: "Heading", hint: "Section title", icon: Heading1, keywords: ["heading", "title", "h1"], run: (e) => e.setBlockTypeAtSelection("heading") },
  { id: "quote", label: "Quote", hint: "Callout", icon: Quote, keywords: ["quote", "cite"], run: (e) => e.setBlockTypeAtSelection("quote") },
  { id: "code", label: "Code block", hint: "Monospace block", icon: Code2, keywords: ["code", "snippet", "mono"], run: (e) => e.setBlockTypeAtSelection("code") },
  { id: "bold", label: "Bold", hint: "Toggle bold", icon: Bold, keywords: ["bold", "b"], run: (e) => e.toggleMark("bold") },
  { id: "italic", label: "Italic", hint: "Toggle italic", icon: Italic, keywords: ["italic", "i"], run: (e) => e.toggleMark("italic") },
];

function filterSlash(q: string): SlashCommand[] {
  const s = q.trim().toLowerCase();
  if (!s) return SLASH;
  return SLASH.filter((c) => c.label.toLowerCase().includes(s) || c.keywords.some((k) => k.includes(s)));
}

const PEOPLE = ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Katherine Johnson", "Margaret Hamilton", "Donald Knuth"];
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

const MENU = "animate-fade-in overflow-hidden rounded-xl border border-fd-border bg-fd-popover p-1 shadow-xl";
const ITEM = "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm";

function caretMenuStyle(editorRef: Ref, open: boolean) {
  if (!open) return null;
  const c = editorRef.current?.getCaretRect();
  if (!c) return null;
  const below = c.y + c.height + 6;
  const placeAbove = below + 300 > window.innerHeight && c.y > 300;
  return {
    top: placeAbove ? c.y - 6 : below,
    left: Math.max(12, Math.min(c.x, window.innerWidth - 280)),
    transform: placeAbove ? "translateY(-100%)" : undefined,
  };
}

export function SlashMenu({ editor, editorRef }: { editor: EditorController; editorRef: Ref }) {
  const snap = useEditorSnapshot(editor);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const ctx = useMemo(() => {
    const sel = editor.getSelection();
    if (!sel || !isCollapsed(sel)) return null;
    const before = editor.getBlockText(sel.focus.blockId).slice(0, sel.focus.offset);
    const m = before.match(/(?:^|\s)\/(\S*)$/);
    if (!m) return null;
    return { blockId: sel.focus.blockId, query: m[1], slashOffset: sel.focus.offset - m[1].length - 1, caretOffset: sel.focus.offset };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.revision, editor]);

  const key = ctx ? `${ctx.blockId}:${ctx.slashOffset}` : null;
  const commands = useMemo(() => (ctx ? filterSlash(ctx.query) : []), [ctx]);
  const open = !!ctx && dismissed !== key && commands.length > 0;

  useEffect(() => setIndex(0), [ctx?.query]);
  useEffect(() => { if (!ctx) setDismissed(null); }, [ctx]);

  const apply = (cmd?: SlashCommand) => {
    if (!ctx || !cmd) return;
    editor.setSelection({ anchor: { blockId: ctx.blockId, offset: ctx.slashOffset }, focus: { blockId: ctx.blockId, offset: ctx.caretOffset } });
    editor.deleteBackward();
    cmd.run(editor);
    editorRef.current?.focus();
    setDismissed(key);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setIndex((i) => Math.min(i + 1, commands.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); apply(commands[index]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDismissed(key); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, commands, index, key]);

  const pos = caretMenuStyle(editorRef, open);
  if (!pos) return null;
  return (
    <div className="fixed z-40 w-[264px]" style={pos} onMouseDown={keepFocus}>
      <div className={MENU}>
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fd-muted-foreground/70">Blocks & formatting</div>
        {commands.map((c, i) => (
          <button key={c.id} type="button" onMouseEnter={() => setIndex(i)} onMouseDown={keepFocus} onClick={() => apply(c)} className={`${ITEM} ${i === index ? "bg-fd-primary/10" : "hover:bg-fd-accent"}`}>
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-fd-muted text-fd-muted-foreground"><c.icon className="size-4" /></span>
            <span className="min-w-0">
              <span className="block truncate font-medium leading-tight">{c.label}</span>
              <span className="block truncate text-xs text-fd-muted-foreground">{c.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MentionMenu({ editor, editorRef }: { editor: EditorController; editorRef: Ref }) {
  const snap = useEditorSnapshot(editor);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const ctx = useMemo(() => {
    const sel = editor.getSelection();
    if (!sel || !isCollapsed(sel)) return null;
    const before = editor.getBlockText(sel.focus.blockId).slice(0, sel.focus.offset);
    const m = before.match(/(?:^|\s)@([^\s@]*)$/);
    if (!m) return null;
    return { blockId: sel.focus.blockId, query: m[1], atOffset: sel.focus.offset - m[1].length - 1, caretOffset: sel.focus.offset };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.revision, editor]);

  const key = ctx ? `${ctx.blockId}:${ctx.atOffset}` : null;
  const people = useMemo(() => {
    if (!ctx) return [];
    const q = ctx.query.trim().toLowerCase();
    return q ? PEOPLE.filter((p) => p.toLowerCase().includes(q)) : PEOPLE;
  }, [ctx]);
  const open = !!ctx && dismissed !== key && people.length > 0;

  useEffect(() => setIndex(0), [ctx?.query]);
  useEffect(() => { if (!ctx) setDismissed(null); }, [ctx]);

  const apply = (name?: string) => {
    if (!ctx || !name) return;
    editor.setSelection({ anchor: { blockId: ctx.blockId, offset: ctx.atOffset }, focus: { blockId: ctx.blockId, offset: ctx.caretOffset } });
    editor.deleteBackward();
    editor.insertInlineAtom({ type: "mention", label: name });
    editor.insertText(" ");
    editorRef.current?.focus();
    setDismissed(key);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setIndex((i) => Math.min(i + 1, people.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setIndex((i) => Math.max(i - 1, 0)); }
      else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); apply(people[index]); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDismissed(key); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, people, index, key]);

  const pos = caretMenuStyle(editorRef, open);
  if (!pos) return null;
  return (
    <div className="fixed z-40 w-[260px]" style={pos} onMouseDown={keepFocus}>
      <div className={MENU}>
        <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fd-muted-foreground/70">People</div>
        {people.map((p, i) => (
          <button key={p} type="button" onMouseEnter={() => setIndex(i)} onMouseDown={keepFocus} onClick={() => apply(p)} className={`${ITEM} ${i === index ? "bg-fd-primary/10" : "hover:bg-fd-accent"}`}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fd-primary/15 text-[11px] font-semibold text-fd-primary">{initials(p)}</span>
            <span className="truncate font-medium">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const MARKS: { key: MarkKey; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { key: "bold", icon: Bold, label: "Bold" },
  { key: "italic", icon: Italic, label: "Italic" },
  { key: "code", icon: Code, label: "Code" },
];
const BLOCKS: { type: BlockType; label: string }[] = [
  { type: "paragraph", label: "Text" },
  { type: "heading", label: "Heading" },
  { type: "quote", label: "Quote" },
  { type: "code", label: "Code" },
];

export function SelectionMenu({ editor, editorRef }: { editor: EditorController; editorRef: Ref }) {
  const snap = useEditorSnapshot(editor);
  void snap.revision;
  const sel = snap.selection;
  if (!sel || isCollapsed(sel)) return null;
  const rect = editorRef.current?.getSelectionRect();
  if (!rect) return null;

  const marks = editor.getActiveMarks();
  const blockType = (editor.blockTypeAtSelection() ?? "paragraph") as BlockType;
  const below = rect.top < 84;
  return (
    <div className="fixed z-40" style={{ top: below ? rect.bottom + 10 : rect.top - 10, left: rect.left + rect.width / 2, transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)" }}>
      <div className="animate-fade-in flex items-center gap-0.5 rounded-xl border border-fd-border bg-fd-popover p-1 shadow-lg">
        {BLOCKS.map((b) => (
          <button key={b.type} type="button" onMouseDown={keepFocus} onClick={() => { editor.setBlockTypeAtSelection(b.type); editorRef.current?.focus(); }} className={`rounded-md px-2 py-1 text-xs font-medium ${blockType === b.type ? "bg-fd-primary/15 text-fd-primary" : "text-fd-muted-foreground hover:bg-fd-accent"}`}>
            {b.label}
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-fd-border" />
        {MARKS.map((m) => (
          <button key={m.key} type="button" title={m.label} aria-pressed={!!marks[m.key]} onMouseDown={keepFocus} onClick={() => editor.toggleMark(m.key)} className={`grid size-7 place-items-center rounded-md ${marks[m.key] ? "bg-fd-primary/15 text-fd-primary" : "hover:bg-fd-accent"}`}>
            <m.icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
