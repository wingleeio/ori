import {
  isListBlockType,
  LIST_NEST_STEP_PX,
  normalizeListLevel,
  type BlockType,
  type InlineItem,
  type Marks,
} from "@wingleeio/ori-core";

/**
 * Clipboard (de)serialization for the contentEditable view. Copy writes three
 * payloads — `text/plain`, `text/html` (for other apps), and a private JSON MIME
 * that round-trips marks, atoms *and* block types exactly — and paste prefers the
 * private MIME, then external HTML, then plain text. Content is grouped per block
 * as `{ type, items }` so block boundaries and types survive a multi-block copy.
 */
export const ORI_MIME = "application/x-ori-inline";

export interface ClipBlock {
  type: BlockType;
  items: InlineItem[];
  /** Block attrs (e.g. an image's src/ratio) so atomic blocks round-trip. */
  attrs?: Record<string, unknown>;
}

function atomPlain(it: InlineItem): string {
  const d = (it.atom?.data ?? {}) as Record<string, unknown>;
  const label = d.label ?? d.text ?? d.name;
  return label != null ? `@${String(label)}` : "";
}

function blockPlain(items: InlineItem[]): string {
  return items.map((it) => (it.atom ? atomPlain(it) : it.text)).join("");
}

const MARK_TAGS: Array<[keyof Marks, string]> = [
  ["bold", "strong"],
  ["italic", "em"],
  ["underline", "u"],
  ["strike", "s"],
  ["code", "code"],
];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape for a double-quoted attribute value (also escape the quote itself). */
function escAttr(s: string): string {
  return esc(s).replace(/"/g, "&quot;");
}

function runHtml(it: InlineItem): string {
  if (it.atom) return `<span>${esc(atomPlain(it))}</span>`;
  let html = esc(it.text);
  const m = it.marks ?? {};
  for (const [k, tag] of MARK_TAGS) if (m[k]) html = `<${tag}>${html}</${tag}>`;
  if (m.link) html = `<a href="${escAttr(m.link)}">${html}</a>`;
  return html;
}

const BLOCK_TAG: Record<string, string> = { heading: "h2", quote: "blockquote", code: "pre" };

function listLevel(attrs?: Record<string, unknown>): number {
  return normalizeListLevel(attrs?.level);
}

function listOrdinal(blocks: ClipBlock[], index: number): number {
  const block = blocks[index];
  if (block.type !== "ordered-list") return 1;
  const level = listLevel(block.attrs);
  let ordinal = 1;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = blocks[i];
    const prevLevel = listLevel(prev.attrs);
    if (!isListBlockType(prev.type)) break;
    if (prevLevel < level) break;
    if (prevLevel === level && prev.type !== "ordered-list") break;
    if (prevLevel === level) ordinal += 1;
  }
  return ordinal;
}

function blockHtml(blocks: ClipBlock[], index: number): string {
  const b = blocks[index];
  const body = b.items.map(runHtml).join("") || "<br>";
  if (isListBlockType(b.type)) {
    const level = listLevel(b.attrs);
    const indent = ` style="margin-left:${level * LIST_NEST_STEP_PX}px"`;
    if (b.type === "todo-list") {
      // A real (disabled) checkbox so other apps render the task state; our own
      // round-trip reads it (and the data-* hints) back in htmlToBlocks.
      const checked = b.attrs?.checked === true;
      const box = `<input type="checkbox" disabled${checked ? " checked" : ""}>`;
      return `<ul><li data-ori-list-type="todo-list" data-ori-list-level="${level}" data-ori-checked="${checked}"${indent}>${box}${body}</li></ul>`;
    }
    const tag = b.type === "ordered-list" ? "ol" : "ul";
    const value = b.type === "ordered-list" ? ` value="${listOrdinal(blocks, index)}"` : "";
    return `<${tag}><li data-ori-list-level="${level}"${value}${indent}>${body}</li></${tag}>`;
  }
  const tag = BLOCK_TAG[b.type] ?? "p";
  return `<${tag}>${body}</${tag}>`;
}

/** Build the three clipboard payloads for a block-grouped selection. */
export function serializeSelection(blocks: ClipBlock[]): { text: string; html: string; json: string } {
  const text = blocks.map((b) => blockPlain(b.items)).join("\n");
  const html = blocks.map((_, i) => blockHtml(blocks, i)).join("");
  const json = JSON.stringify({
    v: 2,
    blocks: blocks.map((b) => ({
      type: b.type,
      ...(b.attrs && Object.keys(b.attrs).length ? { attrs: b.attrs } : {}),
      items: b.items.map((it) =>
        it.atom ? { embed: it.atom.data ?? { type: it.atom.type } } : { text: it.text, marks: it.marks },
      ),
    })),
  });
  return { text, html, json };
}

interface SerItem {
  text?: string;
  marks?: Marks;
  embed?: Record<string, unknown>;
}

function toItems(items: SerItem[]): InlineItem[] {
  return items.map((it) =>
    it.embed
      ? { text: "", start: 0, atom: { type: String(it.embed.type ?? ""), width: 0, data: it.embed } }
      : { text: it.text ?? "", start: 0, marks: it.marks },
  );
}

