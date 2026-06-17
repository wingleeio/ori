/**
 * `@wingleeio/ori-core` — framework-agnostic note-editor runtime.
 *
 * It binds together the three pillars of the design:
 *  - **Y.Doc** as canonical block-based state (see {@link ./schema}).
 *  - **Pretext** layout via a cached, two-tier measurement strategy.
 *  - **Virtualization** so only on-screen blocks ever produce DOM.
 *
 * The {@link EditorController} is the entry point; UI packages such as
 * `@wingleeio/ori-react` subscribe to it and render its snapshots.
 */
export * from "./schema";
export * from "./selection";
export * from "./delta";
export * from "./persistence";
export {
  DEFAULT_SCHEMA,
  DEFAULT_BLOCKS,
  createSchema,
} from "./nodes";
export type {
  EditorSchema,
  BlockNode,
  InlineAtomNode,
  BlockMeasureContext,
  AtomMeasureContext,
} from "./nodes";
export {
  insertText,
  deleteRange,
  splitBlock,
  mergeWithPrevious,
  formatRange,
  setBlockType,
  insertInlineEmbed,
  insertBlockAfter,
} from "./operations";
export { Virtualizer } from "./virtualizer";
export type { VirtualItem, VirtualWindow } from "./virtualizer";
export { LayoutCache } from "./cache";
export type { CacheEntry } from "./cache";
export { EditorController } from "./controller";
export type {
  EditorOptions,
  EditorSnapshot,
  VisibleBlock,
  CaretRect,
  SelectionRect,
  MoveDirection,
} from "./controller";

// Re-export the Pretext surface so consumers need only depend on @wingleeio/ori-core.
export type {
  Typography,
  Marks,
  Measurer,
  BlockLayout,
  Line,
  Fragment,
  InlineAtom,
} from "@wingleeio/ori-pretext";
export {
  DEFAULT_TYPOGRAPHY,
  createCanvasMeasurer,
  createMonospaceMeasurer,
  resolveFont,
  typographyKey,
  lineHeightPx,
} from "@wingleeio/ori-pretext";
