---
"@wingleeio/ori-react": patch
---

Fix select-then-Backspace sometimes moving the caret without deleting, plus a
forward-delete merge bug.

- **A selection is no longer collapsed by an async re-render.** After a content
  change, the view restored the selection from the model — but if the user had
  *just* made a selection that hadn't reached the model yet, that clobbered it
  (collapsing it), so a following Backspace moved the caret instead of deleting
  the range. The view now restores the selection only when the re-render actually
  removed the live selection's DOM nodes.
- **Delete at the end of a block now merges the next block** through the
  controller. It previously took the native fast path, letting the browser
  perform a cross-block merge that corrupted the virtualized DOM.

Adds an `EditorView` input-routing test suite (Backspace/Delete over selections
and across blocks, merges, splits, replace, atom deletion, mark/undo shortcuts,
and the selection-preservation guard).
