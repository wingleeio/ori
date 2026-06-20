---
"@wingleeio/ori-react": patch
---

Fix the caret jumping to the start of the block after inserting a mention.

The previous "don't collapse a live selection" guard only restored the DOM
selection when the re-render *removed* the selection's nodes. But when a block is
re-rendered the browser auto-moves the orphaned caret onto a new (valid) node, so
the guard saw "not detached" and skipped placing the caret at the model position —
leaving it at the wrong spot (then an async atom render bumped it to the block
start). `renderBlocks` now reports which blocks it re-rendered, and the view
restores the selection precisely when the **selection's own block** was
re-rendered (the model is authoritative there) while still leaving a live
selection untouched when some *other* block re-renders. So inserting a mention
leaves the caret right after it, and select-then-Backspace still deletes the range.
