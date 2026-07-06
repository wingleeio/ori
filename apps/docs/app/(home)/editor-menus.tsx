"use client";

import { isCollapsed, type BlockType, type EditorController } from "@wingleeio/ori-core";
import { useEditorSnapshot, type NoteEditorHandle } from "@wingleeio/ori-react";
import { createPortal } from "react-dom";
import {
  Bold,
  CheckIcon,
  ChevronDown,
  Code,
  Code2,
  CornerDownLeft,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
  Table,
  Underline,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { defaultTableAttrs, sampleImageAttrs } from "./live-editor";

type Ref = RefObject<NoteEditorHandle | null>;
type MarkKey = "bold" | "italic" | "underline" | "strike" | "code";
type Icon = ComponentType<{ className?: string }>;

const keepFocus = (e: ReactMouseEvent) => e.preventDefault();

/* ── slash command palette ─────────────────────────────────────────────── */
interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: Icon;
  keywords: string[];
  run: (e: EditorController) => void;
}

const SLASH: SlashCommand[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", group: "Basic", icon: Pilcrow, keywords: ["text", "paragraph", "p"], run: (e) => e.setBlockTypeAtSelection("paragraph") },
  { id: "h1", label: "Heading 1", hint: "Section title", group: "Basic", icon: Heading1, keywords: ["heading", "title", "h1"], run: (e) => e.setBlockTypeAtSelection("heading", { level: 1 }) },
  { id: "h2", label: "Heading 2", hint: "Sub-section", group: "Basic", icon: Heading2, keywords: ["heading", "h2", "subtitle"], run: (e) => e.setBlockTypeAtSelection("heading", { level: 2 }) },
  { id: "h3", label: "Heading 3", hint: "Small heading", group: "Basic", icon: Heading3, keywords: ["heading", "h3"], run: (e) => e.setBlockTypeAtSelection("heading", { level: 3 }) },
  { id: "quote", label: "Quote", hint: "Callout or citation", group: "Basic", icon: Quote, keywords: ["quote", "cite", "blockquote"], run: (e) => e.setBlockTypeAtSelection("quote") },
  { id: "bullet-list", label: "Bullet list", hint: "Simple list", group: "Lists", icon: List, keywords: ["bullet", "list", "ul"], run: (e) => e.setBlockTypeAtSelection("bullet-list") },
  { id: "ordered-list", label: "Numbered list", hint: "Ordered list", group: "Lists", icon: ListOrdered, keywords: ["number", "ordered", "list", "ol"], run: (e) => e.setBlockTypeAtSelection("ordered-list") },
  { id: "todo-list", label: "To-do list", hint: "Checklist", group: "Lists", icon: ListTodo, keywords: ["todo", "task", "check", "checkbox"], run: (e) => e.setBlockTypeAtSelection("todo-list") },
  { id: "code", label: "Code block", hint: "Highlighted code", group: "Blocks", icon: Code2, keywords: ["code", "snippet", "mono", "pre"], run: (e) => e.setBlockTypeAtSelection("code") },
  { id: "table", label: "Table", hint: "Editable grid", group: "Blocks", icon: Table, keywords: ["table", "grid", "rows", "columns"], run: (e) => e.insertBlockAfterSelection("table", defaultTableAttrs()) },
  { id: "image", label: "Image", hint: "Custom image node", group: "Blocks", icon: Image, keywords: ["image", "img", "photo", "picture"], run: (e) => e.insertBlockAfterSelection("image", sampleImageAttrs()) },
  { id: "divider", label: "Divider", hint: "Horizontal rule", group: "Blocks", icon: Minus, keywords: ["divider", "rule", "hr", "line"], run: (e) => e.insertBlockAfterSelection("divider") },
  { id: "bold", label: "Bold", hint: "Toggle bold", group: "Format", icon: Bold, keywords: ["bold", "b", "strong"], run: (e) => e.toggleMark("bold") },
  { id: "italic", label: "Italic", hint: "Toggle italic", group: "Format", icon: Italic, keywords: ["italic", "i", "em"], run: (e) => e.toggleMark("italic") },
  { id: "inline-code", label: "Inline code", hint: "Toggle code mark", group: "Format", icon: Code, keywords: ["code", "inline", "mono"], run: (e) => e.toggleMark("code") },
];

function filterSlash(q: string): SlashCommand[] {
  const s = q.trim().toLowerCase();
  if (!s) return SLASH;
  return SLASH.filter((c) => c.label.toLowerCase().includes(s) || c.keywords.some((k) => k.includes(s)));
}

const PEOPLE = ["Ada Lovelace", "Alan Turing", "Grace Hopper", "Katherine Johnson", "Margaret Hamilton", "Donald Knuth"];
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
const handle = (n: string) => "@" + (n.split(/\s+/)[0] ?? "").toLowerCase();

