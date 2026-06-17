# @wingleeio/ori-pretext

> **Alpha (`0.0.x`).** Experimental — APIs may change between releases and it is not yet production-ready.

Agnostic text **layout & measurement** engine. No DOM, canvas, React or Yjs.

Given styled inline text, a width and typography it produces materialized lines,
caret geometry, hit-testing and selection rectangles.

```ts
import { layoutBlock, caretForOffset, createCanvasMeasurer, DEFAULT_TYPOGRAPHY } from "@wingleeio/ori-pretext";

const measurer = createCanvasMeasurer(); // or createMonospaceMeasurer() for tests
const layout = layoutBlock(
  [{ text: "Hello ", start: 0 }, { text: "world", start: 6, marks: { bold: true } }],
  { width: 320, typography: DEFAULT_TYPOGRAPHY, measurer, detailed: true },
);

caretForOffset(layout, 8, measurer); // { x, y, height, lineIndex }
```

Measurement is injected via the `Measurer` interface, so the engine runs
anywhere. The browser-ready `createCanvasMeasurer()` is provided for convenience.
