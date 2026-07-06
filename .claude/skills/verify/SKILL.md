---
name: verify
description: Build, launch, and drive the ori editor demo app to verify editor changes end-to-end in a real browser.
---

# Verifying ori editor changes

## Launch

```bash
pnpm install          # once
pnpm dev              # vite serves apps/web on http://localhost:5173 (~3s)
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/   # 200 when up
```

## Drive (playwright-core, no @playwright/test needed)

`playwright-core` is a root devDependency. There is no system Chrome; use the
playwright cache browser:

```js
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
```

Put the script **inside the repo** (e.g. `.verify-*.mjs`) so `import "playwright-core"`
resolves; delete it afterwards. Run with `node <script>` (sandbox off — it binds
a socket to the dev server).

## Docs site (second surface)

`pnpm --filter docs dev` serves Next.js on :3000 with a live editor on the
landing page (scope selectors with `.live-editor`; it uses the Hanken Grotesk
webfont — wait ~800ms for fonts). The editor sits below the fold: call
`ce.scrollIntoViewIfNeeded()` before mouse work or clicks land on the hero.

**Layout-drift check** (the architecture's #1 risk): model-positioned overlays
(`.ori-placeholder`, find highlights) must align with DOM-positioned ones
(`.ori-caret`). Compare their `getBoundingClientRect().top` — >2px apart means
some block's DOM height ≠ Pretext's measured height; diff per-block heights
against expected `lines × line-height (+insets)` to find the culprit (CSS
floors/padding on `.ori-block*` are prime suspects).

## Gotchas

- The editing surface is `.ori-ce` (contenteditable). Click it first.
- **macOS keys**: `End`/`Home` do NOT move the caret — use `Meta+ArrowRight` /
  `Meta+ArrowLeft`. Pressing `Enter` with a range selected deletes the range
  (correct behavior — don't misread it as a bug).
- Select-all+Delete first to clear the seeded "Welcome to Ori" note.
- The Cmd+K link flow in the demo uses `window.prompt` — override it via
  `page.addInitScript` before navigation.
- Blocks are `[data-block-id]` divs; inline runs are `[data-off]` spans; links
  carry `data-href`; headings carry `data-heading-level` + `role`/`aria-level`;
  todos carry `aria-checked`.
- Freshly native-typed blocks show a bare text node (no run spans) until the
  next re-render — model text (via block `textContent`) is still correct.
- The floating selection toolbar (`[data-ori-overlay]`) can overlap blocks in
  screenshots.

## Flows worth driving

- Markdown input rules: type `## `, `- `, `[x] `, `**bold**`, `` `code` ``
  char-by-char (`page.keyboard.type(..., { delay: 15 })`).
- Undo/redo of a rule: Cmd+Z twice restores the literal prefix as a paragraph.
- Links: select word → Cmd+K; verify `data-href`, and that `javascript:` URLs
  are rejected (no link produced).
- Syntax highlighting: type ```` ```ts ```` + space (the fence needs its
  trigger space), then code; runs get `ori-tok-*` classes live.
- Markdown paste: dispatch a `ClipboardEvent("paste")` with `text/plain`
  markdown → rich blocks; pasting into a code block stays literal (by design —
  don't misread it: check which block holds the caret first).
- Drag reorder: hover a block → `.ori-drag-handle` appears; pointer-drag to
  another block's far half → `.ori-drop-indicator`; drop reorders; also
  Cmd+Shift+ArrowUp/Down moves the caret's block.
- Outline: `nav[aria-label="Document outline"]` lists headings (visually
  hidden — query it, don't screenshot it).
- Find & replace: Cmd+F opens the bar (`input[placeholder="Find…"]`); match
  highlights are absolutely-positioned divs in `.ori-content` with a
  yellow rgba background; Enter/Shift+Enter cycle; replace-all is one undo.
- Tables: `/table` via slash menu; cells are `<input>`s committing on blur —
  fill + Tab, then assert input values; typing must never leak into
  `[data-block-id]` text content.
- Virtualization: the seeded sidebar has 2,000-block notes for scroll checks.
