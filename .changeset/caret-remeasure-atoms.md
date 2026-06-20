---
"@wingleeio/ori-react": patch
---

Fix the custom caret rendering at the start of the block after inserting a mention.

Inline atoms mount their renderer asynchronously, so when the caret was measured
immediately after an atom was inserted the chip was still zero-width and the caret
overlay landed near the block start — and it never re-measured once the chip
appeared. The caret now re-measures on the next frame after a selection change, so
it settles to the correct position beside the rendered mention.
