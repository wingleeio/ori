---
"@wingleeio/ori-core": patch
"@wingleeio/ori-react": patch
---

Align the empty-document placeholder with the caret. When the only block is an inset block (a to-do/bullet/numbered list item, quote, or code block) the placeholder no longer sits under the marker/checkbox — it now starts where the text and caret do. Adds `EditorController.getBlockInset(id)` to support this.
