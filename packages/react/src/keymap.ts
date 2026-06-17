import type { EditorController } from "@wingleeio/ori-core";
import type { KeyboardEvent } from "react";

export interface KeymapOptions {
  readOnly?: boolean;
}

/** Insert clipboard text, mapping newlines to paragraph splits. */
export function pasteText(editor: EditorController, text: string): void {
  const parts = text.replace(/\r\n?/g, "\n").split("\n");
  editor.insertText(parts[0]);
  for (let i = 1; i < parts.length; i += 1) {
    editor.insertParagraphBreak();
    if (parts[i]) editor.insertText(parts[i]);
  }
}

/**
 * Translate a keyboard event into editor commands. Character insertion is left
 * to the textarea `input`/`composition` events; this handles control keys,
 * navigation and formatting shortcuts only.
 *
 * Returns true if the event was handled (and `preventDefault` was called).
 */
export function handleKeyDown(
  editor: EditorController,
  e: KeyboardEvent,
  opts: KeymapOptions = {},
): boolean {
  if (e.nativeEvent.isComposing) return false;
  // Alt/Option combos are reserved for app-level shortcuts (e.g. note switching),
  // so let them bubble instead of moving the caret.
  if (e.altKey) return false;
  const mod = e.metaKey || e.ctrlKey;
  const shift = e.shiftKey;
  const ro = !!opts.readOnly;

  if (mod) {
    switch (e.key.toLowerCase()) {
      case "b":
        e.preventDefault();
        if (!ro) editor.toggleMark("bold");
        return true;
      case "i":
        e.preventDefault();
        if (!ro) editor.toggleMark("italic");
        return true;
      case "u":
        e.preventDefault();
        if (!ro) editor.toggleMark("underline");
        return true;
      case "e":
        e.preventDefault();
        if (!ro) editor.toggleMark("code");
        return true;
      case "a":
        e.preventDefault();
        editor.selectAll();
        return true;
      case "z":
        e.preventDefault();
        if (!ro) (shift ? editor.redo() : editor.undo());
        return true;
      case "y":
        e.preventDefault();
        if (!ro) editor.redo();
        return true;
      case "arrowleft":
        e.preventDefault();
        editor.moveCaret("lineStart", shift);
        return true;
      case "arrowright":
        e.preventDefault();
        editor.moveCaret("lineEnd", shift);
        return true;
      // Let the browser raise copy/cut/paste on the textarea.
      case "c":
      case "x":
      case "v":
        return false;
      default:
        return false;
    }
  }

  switch (e.key) {
    case "Backspace":
      e.preventDefault();
      if (!ro) editor.deleteBackward();
      return true;
    case "Delete":
      e.preventDefault();
      if (!ro) editor.deleteForward();
      return true;
    case "Enter":
      e.preventDefault();
      if (!ro) editor.insertParagraphBreak();
      return true;
    case "Tab":
      e.preventDefault();
      if (!ro) editor.insertText("  ");
      return true;
    case "ArrowLeft":
      e.preventDefault();
      editor.moveCaret("left", shift);
      return true;
    case "ArrowRight":
      e.preventDefault();
      editor.moveCaret("right", shift);
      return true;
    case "ArrowUp":
      e.preventDefault();
      editor.moveCaret("up", shift);
      return true;
    case "ArrowDown":
      e.preventDefault();
      editor.moveCaret("down", shift);
      return true;
    case "Home":
      e.preventDefault();
      editor.moveCaret("lineStart", shift);
      return true;
    case "End":
      e.preventDefault();
      editor.moveCaret("lineEnd", shift);
      return true;
    default:
      return false;
  }
}
