---
"@wingleeio/ori-core": minor
"@wingleeio/ori-react": minor
---

feat(editor): production-readiness upgrades — links, markdown input rules, heading levels, safer undo, bounded layout memory, block ARIA

- **Links**: `setLink(url)` / `removeLink()` / `getActiveLink()` on the controller — a range selection links whole; a collapsed caret on a link retargets/unlinks the entire run; a bare caret inserts the URL as linked text. URLs are sanitized (`sanitizeUrl`): `javascript:`/`data:` etc. are rejected everywhere, including pasted HTML hrefs; bare domains get `https://`. The react view renders `data-href` + tooltip on link runs, opens links on Cmd/Ctrl+click (plain click when read-only), and fires the new `onLinkShortcut` NoteEditor prop on Cmd/Ctrl+K.
- **Markdown input rules** (on by default, `inputRules: false` to opt out): typing `# `–`### `, `- `/`* `/`+ `, `1. `, `[] `/`[x] `/`- [ ] `, `> `, and ``` ``` ``` converts the block live; `**bold**`, `__bold__`, `*italic*`, `_italic_`, `` `code` `` and `~~strike~~` apply marks and strip their delimiters as you finish typing them. Each conversion is its own undo step (one Cmd+Z restores the literal text); rules never fire on paste, inside code blocks, or across existing code spans.
- **Heading levels 1–3**: headings carry a `level` attr driving typography (1.6/1.35/1.15em), per-level CSS via `data-heading-level`, `aria-level`, copy as `<h1>`–`<h3>`, and import of external `H1`–`H6` (clamped). `setBlockTypeAtSelection(type, attrs?)` now accepts attrs.
- **Undo**: the undo stack tracks only editor-originated transactions (`LOCAL_ORIGIN`) — persistence restores and collaboration updates (now applied under `REMOTE_ORIGIN` by `applyUpdate`/`docFromUpdate`) are never locally undoable. Undo/redo restore the selection captured with each stack item.
- **Bounded layout memory**: detailed layout geometry is evicted LRU beyond `maxDetailedLayouts` (default 256) as the viewport moves; cheap height metrics are always kept, so eviction never causes scroll jumps.
- **Accessibility**: blocks expose semantics — headings `role="heading"`+`aria-level`, quotes `role="blockquote"`, list items `role="listitem"`+`aria-level`, todos `aria-checked`; the editing surface gains `aria-readonly` and a new `ariaLabel` NoteEditor prop.
