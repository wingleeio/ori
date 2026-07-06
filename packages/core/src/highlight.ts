/**
 * Syntax highlighting for code blocks — color classification only.
 *
 * A {@link Highlighter} maps code text to non-overlapping, sorted, half-open
 * ranges tagged with a {@link TokenKind}; the renderer colors the already
 * measured glyphs in place, so nothing here may alter the text itself.
 *
 * The built-in {@link defaultHighlighter} is a tiny dependency-free scanner
 * driven by per-language rule tables: at each position the ordered rules are
 * tried (comments before strings before everything else) and the first match
 * wins. Unmatched text is skipped whole-word at a time, so unknown constructs
 * simply stay uncolored and tokenizing never throws on any input.
 */

/** Token kinds — map 1:1 to CSS classes ori-tok-<kind> in the renderer. */
export type TokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "function"
  | "property"
  | "operator"
  | "punctuation"
  | "tag"
  | "attribute";

export interface HighlightToken {
  /** Half-open [start, end) offsets into the code text. */
  start: number;
  end: number;
  kind: TokenKind;
}

/** A pluggable highlighter: code + language → non-overlapping, sorted tokens. */
export type Highlighter = (code: string, lang: string) => HighlightToken[];

interface TokenRule {
  /** Sticky (`y`) regex tried at the current scan position. */
  re: RegExp;
  /** Fixed kind, or a classifier for context-dependent rules. */
  kind: TokenKind | ((m: RegExpExecArray) => TokenKind);
}

// When no rule matches, consume a whole identifier (so keyword/number rules
// can never fire mid-word), a whitespace run, or a single fallback character.
const SKIP = /[A-Za-z_$][\w$]*|\s+|[\s\S]/y;

/** Scan left-to-right; first matching rule wins, output is sorted by start. */
function tokenize(code: string, rules: TokenRule[]): HighlightToken[] {
  const out: HighlightToken[] = [];
  let pos = 0;
  scan: while (pos < code.length) {
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      const m = rule.re.exec(code);
      if (!m || m[0].length === 0) continue;
      const kind = typeof rule.kind === "function" ? rule.kind(m) : rule.kind;
      out.push({ start: pos, end: pos + m[0].length, kind });
      pos += m[0].length;
      continue scan;
    }
    SKIP.lastIndex = pos;
    pos += SKIP.exec(code)![0].length;
  }
  return out;
}

// --- JavaScript / TypeScript ------------------------------------------------

const JS_RULES: TokenRule[] = [
  { re: /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/y, kind: "comment" },
  {
    re: /'(?:[^'\\\n]|\\[\s\S])*'?|"(?:[^"\\\n]|\\[\s\S])*"?|`(?:[^`\\]|\\[\s\S])*`?/y,
    kind: "string",
  },
  {
    re: /\b(?:const|let|var|function|return|if|else|for|while|class|extends|import|export|from|new|async|await|try|catch|throw|type|interface|enum|typeof|instanceof|in|of|switch|case|break|continue|default|do|yield|static|get|set|null|undefined|true|false|this|super|void|delete)\b/y,
    kind: "keyword",
  },
  { re: /[A-Za-z_$][\w$]*(?=\s*\()/y, kind: "function" },
  { re: /(?<=\.)[A-Za-z_$][\w$]*/y, kind: "property" },
  { re: /\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y, kind: "number" },
  { re: /[+\-*/%=<>!&|^~?]+/y, kind: "operator" },
  { re: /[()[\]{};,.:]/y, kind: "punctuation" },
];

// --- JSON ---------------------------------------------------------------

// A string directly before a ":" is a key; everything else is a value.
const JSON_KEY_AHEAD = /\s*:/y;

const JSON_RULES: TokenRule[] = [
  {
    re: /"(?:[^"\\\n]|\\[\s\S])*"?/y,
    kind: (m) => {
      JSON_KEY_AHEAD.lastIndex = m.index + m[0].length;
      return JSON_KEY_AHEAD.test(m.input) ? "property" : "string";
    },
  },
  { re: /\b(?:true|false|null)\b/y, kind: "keyword" },
  { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, kind: "number" },
  { re: /[{}[\],:]/y, kind: "punctuation" },
];

// --- Python -----------------------------------------------------------------

