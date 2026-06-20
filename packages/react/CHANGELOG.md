# @wingleeio/ori-react

## 0.3.5

### Patch Changes

- f3af92a: Clicking the editor's empty surface places the caret at the nearest line, not the
  document start.

  Clicking a margin beside a line (or the space below the content) fell through to
  the browser, which dropped the caret at the start of the first block. The editor
  now resolves the click to the nearest block and visual line and places the caret
  at that line's start (left side) or end (right side / below) — like a real editor.

## 0.3.4

### Patch Changes

- 6439dcc: Fix the caret jumping to the start of the block after inserting a mention.

  The previous "don't collapse a live selection" guard only restored the DOM
  selection when the re-render _removed_ the selection's nodes. But when a block is
  re-rendered the browser auto-moves the orphaned caret onto a new (valid) node, so
  the guard saw "not detached" and skipped placing the caret at the model position —
  leaving it at the wrong spot (then an async atom render bumped it to the block
  start). `renderBlocks` now reports which blocks it re-rendered, and the view
  restores the selection precisely when the **selection's own block** was
  re-rendered (the model is authoritative there) while still leaving a live
  selection untouched when some _other_ block re-renders. So inserting a mention
  leaves the caret right after it, and select-then-Backspace still deletes the range.

## 0.3.3

### Patch Changes

- f296402: Fix select-then-Backspace sometimes moving the caret without deleting, plus a
  forward-delete merge bug.

  - **A selection is no longer collapsed by an async re-render.** After a content
    change, the view restored the selection from the model — but if the user had
    _just_ made a selection that hadn't reached the model yet, that clobbered it
    (collapsing it), so a following Backspace moved the caret instead of deleting
    the range. The view now restores the selection only when the re-render actually
    removed the live selection's DOM nodes.
  - **Delete at the end of a block now merges the next block** through the
    controller. It previously took the native fast path, letting the browser
    perform a cross-block merge that corrupted the virtualized DOM.

  Adds an `EditorView` input-routing test suite (Backspace/Delete over selections
  and across blocks, merges, splits, replace, atom deletion, mark/undo shortcuts,
  and the selection-preservation guard).

## 0.3.2

### Patch Changes

- b25b079: Fix the custom caret rendering at the start of the block after inserting a mention.

  Inline atoms mount their renderer asynchronously, so when the caret was measured
  immediately after an atom was inserted the chip was still zero-width and the caret
  overlay landed near the block start — and it never re-measured once the chip
  appeared. The caret now re-measures on the next frame after a selection change, so
  it settles to the correct position beside the rendered mention.

## 0.3.1

### Patch Changes

- 0be8a36: Fix deleting inline atoms (mentions) and a caret that could jump to the block start.

  - **Backspace / Delete next to an inline atom now removes it.** Those keystrokes
    took the native fast path, but the browser won't delete a `contentEditable=false`
    atom — so it silently no-op'd (the mention felt undeletable) and could jolt the
    caret. When an atom is adjacent, the deletion is routed through the controller.
  - **A programmatic `focus()` no longer strands the caret at the start of the block.**
    `NoteEditorHandle.focus()` now restores the model selection to the DOM after
    focusing, so focusing the editor after a menu command (e.g. inserting a mention)
    keeps the caret where the edit left it.

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

### Patch Changes

- Updated dependencies [892c23a]
  - @wingleeio/ori-core@0.3.0

## 0.2.2

### Patch Changes

- b9b5bc8: Fix the editor scrolling to the top when you arrow-key down to the last block.

  The virtualizer rendered off-screen height as `contentEditable=false` spacer
  elements inside the editable. Arrowing down at the last block moved the caret into
  the bottom spacer (an unmappable position), and the next arrow press made the
  browser jump the selection — and the scroll — back to the top of the document. The
  off-screen height is now `padding` on the editable instead, so there are no
  elements the caret can escape into; windowing and scroll height are unchanged.

  Also adds extensive tests: DOM↔model offset round-trips (text, marks, atoms, hard
  breaks), and controller editing coverage (delete forward/merge, paragraph-break at
  start/middle/end, cross-block delete, pending marks, block types, select-all, atom
  insert/delete).

## 0.2.1

### Patch Changes

- 527ca16: Fix caret behaviour around hard breaks and inline atoms.

  - **Shift+Enter** now starts a new block (a clean new line with the caret at its
    start) instead of inserting a raw `"\n"` that left the caret stranded — soft
    breaks render unreliably in contentEditable.
  - **Hard breaks (`\n`)** in a block now render as `<br>` elements (with offset
    mapping) rather than raw newlines in a text node, which the browser wouldn't
    give a caret position on.
  - **The caret stays visible next to an inline atom** (e.g. a mention): it's
    anchored to the atom's right edge when there's no adjacent text to measure, and
    the atom no longer uses `user-select: all`, which trapped the caret beside it.

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

### Patch Changes

- Updated dependencies [bcb5704]
  - @wingleeio/ori-core@0.2.0

## 0.1.2

### Patch Changes

