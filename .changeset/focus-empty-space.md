---
"@wingleeio/ori-react": patch
---

Clicking empty space in the editor — surrounding padding or the gutter below the last block — now focuses the editor and drops the caret at the nearest position, instead of doing nothing. The pointer handler is bound to the whole scroller rather than just the text canvas (with a guard so native scrollbar drags still work).
