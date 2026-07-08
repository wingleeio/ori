---
"@wingleeio/ori-react": patch
---

fix(editor): custom caret no longer draws (misplaced) while a custom block's own control has focus

Typing in a table cell input showed ori's custom caret at a stale position
(the block's left edge) alongside the input's native caret — focus events
bubble, so the editor still considered itself focused. The caret overlay now
renders only while the contenteditable surface itself is the active element,
and the pointerdown pre-focus skips widget-internal controls so they take
focus directly. Widget inputs also undo the surface's transparent
`caret-color` (via `--ori-caret`), so cells show a real native caret instead
of none at all.
