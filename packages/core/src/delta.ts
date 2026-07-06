import type { InlineItem, Marks, Measurer, Typography } from "@wingleeio/ori-pretext";
import * as Y from "yjs";
import type { InlineAtomNode } from "./nodes";

interface DeltaOp {
  insert?: string | object;
  attributes?: Record<string, unknown>;
}

/** Supplies inline-atom widths when converting a delta with embeds. */
export interface AtomResolver {
  atoms: Record<string, InlineAtomNode>;
  typography: Typography;
  measurer: Measurer;
}

/** Translate Yjs formatting attributes into Pretext {@link Marks}. */
export function attributesToMarks(attrs?: Record<string, unknown>): Marks {
  const m: Marks = {};
  if (!attrs) return m;
  if (attrs.bold) m.bold = true;
  if (attrs.italic) m.italic = true;
  if (attrs.code) m.code = true;
  if (attrs.underline) m.underline = true;
  if (attrs.strike || attrs.strikethrough) m.strike = true;
  if (typeof attrs.link === "string") m.link = attrs.link;
  return m;
}

/** Translate Pretext {@link Marks} into (sparse) Yjs formatting attributes. */
export function marksToAttributes(marks: Marks): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  if (marks.bold) attrs.bold = true;
  if (marks.italic) attrs.italic = true;
  if (marks.code) attrs.code = true;
  if (marks.underline) attrs.underline = true;
  if (marks.strike) attrs.strike = true;
  if (marks.link) attrs.link = marks.link;
  return attrs;
}

/**
 * Translate {@link Marks} into an *explicit* attribute set: every supported
 * mark is named, set to `true` or `null`. This is required on insert — Yjs
 * keeps a format "open" across inserts, so a plain insert after bold text must
 * explicitly close `bold` (with `null`) or it inherits it.
 */
export function fullAttributes(marks: Marks): Record<string, unknown> {
  return {
    bold: marks.bold ? true : null,
    italic: marks.italic ? true : null,
    code: marks.code ? true : null,
    underline: marks.underline ? true : null,
    strike: marks.strike ? true : null,
    link: marks.link ?? null,
  };
}

/** Expand a (possibly partial) delta attribute map to an explicit insert set. */
export function normalizeAttributes(attrs?: Record<string, unknown>): Record<string, unknown> {
  return fullAttributes(attributesToMarks(attrs));
}

/**
 * Convert a `Y.Text` into Pretext inline items, carrying absolute offsets.
 * String inserts become text items; object inserts (Yjs embeds) become
 * single-offset inline atoms, with their width resolved from `resolver`.
 */
export function textToInline(text: Y.Text, resolver?: AtomResolver): InlineItem[] {
  const delta = text.toDelta() as DeltaOp[];
  const items: InlineItem[] = [];
  let offset = 0;
  for (const op of delta) {
    if (typeof op.insert === "string") {
      items.push({
        text: op.insert,
        start: offset,
        marks: attributesToMarks(op.attributes),
      });
      offset += op.insert.length;
    } else if (op.insert && typeof op.insert === "object") {
      const data = op.insert as Record<string, unknown>;
      const type = String(data.type ?? "");
      const spec = resolver?.atoms[type];
      const width =
        spec && resolver
          ? spec.measure({ data, typography: resolver.typography, measurer: resolver.measurer })
          : 0;
      items.push({
        text: "",
        start: offset,
        marks: attributesToMarks(op.attributes),
        atom: { type, width, data },
      });
      offset += 1;
    }
  }
  return items;
}

/**
 * Plain text where each embed is one placeholder char, so string indices line
 * up with Yjs offsets. Use for offset-correct slicing/scanning.
 */
export function textToPlain(text: Y.Text): string {
  const delta = text.toDelta() as DeltaOp[];
  let out = "";
  for (const op of delta) {
    if (typeof op.insert === "string") out += op.insert;
    else if (op.insert) out += "￼";
  }
  return out;
}

/**
 * Human-readable text for the half-open range `[from, to)`, rendering embeds by
 * their `label`/`text` field (so a copied mention keeps its name).
 */
export function sliceTextPlain(text: Y.Text, from: number, to: number): string {
  const delta = text.toDelta() as DeltaOp[];
  let pos = 0;
  let out = "";
  for (const op of delta) {
    if (typeof op.insert === "string") {
      const len = op.insert.length;
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + len);
      if (s < e) out += op.insert.slice(s - pos, e - pos);
      pos += len;
    } else if (op.insert) {
      if (pos >= from && pos < to) {
        const embed = op.insert as Record<string, unknown>;
        out += String(embed.label ?? embed.text ?? "");
      }
      pos += 1;
    }
  }
  return out;
}

/** The set of marks active across the range `[from, to)` (empty if mixed). */
export function activeMarks(text: Y.Text, from: number, to: number): Marks {
  const items = textToInline(text);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const probe = start === end ? Math.max(0, start - 1) : start;

  let common: Marks | null = null;
  for (const item of items) {
    const itemEnd = item.start + item.text.length;
    const overlaps =
      start === end ? probe >= item.start && probe < itemEnd : item.start < end && itemEnd > start;
    if (!overlaps) continue;
    const marks = item.marks ?? {};
    if (common === null) {
      common = { ...marks };
    } else {
      common = intersectMarks(common, marks);
    }
  }
  return common ?? {};
}

/**
 * Bounds `[start, end)` and URL of the contiguous link run containing the
 * caret at `offset`, or `null` when the caret isn't on a link. Adjacent runs
 * with the SAME url merge (bold text inside a link splits the delta ops but
 * not the link); the caret "is on" a link under the same left-biased rule as
 * {@link activeMarks} (marks come from the character before the caret).
 */
export function linkBoundsAt(
  text: Y.Text,
  offset: number,
): { start: number; end: number; url: string } | null {
  const items = textToInline(text);
  const probe = Math.max(0, offset - 1);
  let runStart = 0;
  let runEnd = 0;
  let runUrl: string | undefined;
  let hit: { start: number; end: number; url: string } | null = null;
  const flush = () => {
    if (runUrl && probe >= runStart && probe < runEnd) {
      hit = { start: runStart, end: runEnd, url: runUrl };
    }
  };
  for (const item of items) {
    const len = item.atom ? 1 : item.text.length;
    const url = item.marks?.link;
    if (url !== runUrl) {
      flush();
      runStart = item.start;
      runUrl = url;
    }
    runEnd = item.start + len;
  }
  flush();
  return hit;
}

/** Marks common to both sets — a mark is kept only if present (and equal) in each. */
export function intersectMarks(a: Marks, b: Marks): Marks {
  const out: Marks = {};
  if (a.bold && b.bold) out.bold = true;
  if (a.italic && b.italic) out.italic = true;
  if (a.code && b.code) out.code = true;
  if (a.underline && b.underline) out.underline = true;
  if (a.strike && b.strike) out.strike = true;
  if (a.link && a.link === b.link) out.link = a.link;
  return out;
}
