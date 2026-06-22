---
"@wingleeio/ori-react": patch
"@wingleeio/ori-core": patch
---

Fix correctness bugs found in an adversarial review:

- **Data loss**: inline atoms (e.g. @mentions) were silently dropped when a
  block was split, merged, or partially deleted with the atom in the moved or
  retained tail. Structural ops now carry embeds through.
- Lazy measurement now also covers `reindex`, so a structural edit in a large
  note no longer re-measures the whole document (it stayed O(viewport) only on
  initial open before).
- Custom/atomic block renderers now receive the block's real geometry and the
  block is pinned to its measured height, so images render at full size and
  dividers match their reserved space instead of collapsing.
- Native formatting commands (the browser/mobile B/I/U buttons, surfacing as
  `beforeinput` `formatBold`/etc.) are routed through the model instead of
  silently mutating the DOM and being lost on the next render.
- Heading weight and code font-size/line-height in the rendered CSS now match
  the typography the layout engine measures with, so wrapping and height agree.
- Clipboard HTML escapes link hrefs as attributes (quotes included).
