/**
 * `@wingleeio/ori-pretext` — agnostic text layout & measurement engine.
 *
 * Given styled inline text, a width and typography, Pretext produces
 * materialized lines, caret geometry, hit-testing and selection rectangles.
 * It has no DOM, canvas, React or Yjs dependency: callers inject a
 * {@link Measurer}. The browser-ready {@link createCanvasMeasurer} is provided
 * for convenience.
 */
export * from "./types";
export * from "./typography";
export * from "./measurer";
export { tokenize, mergeItems } from "./tokenize";
export type { Token, TokenKind } from "./tokenize";
export { layoutBlock } from "./layout";
export type { LayoutOptions } from "./layout";
export {
  caretForOffset,
  offsetAtPoint,
  offsetAtXInLine,
  lineIndexForOffset,
  visualLineBounds,
  selectionRects,
} from "./geometry";
