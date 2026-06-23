# @wingleeio/ori-core

## 0.3.4

### Patch Changes

- 8b36ed1: Improve editor responsiveness on the native typing path: keep plain keystrokes free of pre-paint model notifications, apply known native edits directly to the Y.Doc, move the custom caret imperatively with transforms, and speed up block/virtualizer lookups used by selection and measurement.

## 0.3.3

### Patch Changes

- 21d950e: Fifth-pass review fixes:

  - **Select-all data loss**: Cmd+A now sets the whole-document model selection
    (copy/cut serialize from the model), so copying a virtualized document no
    longer drops off-screen blocks. An edit after select-all replaces the whole
    document; clicking/arrowing ends it.
  - **Robust scroll anchoring**: replaced DOM-based anchoring with model-based
    scroll compensation in the controller (it reports how far the block at the
    viewport top shifted during measurement), so it stays correct even when the
    anchor block isn't mounted.
  - Deep attrs invalidation finds the owning block (the direct child of the blocks
    array), not a nested entity's own `id`.
  - Exact typography: the layout engine no longer rounds line metrics, so the
    model matches the fractional CSS (`1.7em`, `0.95em`, etc.) exactly and scales
    with the host's base font size — no per-line drift in tall blocks.

- 2199417: Fourth-pass review fixes:

  - Deep attrs invalidation walks the full Yjs parent chain through any type
    (Y.Map / Y.Array / Y.Text nested in `attrs`) to the owning block.
  - Code block renders at exact px metrics (15px / 26px) matching the layout
    engine's rounding, so a tall multi-line code block doesn't accumulate
    sub-pixel height drift. Inline code renders in the mono family at 0.92em — it
    was measured as mono but rendered in the body font, so glyph advances
    disagreed with the layout.
  - `domToModel` handles a caret landing directly on a `<br>` (a hard break or the
    trailing filler), mapping it to the right block offset instead of 0.

- dd74cb0: Geometry parity and exact virtualized scrolling:

  - Block nodes can declare a content `inset` (px) matching their rendered CSS
    padding/border; the layout engine subtracts the horizontal inset from the wrap
    width and adds the vertical inset to the height. Code and quote blocks use it,
    so their wrapping and virtualized height now match the DOM exactly (previously
    their padding/border drifted from the layout model).
  - Scroll-anchoring: when a block's height changes above the viewport (e.g. lazy
    measurement resolving an estimate), the view compensates the scroll so the
    content you're reading doesn't jump.
  - Background measurement: off-screen block heights finish measuring from idle
    time after the first paint, so total height — and thus the scrollbar and
    scroll-to-bottom — become exact without slowing the open.

- 3b0de0f: Fix correctness bugs found in an adversarial review:

  - **Data loss**: inline atoms (e.g. @mentions) were silently dropped when a
    block was split, merged, or partially deleted with the atom in the moved or
    retained tail. Structural ops now carry embeds through.
  - Lazy measurement now also covers `reindex`, so a structural edit in a large
    note no longer re-measures the whole document (it stayed O(viewport) only on
    initial open before).
  - Custom/atomic block renderers now receive the block's real geometry and the
    block is pinned to its measured height, so images render at full size and
    dividers match their reserved space instead of collapsing.
  - Native formatting commands (the browser/mobile B/I/U buttons, surfacing as
    `beforeinput` `formatBold`/etc.) are routed through the model instead of
    silently mutating the DOM and being lost on the next render.
  - Heading weight and code font-size/line-height in the rendered CSS now match
    the typography the layout engine measures with, so wrapping and height agree.
  - Clipboard HTML escapes link hrefs as attributes (quotes included).

- 41773ac: Measure block heights lazily. On open (and on width changes) the controller now
  measures only the blocks in and near the viewport instead of every block in the
  document, deferring the rest until they scroll near. Because the overscan window
  measures a block before it reaches the screen, the visible content never jumps —
  only the scrollbar refines as estimates resolve. Opening a large note is now
  O(viewport) instead of O(blocks): a 2,000-block note opens in roughly half the
  time. Construction also no longer measures at width 0 (a pass the first real
  width immediately discarded).
