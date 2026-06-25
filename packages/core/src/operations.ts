import * as Y from "yjs";
import { normalizeAttributes } from "./delta";
import type { BlockArray, BlockType } from "./schema";
import {
  blockAttrs,
  blockText,
  blockType,
  createBlock,
  genId,
  isListBlockType,
  blockId as readId,
  TODO_CHECKED_ATTR,
} from "./schema";
import { position, type Position } from "./selection";

interface DeltaOp {
  insert?: string | object;
  attributes?: Record<string, unknown>;
}

/** Extract a rich delta for the half-open range `[from, to)` of a `Y.Text`. */
function sliceText(text: Y.Text, from: number, to: number): DeltaOp[] {
  const full = text.toDelta() as DeltaOp[];
  const out: DeltaOp[] = [];
  let pos = 0;
  for (const op of full) {
    if (typeof op.insert !== "string") {
      // An inline embed (atom, e.g. a mention) occupies exactly one position.
      // Carry it over when it falls in range — otherwise split/merge/delete
      // would silently drop atoms from the moved or retained tail.
      if (pos >= from && pos < to) out.push({ insert: op.insert, attributes: op.attributes });
      pos += 1;
      continue;
    }
    const len = op.insert.length;
    const s = Math.max(from, pos);
    const e = Math.min(to, pos + len);
    if (s < e) {
      out.push({ insert: op.insert.slice(s - pos, e - pos), attributes: op.attributes });
    }
    pos += len;
  }
  return out;
}

/** Apply a rich delta into a `Y.Text` starting at `at`. */
function appendDelta(text: Y.Text, ops: DeltaOp[], at: number): number {
  let pos = at;
  for (const op of ops) {
    if (typeof op.insert === "string") {
      if (op.insert.length > 0) {
        // Explicit attributes so marks don't bleed across op boundaries.
        text.insert(pos, op.insert, normalizeAttributes(op.attributes));
        pos += op.insert.length;
      }
    } else if (op.insert != null) {
      // Re-insert an inline embed (atom) as a single-position embed so it
      // survives being moved across a split/merge/delete.
      text.insertEmbed(pos, op.insert, normalizeAttributes(op.attributes));
      pos += 1;
    }
  }
  return pos;
}

/** Locate a block and its index by id. */
function find(blocks: BlockArray, id: string): { block: Y.Map<unknown>; index: number } | null {
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks.get(i);
    if (readId(b) === id) return { block: b, index: i };
  }
  return null;
}

export function insertText(
  doc: Y.Doc,
  blocks: BlockArray,
  pos: Position,
  text: string,
  attributes?: Record<string, unknown>,
): Position {
  const hit = find(blocks, pos.blockId);
  if (!hit) return pos;
  doc.transact(() => {
    blockText(hit.block).insert(pos.offset, text, attributes);
  });
  return position(pos.blockId, pos.offset + text.length);
}

/** Delete an ordered range `[start, end]`, merging spanned blocks. */
export function deleteRange(
  doc: Y.Doc,
  blocks: BlockArray,
  start: Position,
  end: Position,
): Position {
  const si = find(blocks, start.blockId);
  const ei = find(blocks, end.blockId);
  if (!si || !ei) return start;

  if (si.index === ei.index) {
    const len = end.offset - start.offset;
    if (len > 0) doc.transact(() => blockText(si.block).delete(start.offset, len));
    return position(start.blockId, start.offset);
  }

  doc.transact(() => {
    const startText = blockText(si.block);
    const endText = blockText(ei.block);
    const tail = sliceText(endText, end.offset, endText.length);
    if (startText.length > start.offset) {
      startText.delete(start.offset, startText.length - start.offset);
    }
    blocks.delete(si.index + 1, ei.index - si.index);
    appendDelta(startText, tail, start.offset);
  });
  return position(start.blockId, start.offset);
}

