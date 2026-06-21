---
"@wingleeio/ori-react": patch
---

Fix Backspace after typing a character not deleting it from the screen (most visible right after typing `@`/`/` to open a menu). The browser paints typed text natively while the Backspace routes through the controller; when the model returns to a previously rendered state the block's cached render signature matched, so the reconciler skipped it and left the character on screen (the caret moved but the text stayed). Native edits now invalidate the block signature so the next render reconciles the DOM.
