import * as Y from "yjs";

/** The built-in block kinds. */
export type BuiltinBlockType = "paragraph" | "heading" | "quote" | "code";

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
): BlockMap {
  const map = new Y.Map<unknown>();
  map.set("id", id);
  map.set("type", type);
  const ytext = new Y.Text();
  if (text.length > 0) ytext.insert(0, text);
  map.set("text", ytext);
  map.set("attrs", new Y.Map<unknown>());
  return map;
}

/** Create a fresh note `Y.Doc` seeded with the given blocks (or one empty paragraph). */
export function createNoteDoc(
  initial?: Array<{ type?: BlockType; text: string }>,
): Y.Doc {
  const doc = new Y.Doc();
  const blocks = getBlocks(doc);
  const seed = initial && initial.length > 0 ? initial : [{ text: "" }];
  doc.transact(() => {
    blocks.push(seed.map((b) => createBlock(b.type ?? "paragraph", b.text)));
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
