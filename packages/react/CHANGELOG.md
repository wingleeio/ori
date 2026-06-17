# @wingleeio/ori-react

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
