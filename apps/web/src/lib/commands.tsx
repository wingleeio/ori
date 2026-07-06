import type { BlockType, EditorController } from "@wingleeio/ori-core";
import {
  Bold,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Minus,
  Pilcrow,
  Quote,
  Strikethrough,
  Table,
  Underline,
} from "lucide-react";
import { defaultTableAttrs, sampleImageAttrs } from "@/lib/nodes";

export type MarkKey = "bold" | "italic" | "underline" | "strike" | "code";
type Icon = LucideIcon;

export interface BlockOption {
  type: BlockType;
  label: string;
  icon: Icon;
  /** Attrs applied with the type (e.g. a heading's level). */
  attrs?: Record<string, unknown>;
}

export const BLOCK_OPTIONS: BlockOption[] = [
  { type: "paragraph", label: "Text", icon: Pilcrow },
  { type: "heading", label: "Heading 1", icon: Heading1, attrs: { level: 1 } },
  { type: "heading", label: "Heading 2", icon: Heading2, attrs: { level: 2 } },
  { type: "heading", label: "Heading 3", icon: Heading3, attrs: { level: 3 } },
  { type: "quote", label: "Quote", icon: Quote },
  { type: "bullet-list", label: "Bullet list", icon: List },
  { type: "ordered-list", label: "Numbered list", icon: ListOrdered },
  { type: "todo-list", label: "To-do list", icon: ListTodo },
  { type: "code", label: "Code block", icon: Code2 },
];

/** The option matching a block's current type (+ heading level). */
export function currentBlockOption(editor: EditorController, type: BlockType): BlockOption {
  if (type === "heading") {
    const sel = editor.getSelection();
    const level = sel ? editor.getHeadingLevel(sel.focus.blockId) : 1;
    return BLOCK_OPTIONS.find((b) => b.type === "heading" && b.attrs?.level === level) ?? BLOCK_OPTIONS[1];
  }
  return BLOCK_OPTIONS.find((b) => b.type === type) ?? BLOCK_OPTIONS[0];
}

export interface MarkOption {
  key: MarkKey;
  label: string;
  icon: Icon;
  shortcut?: string;
}

export const MARK_OPTIONS: MarkOption[] = [
  { key: "bold", label: "Bold", icon: Bold, shortcut: "⌘B" },
  { key: "italic", label: "Italic", icon: Italic, shortcut: "⌘I" },
  { key: "underline", label: "Underline", icon: Underline, shortcut: "⌘U" },
  { key: "strike", label: "Strikethrough", icon: Strikethrough },
  { key: "code", label: "Code", icon: Code, shortcut: "⌘E" },
];

export interface SlashCommand {
  id: string;
  label: string;
  hint?: string;
  icon: Icon;
  keywords: string[];
  run: (editor: EditorController) => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "text", label: "Text", hint: "Plain paragraph", icon: Pilcrow, keywords: ["text", "paragraph", "body", "p"], run: (e) => e.setBlockTypeAtSelection("paragraph") },
  { id: "heading", label: "Heading 1", hint: "Section title", icon: Heading1, keywords: ["heading", "title", "h1", "header"], run: (e) => e.setBlockTypeAtSelection("heading", { level: 1 }) },
  { id: "heading-2", label: "Heading 2", hint: "Sub-section title", icon: Heading2, keywords: ["heading", "subtitle", "h2", "header"], run: (e) => e.setBlockTypeAtSelection("heading", { level: 2 }) },
  { id: "heading-3", label: "Heading 3", hint: "Small heading", icon: Heading3, keywords: ["heading", "h3", "header"], run: (e) => e.setBlockTypeAtSelection("heading", { level: 3 }) },
  { id: "quote", label: "Quote", hint: "Callout or citation", icon: Quote, keywords: ["quote", "blockquote", "cite"], run: (e) => e.setBlockTypeAtSelection("quote") },
  { id: "bullet-list", label: "Bullet list", hint: "Bulleted item", icon: List, keywords: ["bullet", "list", "ul", "unordered"], run: (e) => e.setBlockTypeAtSelection("bullet-list") },
  { id: "ordered-list", label: "Numbered list", hint: "Numbered item", icon: ListOrdered, keywords: ["number", "ordered", "list", "ol"], run: (e) => e.setBlockTypeAtSelection("ordered-list") },
  { id: "todo-list", label: "To-do list", hint: "Checklist item", icon: ListTodo, keywords: ["todo", "task", "check", "checkbox", "list"], run: (e) => e.setBlockTypeAtSelection("todo-list") },
  { id: "code", label: "Code block", hint: "Monospace block", icon: Code2, keywords: ["code", "snippet", "pre", "mono"], run: (e) => e.setBlockTypeAtSelection("code") },
  { id: "bold", label: "Bold", hint: "Toggle bold", icon: Bold, keywords: ["bold", "strong", "b"], run: (e) => e.toggleMark("bold") },
  { id: "italic", label: "Italic", hint: "Toggle italic", icon: Italic, keywords: ["italic", "emphasis", "i"], run: (e) => e.toggleMark("italic") },
  { id: "inline-code", label: "Inline code", hint: "Toggle code mark", icon: Code, keywords: ["code", "inline", "mono"], run: (e) => e.toggleMark("code") },
  // Custom, measurable nodes registered via the schema (mentions use "@"):
  { id: "divider", label: "Divider", hint: "Horizontal rule (custom node)", icon: Minus, keywords: ["divider", "rule", "hr", "line", "separator"], run: (e) => e.insertBlockAfterSelection("divider") },
  { id: "image", label: "Image", hint: "Sample image (custom node)", icon: Image, keywords: ["image", "img", "photo", "picture"], run: (e) => e.insertBlockAfterSelection("image", sampleImageAttrs()) },
  { id: "table", label: "Table", hint: "Editable grid (custom node)", icon: Table, keywords: ["table", "grid", "rows", "columns"], run: (e) => e.insertBlockAfterSelection("table", defaultTableAttrs()) },
];

export function filterSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (c) => c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)),
  );
}
