# @wingleeio/ori-react

## 0.4.0

### Minor Changes

- 34b4390: Add built-in bullet and ordered list blocks with nested levels, keyboard indent/outdent behavior, matching React rendering, and clipboard round-tripping.

### Patch Changes

- Updated dependencies [34b4390]
  - @wingleeio/ori-core@0.4.0

## 0.3.10

### Patch Changes

- c62263b: Build the contentEditable view in a layout effect (seeded with the real width on first mount) so the document paints a frame sooner — no flash of an empty editor. Background measurement still restarts correctly when width changes on a later re-render.
- 8b36ed1: Improve editor responsiveness on the native typing path: keep plain keystrokes free of pre-paint model notifications, apply known native edits directly to the Y.Doc, move the custom caret imperatively with transforms, and speed up block/virtualizer lookups used by selection and measurement.
- Updated dependencies [8b36ed1]
  - @wingleeio/ori-core@0.3.4

## 0.3.9

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
- Updated dependencies [2199417]
- Updated dependencies [dd74cb0]
- Updated dependencies [3b0de0f]
- Updated dependencies [41773ac]
- Updated dependencies [f537d85]
- Updated dependencies [75d2cc9]
- Updated dependencies [92f8e5b]
  - @wingleeio/ori-core@0.3.3
  - @wingleeio/ori-pretext@0.0.2

## 0.3.8

### Patch Changes

- abf2e40: Deleting all of a heading/quote/code block's text now drops it back to a paragraph, instead of leaving an empty heading you had to convert with `/`. This matters most when it's the only (or first) block in the document, where there's nothing to merge into. Typing over a heading's selection still keeps the heading. Adds `EditorController.demoteEmptyBlock()`, which the view calls after a deletion.
- Updated dependencies [abf2e40]
  - @wingleeio/ori-core@0.3.2

## 0.3.7

### Patch Changes

- bfd01b6: Fix Backspace after typing a character not deleting it from the screen (most visible right after typing `@`/`/` to open a menu). The browser paints typed text natively while the Backspace routes through the controller; when the model returns to a previously rendered state the block's cached render signature matched, so the reconciler skipped it and left the character on screen (the caret moved but the text stayed). Native edits now invalidate the block signature so the next render reconciles the DOM.

## 0.3.6

### Patch Changes

- 8c0c10a: Harden the contentEditable editor for real-world input.

  - **iOS autocorrect / IME**: route `beforeinput` through `getTargetRanges()` so autocorrect and spellcheck replacements edit the reported word instead of deleting or duplicating text, and preserve the word's marks. Leave all input native during IME composition and reconcile from the model on `compositionend`; a concurrent edit to the composing block keeps the committed change.
  - **Touch menus**: slash / mention / selection menus are now tap-reliable on iOS — focus retention is mouse-only so taps aren't suppressed and lists still scroll. The selection toolbar stays alive while you use it (including its portaled block-type dropdown) and dismisses on click-away.
  - **Stability**: React roots unmount off the render path (no more "synchronously unmount" warning); inline atoms and custom blocks survive a `readOnly`/`editor` swap with the caret restored.
  - **Drag & drop**: routed through the controller — internal moves delete the source (no duplication, marks/atoms preserved, caret at the drop), Alt/Option copy-drags duplicate, and empty drops are ignored.
  - Handle trackpad/menu undo & redo, and paint a pending mark on the next collapsed keystroke. Adds `EditorController.hasPendingMarks()`.

- Updated dependencies [8c0c10a]
  - @wingleeio/ori-core@0.3.1

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
