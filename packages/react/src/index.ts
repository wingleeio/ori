/**
 * `@wingleeio/ori-react` — React bindings for the Ori virtualized note editor.
 *
 * Pair {@link useEditor} (owns an `EditorController`) with {@link NoteEditor}
 * (renders + drives it). Import `@wingleeio/ori-react/styles.css` for the base styles.
 */
export { useEditor } from "./useEditor";
export type { UseEditorOptions } from "./useEditor";
export { useEditorSnapshot, useActiveMarks } from "./hooks";
export { NoteEditor } from "./NoteEditor";
export type { NoteEditorProps, NoteEditorHandle, ViewportRect } from "./NoteEditor";
export { useRenderers } from "./renderers";
export type {
  BlockRenderer,
  AtomRenderer,
  BlockRendererProps,
  AtomRendererProps,
  Renderers,
} from "./renderers";

// Convenience re-exports so app code can import everything from @wingleeio/ori-react.
export {
  EditorController,
  DEFAULT_TYPOGRAPHY,
  createCanvasMeasurer,
  createNoteDoc,
  getBlocks,
  snapshotBlocks,
  encodeDoc,
  applyUpdate,
  docFromUpdate,
  bytesToBase64,
  base64ToBytes,
} from "@wingleeio/ori-core";
export type {
  EditorSnapshot,
  VisibleBlock,
  Selection,
  Position,
  Typography,
  Marks,
  BlockType,
  BlockSnapshot,
  BlockLayout,
  InlineAtom,
  EditorSchema,
  BlockNode,
  InlineAtomNode,
} from "@wingleeio/ori-core";