/* Shared row + header chrome */
function MenuHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
      <span className="menu-label">{label}</span>
      <span className="flex items-center gap-1">
        <span className="kbd">↑</span>
        <span className="kbd">↓</span>
        <span className="kbd">↵</span>
      </span>
    </div>
  );
}

const ROW =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-[7px] text-left text-[13px] transition-colors duration-75";

/**
 * Keep a caret-anchored menu (slash / mention) glued to the caret. The menu is a
 * fixed overlay portaled to <body>, so it floats above the editor and never
 * affects the editor's scroll size (only text drives overflow). A rAF loop
 * re-reads the caret each frame so it rides the scroll without shaking, flipping
 * above/below relative to the scroll viewport's edge. Returns a ref for the menu.
 */
function useCaretMenu(editorRef: Ref, open: boolean, width: number, maxHeight = 332) {
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

/**
 * Position a selection toolbar centered above (or below, near the top) the
 * selection, in a <body>-portaled fixed overlay clamped to the viewport so it
 * never gets clipped at the editor's edges. Returns a ref for the menu.
 */
function useSelectionToolbar(editorRef: Ref, open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    let raf = 0;
    const place = () => {
      const el = ref.current;
      const r = editorRef.current?.getSelectionRect();
      if (el && r) {
        const sc = editorRef.current?.getScrollElement()?.getBoundingClientRect();
        const above = r.top - (sc ? sc.top : 0) >= 52;
        const w = el.offsetWidth || 0;
        const cx = r.left + r.width / 2;
        el.style.top = `${above ? r.top - 8 : r.bottom + 8}px`;
        el.style.left = `${Math.max(8 + w / 2, Math.min(cx, window.innerWidth - 8 - w / 2))}px`;
        el.style.transform = above ? "translate(-50%, -100%)" : "translate(-50%, 0)";
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
  }, [open, editorRef]);
  return ref;
}

export function SlashMenu({ editor, editorRef }: { editor: EditorController; editorRef: Ref }) {
  const snap = useEditorSnapshot(editor);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

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
  // Keep the active row in view while arrowing through a scrolled list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

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

  const menuRef = useCaretMenu(editorRef, open, 276);
  if (!open) return null;
  return createPortal(
    <div ref={menuRef} data-ori-overlay className="fixed z-40 w-[276px]" style={{ top: 0, left: 0, visibility: "hidden" }} onMouseDown={keepFocus}>
      <div className="menu-panel menu-in overflow-hidden">
        <MenuHeader label={ctx?.query ? `“${ctx.query}”` : "Insert"} />
        <div ref={listRef} className="max-h-[300px] overflow-y-auto p-1 pt-0.5">
          {commands.map((c, i) => {
            const groupStart = i === 0 || commands[i - 1].group !== c.group;
            return (
              <div key={c.id}>
                {groupStart && i !== 0 && <div className="mx-2 my-1 h-px" style={{ background: "var(--hairline)" }} />}
                {groupStart && (
                  <div className="menu-label px-2 pb-1 pt-1.5">{c.group}</div>
                )}
                <button
                  type="button"
                  data-index={i}
                  data-selected={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onMouseDown={keepFocus}
                  onClick={() => apply(c)}
                  className={`${ROW} ${i === index ? "bg-white/[0.07] text-white" : "text-fd-foreground/80"}`}
                >
                  <span className="menu-tile shrink-0"><c.icon className="size-3.5" /></span>
                  <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                  <span className={`truncate text-[11px] ${i === index ? "text-white/45" : "text-fd-muted-foreground/60"}`}>
                    {c.hint}
                  </span>
                  {i === index && <CornerDownLeft className="size-3 shrink-0 text-white/40" />}
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

  const menuRef = useCaretMenu(editorRef, open, 264);
  if (!open) return null;
  return createPortal(
    <div ref={menuRef} data-ori-overlay className="fixed z-40 w-[264px]" style={{ top: 0, left: 0, visibility: "hidden" }} onMouseDown={keepFocus}>
      <div className="menu-panel menu-in overflow-hidden">
        <MenuHeader label="People" />
        <div className="p-1 pt-0.5">
          {people.map((p, i) => (
            <button
              key={p}
              type="button"
              data-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={keepFocus}
              onClick={() => apply(p)}
              className={`${ROW} ${i === index ? "bg-white/[0.07] text-white" : "text-fd-foreground/80"}`}
            >
              <span
                className={`grid size-[26px] shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-colors duration-75 ${
                  i === index ? "bg-fd-primary/25 text-fd-primary" : "bg-white/[0.06] text-fd-muted-foreground"
                }`}
                style={{ border: "1px solid var(--hairline)" }}
              >
                {initials(p)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{p}</span>
              <span className={`ff-mono truncate text-[11px] ${i === index ? "text-white/45" : "text-fd-muted-foreground/50"}`}>
                {handle(p)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── selection toolbar ─────────────────────────────────────────────────── */
const MARKS: { key: MarkKey; icon: Icon; label: string; shortcut?: string }[] = [
  { key: "bold", icon: Bold, label: "Bold", shortcut: "⌘B" },
  { key: "italic", icon: Italic, label: "Italic", shortcut: "⌘I" },
  { key: "underline", icon: Underline, label: "Underline", shortcut: "⌘U" },
  { key: "strike", icon: Strikethrough, label: "Strikethrough" },
  { key: "code", icon: Code, label: "Code", shortcut: "⌘E" },
];

interface BlockOption {
  type: BlockType;
  label: string;
  icon: Icon;
  attrs?: Record<string, unknown>;
}
const BLOCKS: BlockOption[] = [
  { type: "paragraph", label: "Text", icon: Pilcrow },
  { type: "heading", label: "Heading 1", icon: Heading1, attrs: { level: 1 } },
  { type: "heading", label: "Heading 2", icon: Heading2, attrs: { level: 2 } },
  { type: "heading", label: "Heading 3", icon: Heading3, attrs: { level: 3 } },
  { type: "quote", label: "Quote", icon: Quote },
  { type: "bullet-list", label: "Bullet list", icon: List },
  { type: "ordered-list", label: "Numbered list", icon: ListOrdered },
  { type: "todo-list", label: "To-do list", icon: ListTodo },
  { type: "code", label: "Code", icon: Code2 },
];

export function SelectionMenu({ editor, editorRef }: { editor: EditorController; editorRef: Ref }) {
  const snap = useEditorSnapshot(editor);
  void snap.revision;
  const sel = snap.selection;
  const open = !!sel && !isCollapsed(sel);
  const ref = useSelectionToolbar(editorRef, open);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    if (!open) setPickerOpen(false);
  }, [open]);
  if (!open) return null;

  const marks = editor.getActiveMarks();
  const blockType = (editor.blockTypeAtSelection() ?? "paragraph") as BlockType;
  const level = sel ? editor.getHeadingLevel(sel.focus.blockId) : 1;
  const current =
    BLOCKS.find((b) =>
      b.type === blockType && (b.type !== "heading" || (b.attrs?.level ?? 1) === level),
    ) ?? BLOCKS[0];

  // Float in a <body> portal, clamped to the viewport (rAF-positioned), so the
  // toolbar never gets clipped at the editor's edges.
  return createPortal(
    <div ref={ref} data-ori-overlay className="fixed z-40" style={{ top: 0, left: 0, visibility: "hidden" }}>
      <div className="relative">
        <div className="menu-panel menu-in flex items-center gap-0.5 p-1">
          {/* block picker */}
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-fd-foreground/90 transition-colors duration-75 hover:bg-white/[0.07]"
          >
            <current.icon className="size-3.5 text-fd-muted-foreground" />
            {current.label}
            <ChevronDown className={`size-3 text-fd-muted-foreground/70 transition-transform duration-150 ${pickerOpen ? "rotate-180" : ""}`} />
          </button>
          <span className="mx-0.5 h-4 w-px" style={{ background: "var(--hairline)" }} />
          {MARKS.map((m) => (
            <button
              key={m.key}
              type="button"
              title={m.shortcut ? `${m.label} · ${m.shortcut}` : m.label}
              aria-pressed={!!marks[m.key]}
              onMouseDown={keepFocus}
              onClick={() => editor.toggleMark(m.key)}
              className={`grid size-7 cursor-pointer place-items-center rounded-lg transition-colors duration-75 ${
                marks[m.key] ? "bg-white/[0.12] text-white" : "text-fd-muted-foreground hover:bg-white/[0.07] hover:text-fd-foreground"
              }`}
            >
              <m.icon className="size-3.5" />
            </button>
          ))}
        </div>

        {/* block picker dropdown */}
        {pickerOpen && (
          <div className="menu-panel menu-in absolute left-0 top-full mt-1.5 w-[196px] p-1">
            {BLOCKS.map((b) => {
              const active = b === current;
              return (
                <button
                  key={b.label}
                  type="button"
                  data-selected={active}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    editor.setBlockTypeAtSelection(b.type, b.attrs);
                    setPickerOpen(false);
                    editorRef.current?.focus();
                  }}
                  className={`${ROW} ${active ? "bg-white/[0.07] text-white" : "text-fd-foreground/80 hover:bg-white/[0.05]"}`}
                >
                  <b.icon className={`size-3.5 shrink-0 ${active ? "text-white" : "text-fd-muted-foreground"}`} />
                  <span className="min-w-0 flex-1 truncate font-medium">{b.label}</span>
                  {active && <CheckIcon className="size-3.5 shrink-0 text-fd-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
