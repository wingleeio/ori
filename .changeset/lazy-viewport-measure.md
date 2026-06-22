---
"@wingleeio/ori-core": patch
---

Measure block heights lazily. On open (and on width changes) the controller now
measures only the blocks in and near the viewport instead of every block in the
document, deferring the rest until they scroll near. Because the overscan window
measures a block before it reaches the screen, the visible content never jumps —
only the scrollbar refines as estimates resolve. Opening a large note is now
O(viewport) instead of O(blocks): a 2,000-block note opens in roughly half the
time. Construction also no longer measures at width 0 (a pass the first real
width immediately discarded).
