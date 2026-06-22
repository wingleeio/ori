# @wingleeio/ori-pretext

## 0.0.2

### Patch Changes

- 21d950e: Fifth-pass review fixes:

  - **Select-all data loss**: Cmd+A now sets the whole-document model selection
    (copy/cut serialize from the model), so copying a virtualized document no
    longer drops off-screen blocks. An edit after select-all replaces the whole
    document; clicking/arrowing ends it.
  - **Robust scroll anchoring**: replaced DOM-based anchoring with model-based
    scroll compensation in the controller (it reports how far the block at the
    viewport top shifted during measurement), so it stays correct even when the
    anchor block isn't mounted.
  - Deep attrs invalidation finds the owning block (the direct child of the blocks
    array), not a nested entity's own `id`.
  - Exact typography: the layout engine no longer rounds line metrics, so the
    model matches the fractional CSS (`1.7em`, `0.95em`, etc.) exactly and scales
    with the host's base font size — no per-line drift in tall blocks.

## 0.0.1

### Patch Changes

- bd5ab6f: Initial alpha release of Ori — a local-first, virtualized note editor.

  - `@wingleeio/ori-pretext`: agnostic text layout & measurement engine.
  - `@wingleeio/ori-core`: Y.Doc block model, virtualizer, custom-node schema and the `EditorController` runtime.
  - `@wingleeio/ori-react`: `useEditor` + `<NoteEditor>` React bindings.
