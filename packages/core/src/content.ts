import * as Y from "yjs";
import { marksToAttributes } from "./delta";
import type { ContentBlock } from "./markdown";
import { createBlock, genId, getBlocks, REMOTE_ORIGIN } from "./schema";

/**
 * Build a fresh note `Y.Doc` from plain {@link ContentBlock}s (e.g. the output
 * of `markdownToBlocks`). The inverse of the controller's `getContentBlocks`.
 * Applied under {@link REMOTE_ORIGIN} so hydration is never locally undoable.
 */
export function docFromContent(blocks: ContentBlock[]): Y.Doc {
  const doc = new Y.Doc();
  const arr = getBlocks(doc);
  const source = blocks.length > 0 ? blocks : [{ type: "paragraph", items: [] } as ContentBlock];
  doc.transact(() => {
    for (const b of source) {
      const block = createBlock(b.type, "", genId(), b.attrs);
      arr.push([block]);
      const text = block.get("text") as Y.Text;
      let pos = 0;
      for (const item of b.items) {
        if (item.atom) {
          text.insertEmbed(pos, item.atom.data ?? { type: item.atom.type });
          pos += 1;
        } else if (item.text) {
          text.insert(pos, item.text, item.marks ? marksToAttributes(item.marks) : undefined);
          pos += item.text.length;
        }
      }
    }
  }, REMOTE_ORIGIN);
  return doc;
}
