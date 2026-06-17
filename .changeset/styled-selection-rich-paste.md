---
"@wingleeio/ori-core": minor
"@wingleeio/ori-react": minor
---

Brand the selection highlight and preserve formatting across copy/paste.

- **Selection highlight is styled again.** Now that the editor is contentEditable
  the browser draws the selection; it's wired to the existing `--ori-selection`
  custom property via `::selection`, so it picks up each app's brand colour
  instead of the default blue. (The old `.ori-selection-rect` layer is gone.)
- **Copy/paste keeps marks.** Copy writes `text/plain`, `text/html`, and a private
  JSON payload; paste prefers the private payload (exact marks + block boundaries),
  then falls back to parsing external HTML (bold/italic/underline/strike/code/links),
  then plain text. Cut and paste-over-selection replace correctly.
- `EditorController` gains `getSelectionInline()` (the selection as styled runs,
  grouped per block) and `insertInline(items)` (insert styled runs/atoms at the
  caret) — the copy and paste primitives.
