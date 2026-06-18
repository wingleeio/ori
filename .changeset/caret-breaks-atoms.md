---
"@wingleeio/ori-react": patch
---

Fix caret behaviour around hard breaks and inline atoms.

- **Shift+Enter** now starts a new block (a clean new line with the caret at its
  start) instead of inserting a raw `"\n"` that left the caret stranded — soft
  breaks render unreliably in contentEditable.
- **Hard breaks (`\n`)** in a block now render as `<br>` elements (with offset
  mapping) rather than raw newlines in a text node, which the browser wouldn't
  give a caret position on.
- **The caret stays visible next to an inline atom** (e.g. a mention): it's
  anchored to the atom's right edge when there's no adjacent text to measure, and
  the atom no longer uses `user-select: all`, which trapped the caret beside it.
