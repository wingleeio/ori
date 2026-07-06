---
"@wingleeio/ori-core": minor
"@wingleeio/ori-react": minor
---

feat(editor): parity batch — markdown import/export, syntax highlighting, block reordering, find & replace, accessible outline

- **Markdown import/export**: pure `blocksToMarkdown` / `markdownToBlocks` (GFM: headings, fenced code with language, quotes, nested bullet/ordered/todo lists, bold/italic/code/strike/links/`<u>`), `docFromContent` to hydrate a Y.Doc from parsed blocks, and `controller.exportMarkdown()` / `getContentBlocks()`. **Pasting plain text now parses markdown** into rich blocks (Notion behavior) — except inside code blocks, where paste stays verbatim.
- **Syntax highlighting**: code blocks highlight live via a dependency-free tokenizer (js/ts, json, py, css, html, sh, md) — colors only, so Pretext's measured layout is never disturbed. ```` ```ts ```` fences set the language (`getCodeLang`/`setCodeLang`); bring your own `Highlighter` (e.g. shiki) via the `highlighter` option or pass `null` to disable. Token colors are CSS-var themable with dark-mode defaults.
- **Block reordering**: `controller.moveBlock(id, toIndex)` (id-stable clone, single undo step), a Notion-style hover drag handle with drop indicator and edge auto-scroll (`dragHandle` prop, default on), and Cmd/Ctrl+Shift+↑/↓ to move the caret's block.
- **Find & replace**: `findAll(query, {caseSensitive})` across blocks, `selectMatch`, `replaceMatch`, and one-undo-step `replaceAll` that preserves marks.
- **Accessible outline**: a visually-hidden `nav` landmark lists every heading with jump-to-section buttons — restoring whole-document structure for screen readers despite virtualization (`controller.getOutline()` / `getBlockTop()` for custom TOC UI).
- **Interactive custom blocks (tables)**: `controller.setBlockAttrs(id, attrs)` lets a custom block's renderer persist its own state (synced, undoable, re-measured); the view now reconciles a custom block's React root in place (focused inputs survive attrs commits) and routes events from widget-internal form controls (`input`/`textarea`/`[data-ori-widget]`) natively instead of through the editor. The demo ships an editable `/table` block (header row, add/remove rows & columns, blur-commit cells) built entirely on the public extensibility API.
- **Extension API**: `EditorOptions.extensions` accepts named bundles of `{ schema, blockRules, inlineRules, commands }` — custom nodes, autoformat rules (checked before the built-ins) and commands (`editor.exec(name)` / `hasCommand`) composed as one reusable unit, TipTap-extension style.
- **Host keymaps**: a `keymap` prop on `NoteEditor` (`"Mod-Shift-k": handler`) resolved before the built-in shortcuts with the model selection pre-synced; return `true` to consume the event.
- **Range geometry for overlays**: `controller.rectsForRange(start, end)` returns document-space rectangles for any text range (offscreen blocks included) — the primitive behind find-match highlights, comment anchors, and similar host UI. The example app ships a full Cmd+F find & replace bar (match highlights, next/prev, replace one/all) built on it.
