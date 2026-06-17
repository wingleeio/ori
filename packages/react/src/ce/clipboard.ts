import type { InlineItem, Marks } from "@wingleeio/ori-core";

/**
 * Clipboard (de)serialization for the contentEditable view. Copy writes three
 * payloads — `text/plain`, `text/html` (for other apps), and a private JSON MIME
 * that round-trips marks/atoms exactly — and paste prefers the private MIME, then
 * falls back to parsing external HTML, then plain text. Content is grouped one
 * array of inline runs per block so block boundaries survive a multi-block copy.
 */
export const ORI_MIME = "application/x-ori-inline";

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

/** Build the three clipboard payloads for a block-grouped selection. */
export function serializeSelection(blocks: InlineItem[][]): { text: string; html: string; json: string } {
  const text = blocks.map(blockPlain).join("\n");
  const html = blocks.map((items) => `<p>${items.map(runHtml).join("") || "<br>"}</p>`).join("");
  const json = JSON.stringify({
    v: 1,
    blocks: blocks.map((items) =>
      items.map((it) =>
        it.atom ? { embed: it.atom.data ?? { type: it.atom.type } } : { text: it.text, marks: it.marks },
      ),
    ),
  });
  return { text, html, json };
}

interface SerItem {
  text?: string;
  marks?: Marks;
  embed?: Record<string, unknown>;
}

/** Parse our own clipboard JSON back into block-grouped inline items. */
export function deserializeOri(json: string): InlineItem[][] | null {
  try {
    const data = JSON.parse(json) as { v?: number; blocks?: SerItem[][] };
    if (!Array.isArray(data.blocks)) return null;
    return data.blocks.map((items) =>
      items.map((it) =>
        it.embed
          ? { text: "", start: 0, atom: { type: String(it.embed.type ?? ""), width: 0, data: it.embed } }
          : { text: it.text ?? "", start: 0, marks: it.marks },
      ),
    );
  } catch {
    return null;
  }
}

/** Plain text → one block per line. */
export function textToBlocks(text: string): InlineItem[][] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line ? [{ text: line, start: 0 } as InlineItem] : []));
}

/** Parse external HTML into block-grouped inline items (best-effort marks). */
export function htmlToBlocks(html: string): InlineItem[][] {
  if (typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: InlineItem[][] = [];
  let cur: InlineItem[] = [];
  const flush = () => {
    blocks.push(cur);
    cur = [];
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
      walk(el, m);
      if (isBlock) flush();
    }
  };
  walk(doc.body, {});
  if (cur.length) flush();
  // Trim leading/trailing empty blocks left by formatting whitespace.
  while (blocks.length && blocks[0].length === 0) blocks.shift();
  while (blocks.length && blocks[blocks.length - 1].length === 0) blocks.pop();
  return blocks;
}
