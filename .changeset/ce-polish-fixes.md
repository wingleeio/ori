---
"@wingleeio/ori-react": patch
---

Fix five editing/selection rough edges in the contentEditable editor:

- **Quote (and code) blocks no longer paint the whole editor.** A legacy
  absolutely-positioned `::before` quote bar anchored to the content box, so one
  quote block drew a rule down the entire document. Block accents are now the
  per-block `.ori-ce`-scoped borders only.
- **The caret is visible on empty lines.** A collapsed range in an empty block
  has no client rects, so the custom caret (the native one is hidden) vanished;
  it is now synthesized from the block box + line metrics. Arrow-navigating into
  an empty block shows the caret.
- **Clicking outside the editor drops the selection** (so a selection toolbar
  hides), while focus-preserving clicks (toolbar buttons) and window/tab blur are
  ignored.
- **Clicking the empty space below the content** focuses the editor and places
  the caret at the end of the document.
- Selection-menu examples now re-position on scroll/resize, not just model
  changes, so a floating toolbar tracks the selection when the page scrolls.
