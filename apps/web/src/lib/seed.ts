import { attributesToMarks, createBlock, fullAttributes, getBlocks, type BlockType } from "@wingleeio/ori-core";
import * as Y from "yjs";
import { sampleImageAttrs } from "./nodes";
import { genNoteId, type NoteMeta } from "./storage";

interface Run {
  text?: string;
  marks?: Record<string, unknown>;
  /** An inline embed (custom atom), e.g. `{ type: "mention", label: "…" }`. */
  embed?: Record<string, unknown>;
}

function addBlock(doc: Y.Doc, type: BlockType, runs: Run[], attrs?: Record<string, unknown>): void {
  const blocks = getBlocks(doc);
  const block = createBlock(type);
  blocks.push([block]);
  if (attrs) {
    const attrMap = block.get("attrs") as Y.Map<unknown>;
    for (const [k, v] of Object.entries(attrs)) attrMap.set(k, v);
  }
  const text = block.get("text") as Y.Text;
  let at = 0;
  for (const run of runs) {
    if (run.embed) {
      text.insertEmbed(at, run.embed);
      at += 1;
      continue;
    }
    const t = run.text ?? "";
    // Explicit attributes so a bold/code run doesn't bleed into the next.
    text.insert(at, t, fullAttributes(attributesToMarks(run.marks)));
    at += t.length;
  }
}

/** Push an atomic (non-text) block with attrs, e.g. a divider or image. */
function addAtomicBlock(doc: Y.Doc, type: BlockType, attrs: Record<string, unknown>): void {
  const blocks = getBlocks(doc);
  const block = createBlock(type);
  blocks.push([block]);
  const attrMap = block.get("attrs") as Y.Map<unknown>;
  for (const [k, v] of Object.entries(attrs)) attrMap.set(k, v);
}

/** A rich welcome note that exercises headings, marks, quotes and code. */
export function welcomeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    addBlock(doc, "heading", [{ text: "Welcome to Ori" }]);
    addBlock(doc, "paragraph", [
      { text: "A local-first note editor where " },
      { text: "Y.Doc", marks: { code: true } },
      { text: " is the canonical state, " },
      { text: "Pretext", marks: { bold: true } },
      { text: " computes layout, and only the blocks in view ever touch the DOM." },
    ]);
    addBlock(doc, "paragraph", [
      { text: "Type anywhere, drag to select, and use " },
      { text: "⌘B", marks: { bold: true } },
      { text: " / " },
      { text: "⌘I", marks: { italic: true } },
      { text: " / " },
      { text: "⌘E", marks: { code: true } },
      { text: " to format. Every keystroke is a Yjs update, persisted to localStorage as binary." },
    ]);
    addBlock(doc, "paragraph", [
      { text: "Tip: press " },
      { text: "⌥ ↑/↓", marks: { bold: true } },
      { text: " (Option/Alt + arrows) to jump between notes — handy for feeling how fast long notes load." },
    ]);
    addBlock(doc, "bullet-list", [{ text: "Local edits land as Yjs operations." }]);
    addBlock(doc, "bullet-list", [{ text: "Nested items keep their own measured gutter." }], { level: 1 });
    addBlock(doc, "ordered-list", [{ text: "Numbered siblings continue across nested children." }]);
    addBlock(doc, "ordered-list", [{ text: "Clipboard payloads carry list levels with the text." }], { level: 1 });
    addBlock(doc, "quote", [
      {
        text:
          "Layout is derived, never stored. Resize the window and watch every line re-flow straight from Pretext.",
      },
    ]);
    addBlock(doc, "heading", [{ text: "How it fits together" }]);
    addBlock(doc, "paragraph", [
      { text: "Y.Doc holds block-structured text. Pretext measures and wraps each block into " },
      { text: "materialized lines", marks: { italic: true } },
      { text: ". A virtualizer keeps only the viewport mounted — so a 10,000-line note stays light." },
    ]);
    addBlock(doc, "code", [{ text: "const update = Y.encodeStateAsUpdate(ydoc)" }]);
    addBlock(doc, "paragraph", [
      { text: "Open the " },
      { text: "Virtualization stress test", marks: { bold: true } },
      { text: " note and scroll — thousands of blocks, smooth the whole way down." },
    ]);

    addBlock(doc, "heading", [{ text: "Extensible, measurable nodes" }]);
    addBlock(doc, "paragraph", [
      { text: "Custom nodes register their own measurement. The rule and image below, and this " },
      { embed: { type: "mention", label: "Ada Lovelace" } },
      { text: " chip, are all custom nodes — the engine lays them out and virtualizes them like any block." },
    ]);
    addAtomicBlock(doc, "divider", {});
    addAtomicBlock(doc, "image", sampleImageAttrs());
    addBlock(doc, "paragraph", [
      { text: "Type " },
      { text: "/", marks: { code: true } },
      { text: " for blocks (Divider, Image), or " },
      { text: "@", marks: { code: true } },
      { text: " to mention someone." },
    ]);
  });
  return doc;
}

/** A long, uniform note used purely to demonstrate virtualization at volume. */
export function stressDoc(count = 2000): Y.Doc {
  const lines = [
    "Local-first software keeps the source of truth on the device and syncs in the background.",
    "Virtualization trades a full DOM for a height map plus a small visible window.",
    "Pretext measures runs with the same font the browser will paint, so the caret lands true.",
  ];
  const doc = new Y.Doc();
  doc.transact(() => {
    addBlock(doc, "heading", [{ text: "Virtualization stress test" }]);
    addBlock(doc, "paragraph", [
      { text: `${count.toLocaleString()} paragraphs below — only a handful are ever in the DOM.` },
    ]);
    for (let i = 1; i <= count; i += 1) {
      addBlock(doc, "paragraph", [{ text: `${i}. ${lines[i % lines.length]}` }]);
    }
  });
  return doc;
}

