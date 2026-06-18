---
"@wingleeio/ori-react": patch
---

Fix the editor scrolling to the top when you arrow-key down to the last block.

The virtualizer rendered off-screen height as `contentEditable=false` spacer
elements inside the editable. Arrowing down at the last block moved the caret into
the bottom spacer (an unmappable position), and the next arrow press made the
browser jump the selection — and the scroll — back to the top of the document. The
off-screen height is now `padding` on the editable instead, so there are no
elements the caret can escape into; windowing and scroll height are unchanged.

Also adds extensive tests: DOM↔model offset round-trips (text, marks, atoms, hard
breaks), and controller editing coverage (delete forward/merge, paragraph-break at
start/middle/end, cross-block delete, pending marks, block types, select-all, atom
insert/delete).
