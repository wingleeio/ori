---
"@wingleeio/ori-react": patch
---

Fix deleting inline atoms (mentions) and a caret that could jump to the block start.

- **Backspace / Delete next to an inline atom now removes it.** Those keystrokes
  took the native fast path, but the browser won't delete a `contentEditable=false`
  atom — so it silently no-op'd (the mention felt undeletable) and could jolt the
  caret. When an atom is adjacent, the deletion is routed through the controller.
- **A programmatic `focus()` no longer strands the caret at the start of the block.**
  `NoteEditorHandle.focus()` now restores the model selection to the DOM after
  focusing, so focusing the editor after a menu command (e.g. inserting a mention)
  keeps the caret where the edit left it.