// ---------------------------------------------------------------------------
// Distinct long notes — each gets its own seeded content + title.
// ---------------------------------------------------------------------------

/** FNV-1a string hash → a stable 32-bit seed from a note id. */
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ADJ = [
  "quiet", "distant", "local", "tangled", "luminous", "brittle", "ancient", "restless",
  "hollow", "precise", "weathered", "golden", "silent", "fragile", "deliberate", "unmarked",
  "shifting", "patient", "austere", "vivid", "narrow", "salt-worn", "half-forgotten", "stubborn",
] as const;

const SUBJECT = [
  "cartography", "tide pools", "glaciers", "archives", "circuitry", "orchards", "monsoons",
  "lighthouses", "sediment", "telescopes", "ferns", "harbors", "almanacs", "migrations",
  "lattices", "estuaries", "printing presses", "constellations", "aqueducts", "beekeeping",
  "clockwork", "riverbeds", "field recordings", "old railways",
] as const;

const VERB = [
  "maps", "measures", "remembers", "unfolds", "echoes through", "gathers", "drifts past",
  "anchors", "traces", "reshapes", "catalogs", "outlasts", "mirrors", "disturbs", "sketches",
  "weighs", "records", "scatters", "tends", "threads through",
] as const;

const PLACE = [
  "the coastline", "a field notebook", "the lower valley", "old shipping lanes", "a quiet ledger",
  "the morning fog", "a paper map", "the tidal flat", "an index card", "the back garden",
  "a worn atlas", "the river delta", "a glass jar", "the reading room", "a stack of letters",
  "the salt marsh", "a brass compass", "the upper shelf", "a folded chart", "the harbor wall",
] as const;

const TITLE_TEMPLATES: Array<(a: string, s: string) => string> = [
  (_a, s) => `Field notes on ${s}`,
  (a, s) => `${cap(a)} ${s}`,
  (a, s) => `A ${a} guide to ${s}`,
  (a, s) => `On ${s} and ${a} things`,
  (a, s) => `${cap(s)}: a ${a} survey`,
  (_a, s) => `Notebook — ${cap(s)}`,
];

const SENTENCES: Array<(r: () => number) => string> = [
  (r) => `The ${pick(r, ADJ)} ${pick(r, SUBJECT)} ${pick(r, VERB)} ${pick(r, PLACE)}.`,
  (r) => `In ${pick(r, PLACE)}, a ${pick(r, ADJ)} ${pick(r, SUBJECT)} ${pick(r, VERB)} ${pick(r, PLACE)}.`,
  (r) => `Every ${pick(r, ADJ)} season ${pick(r, PLACE)} ${pick(r, VERB)} ${pick(r, PLACE)} once more.`,
  (r) => `${cap(pick(r, PLACE))} ${pick(r, VERB)} ${pick(r, PLACE)} — ${pick(r, ADJ)} and unhurried.`,
  (r) => `Notes suggest the ${pick(r, SUBJECT)} ${pick(r, VERB)} ${pick(r, PLACE)} before dawn.`,
];

function makeTitle(rng: () => number): string {
  const a = pick(rng, ADJ);
  const s = pick(rng, SUBJECT);
  return pick(rng, TITLE_TEMPLATES)(a, s);
}

function paragraph(rng: () => number): string {
  const sentences = 1 + Math.floor(rng() * 3);
  let out = "";
  for (let k = 0; k < sentences; k += 1) out += (k ? " " : "") + pick(rng, SENTENCES)(rng);
  return out;
}

/** Build a distinct long note of ~`blocks` blocks from a seed. */
function longDoc(title: string, seed: number, blocks: number): Y.Doc {
  const doc = new Y.Doc();
  const rng = mulberry32(seed);
  doc.transact(() => {
    addBlock(doc, "heading", [{ text: title }]);
    for (let i = 1; i < blocks; i += 1) {
      const roll = rng();
      if (i % 16 === 0) {
        addBlock(doc, "heading", [{ text: cap(`${pick(rng, ADJ)} ${pick(rng, SUBJECT)}`) }]);
      } else if (roll < 0.03) {
        addBlock(doc, "quote", [{ text: paragraph(rng) }]);
      } else if (roll < 0.05) {
        const sym = pick(rng, SUBJECT).replace(/\W+/g, "_");
        addBlock(doc, "code", [{ text: `const ${sym} = measure(${Math.floor(rng() * 1000)})` }]);
      } else {
        addBlock(doc, "paragraph", [{ text: paragraph(rng) }]);
      }
    }
  });
  return doc;
}

/** Generate a long note's Y.Doc deterministically from its metadata. */
export function generateNote(meta: NoteMeta): Y.Doc {
  return longDoc(meta.title, hashStr(meta.id), meta.blocks ?? 300);
}

/**
 * Build `count` long-note metadata entries — each with a distinct seeded title
 * and a varied size (~200–1500 blocks). The docs are generated lazily on open.
 */
export function longNoteMetas(count = 100, now = Date.now()): NoteMeta[] {
  const metas: NoteMeta[] = [];
  for (let i = 1; i <= count; i += 1) {
    const id = `${genNoteId()}${i.toString(36)}`;
    const rng = mulberry32(hashStr(id));
    const blocks = 200 + ((i * 137) % 1300);
    metas.push({ id, title: makeTitle(rng), updatedAt: now - i * 1000, blocks });
  }
  return metas;
}
