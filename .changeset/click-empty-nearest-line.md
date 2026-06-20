---
"@wingleeio/ori-react": patch
---

Clicking the editor's empty surface places the caret at the nearest line, not the
document start.

Clicking a margin beside a line (or the space below the content) fell through to
the browser, which dropped the caret at the start of the first block. The editor
now resolves the click to the nearest block and visual line and places the caret
at that line's start (left side) or end (right side / below) — like a real editor.
