import type { InlineItem } from "@wingleeio/ori-core";

/** CSS.escape with a fallback (jsdom lacks it). */
export function esc(s: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

/**
 * Imperative DOM helpers for the contentEditable view. Each block is a
 * block-level element carrying `data-block-id`; its inline runs are spans
 * carrying `data-off` (their start offset in the block) so DOM positions map
 * back to {blockId, offset} and vice-versa.
 */

export const BLOCK_SEL = "[data-block-id]";

export function blockElOf(node: Node | null, root: HTMLElement): HTMLElement | null {
  let n: Node | null = node;
  while (n && n !== root) {
    if (n instanceof HTMLElement && n.dataset.blockId) return n;
    n = n.parentNode;
  }
  return null;
}

function spanOf(node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n) {
    if (n instanceof HTMLElement && n.dataset.off != null) return n;
    n = n.parentNode;
  }
  return null;
}

/** Map a DOM (node, offset) to a {blockId, offset} model position. */
export function domToModel(
  root: HTMLElement,
  node: Node | null,
  offset: number,
): { blockId: string; offset: number } | null {
  const blockEl = blockElOf(node, root);
  if (!blockEl) return null;
  const blockId = blockEl.dataset.blockId as string;

  // A caret can land directly on a <br> — a hard break, or the trailing filler
  // <br> that makes the empty last line selectable. Neither carries data-off, so
  // normalize it to a position in the block at the <br>'s child index, where the
  // logic below resolves it against the surrounding run spans.
  if (node instanceof HTMLElement && node.tagName === "BR") {
    const idx = Array.prototype.indexOf.call(blockEl.childNodes, node);
    if (idx >= 0) {
      node = blockEl;
      offset = idx + (offset > 0 ? 1 : 0);
    }
  }

  if (node && node.nodeType === Node.TEXT_NODE) {
    const span = spanOf(node);
    const base = span ? Number(span.dataset.off) : 0;
    return { blockId, offset: base + offset };
  }

  // node is an element; `offset` is a child index. Resolve via the child spans.
  const el = node as HTMLElement;
  if (el.dataset?.off != null) {
    // selection landed on a span boundary
    return { blockId, offset: Number(el.dataset.off) + (offset > 0 ? spanLen(el) : 0) };
  }
  const kids = Array.from(el.childNodes);
  for (let i = offset; i < kids.length; i++) {
    const k = kids[i];
    if (k instanceof HTMLElement && k.dataset.off != null) return { blockId, offset: Number(k.dataset.off) };
  }
  // past the last span → block end
  let end = 0;
  for (const k of kids) if (k instanceof HTMLElement && k.dataset.off != null) end = Math.max(end, Number(k.dataset.off) + spanLen(k));
  return { blockId, offset: end };
}

function spanLen(span: HTMLElement): number {
  return span.dataset.len != null ? Number(span.dataset.len) : (span.textContent ?? "").length;
}

/** Find the DOM (node, offset) for a {blockId, offset} model position. */
export function modelToDom(
  root: HTMLElement,
  blockId: string,
  offset: number,
): { node: Node; offset: number } | null {
  const blockEl = root.querySelector(`[data-block-id="${esc(blockId)}"]`) as HTMLElement | null;
  if (!blockEl) return null;
  const spans = Array.from(blockEl.querySelectorAll("[data-off]")) as HTMLElement[];
  if (spans.length === 0) {
    return { node: blockEl, offset: 0 }; // empty block
  }
  for (const span of spans) {
    const start = Number(span.dataset.off);
    const len = spanLen(span);
    if (offset <= start + len) {
      if (span.dataset.atom != null || span.dataset.break != null) {
        // atom or hard break (<br>): place before or after it by child index
        const idx = Array.prototype.indexOf.call(blockEl.childNodes, span);
        return { node: blockEl, offset: offset <= start ? idx : idx + 1 };
      }
      const textNode = span.firstChild ?? span;
      return { node: textNode, offset: Math.max(0, Math.min(offset - start, (textNode.textContent ?? "").length)) };
    }
  }
  // past everything → after the last span
  const last = spans[spans.length - 1];
  const textNode = last.firstChild ?? last;
  return { node: textNode, offset: (textNode.textContent ?? "").length };
}

function markClass(marks: InlineItem["marks"]): string {
  const m = marks ?? {};
  const cls = ["ori-frag"];
  if (m.bold) cls.push("ori-m-bold");
  if (m.italic) cls.push("ori-m-italic");
  if (m.underline) cls.push("ori-m-underline");
  if (m.strike) cls.push("ori-m-strike");
  if (m.code) cls.push("ori-frag-code");
  if (m.link) cls.push("ori-frag-link");
  return cls.join(" ");
}

/** Build the inline run DOM for a block (text spans only; atoms handled by the view). */
export function buildRun(item: InlineItem): HTMLElement {
  const span = document.createElement("span");
  span.className = markClass(item.marks);
  span.dataset.off = String(item.start);
  span.dataset.len = String(item.text.length);
  span.textContent = item.text;
  return span;
}
