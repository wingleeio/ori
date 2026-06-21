# @wingleeio/ori-core

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
