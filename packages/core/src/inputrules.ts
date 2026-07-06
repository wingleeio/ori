import type { BlockType } from "./schema";

/**
 * Markdown input rules — live autoformatting as the user types.
 *
 * Two kinds:
 * - **Block rules** fire when the text from the block's start to the caret is
 *   exactly a markdown block prefix (`# `, `- `, `1. `, `[] `, `> `, ``` ``` ```):
 *   the block converts to the matching type and the prefix is removed.
 * - **Inline rules** fire when the just-typed character completes a delimited
 *   span (`**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `__bold__`,
 *   `_italic_`): the delimiters are removed and the inner text gets the mark.
 *
 * Matching is pure (string in, description out); the {@link EditorController}
 * applies the result to the document. Both are checked only on single-character
 * insertions, so pasting literal markdown never reformats.
 */

export interface BlockRuleMatch {
  type: BlockType;
  attrs?: Record<string, unknown>;
  /** Characters to delete from the block start (the whole prefix). */
  prefixLength: number;
}

/**
 * Match a markdown block prefix. `prefix` is the block's text from offset 0 to
 * the caret, including the just-typed trigger character.
 */
export function matchBlockRule(prefix: string): BlockRuleMatch | null {
  const heading = /^(#{1,3}) $/.exec(prefix);
  if (heading) {
    return { type: "heading", attrs: { level: heading[1].length }, prefixLength: prefix.length };
  }
  // Todo before bullet: "- [ ] " style task prefixes start like a bullet.
  const todoBullet = /^(?:[-*+] )?\[( |x|X)?\] $/.exec(prefix);
  if (todoBullet) {
    return {
      type: "todo-list",
      attrs: { checked: (todoBullet[1] ?? "").toLowerCase() === "x" },
      prefixLength: prefix.length,
    };
  }
  if (/^[-*+] $/.test(prefix)) return { type: "bullet-list", prefixLength: prefix.length };
  if (/^\d{1,4}[.)] $/.test(prefix)) return { type: "ordered-list", prefixLength: prefix.length };
  if (/^> $/.test(prefix)) return { type: "quote", prefixLength: prefix.length };
  // ``` or ```lang followed by the trigger space — the trailing space (rather
  // than firing on the third backtick) is what makes a language typeable.
  const fence = /^```([A-Za-z0-9+#.-]{0,20}) $/.exec(prefix);
  if (fence) {
    return {
      type: "code",
      attrs: fence[1] ? { lang: fence[1] } : undefined,
      prefixLength: prefix.length,
    };
  }
  return null;
}

export type InlineRuleMark = "bold" | "italic" | "code" | "strike";

export interface InlineRuleMatch {
  mark: InlineRuleMark;
  /** Offset of the opening delimiter. */
  start: number;
  /** Opening / closing delimiter lengths. */
  open: number;
  close: number;
  /** End of the whole match (== caret offset). */
  end: number;
}

interface InlinePattern {
  mark: InlineRuleMark;
  delim: number;
  re: RegExp;
}

// Inner text must not start/end with whitespace (markdown convention), must be
// non-empty, and must not contain the delimiter character. A guard group
// rejects a longer delimiter run on the left (so `**` doesn't read as italic).
const INLINE_PATTERNS: InlinePattern[] = [
  { mark: "code", delim: 1, re: /(?:^|[^`])(`)([^`\n]+)(`)$/ },
  { mark: "bold", delim: 2, re: /(?:^|[^*])(\*\*)([^\s*](?:[^*\n]*[^\s*])?)(\*\*)$/ },
  { mark: "bold", delim: 2, re: /(?:^|[^_])(__)([^\s_](?:[^_\n]*[^\s_])?)(__)$/ },
  { mark: "strike", delim: 2, re: /(?:^|[^~])(~~)([^\s~](?:[^~\n]*[^\s~])?)(~~)$/ },
  { mark: "italic", delim: 1, re: /(?:^|[^*])(\*)([^\s*](?:[^*\n]*[^\s*])?)(\*)$/ },
  { mark: "italic", delim: 1, re: /(?:^|[^_])(_)([^\s_](?:[^_\n]*[^\s_])?)(_)$/ },
];

/**
 * Match an inline markdown span ending exactly at the caret. `text` is the
 * block's plain text from offset 0 to the caret (embeds as placeholder chars).
 */
export function matchInlineRule(text: string): InlineRuleMatch | null {
  for (const p of INLINE_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const inner = m[2];
    const start = text.length - (p.delim * 2 + inner.length);
    return { mark: p.mark, start, open: p.delim, close: p.delim, end: text.length };
  }
  return null;
}