- f537d85: Third-pass review fixes:

  - **Multi-line code blocks**: Enter inside a code block now adds a line to the
    same block (rendered via `<br>` + a filler `<br>` so the caret lands on the new
    line) instead of splitting into a new block. Editing a block that contains a
    newline is routed through the controller so the run/offset map stays correct.
  - Background measurement restarts after a resize, so total height becomes exact
    again at the new width (it previously only ran once per note).
  - Block `inset` is reflected in the public geometry APIs (`caretRect`,
    `positionFromPoint`, `selectionRectsForViewport`), so a host using core
    geometry gets correct coordinates for code/quote blocks.
  - Scroll-anchoring only pins a block that actually intersects the viewport, so a
    large upward jump can't anchor a stale off-screen block.
  - Attrs invalidation walks the full parent chain, so a change to a map nested
    inside a block's `attrs` still re-measures/re-renders the block.

- 75d2cc9: Second round of adversarial-review fixes:

  - Atomic/custom blocks re-render when their measured height (e.g. an image on
    resize) or attrs change, and re-measure when a nested attrs map is edited.
  - The renderer host fills the block's pinned height so height:100% renderers
    (e.g. a centered divider) lay out correctly.
  - `getActiveMarks`/`toggleMark` consider the whole multi-block selection, so
    toggling a mark over a mixed-mark range applies it instead of removing it.
  - Lazy viewport measurement converges robustly (no visible tail left on an
    estimate in pathological docs).
  - Pasting external HTML preserves whitespace and newlines inside `<pre>`, so
    copied code keeps its indentation.

- 92f8e5b: Restore inter-block spacing in the editor. Blocks now render the spacing the
  layout model reserves (previously the contentEditable view stacked them with no
  gap), and a block's `spacing` is the gap _above_ it — so headings claim a
  section break above and bind tightly to the body below. The editable's
  line-height now matches the typography model (1.7 / 1.3 for headings) instead of
  inheriting a tighter value, and clicking in a between-block gap places the caret
  in the nearest block.
- Updated dependencies [21d950e]
  - @wingleeio/ori-pretext@0.0.2

## 0.3.2

### Patch Changes

- abf2e40: Deleting all of a heading/quote/code block's text now drops it back to a paragraph, instead of leaving an empty heading you had to convert with `/`. This matters most when it's the only (or first) block in the document, where there's nothing to merge into. Typing over a heading's selection still keeps the heading. Adds `EditorController.demoteEmptyBlock()`, which the view calls after a deletion.

## 0.3.1

### Patch Changes

- 8c0c10a: Harden the contentEditable editor for real-world input.

  - **iOS autocorrect / IME**: route `beforeinput` through `getTargetRanges()` so autocorrect and spellcheck replacements edit the reported word instead of deleting or duplicating text, and preserve the word's marks. Leave all input native during IME composition and reconcile from the model on `compositionend`; a concurrent edit to the composing block keeps the committed change.
  - **Touch menus**: slash / mention / selection menus are now tap-reliable on iOS — focus retention is mouse-only so taps aren't suppressed and lists still scroll. The selection toolbar stays alive while you use it (including its portaled block-type dropdown) and dismisses on click-away.
  - **Stability**: React roots unmount off the render path (no more "synchronously unmount" warning); inline atoms and custom blocks survive a `readOnly`/`editor` swap with the caret restored.
  - **Drag & drop**: routed through the controller — internal moves delete the source (no duplication, marks/atoms preserved, caret at the drop), Alt/Option copy-drags duplicate, and empty drops are ignored.
  - Handle trackpad/menu undo & redo, and paint a pending mark on the next collapsed keystroke. Adds `EditorController.hasPendingMarks()`.

## 0.3.0

### Minor Changes

- 892c23a: Preserve block types (heading / quote / code) across copy/paste.

  Copy/paste kept inline marks but flattened every block to a paragraph — a copied
  heading pasted back as body text. The clipboard now carries each block's type in
  all three payloads: the private JSON, and the HTML (`<h2>`, `<blockquote>`,
  `<pre>` ↔ heading/quote/code on parse). Paste adopts the copied type when filling
  a fresh or empty block, and keeps the existing type when merging into a block that
  already has text.

  - `EditorController` adds `getSelectionBlocks()` — the selection as `{ type, items }`
    per spanned block (the typed counterpart to `getSelectionInline()`).

