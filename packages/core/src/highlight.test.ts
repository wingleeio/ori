import { describe, expect, it } from "vitest";
import { defaultHighlighter, normalizeLang } from "./highlight";
import type { HighlightToken, TokenKind } from "./highlight";

/** Map tokens back onto their source substrings for readable assertions. */
function toks(code: string, lang: string): [string, TokenKind][] {
  return defaultHighlighter(code, lang).map((t) => [code.slice(t.start, t.end), t.kind]);
}

/** Kind of the first token whose text is exactly `text` (undefined if none). */
function kindOf(code: string, lang: string, text: string): TokenKind | undefined {
  return toks(code, lang).find(([s]) => s === text)?.[1];
}

/** Assert tokens are sorted, non-overlapping, non-empty and within bounds. */
function expectInvariants(code: string, tokens: HighlightToken[]) {
  let prevEnd = 0;
  for (const t of tokens) {
    expect(t.start).toBeGreaterThanOrEqual(prevEnd);
    expect(t.end).toBeGreaterThan(t.start);
    expect(t.end).toBeLessThanOrEqual(code.length);
    prevEnd = t.end;
  }
}

const JS_SAMPLE = [
  "// greet the user",
  "const n = 42;",
  "function greet(name) {",
  '  return "hi, " + name.length;',
  "}",
].join("\n");

describe("normalizeLang", () => {
  it("maps aliases to canonical names", () => {
    expect(normalizeLang("javascript")).toBe("js");
    expect(normalizeLang("jsx")).toBe("js");
    expect(normalizeLang("TypeScript")).toBe("ts");
    expect(normalizeLang("tsx")).toBe("ts");
    expect(normalizeLang("python")).toBe("py");
    expect(normalizeLang("bash")).toBe("sh");
    expect(normalizeLang("markdown")).toBe("md");
    expect(normalizeLang(" html ")).toBe("html");
  });

  it("maps unknown or missing languages to the empty string", () => {
    expect(normalizeLang("brainfuck")).toBe("");
    expect(normalizeLang("")).toBe("");
    expect(normalizeLang(undefined)).toBe("");
  });
});

describe("defaultHighlighter: js/ts", () => {
  it("classifies comments, strings and numbers", () => {
    expect(kindOf(JS_SAMPLE, "js", "// greet the user")).toBe("comment");
    expect(kindOf(JS_SAMPLE, "js", '"hi, "')).toBe("string");
    expect(kindOf(JS_SAMPLE, "js", "42")).toBe("number");
    expect(kindOf("/* block\ncomment */ let x", "js", "/* block\ncomment */")).toBe("comment");
  });

  it("classifies keywords, function names and property access", () => {
    expect(kindOf(JS_SAMPLE, "js", "const")).toBe("keyword");
    expect(kindOf(JS_SAMPLE, "js", "function")).toBe("keyword");
    expect(kindOf(JS_SAMPLE, "js", "return")).toBe("keyword");
    expect(kindOf(JS_SAMPLE, "js", "greet")).toBe("function");
    expect(kindOf(JS_SAMPLE, "js", "length")).toBe("property");
    // Plain identifiers stay unclassified.
    expect(kindOf(JS_SAMPLE, "js", "name")).toBeUndefined();
  });

  it("classifies template strings, operators and punctuation", () => {
    const code = "const s = `a ${b}` !== c;";
    expect(kindOf(code, "js", "`a ${b}`")).toBe("string");
    expect(kindOf(code, "js", "!==")).toBe("operator");
    expect(kindOf(code, "js", ";")).toBe("punctuation");
  });

  it("understands ts-only keywords via the typescript alias", () => {
    const code = "interface Box extends Base {}\ntype Id = string;";
    expect(kindOf(code, "typescript", "interface")).toBe("keyword");
    expect(kindOf(code, "typescript", "extends")).toBe("keyword");
    expect(kindOf(code, "typescript", "type")).toBe("keyword");
  });

  it("does not match keywords inside identifiers", () => {
    expect(kindOf("const iffy = returned;", "js", "iffy")).toBeUndefined();
    expect(kindOf("const iffy = returned;", "js", "returned")).toBeUndefined();
  });
});

describe("defaultHighlighter: json", () => {
  it("distinguishes keys from values and classifies literals", () => {
    const code = '{"name": "ori", "count": 3, "ok": true, "nil": null}';
    expect(kindOf(code, "json", '"name"')).toBe("property");
    expect(kindOf(code, "json", '"count"')).toBe("property");
    expect(kindOf(code, "json", '"ori"')).toBe("string");
    expect(kindOf(code, "json", "3")).toBe("number");
    expect(kindOf(code, "json", "true")).toBe("keyword");
    expect(kindOf(code, "json", "null")).toBe("keyword");
    expect(kindOf(code, "json", "{")).toBe("punctuation");
  });
});