/** Parse our own clipboard JSON back into typed, block-grouped inline items. */
export function deserializeOri(json: string): ClipBlock[] | null {
  try {
    const data = JSON.parse(json) as {
      v?: number;
      blocks?: Array<
        SerItem[] | { type?: BlockType; items?: SerItem[]; attrs?: Record<string, unknown> }
      >;
    };
    if (!Array.isArray(data.blocks)) return null;
    return data.blocks.map((b) => {
      // v2: { type, items, attrs? }; v1 (legacy): a bare array of items.
      if (Array.isArray(b)) return { type: "paragraph" as BlockType, items: toItems(b) };
      return {
        type: (b.type ?? "paragraph") as BlockType,
        items: toItems(b.items ?? []),
        ...(b.attrs ? { attrs: b.attrs } : {}),
      };
    });
  } catch {
    return null;
  }
}

/** Plain text → one paragraph block per line. */
export function textToBlocks(text: string): ClipBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const m = line.match(/^([ \t]*)(?:([-*+])|(\d+)[.)])\s+(.*)$/);
      if (m) {
        const level = normalizeListLevel(Math.floor(m[1].replace(/\t/g, "  ").length / 2));
        // GitHub-style task item: a bullet marker followed by "[ ]" / "[x]".
        const task = m[2] ? m[4].match(/^\[([ xX])\]\s+(.*)$/) : null;
        if (task) {
          return {
            type: "todo-list" as BlockType,
            attrs: { level, checked: task[1].toLowerCase() === "x" },
            items: task[2] ? [{ text: task[2], start: 0 }] : [],
          };
        }
        const type = m[3] ? "ordered-list" : "bullet-list";
        return {
          type: type as BlockType,
          attrs: { level },
          items: m[4] ? [{ text: m[4], start: 0 }] : [],
        };
      }
      return { type: "paragraph" as BlockType, items: line ? [{ text: line, start: 0 }] : [] };
    });
}

function blockTypeForTag(tag: string): BlockType {
  if (/^H[1-6]$/.test(tag)) return "heading";
  if (tag === "BLOCKQUOTE") return "quote";
  if (tag === "PRE") return "code";
  return "paragraph";
}

/** Parse external HTML into typed, block-grouped inline items (best-effort). */
export function htmlToBlocks(html: string): ClipBlock[] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: ClipBlock[] = [];
  let cur: InlineItem[] = [];
  let curType: BlockType = "paragraph";
  let curAttrs: Record<string, unknown> | undefined;
  const flush = () => {
    blocks.push({ type: curType, items: cur, ...(curAttrs ? { attrs: curAttrs } : {}) });
    cur = [];
    curType = "paragraph";
    curAttrs = undefined;
  };
  const push = (text: string, marks: Marks) => {
    if (!text) return;
    cur.push({ text, start: 0, marks: Object.keys(marks).length ? { ...marks } : undefined });
  };
  const BLOCK = new Set([
    "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE",
  ]);
  const walk = (node: Node, marks: Marks, pre: boolean, list?: { type: BlockType; level: number }) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Preserve whitespace (indentation, newlines) inside <pre> so pasted
        // code keeps its shape; collapse it everywhere else as HTML does.
        const raw = child.textContent ?? "";
        push(pre ? raw : raw.replace(/\s+/g, " "), marks);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName;
      if (tag === "BR") {
        if (pre) push("\n", marks);
        else if (cur.length) flush();
        continue;
      }
      const m: Marks = { ...marks };
      if (tag === "STRONG" || tag === "B") m.bold = true;
      if (tag === "EM" || tag === "I") m.italic = true;
      if (tag === "U" || tag === "INS") m.underline = true;
      if (tag === "S" || tag === "STRIKE" || tag === "DEL") m.strike = true;
      if (tag === "CODE" || tag === "KBD" || tag === "TT") m.code = true;
      const href = tag === "A" ? el.getAttribute("href") : null;
      if (href) m.link = href;
      if (tag === "UL" || tag === "OL") {
        if (cur.length) flush();
        const type = (tag === "OL" ? "ordered-list" : "bullet-list") as BlockType;
        walk(el, m, pre, { type, level: list ? list.level + 1 : 0 });
        continue;
      }
      const isListItem = tag === "LI" && list != null;
      const isBlock = isListItem || (!list && BLOCK.has(tag));
      if (isBlock && cur.length) flush();
      const blockCountBefore = blocks.length;
      if (isListItem && list) {
        const raw = el.getAttribute("data-ori-list-level");
        const level = raw != null && raw !== "" ? normalizeListLevel(Number(raw)) : normalizeListLevel(list.level);
        // A task item is flagged by our own data-* hint or, for external HTML
        // (GitHub etc.), a leading checkbox input directly in the item — a direct
        // child only, so a nested sublist's checkbox can't mislabel its parent.
        const checkbox = (Array.from(el.children) as HTMLElement[]).find(
          (c) => c.tagName === "INPUT" && c.getAttribute("type") === "checkbox",
        );
        const isTodo = el.getAttribute("data-ori-list-type") === "todo-list" || checkbox != null;
        if (isTodo) {
          const checked =
            el.getAttribute("data-ori-checked") === "true" ||
            (checkbox instanceof HTMLInputElement ? checkbox.checked : checkbox?.hasAttribute("checked") ?? false);
          curType = "todo-list";
          curAttrs = { level, checked };
        } else {
          curType = list.type;
          curAttrs = { level };
        }
        walk(el, m, pre, { ...list, level });
      } else {
        if (isBlock) curType = blockTypeForTag(tag);
        walk(el, m, pre || tag === "PRE", list);
      }
      if (isBlock && (cur.length || blocks.length === blockCountBefore)) flush();
    }
  };
  walk(doc.body, {}, false);
  if (cur.length) flush();
  while (blocks.length && blocks[0].items.length === 0) blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].items.length === 0) blocks.pop();
  return blocks;
}
