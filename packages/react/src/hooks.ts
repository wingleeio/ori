import type { EditorController, EditorSnapshot, Marks } from "@wingleeio/ori-core";
import { useSyncExternalStore } from "react";

/** Subscribe a component to the controller's snapshot stream. */
export function useEditorSnapshot(editor: EditorController): EditorSnapshot {
  return useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
}

/**
 * The marks active at the current selection. Recomputed whenever the editor
 * notifies (selection move, edit, or pending-mark toggle), so toolbars stay in
 * sync without their own subscription.
 */
export function useActiveMarks(editor: EditorController): Marks {
  const snapshot = useEditorSnapshot(editor);
  // `revision` changes on every notify; reading it ties this to the store.
  void snapshot.revision;
  return editor.getActiveMarks();
}
