---
"@wingleeio/ori-react": patch
"@wingleeio/ori-core": patch
---

Restore inter-block spacing in the editor. Blocks now render the spacing the
layout model reserves (previously the contentEditable view stacked them with no
gap), and a block's `spacing` is the gap *above* it — so headings claim a
section break above and bind tightly to the body below. The editable's
line-height now matches the typography model (1.7 / 1.3 for headings) instead of
inheriting a tighter value, and clicking in a between-block gap places the caret
in the nearest block.
