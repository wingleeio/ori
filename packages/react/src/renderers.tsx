import type { BlockLayout, EditorController, InlineAtom, VisibleBlock } from "@wingleeio/ori-core";
import { createContext, useContext, type ReactNode } from "react";

/** Props for a custom block renderer (atomic nodes: divider, image, …). */
export interface BlockRendererProps {
  editor: EditorController;
  block: VisibleBlock;
  /** The block's synthetic layout (atomic blocks: one line, no fragments). */
  layout: BlockLayout;
}
export type BlockRenderer = (props: BlockRendererProps) => ReactNode;

/** Props for a custom inline-atom renderer (mention chip, inline math, …). */
export interface AtomRendererProps {
  editor: EditorController;
  atom: InlineAtom;
}
export type AtomRenderer = (props: AtomRendererProps) => ReactNode;

export interface Renderers {
  blocks: Record<string, BlockRenderer>;
  atoms: Record<string, AtomRenderer>;
}

const EMPTY: Renderers = { blocks: {}, atoms: {} };

const RenderersContext = createContext<Renderers>(EMPTY);
export const RenderersProvider = RenderersContext.Provider;
export const useRenderers = (): Renderers => useContext(RenderersContext);