const PY_RULES: TokenRule[] = [
  { re: /#[^\n]*/y, kind: "comment" },
  { re: /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/y, kind: "string" },
  { re: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/y, kind: "string" },
  {
    re: /\b(?:def|class|if|elif|else|for|while|return|import|from|as|with|try|except|finally|raise|lambda|pass|break|continue|global|nonlocal|yield|assert|del|not|and|or|in|is|None|True|False|self)\b/y,
    kind: "keyword",
  },
  { re: /[A-Za-z_]\w*(?=\s*\()/y, kind: "function" },
  { re: /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y, kind: "number" },
  { re: /[+\-*/%=<>!&|^~@]+/y, kind: "operator" },
  { re: /[()[\]{};,.:]/y, kind: "punctuation" },
];

// --- CSS ----------------------------------------------------------------

const CSS_RULES: TokenRule[] = [
  { re: /\/\*[\s\S]*?(?:\*\/|$)/y, kind: "comment" },
  { re: /"[^"\n]*"?|'[^'\n]*'?/y, kind: "string" },
  // Property name before ":" (also matches --custom-properties).
  { re: /[-A-Za-z][\w-]*(?=\s*:)/y, kind: "property" },
  { re: /#[0-9a-fA-F]{3,8}\b/y, kind: "number" },
  { re: /-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]+)?/y, kind: "number" },
  // Element selectors: identifiers at the start of a selector position only
  // (line start or right after a combinator / block boundary).
  { re: /(?<=(?:^|[\n,{}>+~])\s*)[a-zA-Z][a-zA-Z0-9]*/y, kind: "tag" },
  { re: /[{}();:,]/y, kind: "punctuation" },
];

// --- HTML ---------------------------------------------------------------

const HTML_RULES: TokenRule[] = [
  { re: /<!--[\s\S]*?(?:-->|$)/y, kind: "comment" },
  { re: /(?<=<\/?)[a-zA-Z][\w-]*/y, kind: "tag" },
  { re: /[a-zA-Z-][\w-]*(?=\s*=["'])/y, kind: "attribute" },
  { re: /(?<==)"[^"]*"?|(?<==)'[^']*'?/y, kind: "string" },
  { re: /[<>/=]/y, kind: "punctuation" },
];

// --- Shell --------------------------------------------------------------

const SH_RULES: TokenRule[] = [
  { re: /#[^\n]*/y, kind: "comment" },
  { re: /"(?:[^"\\]|\\[\s\S])*"?|'[^']*'?/y, kind: "string" },
  { re: /\$(?:\{[^}\n]*\}|\w+|[@#?$!*-])/y, kind: "property" },
  {
    re: /\b(?:echo|cd|ls|export|if|then|else|elif|fi|for|do|done|while|function|return|local|case|esac|in|source|exit)\b/y,
    kind: "keyword",
  },
  { re: /[|&;<>()]/y, kind: "punctuation" },
];

// --- Markdown (kept minimal) ---------------------------------------------

const MD_RULES: TokenRule[] = [
  { re: /(?<=^|\n)#{1,6}(?:[ \t][^\n]*)?/y, kind: "keyword" },
  { re: /`[^`\n]*`?/y, kind: "string" },
  { re: /\[[^\]\n]*\]\([^)\n]*\)/y, kind: "property" },
  { re: /\*{1,2}|_{1,2}/y, kind: "operator" },
];

// ----------------------------------------------------------------------------

const LANG_RULES: Record<string, TokenRule[]> = {
  js: JS_RULES,
  ts: JS_RULES,
  json: JSON_RULES,
  py: PY_RULES,
  css: CSS_RULES,
  html: HTML_RULES,
  sh: SH_RULES,
  md: MD_RULES,
};

const LANG_ALIASES: Record<string, string> = {
  js: "js",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "ts",
  typescript: "ts",
  tsx: "ts",
  json: "json",
  jsonc: "json",
  py: "py",
  python: "py",
  python3: "py",
  css: "css",
  html: "html",
  htm: "html",
  xml: "html",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  shell: "sh",
  md: "md",
  markdown: "md",
};

/** Languages the built-in highlighter understands (aliases included). */
export function normalizeLang(lang: string | undefined): string {
  return LANG_ALIASES[(lang ?? "").trim().toLowerCase()] ?? "";
}

/** Built-in regex-based highlighter for js/ts, json, py, css, html, md, sh. */
export const defaultHighlighter: Highlighter = (code, lang) => {
  const rules = LANG_RULES[normalizeLang(lang)];
  if (!rules || !code) return [];
  try {
    return tokenize(code, rules);
  } catch {
    // Classification is cosmetic — never let a scanner bug break rendering.
    return [];
  }
};
