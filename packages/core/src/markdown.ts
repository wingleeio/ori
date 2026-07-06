import type { InlineItem, Marks } from "@wingleeio/ori-pretext";
import { isListBlockType, normalizeHeadingLevel, normalizeListLevel, type BlockType } from "./schema";

/**
 * Markdown (de)serialization for block-grouped inline content. Pure functions
 * with no DOM or Yjs dependency: the same `{ type, items, attrs? }` shape the
 * clipboard layer uses, so a host can export a note to GitHub-flavored
 * markdown and import it back. The parser round-trips everything the
 * serializer emits (headings, fenced code, quotes, nested lists, todos, and
 * the inline marks), and degrades to literal text for anything unmatched.
 */
export interface ContentBlock {
  type: BlockType;
  items: InlineItem[];
  /** Block attrs (e.g. a heading's level, a code block's lang). */
  attrs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Backslash-escape only the characters our own parser treats as syntax
 * (`\ * _ ` ~ [ ]`), so plain text survives a round trip without littering
 * the output with escapes markdown doesn't need.
 */
function escapeText(s: string): string {
  return s.replace(/[\\*_`~[\]]/g, (ch) => `\\${ch}`);
}

/** An inline atom's human-readable `@label` (mirrors the clipboard's atomPlain). */
function atomLabel(item: InlineItem): string {
  const d = (item.atom?.data ?? {}) as Record<string, unknown>;
  const label = d.label ?? d.text ?? d.name;
  return label != null ? `@${String(label)}` : "";
}

/**
 * Wrap text in a code span. Backslash escapes don't work inside code spans, so
 * literal backticks need a longer delimiter run instead (CommonMark), and
 * content that starts/ends with a backtick or space needs one space of padding
 * (which the parser strips back off).
 */
function codeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const delim = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = /^[` ]|[` ]$/.test(text) ? " " : "";
  return `${delim}${pad}${text}${pad}${delim}`;
}

/**
 * One inline item as markdown, marks nested in a fixed order — link outermost,
 * then bold, italic, strike, underline, code innermost — so the parser (which
 * scans left to right and parses links before emphasis) reads them back into
 * the same mark set. Underline has no markdown syntax, so it stays HTML.
 */
function itemToMarkdown(item: InlineItem): string {
  if (item.atom) return escapeText(atomLabel(item));
  if (!item.text) return "";
  const m = item.marks ?? {};
  let out = m.code ? codeSpan(item.text) : escapeText(item.text);
  if (m.underline) out = `<u>${out}</u>`;
  if (m.strike) out = `~~${out}~~`;
  if (m.italic) out = `*${out}*`;
  if (m.bold) out = `**${out}**`;
  if (m.link) out = `[${out}](${m.link})`;
  return out;
}

function inlineToMarkdown(items: InlineItem[]): string {
  return items.map(itemToMarkdown).join("");
}

/** Unformatted text for a block (code fences must stay verbatim, not escaped). */
function plainText(items: InlineItem[]): string {
  return items.map((it) => (it.atom ? atomLabel(it) : it.text)).join("");
}

function listLevel(attrs?: Record<string, unknown>): number {
  return normalizeListLevel(attrs?.level);
}

/**
 * 1-based ordinal of an ordered item within its run — mirrors the clipboard's
 * listOrdinal: walk back through consecutive list items, counting same-level
 * ordered ones, and stop when the run breaks (a non-list block, a shallower
 * item, or a same-level item of a different list type).
 */
