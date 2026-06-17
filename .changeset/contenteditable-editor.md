---
"@wingleeio/ori-core": minor
"@wingleeio/ori-react": minor
---

Rebuild the editor on **contentEditable** for native text editing.

The view layer now hands caret, selection, the iOS spacebar-trackpad, native selection menus (Copy / Look Up / Translate), the loupe, dictation and IME to the browser, while every edit is routed through the `EditorController` (Y.Doc). One editable surface means selection spans across blocks. The view stays **virtualized** — only the on-screen window of blocks is rendered, between offscreen spacers sized from Pretext measurement — and a branded caret overlay is drawn on top (the native caret is hidden via `caret-color`).

- `EditorController`: adds `blockIds()`, `getInline()`, `getBlockType()`; `InlineItem` is now exported.
- `@wingleeio/ori-react`: `<NoteEditor>` keeps the same props/handle. The old custom-render + hidden-textarea path (and its `BlockView` / `SelectionLayer` / `CaretLayer` / `handleKeyDown` / `pasteText` exports) is removed.