- d91db87: Stop the selection toolbar from shaking on scroll.

  A floating toolbar pinned with `position: fixed` and re-measured on every scroll
  trails the compositor by a frame, so it visibly jitters as you scroll. The editor
  now exposes the content overlay layer via `NoteEditorHandle.getOverlayElement()` —
  a positioned layer that scrolls _with_ the text. The example selection menus render
  into it (`createPortal`) with content-relative coordinates, so the toolbar rides
  the scroll natively (zero drift) and flips above/below relative to the scroll
  viewport's edge instead of the window's.

## 0.1.1

### Patch Changes

- 93a0a51: Fix five editing/selection rough edges in the contentEditable editor:

  - **Quote (and code) blocks no longer paint the whole editor.** A legacy
    absolutely-positioned `::before` quote bar anchored to the content box, so one
    quote block drew a rule down the entire document. Block accents are now the
    per-block `.ori-ce`-scoped borders only.
  - **The caret is visible on empty lines.** A collapsed range in an empty block
    has no client rects, so the custom caret (the native one is hidden) vanished;
    it is now synthesized from the block box + line metrics. Arrow-navigating into
    an empty block shows the caret.
  - **Clicking outside the editor drops the selection** (so a selection toolbar
    hides), while focus-preserving clicks (toolbar buttons) and window/tab blur are
    ignored.
  - **Clicking the empty space below the content** focuses the editor and places
    the caret at the end of the document.
  - Selection-menu examples now re-position on scroll/resize, not just model
    changes, so a floating toolbar tracks the selection when the page scrolls.

## 0.1.0

### Minor Changes

- 1ba87f2: Rebuild the editor on **contentEditable** for native text editing.

  The view layer now hands caret, selection, the iOS spacebar-trackpad, native selection menus (Copy / Look Up / Translate), the loupe, dictation and IME to the browser, while every edit is routed through the `EditorController` (Y.Doc). One editable surface means selection spans across blocks. The view stays **virtualized** — only the on-screen window of blocks is rendered, between offscreen spacers sized from Pretext measurement — and a branded caret overlay is drawn on top (the native caret is hidden via `caret-color`).

  - `EditorController`: adds `blockIds()`, `getInline()`, `getBlockType()`; `InlineItem` is now exported.
  - `@wingleeio/ori-react`: `<NoteEditor>` keeps the same props/handle. The old custom-render + hidden-textarea path (and its `BlockView` / `SelectionLayer` / `CaretLayer` / `handleKeyDown` / `pasteText` exports) is removed.

### Patch Changes

- Updated dependencies [1ba87f2]
  - @wingleeio/ori-core@0.1.0

## 0.0.4

### Patch Changes

- 8962d71: Native-feeling text interaction on touch devices (iOS/Android) and unified pointer input.

  - **Gestures**: tap places the caret, double-tap selects the word, triple-tap selects the block, and long-press selects the word — all via a single Pointer Events pipeline (mouse / touch / pen).
  - **Selection handles**: iOS-style draggable handles appear on touch and adjust the selection ends.
  - **Scroll vs. select**: a vertical touch-drag scrolls; selection drags don't fight it (`touch-action`).
  - **Native caret + typing**: on touch, the hidden input mirrors the focused block's text and selection, so the iOS spacebar-trackpad and native caret traverse real characters; typing/autocorrect reconcile into the editor by diff. Desktop keeps its existing keymap-driven model unchanged.
  - **Core**: adds `EditorController.selectWordAt`, `selectBlockAt`, `orderedSelection`, and the pure `wordBoundsAt` helper.

- Updated dependencies [8962d71]
  - @wingleeio/ori-core@0.0.3

## 0.0.3

### Patch Changes

- f5ea26d: Fix: the editor now survives React StrictMode. Previously, StrictMode's dev-only mount → unmount → remount tore down the controller's document subscriptions (`observeDeep` + undo) and left a dead controller behind, so the editor stopped reacting to edits.

  `EditorController` now exposes idempotent `connect()` / `disconnect()`, and `useEditor` disconnects on unmount and reconnects on mount instead of destroying — so the same controller (and all its state) is reused across StrictMode's double-mount. `destroy()` remains for terminal teardown. No API changes for existing callers.

- Updated dependencies [f5ea26d]
  - @wingleeio/ori-core@0.0.2

## 0.0.2

### Patch Changes

- e182518: Clicking empty space in the editor — surrounding padding or the gutter below the last block — now focuses the editor and drops the caret at the nearest position, instead of doing nothing. The pointer handler is bound to the whole scroller rather than just the text canvas (with a guard so native scrollbar drags still work).

## 0.0.1

### Patch Changes

- bd5ab6f: Initial alpha release of Ori — a local-first, virtualized note editor.

  - `@wingleeio/ori-pretext`: agnostic text layout & measurement engine.
  - `@wingleeio/ori-core`: Y.Doc block model, virtualizer, custom-node schema and the `EditorController` runtime.
  - `@wingleeio/ori-react`: `useEditor` + `<NoteEditor>` React bindings.

- Updated dependencies [bd5ab6f]
  - @wingleeio/ori-pretext@0.0.1
  - @wingleeio/ori-core@0.0.1
