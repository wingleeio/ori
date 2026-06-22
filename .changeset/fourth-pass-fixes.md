---
"@wingleeio/ori-react": patch
"@wingleeio/ori-core": patch
---

Fourth-pass review fixes:

- Deep attrs invalidation walks the full Yjs parent chain through any type
  (Y.Map / Y.Array / Y.Text nested in `attrs`) to the owning block.
- Code block renders at exact px metrics (15px / 26px) matching the layout
  engine's rounding, so a tall multi-line code block doesn't accumulate
  sub-pixel height drift. Inline code renders in the mono family at 0.92em — it
  was measured as mono but rendered in the body font, so glyph advances
  disagreed with the layout.
- `domToModel` handles a caret landing directly on a `<br>` (a hard break or the
  trailing filler), mapping it to the right block offset instead of 0.
