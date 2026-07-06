import * as Y from "yjs";

/** The built-in block kinds. */
export type BuiltinBlockType =
  | "paragraph"
  | "heading"
  | "quote"
  | "code"
  | "bullet-list"
  | "ordered-list"
  | "todo-list";
export type ListBlockType = "bullet-list" | "ordered-list" | "todo-list";

/**
 * A block's `type`. Open to any string so hosts can register custom node types
 * via the {@link EditorSchema}, while keeping autocomplete for the built-ins.
 */
export type BlockType = BuiltinBlockType | (string & {});

/** Plain snapshot of a block (no Yjs types) for inspection/serialization. */
export interface BlockSnapshot {
  id: string;
  type: BlockType;
  text: string;
}

/** The top-level `Y.Array` of block `Y.Map`s for a note document. */
export type BlockArray = Y.Array<Y.Map<unknown>>;
export type BlockMap = Y.Map<unknown>;

const BLOCKS_KEY = "blocks";

/**
 * Transaction origin for every edit made through the editor itself. The undo
 * stack tracks ONLY this origin, so updates applied from persistence or a
 * collaboration provider (which must use their own origin — see
 * {@link REMOTE_ORIGIN}) are never undoable locally.
 */
export const LOCAL_ORIGIN = "ori:local";

/** Suggested transaction origin for persistence restores / remote sync. */
export const REMOTE_ORIGIN = "ori:remote";

export const MAX_LIST_LEVEL = 7;
export const LIST_LEVEL_ATTR = "level";
export const LIST_MARKER_GUTTER_PX = 28;
export const LIST_NEST_STEP_PX = 24;
/** Attr holding a todo-list item's checked state (boolean). */
export const TODO_CHECKED_ATTR = "checked";

/** Attr holding a heading's level (1–3; 1 when absent). */
export const HEADING_LEVEL_ATTR = "level";
export const MAX_HEADING_LEVEL = 3;

export function normalizeHeadingLevel(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_HEADING_LEVEL);
}

export function getBlocks(doc: Y.Doc): BlockArray {
  return doc.getArray<Y.Map<unknown>>(BLOCKS_KEY);
}

let idCounter = 0;
/** Monotonic, collision-resistant block id (local-only; never synced as state). */
export function genId(): string {
  idCounter = (idCounter + 1) % 0xffffff;
  const time = Date.now().toString(36);
  const rand = idCounter.toString(36).padStart(2, "0");
  return `b_${time}_${rand}`;
}

export function blockId(block: BlockMap): string {
  return block.get("id") as string;
}

export function blockType(block: BlockMap): BlockType {
  return (block.get("type") as BlockType | undefined) ?? "paragraph";
}

export function isListBlockType(type: BlockType): type is ListBlockType {
  return type === "bullet-list" || type === "ordered-list" || type === "todo-list";
}

export function normalizeListLevel(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.max(0, Math.min(MAX_LIST_LEVEL, n));
}

export function blockListLevel(block: BlockMap): number {
  return normalizeListLevel(blockAttrs(block)[LIST_LEVEL_ATTR]);
}

/** Whether a todo-list item is checked (its `checked` attr is truthy). */
export function blockTodoChecked(block: BlockMap): boolean {
  return blockAttrs(block)[TODO_CHECKED_ATTR] === true;
}

/** A heading block's level (1–3), 1 for non-headings or when unset. */
export function blockHeadingLevel(block: BlockMap): number {
  return normalizeHeadingLevel(blockAttrs(block)[HEADING_LEVEL_ATTR]);
}

export function listInsetLeft(level: number): number {
  return LIST_MARKER_GUTTER_PX + normalizeListLevel(level) * LIST_NEST_STEP_PX;
}

export function blockText(block: BlockMap): Y.Text {
  return block.get("text") as Y.Text;
}

/** A block's `attrs` map as a plain object (e.g. an image's src/ratio). */
export function blockAttrs(block: BlockMap): Record<string, unknown> {
  const attrs = block.get("attrs");
  if (attrs instanceof Y.Map) return attrs.toJSON() as Record<string, unknown>;
  return {};
}

/** Construct a detached block `Y.Map` (insert it into a `BlockArray` to attach). */
export function createBlock(
  type: BlockType = "paragraph",
  text = "",
  id: string = genId(),
  attrs?: Record<string, unknown>,
): BlockMap {
  const map = new Y.Map<unknown>();
  map.set("id", id);
  map.set("type", type);
  const ytext = new Y.Text();
  if (text.length > 0) ytext.insert(0, text);
  map.set("text", ytext);
  const attrMap = new Y.Map<unknown>();
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) attrMap.set(k, v);
  }
  map.set("attrs", attrMap);
  return map;
}

/** Create a fresh note `Y.Doc` seeded with the given blocks (or one empty paragraph). */
export function createNoteDoc(
  initial?: Array<{ type?: BlockType; text: string; attrs?: Record<string, unknown> }>,
): Y.Doc {
  const doc = new Y.Doc();
  const blocks = getBlocks(doc);
  const seed = initial && initial.length > 0 ? initial : [{ text: "" }];
  doc.transact(() => {
    blocks.push(seed.map((b) => createBlock(b.type ?? "paragraph", b.text, genId(), b.attrs)));
  });
  return doc;
}

/** Read a plain snapshot of every block (for export/debugging). */
export function snapshotBlocks(doc: Y.Doc): BlockSnapshot[] {
  const blocks = getBlocks(doc);
  const out: BlockSnapshot[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks.get(i);
    out.push({
      id: blockId(block),
      type: blockType(block),
      text: blockText(block).toString(),
    });
  }
  return out;
}
