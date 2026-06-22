---
"@wingleeio/ori-react": patch
"@wingleeio/ori-core": patch
---

Third-pass review fixes:

- **Multi-line code blocks**: Enter inside a code block now adds a line to the
  same block (rendered via `<br>` + a filler `<br>` so the caret lands on the new
  line) instead of splitting into a new block. Editing a block that contains a
  newline is routed through the controller so the run/offset map stays correct.
- Background measurement restarts after a resize, so total height becomes exact
  again at the new width (it previously only ran once per note).
- Block `inset` is reflected in the public geometry APIs (`caretRect`,
  `positionFromPoint`, `selectionRectsForViewport`), so a host using core
  geometry gets correct coordinates for code/quote blocks.
- Scroll-anchoring only pins a block that actually intersects the viewport, so a
  large upward jump can't anchor a stale off-screen block.
- Attrs invalidation walks the full parent chain, so a change to a map nested
  inside a block's `attrs` still re-measures/re-renders the block.