describe("defaultHighlighter: python", () => {
  it("classifies comments, strings, keywords and function names", () => {
    const code = '# add two\ndef add(a, b):\n    """doc"""\n    return a + b if True else 0';
    expect(kindOf(code, "python", "# add two")).toBe("comment");
    expect(kindOf(code, "python", "def")).toBe("keyword");
    expect(kindOf(code, "python", "add")).toBe("function");
    expect(kindOf(code, "python", '"""doc"""')).toBe("string");
    expect(kindOf(code, "python", "if")).toBe("keyword");
    expect(kindOf(code, "python", "True")).toBe("keyword");
    expect(kindOf(code, "python", "0")).toBe("number");
  });
});

describe("defaultHighlighter: css", () => {
  it("classifies selectors, properties, colors and unit numbers", () => {
    const code = '/* note */\na { color: #fff; margin: 4px 0; }\np { content: "x"; }';
    expect(kindOf(code, "css", "/* note */")).toBe("comment");
    expect(kindOf(code, "css", "a")).toBe("tag");
    expect(kindOf(code, "css", "p")).toBe("tag");
    expect(kindOf(code, "css", "color")).toBe("property");
    expect(kindOf(code, "css", "margin")).toBe("property");
    expect(kindOf(code, "css", "#fff")).toBe("number");
    expect(kindOf(code, "css", "4px")).toBe("number");
    expect(kindOf(code, "css", '"x"')).toBe("string");
  });
});

describe("defaultHighlighter: html", () => {
  it("classifies comments, tags, attributes and attribute values", () => {
    const code = "<!-- hi --><div class=\"btn\" id='x'>text</div>";
    expect(kindOf(code, "html", "<!-- hi -->")).toBe("comment");
    expect(kindOf(code, "html", "div")).toBe("tag");
    expect(kindOf(code, "html", "class")).toBe("attribute");
    expect(kindOf(code, "html", "id")).toBe("attribute");
    expect(kindOf(code, "html", '"btn"')).toBe("string");
    expect(kindOf(code, "html", "'x'")).toBe("string");
    expect(kindOf(code, "html", "text")).toBeUndefined();
  });
});

describe("defaultHighlighter: sh", () => {
  it("classifies comments, strings, builtins and variables", () => {
    const code = '# setup\necho "hi there" && cd $HOME\nexport PATH=/bin';
    expect(kindOf(code, "bash", "# setup")).toBe("comment");
    expect(kindOf(code, "bash", "echo")).toBe("keyword");
    expect(kindOf(code, "bash", "cd")).toBe("keyword");
    expect(kindOf(code, "bash", "export")).toBe("keyword");
    expect(kindOf(code, "bash", '"hi there"')).toBe("string");
    expect(kindOf(code, "bash", "$HOME")).toBe("property");
  });
});

describe("defaultHighlighter: md", () => {
  it("classifies headings, code spans, emphasis markers and links", () => {
    const code = "# Title\nUse `x` and **bold** [link](https://a.b)";
    expect(kindOf(code, "md", "# Title")).toBe("keyword");
    expect(kindOf(code, "md", "`x`")).toBe("string");
    expect(kindOf(code, "md", "**")).toBe("operator");
    expect(kindOf(code, "md", "[link](https://a.b)")).toBe("property");
    // "#" mid-line is not a heading.
    expect(kindOf("a # b", "md", "# b")).toBeUndefined();
  });
});

describe("defaultHighlighter: general behavior", () => {
  it("returns [] for unknown languages and empty code", () => {
    expect(defaultHighlighter("const x = 1;", "brainfuck")).toEqual([]);
    expect(defaultHighlighter("const x = 1;", "")).toEqual([]);
    expect(defaultHighlighter("", "js")).toEqual([]);
  });

  it("emits sorted, non-overlapping, in-bounds tokens for every language", () => {
    const samples: [string, string][] = [
      ["js", JS_SAMPLE],
      ["json", '{"a": [1, "b", null]}'],
      ["py", "def f():\n    return 'x'  # done"],
      ["css", "a, p { color: #abc; }"],
      ["html", '<a href="#">go</a>'],
      ["sh", 'echo "$1" # run'],
      ["md", "## h\n`c` *i*"],
    ];
    for (const [lang, code] of samples) {
      expectInvariants(code, defaultHighlighter(code, lang));
    }
  });

  it("never throws and keeps invariants on nasty input", () => {
    const nasty = [
      '"unterminated string',
      "'/* half of everything",
      "/* never closed\nstill open",
      '"""open triple',
      "`tick \\",
      "\\\\\\",
      "emoji 😀🎉 and ⚡ text \ud800", // includes a lone surrogate
      "<div class=",
      '"a'.repeat(500),
      `${"x".repeat(20000)}("y`,
      "\n\n\n#",
    ];
    const langs = ["js", "ts", "json", "py", "css", "html", "sh", "md", "nope"];
    for (const lang of langs) {
      for (const code of nasty) {
        let tokens: HighlightToken[] = [];
        expect(() => {
          tokens = defaultHighlighter(code, lang);
        }).not.toThrow();
        expectInvariants(code, tokens);
      }
    }
  });
});
