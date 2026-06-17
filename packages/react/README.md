# @wingleeio/ori-react

> **Alpha (`0.0.x`).** Experimental — APIs may change between releases and it is not yet production-ready.

React bindings for the Ori virtualized note editor.

```tsx
import { useEditor, NoteEditor } from "@wingleeio/ori-react";
import "@wingleeio/ori-react/styles.css";

function Editor({ doc }) {
  const editor = useEditor({ doc }); // owns an EditorController for this mount
  return <NoteEditor editor={editor} autoFocus placeholder="Start writing…" maxWidth={720} />;
}
```

`<NoteEditor>` renders only the blocks intersecting the viewport, draws the caret
and selection from logical state, and routes keyboard / IME / mouse input to the
controller. Pair with `useEditorSnapshot` / `useActiveMarks` to build toolbars.

To switch notes, give the host component a `key` (e.g. the note id) so it
remounts with a fresh controller for the new `Y.Doc`.

`react`, `react-dom` and `yjs` are peer dependencies.
