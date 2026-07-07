---
"@wingleeio/ori-react": patch
---

fix(editor): clicking into an unfocused editor no longer scroll-jumps to the remembered caret

Chrome scrolls a contenteditable to reveal its remembered selection when it
regains focus — so after a floating menu closed (editor blurred), the next
click into the editor yanked the scroller to wherever the caret last was
before placing the new caret: a jump to a seemingly random spot. The view now
pre-focuses the editor with `preventScroll` on pointerdown (making the
browser's default mousedown focus a no-op), and every programmatic focus —
`view.focus()`, the empty-surface click handler, `autoFocus` — passes
`preventScroll` too. The editor draws its own caret and owns its scrolling;
focus must never move it.
