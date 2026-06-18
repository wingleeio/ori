---
"@wingleeio/ori-core": minor
"@wingleeio/ori-react": minor
---

Preserve block types (heading / quote / code) across copy/paste.

Copy/paste kept inline marks but flattened every block to a paragraph — a copied
heading pasted back as body text. The clipboard now carries each block's type in
all three payloads: the private JSON, and the HTML (`<h2>`, `<blockquote>`,
`<pre>` ↔ heading/quote/code on parse). Paste adopts the copied type when filling
a fresh or empty block, and keeps the existing type when merging into a block that
already has text.

- `EditorController` adds `getSelectionBlocks()` — the selection as `{ type, items }`
  per spanned block (the typed counterpart to `getSelectionInline()`).
