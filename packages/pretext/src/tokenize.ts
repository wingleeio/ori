import type { InlineAtom, InlineItem, Marks, ResolvedFont, Typography } from "./types";
import type { Measurer } from "./measurer";
import { resolveFont } from "./typography";

export type TokenKind = "word" | "space" | "newline" | "atom";

/** Unicode OBJECT REPLACEMENT CHARACTER — stands in for an inline atom. */
const ATOM_CHAR = "￼";

/** A measured, single-style atom used by the line breaker. */
export interface Token {
  text: string;
  /** Offset of the first character within the block. */
  start: number;
  marks: Marks;
  font: ResolvedFont;
  width: number;
  kind: TokenKind;
  atom?: InlineAtom;
}

function sameMarks(a: Marks | undefined, b: Marks | undefined): boolean {
  const x = a ?? {};
  const y = b ?? {};
  return (
    !!x.bold === !!y.bold &&
    !!x.italic === !!y.italic &&
    !!x.code === !!y.code &&
    !!x.underline === !!y.underline &&
    !!x.strike === !!y.strike &&
    (x.link ?? "") === (y.link ?? "")
  );
}

/**
 * Merge adjacent inline items that share identical marks. Yjs deltas can be
 * fragmented (one op per edit); merging keeps words intact so the breaker
 * never wraps in the middle of an unstyled word.
 */
export function mergeItems(items: InlineItem[]): InlineItem[] {
  const out: InlineItem[] = [];
  for (const item of items) {
    if (item.atom) {
      // Atoms are indivisible and never merge with neighbours.
      out.push({ text: "", start: item.start, marks: item.marks, atom: item.atom });
      continue;
    }
    if (item.text.length === 0) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      !prev.atom &&
      prev.start + prev.text.length === item.start &&
      sameMarks(prev.marks, item.marks)
    ) {
      prev.text += item.text;
    } else {
      out.push({ text: item.text, start: item.start, marks: item.marks });
    }
  }
  return out;
}

const isSpaceChar = (c: string): boolean => c === " " || c === "\t";

/**
 * Split styled inline items into measured word / space / newline tokens.
 * Each token is a maximal run of one character class within a single style.
 */
export function tokenize(
  items: InlineItem[],
  typography: Typography,
  measurer: Measurer,
): Token[] {
  const merged = mergeItems(items);
  const tokens: Token[] = [];

  for (const item of merged) {
    const marks = item.marks ?? {};
    const font = resolveFont(typography, marks);

    if (item.atom) {
      tokens.push({
        text: ATOM_CHAR,
        start: item.start,
        marks,
        font,
        width: item.atom.width,
        kind: "atom",
        atom: item.atom,
      });
      continue;
    }

    const text = item.text;
    let i = 0;

    while (i < text.length) {
      const ch = text[i];

      if (ch === "\n") {
        tokens.push({
          text: "\n",
          start: item.start + i,
          marks,
          font,
          width: 0,
          kind: "newline",
        });
        i += 1;
        continue;
      }

      const space = isSpaceChar(ch);
      let j = i + 1;
      while (j < text.length) {
        const c = text[j];
        if (c === "\n" || isSpaceChar(c) !== space) break;
        j += 1;
      }

      const seg = text.slice(i, j);
      tokens.push({
        text: seg,
        start: item.start + i,
        marks,
        font,
        width: measurer.measure(seg, font),
        kind: space ? "space" : "word",
      });
      i = j;
    }
  }

  return tokens;
}
