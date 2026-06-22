---
"@wingleeio/ori-react": patch
"@wingleeio/ori-core": patch
---

Second round of adversarial-review fixes:

- Atomic/custom blocks re-render when their measured height (e.g. an image on
  resize) or attrs change, and re-measure when a nested attrs map is edited.
- The renderer host fills the block's pinned height so height:100% renderers
  (e.g. a centered divider) lay out correctly.
- `getActiveMarks`/`toggleMark` consider the whole multi-block selection, so
  toggling a mark over a mixed-mark range applies it instead of removing it.
- Lazy viewport measurement converges robustly (no visible tail left on an
  estimate in pathological docs).
- Pasting external HTML preserves whitespace and newlines inside `<pre>`, so
  copied code keeps its indentation.
