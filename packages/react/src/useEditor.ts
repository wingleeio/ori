import {
  EditorController,
  createCanvasMeasurer,
  type EditorSchema,
  type Measurer,
  type Typography,
} from "@wingleeio/ori-core";
import { useEffect, useRef } from "react";
import type * as Y from "yjs";

export interface UseEditorOptions {
  /** Existing note `Y.Doc`. When switching notes, remount via `key` instead. */
  doc?: Y.Doc;
  typography?: Typography;
  measurer?: Measurer;
  overscan?: number;
  blockSpacing?: number;
  /** Custom block/atom nodes, merged over the built-ins. */
  schema?: Partial<EditorSchema>;
}

/**
 * Create (once) and own an {@link EditorController} for the lifetime of the
 * component. The controller is destroyed on unmount. To switch documents, give
 * the hosting component a `key` so it remounts with a fresh controller.
 */
export function useEditor(options: UseEditorOptions = {}): EditorController {
  const ref = useRef<EditorController | null>(null);
  if (ref.current === null) {
    ref.current = new EditorController({
      doc: options.doc,
      measurer: options.measurer ?? createCanvasMeasurer(),
      typography: options.typography,
      overscan: options.overscan,
      blockSpacing: options.blockSpacing,
      schema: options.schema,
    });
  }
  useEffect(() => {
    const editor = ref.current;
    return () => editor?.destroy();
  }, []);
  return ref.current;
}
