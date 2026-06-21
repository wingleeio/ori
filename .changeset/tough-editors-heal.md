---
"@wingleeio/ori-core": patch
"@wingleeio/ori-react": patch
---

Harden the contentEditable editor for real-world input.

- **iOS autocorrect / IME**: route `beforeinput` through `getTargetRanges()` so autocorrect and spellcheck replacements edit the reported word instead of deleting or duplicating text, and preserve the word's marks. Leave all input native during IME composition and reconcile from the model on `compositionend`; a concurrent edit to the composing block keeps the committed change.
- **Touch menus**: slash / mention / selection menus are now tap-reliable on iOS — focus retention is mouse-only so taps aren't suppressed and lists still scroll. The selection toolbar stays alive while you use it (including its portaled block-type dropdown) and dismisses on click-away.
- **Stability**: React roots unmount off the render path (no more "synchronously unmount" warning); inline atoms and custom blocks survive a `readOnly`/`editor` swap with the caret restored.
- **Drag & drop**: routed through the controller — internal moves delete the source (no duplication, marks/atoms preserved, caret at the drop), Alt/Option copy-drags duplicate, and empty drops are ignored.
- Handle trackpad/menu undo & redo, and paint a pending mark on the next collapsed keystroke. Adds `EditorController.hasPendingMarks()`.
