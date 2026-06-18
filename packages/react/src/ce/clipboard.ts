import type { BlockType, InlineItem, Marks } from "@wingleeio/ori-core";

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

function runHtml(it: InlineItem): string {
  if (it.atom) return `<span>${esc(atomPlain(it))}</span>`;
  let html = esc(it.text);
  const m = it.marks ?? {};
  for (const [k, tag] of MARK_TAGS) if (m[k]) html = `<${tag}>${html}</${tag}>`;
  if (m.link) html = `<a href="${esc(m.link)}">${html}</a>`;
  return html;
}

const BLOCK_TAG: Record<string, string> = { heading: "h2", quote: "blockquote", code: "pre" };

/** Build the three clipboard payloads for a block-grouped selection. */
export function serializeSelection(blocks: ClipBlock[]): { text: string; html: string; json: string } {
  const text = blocks.map((b) => blockPlain(b.items)).join("\n");
  const html = blocks
    .map((b) => {
      const tag = BLOCK_TAG[b.type] ?? "p";
      return `<${tag}>${b.items.map(runHtml).join("") || "<br>"}</${tag}>`;
    })
    .join("");
  const json = JSON.stringify({
    v: 2,
    blocks: blocks.map((b) => ({
      type: b.type,
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
      blocks?: Array<SerItem[] | { type?: BlockType; items?: SerItem[] }>;
    };
    if (!Array.isArray(data.blocks)) return null;
    return data.blocks.map((b) => {
      // v2: { type, items }; v1 (legacy): a bare array of items.
      if (Array.isArray(b)) return { type: "paragraph" as BlockType, items: toItems(b) };
      return { type: (b.type ?? "paragraph") as BlockType, items: toItems(b.items ?? []) };
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
    .map((line) => ({ type: "paragraph" as BlockType, items: line ? [{ text: line, start: 0 }] : [] }));
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
  const flush = () => {
    blocks.push({ type: curType, items: cur });
    cur = [];
    curType = "paragraph";
  };
  const push = (text: string, marks: Marks) => {
    if (!text) return;
    cur.push({ text, start: 0, marks: Object.keys(marks).length ? { ...marks } : undefined });
  };
  const BLOCK = new Set([
    "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "UL", "OL",
  ]);
  const walk = (node: Node, marks: Marks) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        push((child.textContent ?? "").replace(/\s+/g, " "), marks);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName;
      if (tag === "BR") {
        if (cur.length) flush();
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
      const isBlock = BLOCK.has(tag);
      if (isBlock && cur.length) flush();
      if (isBlock) curType = blockTypeForTag(tag);
      walk(el, m);
      if (isBlock) flush();
    }
  };
  walk(doc.body, {});
  if (cur.length) flush();
  while (blocks.length && blocks[0].items.length === 0) blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].items.length === 0) blocks.pop();
  return blocks;
}