function listOrdinal(blocks: ContentBlock[], index: number): number {
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

/** Render one block, or `null` for atomic custom blocks markdown can't express. */
function renderBlock(blocks: ContentBlock[], index: number): string | null {
  const b = blocks[index];
  if (b.type === "heading") {
    return `${"#".repeat(normalizeHeadingLevel(b.attrs?.level))} ${inlineToMarkdown(b.items)}`;
  }
  if (b.type === "quote") {
    // Newlines inside a quote become additional quoted lines, not new blocks.
    return inlineToMarkdown(b.items)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (b.type === "code") {
    // Fence content is verbatim — no inline marks, no escaping.
    const lang = typeof b.attrs?.lang === "string" ? b.attrs.lang : "";
    return `\`\`\`${lang}\n${plainText(b.items)}\n\`\`\``;
  }
  if (isListBlockType(b.type)) {
    const indent = "  ".repeat(listLevel(b.attrs));
    const body = inlineToMarkdown(b.items);
    if (b.type === "todo-list") return `${indent}- [${b.attrs?.checked === true ? "x" : " "}] ${body}`;
    if (b.type === "ordered-list") return `${indent}${listOrdinal(blocks, index)}. ${body}`;
    return `${indent}- ${body}`;
  }
  // Unknown types with inline content serialize like paragraphs; atomic custom
  // blocks (an image, say) have no markdown form and are skipped — the join
  // below still leaves a blank line where they were, so surrounding list runs
  // don't fuse together.
  if (b.type !== "paragraph" && b.items.length === 0) return null;
  // A "\n" inside a paragraph is a soft break; markdown needs the trailing
  // two-space hard break or the parser would fold the lines into one.
  return inlineToMarkdown(b.items).replace(/\n/g, "  \n");
}

/** Serialize blocks to GitHub-flavored markdown. */
export function blocksToMarkdown(blocks: ContentBlock[]): string {
  let out = "";
  let prevIndex = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    const text = renderBlock(blocks, i);
    if (text === null) continue;
    if (prevIndex !== -1) {
      // Consecutive list items (of any list type) stay one per line so they
      // read as a single list; everything else separates with a blank line.
      // A skipped atomic block between two lists still forces the blank line.
      const adjacentLists =
        prevIndex === i - 1 && isListBlockType(blocks[prevIndex].type) && isListBlockType(blocks[i].type);
      out += adjacentLists ? "\n" : "\n\n";
    }
    out += text;
    prevIndex = i;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing — block structure
// ---------------------------------------------------------------------------

const FENCE_RE = /^```(.*)$/;
const FENCE_CLOSE_RE = /^```\s*$/;
const HEADING_RE = /^(#{1,3}) (.*)$/;
const TODO_RE = /^( *)- \[( |x|X)\] ?(.*)$/;
const BULLET_RE = /^( *)[-*+] (.*)$/;
const ORDERED_RE = /^( *)\d+[.)] (.*)$/;

/** Two spaces of indentation per nesting level, clamped to the schema's max. */
function indentLevel(indent: string): number {
  return normalizeListLevel(Math.floor(indent.replace(/\t/g, "  ").length / 2));
}

/** Whether a line starts a non-paragraph block (terminates a paragraph run). */
function isStructural(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    line.startsWith(">") ||
    TODO_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line)
  );
}

/**
 * Parse markdown into blocks. Supports headings (`#`–`###`), fenced code with
 * an optional language, `>` quotes, bullet/ordered/todo lists with two-space
 * indent nesting, blank-line separated paragraphs, and the inline marks
 * (`**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `[text](url)`,
 * `<u>underline</u>`).
 */
export function markdownToBlocks(markdown: string): ContentBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ContentBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      // Everything until the closing fence (or EOF for an unclosed fence) is
      // verbatim — no inline parsing, no escapes.
      const lang = fence[1].trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE_CLOSE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume the closing fence
      const text = body.join("\n");
      blocks.push({
        type: "code",
        items: text ? [{ text, start: 0 }] : [],
        ...(lang ? { attrs: { lang } } : {}),
      });
      continue;
    }

    if (line.startsWith(">")) {
      // Consecutive quote lines merge into ONE quote block with soft breaks.
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        body.push(lines[i].replace(/^> ?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", items: parseInline(body.join("\n")) });
      continue;
    }

    const todo = TODO_RE.exec(line);
    if (todo) {
      blocks.push({
        type: "todo-list",
        items: parseInline(todo[3]),
        attrs: { level: indentLevel(todo[1]), checked: todo[2].toLowerCase() === "x" },
      });
      i += 1;
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      blocks.push({
        type: "bullet-list",
        items: parseInline(bullet[2]),
        attrs: { level: indentLevel(bullet[1]) },
      });
      i += 1;
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      blocks.push({
        type: "ordered-list",
        items: parseInline(ordered[2]),
        attrs: { level: indentLevel(ordered[1]) },
      });
      i += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        items: parseInline(heading[2]),
        attrs: { level: normalizeHeadingLevel(heading[1].length) },
      });
      i += 1;
      continue;
    }

    // Paragraph: consecutive plain lines fold into one block joined by soft
    // breaks. A trailing two-space hard break is the same soft break with the
    // marker stripped.
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isStructural(lines[i])) {
      const raw = lines[i];
      body.push(raw.endsWith("  ") ? raw.slice(0, -2) : raw);
      i += 1;
    }
    blocks.push({ type: "paragraph", items: parseInline(body.join("\n")) });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Parsing — inline marks
