---
"@wingleeio/ori-react": patch
"@wingleeio/ori-core": patch
---

Geometry parity and exact virtualized scrolling:

- Block nodes can declare a content `inset` (px) matching their rendered CSS
  padding/border; the layout engine subtracts the horizontal inset from the wrap
  width and adds the vertical inset to the height. Code and quote blocks use it,
  so their wrapping and virtualized height now match the DOM exactly (previously
  their padding/border drifted from the layout model).
- Scroll-anchoring: when a block's height changes above the viewport (e.g. lazy
  measurement resolving an estimate), the view compensates the scroll so the
  content you're reading doesn't jump.
- Background measurement: off-screen block heights finish measuring from idle
  time after the first paint, so total height — and thus the scrollbar and
  scroll-to-bottom — become exact without slowing the open.
