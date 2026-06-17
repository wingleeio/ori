# @wingleeio/ori-react

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