// ---------------------------------------------------------------------------

/** ASCII punctuation, the set a backslash may escape (CommonMark). */
const ESCAPABLE = /[!-/:-@[-`{-~]/;

function runLength(src: string, i: number, end: number, ch: string): number {
  let n = 0;
  while (i + n < end && src[i + n] === ch) n += 1;
  return n;
}

/** Start of the closing backtick run of exactly `len` in `[from, end)`, or -1. */
function findCodeClose(src: string, from: number, end: number, len: number): number {
  let i = from;
  while (i < end) {
    if (src[i] === "`") {
      const n = runLength(src, i, end, "`");
      if (n === len) return i;
      i += n;
    } else {
      i += 1;
    }
  }
  return -1;
}

/**
 * Next unescaped occurrence of `delim` in `[from, end)`, skipping over
 * complete code spans so that delimiters inside inline code stay literal
 * (`` `a*b` `` must not close an emphasis opened outside it). -1 when absent.
 */
function findDelim(src: string, delim: string, from: number, end: number): number {
  let i = from;
  while (i < end) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      const open = runLength(src, i, end, "`");
      const close = findCodeClose(src, i + open, end, open);
      i = close === -1 ? i + open : close + open;
      continue;
    }
    if (src.startsWith(delim, i)) return i;
    i += 1;
  }
  return -1;
}

interface LinkMatch {
  textStart: number;
  textEnd: number;
  url: string;
  /** Index just past the closing `)`. */
  next: number;
}

/** Match `[text](url)` at `i`; brackets in text and parens in the url may nest. */
function matchLink(src: string, i: number, end: number): LinkMatch | null {
  let depth = 0;
  let j = i + 1;
  while (j < end) {
    const ch = src[j];
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === "`") {
      const open = runLength(src, j, end, "`");
      const close = findCodeClose(src, j + open, end, open);
      j = close === -1 ? j + open : close + open;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      if (depth === 0) break;
      depth -= 1;
    }
    j += 1;
  }
  if (j >= end || src[j] !== "]" || !src.startsWith("(", j + 1)) return null;
  let pdepth = 0;
  let k = j + 2;
  while (k < end) {
    const ch = src[k];
    if (ch === "\\") {
      k += 2;
      continue;
    }
    if (ch === "(") pdepth += 1;
    else if (ch === ")") {
      if (pdepth === 0) break;
      pdepth -= 1;
    }
    k += 1;
  }
  if (k >= end || src[k] !== ")") return null;
  return { textStart: i + 1, textEnd: j, url: src.slice(j + 2, k), next: k + 1 };
}

function marksEqual(a: Marks | undefined, b: Marks | undefined): boolean {
  const x = a ?? {};
  const y = b ?? {};
  return (
    !!x.bold === !!y.bold &&
    !!x.italic === !!y.italic &&
    !!x.code === !!y.code &&
    !!x.underline === !!y.underline &&
    !!x.strike === !!y.strike &&
    (x.link ?? null) === (y.link ?? null)
  );
}