/** Split a block at `offset`, moving the tail (with marks) to a new block. */
export function splitBlock(
  doc: Y.Doc,
  blocks: BlockArray,
  blockId: string,
  offset: number,
): Position {
  const hit = find(blocks, blockId);
  if (!hit) return position(blockId, offset);

  // Headings/quotes continue as paragraphs; code and list items continue.
  const type = hit.block.get("type") as BlockType;
  const nextType: BlockType = type === "code" || isListBlockType(type) ? type : "paragraph";
  // List items carry their nesting level forward, but a continued todo item
  // always starts unchecked — `checked` is per-item, never inherited.
  let nextAttrs: Record<string, unknown> | undefined;
  if (isListBlockType(type)) {
    nextAttrs = blockAttrs(hit.block);
    delete nextAttrs[TODO_CHECKED_ATTR];
  }
  // Capture the id locally: a not-yet-integrated Y.Map returns undefined from
  // .get(), so we must not read the id back off the prelim block.
  const newId = genId();
  const newBlock = createBlock(nextType, "", newId, nextAttrs);

  doc.transact(() => {
    const text = blockText(hit.block);
    const tail = sliceText(text, offset, text.length);
    if (text.length > offset) text.delete(offset, text.length - offset);
    blocks.insert(hit.index + 1, [newBlock]);
    appendDelta(blockText(newBlock), tail, 0);
  });
  return position(newId, 0);
}

/** Merge a block into its predecessor; returns the junction caret (or null). */
export function mergeWithPrevious(
  doc: Y.Doc,
  blocks: BlockArray,
  blockId: string,
): Position | null {
  const hit = find(blocks, blockId);
  if (!hit || hit.index <= 0) return null;

  const prev = blocks.get(hit.index - 1);
  const prevText = blockText(prev);
  const prevLen = prevText.length;
  const curDelta = blockText(hit.block).toDelta() as DeltaOp[];

  doc.transact(() => {
    appendDelta(prevText, curDelta, prevLen);
    blocks.delete(hit.index, 1);
  });
  return position(readId(prev), prevLen);
}

/** Apply or remove a formatting mark across an ordered range `[start, end]`. */
export function formatRange(
  doc: Y.Doc,
  blocks: BlockArray,
  start: Position,
  end: Position,
  mark: string,
  value: unknown,
): void {
  const si = find(blocks, start.blockId);
  const ei = find(blocks, end.blockId);
  if (!si || !ei) return;

  doc.transact(() => {
    for (let i = si.index; i <= ei.index; i += 1) {
      const text = blockText(blocks.get(i));
      const from = i === si.index ? start.offset : 0;
      const to = i === ei.index ? end.offset : text.length;
      if (to > from) text.format(from, to - from, { [mark]: value });
    }
  });
}

/** Change a block's `type` (paragraph / heading / quote / code / custom). */
export function setBlockType(
  doc: Y.Doc,
  blocks: BlockArray,
  blockId: string,
  type: BlockType,
): void {
  const hit = find(blocks, blockId);
  if (!hit) return;
  doc.transact(() => hit.block.set("type", type));
}

/** Insert an inline embed (custom atom) at a text position; returns the caret after it. */
export function insertInlineEmbed(
  doc: Y.Doc,
  blocks: BlockArray,
  pos: Position,
  embed: Record<string, unknown>,
): Position {
  const hit = find(blocks, pos.blockId);
  if (!hit) return pos;
  doc.transact(() => {
    blockText(hit.block).insertEmbed(pos.offset, embed);
  });
  return position(pos.blockId, pos.offset + 1);
}

/** Insert a new (typically atomic) block after `afterId`; returns its caret. */
export function insertBlockAfter(
  doc: Y.Doc,
  blocks: BlockArray,
  afterId: string,
  type: BlockType,
  attrs?: Record<string, unknown>,
): Position {
  const hit = find(blocks, afterId);
  const newId = genId();
  const newBlock = createBlock(type, "", newId);
  doc.transact(() => {
    const index = hit ? hit.index + 1 : blocks.length;
    blocks.insert(index, [newBlock]);
    if (attrs) {
      const attrMap = newBlock.get("attrs") as Y.Map<unknown>;
      for (const [k, v] of Object.entries(attrs)) attrMap.set(k, v);
    }
  });
  return position(newId, 0);
}

export { blockType };
