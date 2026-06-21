---
"@wingleeio/ori-core": patch
"@wingleeio/ori-react": patch
---

Deleting all of a heading/quote/code block's text now drops it back to a paragraph, instead of leaving an empty heading you had to convert with `/`. This matters most when it's the only (or first) block in the document, where there's nothing to merge into. Typing over a heading's selection still keeps the heading. Adds `EditorController.demoteEmptyBlock()`, which the view calls after a deletion.
