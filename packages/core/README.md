# @wingleeio/ori-core

> **Alpha (`0.0.x`).** Experimental — APIs may change between releases and it is not yet production-ready.

Framework-agnostic note-editor runtime. Binds **Y.Doc** (state), **Pretext**
(layout) and a **Virtualizer** (windowing) behind one `EditorController`.

```ts
import { EditorController, createCanvasMeasurer, createNoteDoc } from "@wingleeio/ori-core";

const editor = new EditorController({
  doc: createNoteDoc(),
  measurer: createCanvasMeasurer(),
});

// viewport / layout
editor.setWidth(720);
editor.setViewport(scrollTop, viewportHeight);
const snapshot = editor.getSnapshot();        // { visible, totalHeight, selection, ... }
const layout = editor.getLayout(blockId);      // detailed Pretext layout (cached)

// editing
editor.insertText("hello");
editor.insertParagraphBreak();
editor.toggleMark("bold");
editor.moveCaret("down", true);
editor.undo();

// subscribe (e.g. via React's useSyncExternalStore)
const unsub = editor.subscribe(() => render(editor.getSnapshot()));
```

`yjs` is a peer dependency — the host app provides the single shared instance.

Run the headless engine test with `pnpm --filter @wingleeio/ori-core test`.
