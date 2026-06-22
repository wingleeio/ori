---
"@wingleeio/ori-react": patch
---

Build the contentEditable view in a layout effect (seeded with the real width on first mount) so the document paints a frame sooner — no flash of an empty editor. Background measurement still restarts correctly when width changes on a later re-render.
