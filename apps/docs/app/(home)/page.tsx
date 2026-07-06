import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { BenchCharts } from "./bench-charts";
import { LiveEditor } from "./live-editor";

/* ── crafted editor "window" with a virtualization rail ─────────────────── */
function EditorMock() {
  // tiny bars representing the full document in the virtualization gutter
  const bars = Array.from({ length: 30 }, (_, i) => 30 + ((i * 53) % 60));
  return (
    <div className="reveal d4 relative">
      {/* single light source behind the window */}
      <div className="aura absolute -inset-10 -z-10" />
      <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        {/* title bar */}
        <div className="flex items-center gap-3 border-b border-fd-border px-4 py-2.5">
          <div className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-fd-muted-foreground/40" />
            <span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
            <span className="size-2.5 rounded-full bg-fd-muted-foreground/25" />
          </div>
          <span className="ff-mono text-[11px] text-fd-muted-foreground">untitled.note</span>
          <span className="ff-mono tnum ml-auto text-[11px] text-fd-muted-foreground">
            <span className="text-fd-primary">●</span> 24 / 9,998 rendered
          </span>
        </div>

        <div className="flex">
          {/* virtualization gutter — the whole doc, only a window is "rendered" */}
          <div className="relative w-10 shrink-0 overflow-hidden border-r border-fd-border bg-fd-muted/40 py-3">
            <div className="flex flex-col items-center gap-[5px] px-2">
              {bars.map((w, i) => (
                <span
                  key={i}
                  className="block h-[3px] rounded-full bg-fd-muted-foreground/25"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
            <div className="viz-window absolute left-1 right-1 top-2 h-[46px] rounded-md border border-fd-primary/60 bg-fd-primary/10" />
          </div>

          {/* the note */}
          <div className="min-w-0 flex-1 px-6 py-6 leading-[1.85]">
            <p className="ff-display mb-3 text-[22px] font-semibold tracking-tight text-fd-foreground">
              On cartography
            </p>
            <p className="text-[15px] text-fd-foreground/90">
              The quiet coastline maps a folded chart. A{" "}
              <span className="mock-pill">Y.Text</span> holds the prose,{" "}
              <span className="mock-sel">marks live in its attributes</span>, and{" "}
              <span className="mock-chip">@ada</span> reviewed it before dawn.
            </p>
            <div className="mt-4 space-y-1.5 text-[15px] text-fd-foreground/90">
              <p className="flex gap-2">
                <span className="w-5 text-right text-fd-primary">•</span>
                <span>List items measure their own marker gutter.</span>
              </p>
              <p className="flex gap-2 pl-6">
                <span className="w-5 text-right text-fd-primary">◦</span>
                <span>Nested items wrap against the same Pretext layout.</span>
              </p>
              <p className="flex items-baseline gap-2">
                <span className="inline-block size-3 translate-y-0.5 rounded-[3px] border-[1.5px] border-fd-primary bg-fd-primary" />
                <span className="text-fd-muted-foreground line-through">To-do items toggle a checkbox you can click.</span>
              </p>
            </div>
            <div className="my-5 h-px bg-fd-border" />
            <p className="text-[15px] text-fd-foreground/90">
              Every measured line wraps from Pretext, never the browser
              <span className="mock-caret" />
            </p>
            <p className="mt-3 text-[15px] text-fd-muted-foreground/70">
              …9,994 more blocks, idle in the Y.Doc, never touching the DOM until
              you scroll to them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const PIPELINE = [
  { k: "Y.Doc", t: "canonical state", d: "A block-structured CRDT. Every edit is a Yjs update — local-first, syncable, undoable." },
  { k: "Pretext", t: "layout & measurement", d: "Wraps blocks into materialized lines; answers caret, hit-testing and selection geometry." },
  { k: "Virtualizer", t: "renders the window", d: "A binary-searched height map turns scroll into the handful of blocks that become DOM." },
];

const FEATURES = [
  { n: "01", t: "Built to scale", d: "Thousands of blocks, a few dozen DOM nodes. Heights come from Pretext, windowing from a height map — a 10,000-line note stays light." },
  { n: "02", t: "Layout you can trust", d: "Pretext measures with the same font the browser paints, and lines are materialized so the browser never re-wraps and disagrees with the caret." },
  { n: "03", t: "Extensible, measurable nodes", d: "Register custom block types and inline atoms — image, divider, @mention — with a measure() function and a renderer. The engine does the rest." },
  { n: "04", t: "Real editing", d: "Drag-select, full keyboard nav, split/merge, undo/redo, clipboard and IME — all from logical positions that survive offscreen blocks." },
];

const PACKAGES = [
  { name: "@wingleeio/ori-pretext", d: "Pure layout & measurement. No DOM, React or Yjs." },
  { name: "@wingleeio/ori-core", d: "Y.Doc model, virtualizer, node schema, EditorController." },
  { name: "@wingleeio/ori-react", d: "useEditor + <NoteEditor>, overlays, keyboard & IME." },
];

export default function HomePage() {
  return (
    <main className="relative isolate flex flex-1 flex-col overflow-hidden">
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="relative border-b border-fd-border">
        <div className="dotgrid pointer-events-none absolute inset-0" />
        <div className="spotlight pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
        <div className="relative mx-auto w-full max-w-6xl">
          {/* grid-intersection crosshairs, drawn at the hero's corners */}
          <span className="cross left-4 top-6 hidden lg:block" aria-hidden />
          <span className="cross right-4 top-6 hidden lg:block" aria-hidden />
          <div className="relative grid grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-28">
            {/* copy */}
            <div>
              <p className="reveal d1 ff-mono mb-7 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground">
                <span className="inline-block h-px w-7 bg-fd-muted-foreground/60" />
                Local-first · text-layout engine
              </p>
              <h1 className="reveal d2 ff-display text-[clamp(2.6rem,6vw,4.6rem)] leading-[1.02] tracking-tight">
                <span className="txt-gradient">
                  A virtualized
                  <br />
                  note editor —
                </span>
                <br />
                <span className="text-white">layout derived</span>
                <span className="txt-gradient">, never stored.</span>
                <span className="mock-caret align-baseline" />
              </h1>
              <p className="reveal d3 mt-7 max-w-md text-lg leading-relaxed text-fd-muted-foreground">
                Ori keeps the whole note in a Y.Doc, measures it with Pretext, and
                renders only the blocks you can see. Ten thousand lines stay
                editable while the DOM stays tiny.
              </p>
              <div className="reveal d4 mt-9 flex flex-wrap items-center gap-3">
                <Link
                  href="/docs"
                  className="btn-primary group inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium"
                >
                  Read the docs
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/docs/architecture"
                  className="btn-ghost inline-flex items-center rounded-full px-6 py-3 text-sm"
                >
                  How it works
                </Link>
              </div>
              <p className="reveal d5 ff-mono mt-10 text-[11px] uppercase tracking-[0.18em] text-fd-muted-foreground/70">
                MIT · 0.0.1 alpha · Y.Doc + Pretext + virtualization
              </p>
            </div>

            {/* editor window */}
            <EditorMock />
          </div>
        </div>
      </section>

      {/* ── live demo ────────────────────────────────────────────────────── */}
      <section className="border-b border-fd-border">
        <div className="mx-auto w-full max-w-3xl px-6 py-20">
          <p className="ff-mono mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground">
            <span className="inline-block h-px w-7 bg-fd-muted-foreground/60" />
            live demo
          </p>
          <h2 className="ff-display text-3xl tracking-tight text-fd-foreground sm:text-4xl">
            Try it — it's real.
          </h2>
          <p className="mt-3 max-w-xl text-fd-muted-foreground">
            A full <code className="ff-mono text-sm text-fd-foreground">@wingleeio/ori-react</code>{" "}
            editor, running right here in the page. Type, drag to select for the formatting menu, or
            press <kbd className="ff-mono">/</kbd> for blocks like <span className="text-fd-foreground">Bullet list</span>,{" "}
            <span className="text-fd-foreground">Numbered list</span>, or a <span className="text-fd-foreground">To-do list</span>. Press <kbd className="ff-mono">@</kbd> to mention.
          </p>
          <div className="mt-8">
            <LiveEditor />
          </div>
        </div>
      </section>

      {/* ── benchmark ────────────────────────────────────────────────────── */}
      <section className="border-b border-fd-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <p className="ff-mono mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground">
            <span className="inline-block h-px w-7 bg-fd-muted-foreground/60" />
            benchmark
          </p>
          <h2 className="ff-display text-3xl tracking-tight text-fd-foreground sm:text-4xl">
            Stays fast as documents grow.
          </h2>
          <p className="mt-3 max-w-2xl text-fd-muted-foreground">
            The same document loaded into ori and four other rich-text editors, then typed into. ori
            renders only the visible viewport and only re-renders the block you&apos;re editing — so load
            time stays low and typing stays flat as the document grows.
          </p>
          <div className="mt-10">
            <BenchCharts />
          </div>
        </div>
      </section>

      {/* ── pipeline ─────────────────────────────────────────────────────── */}
      <section className="border-b border-fd-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16">
          <p className="ff-mono mb-10 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-fd-muted-foreground">
            <span className="inline-block h-px w-7 bg-fd-muted-foreground/60" />
            the data flow
          </p>
          <div className="grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border md:grid-cols-3">
            {PIPELINE.map((s, i) => (
              <div key={s.k} className="bg-fd-background p-7">
                <div className="flex items-baseline justify-between">
                  <span className="ff-mono text-sm text-fd-foreground">{s.k}</span>
                  <span className="ff-mono text-[11px] text-fd-muted-foreground">
                    {i < PIPELINE.length - 1 ? "→" : "■"}
                  </span>
                </div>
                <p className="ff-display mt-3 text-xl text-fd-foreground">{s.t}</p>
                <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── features ─────────────────────────────────────────────────────── */}
      <section className="border-b border-fd-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          {FEATURES.map((f) => (
            <div
              key={f.n}
              className="grid grid-cols-1 gap-3 border-b border-fd-border py-10 last:border-0 md:grid-cols-[auto_1fr] md:gap-12"
            >
              <span className="ff-mono text-sm text-fd-muted-foreground">{f.n}</span>
              <div className="max-w-3xl">
                <h3 className="ff-display text-2xl text-fd-foreground sm:text-3xl">{f.t}</h3>
                <p className="mt-3 text-[17px] leading-relaxed text-fd-muted-foreground">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── packages ─────────────────────────────────────────────────────── */}
      <section className="border-b border-fd-border">
        <div className="mx-auto w-full max-w-6xl px-6 py-16">
          <h2 className="ff-display text-3xl tracking-tight text-fd-foreground">
            Three small packages
          </h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border md:grid-cols-3">
            {PACKAGES.map((p) => (
              <div key={p.name} className="bg-fd-card p-7">
                <code className="ff-mono text-sm font-medium text-fd-foreground">{p.name}</code>
                <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── closing ──────────────────────────────────────────────────────── */}
      <section className="relative">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-7 px-6 py-24 text-center">
          <p className="ff-display max-w-2xl text-[clamp(1.8rem,4vw,2.8rem)] leading-tight tracking-tight text-fd-foreground">
            Long notes that stay light — and a layout engine you can read.
          </p>
          <Link
            href="/docs/getting-started"
            className="btn-primary group inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-medium"
          >
            Get started
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-fd-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-7">
          <span className="ff-mono text-xs text-fd-muted-foreground">ori — MIT</span>
          <span className="ff-mono text-xs text-fd-muted-foreground">
            an experimental local-first editor
          </span>
        </div>
      </footer>
    </main>
  );
}
