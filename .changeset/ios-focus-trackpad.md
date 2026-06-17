---
"@wingleeio/ori-react": patch
---

iOS touch fixes:

- **Focus no longer flickers**: a touch tap on iOS is followed by a synthesized `mousedown` whose default action moved focus off the hidden input and dismissed the keyboard. We now `preventDefault` it (the standard "keep focus in the hidden input" technique), which also suppresses native text selection on desktop.
- **Spacebar-trackpad caret**: listen for `selectionchange` on the `<textarea>` element as well as `document` (iOS dispatches it on the element), and give the hidden input a 16px font so iOS treats it as a real, non-zooming text field the trackpad engages.
