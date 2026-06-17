import type { Measurer } from "./measurer";
import type { Token } from "./tokenize";
import { tokenize } from "./tokenize";
import { lineHeightPx, typographyKey } from "./typography";
import type {
  BlockLayout,
  Fragment,
  InlineItem,
  Line,
  Marks,
  Typography,
} from "./types";

export interface LayoutOptions {
  /** Available content width in pixels. `<= 0` disables wrapping. */
  width: number;
  typography: Typography;
  measurer: Measurer;
  /**
   * When true, build `fragments` for every line (needed for rendering, caret
   * geometry and hit-testing). When false, only line counts / heights are
   * produced — cheaper, used for offscreen blocks.
   */
  detailed?: boolean;
}

interface RawLine {
  tokens: Token[];
  hardBreak: boolean;
}

function sameStyle(a: Token, b: Fragment): boolean {
  // Atoms are always their own fragment.
  return !a.atom && !b.atom && a.font.css === b.font.css && a.start === b.end;
}

/** Hard-break a word that is wider than the line into char-level chunks. */
function breakLongWord(token: Token, maxWidth: number, measurer: Measurer): Token[] {
  const { text, font, marks } = token;
  const parts: Token[] = [];
  let chunkStart = 0;
  let i = 0;

  const emit = (from: number, to: number) => {
    const slice = text.slice(from, to);
    parts.push({
      text: slice,
      start: token.start + from,
      marks,
      font,
      width: measurer.measure(slice, font),
      kind: "word",
    });
  };

  while (i < text.length) {
    const w = measurer.measure(text.slice(chunkStart, i + 1), font);
    if (w > maxWidth && i > chunkStart) {
      emit(chunkStart, i);
      chunkStart = i; // re-evaluate this char as the start of the next chunk
    } else {
      i += 1;
    }
  }
  emit(chunkStart, text.length);
  return parts;
}

/** Greedy word-wrap the tokens into raw lines. */
function wrap(tokens: Token[], maxWidth: number, measurer: Measurer): RawLine[] {
  const lines: RawLine[] = [];
  let line: Token[] = [];
  let lineWidth = 0;

  const commit = (hardBreak: boolean) => {
    lines.push({ tokens: line, hardBreak });
    line = [];
    lineWidth = 0;
  };

  for (const token of tokens) {
    if (token.kind === "newline") {
      commit(true);
      continue;
    }
    if (token.kind === "space") {
      line.push(token);
      lineWidth += token.width;
      continue;
    }
    // word or atom — both are non-collapsible inline boxes
    if (lineWidth > 0 && lineWidth + token.width > maxWidth) {
      commit(false);
    }
    if (token.kind === "word" && token.width > maxWidth && maxWidth !== Infinity) {
      const parts = breakLongWord(token, maxWidth, measurer);
      for (let k = 0; k < parts.length; k += 1) {
        if (k > 0) commit(false);
        line.push(parts[k]);
        lineWidth += parts[k].width;
      }
    } else {
      // Atoms never char-break; an over-wide atom simply overflows its line.
      line.push(token);
      lineWidth += token.width;
    }
  }
  commit(false); // always emit a final (possibly empty) line
  return lines;
}

function buildFragments(tokens: Token[]): { fragments: Fragment[]; width: number } {
  const fragments: Fragment[] = [];
  let x = 0;
  for (const tok of tokens) {
    const last = fragments[fragments.length - 1];
    if (last && sameStyle(tok, last)) {
      last.text += tok.text;
      last.end = tok.start + tok.text.length;
      last.width += tok.width;
    } else {
      fragments.push({
        text: tok.text,
        start: tok.start,
        end: tok.start + tok.text.length,
        marks: tok.marks as Marks,
        font: tok.font,
        x,
        width: tok.width,
        atom: tok.atom,
      });
    }
    x += tok.width;
  }
  return { fragments, width: x };
}

/**
 * Lay out a single block: wrap its styled inline text into materialized lines
 * with geometry. This is the heart of "Pretext".
 */
export function layoutBlock(items: InlineItem[], opts: LayoutOptions): BlockLayout {
  const { typography, measurer, detailed = false } = opts;
  const maxWidth = opts.width > 0 ? opts.width : Infinity;
  const lineH = lineHeightPx(typography);

  const tokens = tokenize(items, typography, measurer);
  const rawLines = wrap(tokens, maxWidth, measurer);

  const lines: Line[] = [];
  let top = 0;
  let prevEnd = 0;
  let prevHard = false;

  for (let idx = 0; idx < rawLines.length; idx += 1) {
    const { tokens: lts, hardBreak } = rawLines[idx];

    let start: number;
    let end: number;
    if (lts.length > 0) {
      start = lts[0].start;
      const lastTok = lts[lts.length - 1];
      end = lastTok.start + lastTok.text.length;
    } else {
      start = idx === 0 ? 0 : prevHard ? prevEnd + 1 : prevEnd;
      end = start;
    }

    let fragments: Fragment[] = [];
    let width = 0;
    if (detailed && lts.length > 0) {
      const built = buildFragments(lts);
      fragments = built.fragments;
      width = built.width;
    } else if (lts.length > 0) {
      for (const t of lts) width += t.width;
    }

    lines.push({
      index: idx,
      top,
      height: lineH,
      width,
      start,
      end,
      hardBreak,
      fragments,
    });

    top += lineH;
    prevEnd = end;
    prevHard = hardBreak;
  }

  const length = items.reduce((n, it) => n + (it.atom ? 1 : it.text.length), 0);

  return {
    width: opts.width,
    typographyKey: typographyKey(typography),
    height: lines.length * lineH,
    lineCount: lines.length,
    length,
    detailed,
    lines,
  };
}