type Emit = (text: string, marks: Marks) => void;

/**
 * Scan `src[i, end)` emitting text runs with `marks` applied. Links are parsed
 * first (and disallowed inside their own text), then emphasis/strike/underline
 * recurse so marks nest; code spans never nest. Unmatched delimiters fall
 * through as literal text.
 */
function scanInline(src: string, i: number, end: number, marks: Marks, emit: Emit, allowLink: boolean): void {
  let plain = "";
  const flush = () => {
    if (plain) {
      emit(plain, marks);
      plain = "";
    }
  };
  while (i < end) {
    const ch = src[i];

    // Backslash escapes produce the literal punctuation character.
    if (ch === "\\" && i + 1 < end && ESCAPABLE.test(src[i + 1])) {
      plain += src[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const open = runLength(src, i, end, "`");
      const close = findCodeClose(src, i + open, end, open);
      if (close !== -1) {
        // Strip the one-space padding the serializer adds around content that
        // starts/ends with a backtick or space.
        let content = src.slice(i + open, close);
        if (content.length >= 2 && content.startsWith(" ") && content.endsWith(" ")) {
          content = content.slice(1, -1);
        }
        flush();
        emit(content, { ...marks, code: true });
        i = close + open;
        continue;
      }
      plain += src.slice(i, i + open); // unmatched backticks stay literal
      i += open;
      continue;
    }

    if (ch === "[" && allowLink) {
      const link = matchLink(src, i, end);
      if (link) {
        flush();
        scanInline(src, link.textStart, link.textEnd, { ...marks, link: link.url }, emit, false);
        i = link.next;
        continue;
      }
    }

    if (ch === "<" && src.startsWith("<u>", i)) {
      const close = findDelim(src, "</u>", i + 3, end);
      if (close !== -1) {
        flush();
        scanInline(src, i + 3, close, { ...marks, underline: true }, emit, allowLink);
        i = close + 4;
        continue;
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      // Try the longest delimiter first: *** is bold+italic, ** bold, * italic
      // (same for _); ~~ is strike, a single ~ is always literal. Content must
      // be non-empty and not whitespace-bounded, or the run stays literal.
      const run = Math.min(runLength(src, i, end, ch), ch === "~" ? 2 : 3);
      const min = ch === "~" ? 2 : 1;
      let matched = false;
      for (let n = run; n >= min; n -= 1) {
        const delim = ch.repeat(n);
        const close = findDelim(src, delim, i + n, end);
        if (close === -1) continue;
        const content = src.slice(i + n, close);
        if (!content || /^\s|\s$/.test(content)) continue;
        const next: Marks = { ...marks };
        if (ch === "~") next.strike = true;
        else if (n === 1) next.italic = true;
        else if (n === 2) next.bold = true;
        else {
          next.bold = true;
          next.italic = true;
        }
        flush();
        scanInline(src, i + n, close, next, emit, allowLink);
        i = close + n;
        matched = true;
        break;
      }
      if (matched) continue;
      plain += src.slice(i, i + run);
      i += run;
      continue;
    }

    plain += ch;
    i += 1;
  }
  flush();
}

/**
 * Parse a block's markdown into inline items. `start` offsets are cumulative
 * plain-text offsets (delimiters don't count), and adjacent runs with equal
 * marks merge so literal fallbacks don't fragment the text.
 */
function parseInline(src: string): InlineItem[] {
  const items: InlineItem[] = [];
  let length = 0;
  const emit: Emit = (text, marks) => {
    if (!text) return;
    const m = Object.keys(marks).length > 0 ? { ...marks } : undefined;
    const last = items[items.length - 1];
    if (last && marksEqual(last.marks, m)) {
      last.text += text;
    } else {
      items.push({ text, start: length, ...(m ? { marks: m } : {}) });
    }
    length += text.length;
  };
  scanInline(src, 0, src.length, {}, emit, true);
  return items;
}
