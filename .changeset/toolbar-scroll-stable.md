---
"@wingleeio/ori-react": patch
---

Stop the selection toolbar from shaking on scroll.

A floating toolbar pinned with `position: fixed` and re-measured on every scroll
trails the compositor by a frame, so it visibly jitters as you scroll. The editor
now exposes the content overlay layer via `NoteEditorHandle.getOverlayElement()` —
a positioned layer that scrolls *with* the text. The example selection menus render
into it (`createPortal`) with content-relative coordinates, so the toolbar rides
the scroll natively (zero drift) and flips above/below relative to the scroll
viewport's edge instead of the window's.
