---
"@wingleeio/ori-react": patch
---

fix(editor): heading blocks rendered taller than measured, drifting model-positioned overlays

`.ori-block`'s `min-height: 1.6em` floor exceeded a heading's `1.3` line-height
(1.6em font × 1.6em floor = 2.56em > 2.08em line), so every heading painted
~8px taller than Pretext measured. The accumulated drift pushed the caret-line
placeholder (and any other model-positioned overlay, plus the virtualized
scroll height) visibly out of place below headings. The floor is now `1lh` —
exactly one line at the block's own line-height (`1em` fallback) — so empty
blocks stay selectable without ever exceeding the measured height.
