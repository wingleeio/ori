---
"@wingleeio/ori-react": patch
---

Show the placeholder on the empty block at the caret, not just on a wholly empty document. Pressing Enter onto a new empty paragraph or list item now reveals the placeholder there, positioned at the caret (offset by the block's inset for list/quote/code), and it hides as soon as you type or move to a non-empty block.
