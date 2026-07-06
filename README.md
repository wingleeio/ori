# Ori

A **local-first, virtualized note editor** built on three independent pillars:

```
Y.Doc          →  canonical document state (block-based CRDT)
Pretext        →  text layout & measurement (line breaks, caret, hit-testing)
Virtualization →  only the blocks in the viewport ever become DOM
```

Long notes stay fully editable and syncable while the DOM stays tiny. Layout is
**derived, never stored** — it is recomputed from content, width and typography.

```
Y.Doc   = canonical app state
DOM     = rendered view (viewport only)
Pretext = derived / cache-only layout
```

The core is **framework-agnostic**. React is the first binding; the same
`EditorController` can drive Vue, Svelte, Solid, or a canvas renderer.

---

## Monorepo layout

| Package          | Responsibility                                                                                  | Depends on            |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------- |
| `@wingleeio/ori-pretext`   | Pure layout engine: tokenize → wrap → materialized lines, caret geometry, hit-test, selection rects. **No DOM / Yjs / React.** | —                     |
| `@wingleeio/ori-core`      | Y.Doc block schema, delta↔inline, edit ops (insert/delete/split/merge/format), `Virtualizer`, layout cache, and the `EditorController` runtime. | `@wingleeio/ori-pretext`, `yjs` |
| `@wingleeio/ori-react`     | `useEditor`, `<NoteEditor>`, virtualized block rendering, caret/selection overlay, keyboard + IME + mouse handling. | `@wingleeio/ori-core`, `react`  |
| `apps/web`       | A clean, minimal shadcn/Tailwind example: sidebar, slash + selection + `@`-mention menus, localStorage persistence, a 2,000-block virtualization demo, custom nodes. | `@wingleeio/ori-react`          |
| `apps/docs`      | Documentation site + landing page, built with [Fumadocs](https://fumadocs.dev) (Next.js).        | —                     |

---

## Quick start

```bash
pnpm install
pnpm dev          # runs the example app on http://localhost:5173
```

Other scripts:

```bash
pnpm build        # build everything (packages, example, docs) — turbo, dependency-ordered
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # unit suites (Vitest) for @wingleeio/ori-pretext, @wingleeio/ori-core and @wingleeio/ori-react
pnpm --filter docs dev   # run the docs site (Next.js) on http://localhost:3000
```

> Tests: ~80 Vitest specs cover Pretext (tokenize/wrap/geometry/atoms), the core
> runtime (virtualizer, delta/marks, operations, controller, persistence) and
> the React `<NoteEditor>` (jsdom). Run `pnpm --filter @wingleeio/ori-core coverage` for a
> coverage report.

---

## How it works

### 1. Y.Doc — canonical state

One `Y.Doc` per note. Inside it, a `Y.Array` of block `Y.Map`s:

```
blocks: Y.Array
  block: Y.Map
    id:    string
    type:  "paragraph" | "heading" | "quote" | "code"
    text:  Y.Text          // inline marks live in Y.Text attributes
    attrs: Y.Map
```

Block-based structure (many small `Y.Text`s, not one giant one) is what makes
virtualization, layout caching, selection and block ops tractable. Edits emit
Yjs updates; persistence is just binary updates:

```ts
const update = Y.encodeStateAsUpdate(ydoc); // save
Y.applyUpdate(ydoc, update);                // restore / sync
```

No layout data is ever stored in the Y.Doc.

### 2. Pretext — layout engine

Given a `Y.Text` delta (converted to styled inline items), a width and
typography, Pretext produces **materialized lines** so the browser never
re-wraps:

```
Y.Text delta → inline items → tokenize → greedy wrap → Line[] (+ fragments)
```

It also answers caret geometry, hit-testing (point → offset) and selection
rectangles. Measurement is abstracted behind a `Measurer` — the browser uses
`createCanvasMeasurer()`; tests use `createMonospaceMeasurer()`.

**Two tiers of layout** keep it cheap:

- offscreen blocks → height + line count only
- visible blocks → full line/fragment/caret geometry

### 3. Virtualization

The `EditorController` maintains a height map and a `Virtualizer` that turns a
scroll offset into a visible block range via binary search. Only those blocks
render; selection and caret are drawn from **logical** positions
(`{ blockId, offset }`) so they remain correct even when the relevant block is
offscreen.

Remote/offscreen edits follow the spec exactly: apply the Yjs update →
invalidate that block's layout cache → recompute its height → update the
virtualizer — without producing any DOM until the block scrolls into view.

---

## The `EditorController`

The single place where the three pillars meet. UI bindings subscribe to it
(`subscribe` / `getSnapshot`, designed for React's `useSyncExternalStore`) and
call imperative methods:

```ts
const editor = new EditorController({ measurer: createCanvasMeasurer() });

editor.setWidth(720);
editor.setViewport(scrollTop, viewportHeight);
editor.insertText("hello");
editor.toggleMark("bold");
editor.moveCaret("down", /* extend */ true);
editor.getLayout(blockId);        // detailed Pretext layout (cached)
editor.selectionRectsForViewport();
```

It observes the Y.Doc (`observeDeep`), so local edits, undo/redo and remote
updates all flow through one code path that bumps a per-block content version,
invalidates the cache, remeasures, and notifies subscribers.

---

## Design decisions

- **Canonical state:** `Y.Doc` — not Markdown, DOM, or Pretext layout.
- **Layout:** a runtime `LayoutCache`, keyed by `blockId + contentVersion + width + typographyKey`.
- **Rendering:** virtualized DOM with Pretext's computed lines (each line is its own element with `white-space: pre`, so the browser never disagrees about wrapping).
- **Persistence:** binary Yjs updates (base64 in localStorage here), never rendered HTML.
- **No layout in the model:** line breaks, heights, caret x/y, selection rects are all derived.

### Avoiding layout drift

The biggest risk called out in the design is Pretext and the DOM disagreeing on
typography. Ori addresses it structurally: each rendered fragment carries the
**exact** resolved font Pretext measured with, lines are materialized (no native
wrapping), and **no block/line/fragment ever carries padding, margins or borders
that shift glyphs** — decoration that must not move text uses absolute
pseudo-elements or `box-shadow` spread (see `@wingleeio/ori-react/styles.css`). On web-font
load the controller re-measures.

---

## Extending it with custom nodes

The engine is driven by a **schema** of measurable nodes, so hosts add custom
block types and inline atoms without forking it. A node only has to declare
*how it measures* and *how it renders*; layout, virtualization, caret and
selection come for free.

```ts
// 1. Register nodes (core). Text nodes are laid out by Pretext; atomic nodes
//    return their own height; inline atoms return their own width.
const editor = useEditor({
  schema: {
    blocks: {
      divider: { type: "divider", text: false, measure: () => 33 },
      image: {
        type: "image",
        text: false,
        measure: ({ width, attrs }) => Math.round(width / Number(attrs.ratio)), // re-measured on resize
      },
    },
    atoms: {
      mention: { type: "mention", measure: ({ data, typography, measurer }) =>
        measurer.measure(`@${data.label}`, resolveFont(typography, {})) + 14 },
    },
  },
});

// 2. Render them (react) — keyed by type.
<NoteEditor
  editor={editor}
  blockRenderers={{ divider: () => <hr/>, image: ({ editor, block }) => <img .../> }}
  atomRenderers={{ mention: ({ atom }) => <Chip label={atom.data.label} /> }}
/>;
```

- **Atomic blocks** (divider, image, embed) provide a height function of
  `width + attrs`; the image demo re-measures on resize and stays pixel-exact.
- **Inline atoms** (mention, equation) are Yjs embeds occupying one offset that
  participate in Pretext's line-breaking as fixed-width boxes — the caret steps
  over them, hit-testing snaps to the nearer edge, and you can type around them.
- Built-in `paragraph/heading/quote/code` are themselves just registered text
  nodes; your schema merges over them.

The example registers all three (`/divider`, `/image`, `/mention`) — see
`apps/web/src/lib/nodes.tsx`.

---

## Status vs. the MVP plan

- **Phase 1 (done):** Y.Doc per note, `blocks: Y.Array`, one `Y.Text` per block, local persistence, Pretext height measurement, block virtualization, visible blocks rendered as Pretext lines.
- **Phase 2 (done):** caret geometry from layout, click + drag hit-testing, selection, insert/delete, split/merge, full keyboard nav (incl. vertical movement with preferred-x), undo/redo, clipboard.
- **Phase 3 (done):** inline marks via `Y.Text` attributes, Pretext rich-inline layout, bold/italic/code/underline/strike rendering, selection rectangles across styled text, heading/quote/code block types.
- **Extensibility (done):** schema-driven block + inline-atom registry (measurable custom nodes), renderer registries, demo divider/image/mention.
- **Production hardening (done):** links (`setLink`/`removeLink`, Cmd+K, sanitized URLs incl. pasted HTML), live markdown input rules (`# `, `- `, `1. `, `[] `, `> `, ``` ``` ```, `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`) with single-undo reversal, heading levels 1–3 (typography, clipboard `<h1>`–`<h3>` fidelity), origin-scoped selection-restoring undo, LRU eviction of detailed layouts (`maxDetailedLayouts`), and per-block ARIA semantics (heading/blockquote/listitem/aria-checked).
- **Parity batch (done):** markdown import/export (`blocksToMarkdown`/`markdownToBlocks`/`exportMarkdown`, markdown-aware paste), live code-block syntax highlighting (built-in tokenizer for js/ts/json/py/css/html/sh/md, pluggable `Highlighter`, ```` ```lang ```` fences), block reordering (drag handle + Cmd/Ctrl+Shift+↑/↓, `moveBlock`), find & replace (`findAll`/`replaceAll` + the demo's Cmd+F bar with overlay match highlights via `rectsForRange`), an accessible document-outline landmark (`getOutline`), and interactive custom blocks (`setBlockAttrs`, in-place React reconciliation, native widget events) demonstrated by the example app's editable `/table` node.
- **Extension system (done):** composable `extensions` bundles (custom nodes + input rules + `exec` commands), host `keymap` prop resolved before built-in shortcuts, and range-geometry APIs for host overlays — the pieces hosts need to build links-menus, comments, callouts, etc. without forking the engine.

### Known limitations (MVP)

- Greedy (not Knuth–Plass) line breaking; long unbreakable words break per-character.
- One active note Y.Doc held in memory at a time (by design).
- Atom width is measured with the base typography (not the host block's), so an inline atom inside a heading uses body-size metrics.
- No collaborative transport wired up — but every edit is already a Yjs update, so a provider drops straight in.
