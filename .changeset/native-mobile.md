---
"@wingleeio/ori-core": patch
"@wingleeio/ori-react": patch
---

Native-feeling text interaction on touch devices (iOS/Android) and unified pointer input.

- **Gestures**: tap places the caret, double-tap selects the word, triple-tap selects the block, and long-press selects the word — all via a single Pointer Events pipeline (mouse / touch / pen).
- **Selection handles**: iOS-style draggable handles appear on touch and adjust the selection ends.
- **Scroll vs. select**: a vertical touch-drag scrolls; selection drags don't fight it (`touch-action`).
- **Native caret + typing**: on touch, the hidden input mirrors the focused block's text and selection, so the iOS spacebar-trackpad and native caret traverse real characters; typing/autocorrect reconcile into the editor by diff. Desktop keeps its existing keymap-driven model unchanged.
- **Core**: adds `EditorController.selectWordAt`, `selectBlockAt`, `orderedSelection`, and the pure `wordBoundsAt` helper.