## 0.2.0

### Minor Changes

- bcb5704: Brand the selection highlight and preserve formatting across copy/paste.

  - **Selection highlight is styled again.** Now that the editor is contentEditable
    the browser draws the selection; it's wired to the existing `--ori-selection`
    custom property via `::selection`, so it picks up each app's brand colour
    instead of the default blue. (The old `.ori-selection-rect` layer is gone.)
  - **Copy/paste keeps marks.** Copy writes `text/plain`, `text/html`, and a private
    JSON payload; paste prefers the private payload (exact marks + block boundaries),
    then falls back to parsing external HTML (bold/italic/underline/strike/code/links),
    then plain text. Cut and paste-over-selection replace correctly.
  - `EditorController` gains `getSelectionInline()` (the selection as styled runs,
    grouped per block) and `insertInline(items)` (insert styled runs/atoms at the
    caret) — the copy and paste primitives.

## 0.1.0

### Minor Changes

- 1ba87f2: Rebuild the editor on **contentEditable** for native text editing.

  The view layer now hands caret, selection, the iOS spacebar-trackpad, native selection menus (Copy / Look Up / Translate), the loupe, dictation and IME to the browser, while every edit is routed through the `EditorController` (Y.Doc). One editable surface means selection spans across blocks. The view stays **virtualized** — only the on-screen window of blocks is rendered, between offscreen spacers sized from Pretext measurement — and a branded caret overlay is drawn on top (the native caret is hidden via `caret-color`).

  - `EditorController`: adds `blockIds()`, `getInline()`, `getBlockType()`; `InlineItem` is now exported.
  - `@wingleeio/ori-react`: `<NoteEditor>` keeps the same props/handle. The old custom-render + hidden-textarea path (and its `BlockView` / `SelectionLayer` / `CaretLayer` / `handleKeyDown` / `pasteText` exports) is removed.

## 0.0.3

### Patch Changes

- 8962d71: Native-feeling text interaction on touch devices (iOS/Android) and unified pointer input.

  - **Gestures**: tap places the caret, double-tap selects the word, triple-tap selects the block, and long-press selects the word — all via a single Pointer Events pipeline (mouse / touch / pen).
  - **Selection handles**: iOS-style draggable handles appear on touch and adjust the selection ends.
  - **Scroll vs. select**: a vertical touch-drag scrolls; selection drags don't fight it (`touch-action`).
  - **Native caret + typing**: on touch, the hidden input mirrors the focused block's text and selection, so the iOS spacebar-trackpad and native caret traverse real characters; typing/autocorrect reconcile into the editor by diff. Desktop keeps its existing keymap-driven model unchanged.
  - **Core**: adds `EditorController.selectWordAt`, `selectBlockAt`, `orderedSelection`, and the pure `wordBoundsAt` helper.

## 0.0.2

### Patch Changes

- f5ea26d: Fix: the editor now survives React StrictMode. Previously, StrictMode's dev-only mount → unmount → remount tore down the controller's document subscriptions (`observeDeep` + undo) and left a dead controller behind, so the editor stopped reacting to edits.

  `EditorController` now exposes idempotent `connect()` / `disconnect()`, and `useEditor` disconnects on unmount and reconnects on mount instead of destroying — so the same controller (and all its state) is reused across StrictMode's double-mount. `destroy()` remains for terminal teardown. No API changes for existing callers.

## 0.0.1

### Patch Changes

- bd5ab6f: Initial alpha release of Ori — a local-first, virtualized note editor.

  - `@wingleeio/ori-pretext`: agnostic text layout & measurement engine.
  - `@wingleeio/ori-core`: Y.Doc block model, virtualizer, custom-node schema and the `EditorController` runtime.
  - `@wingleeio/ori-react`: `useEditor` + `<NoteEditor>` React bindings.

- Updated dependencies [bd5ab6f]
  - @wingleeio/ori-pretext@0.0.1
