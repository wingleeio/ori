import { NoteEditor, useEditor, type NoteEditorHandle } from "@wingleeio/ori-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { FindBar } from "@/components/FindBar";
import { MentionMenu } from "@/components/MentionMenu";
import { SelectionMenu } from "@/components/SelectionMenu";
import { SlashMenu } from "@/components/SlashMenu";
import { atomRenderers, blockRenderers, editorNodes } from "@/lib/nodes";
import { deriveTitle, saveDoc, type NoteMeta } from "@/lib/storage";

export interface EditorPaneProps {
  noteId: string;
  doc: Y.Doc;
  onMeta: (id: string, patch: Partial<NoteMeta>) => void;
  /** Called once after the first layout, with the block count (for load timing). */
  onMounted?: (blockCount: number) => void;
}

/**
 * Hosts one note's editor: the virtualized surface plus its floating slash and
 * selection menus. Persists the Y.Doc (debounced) and keeps the note's
 * title/timestamp in sync with content.
 */
export function EditorPane({ noteId, doc, onMeta, onMounted }: EditorPaneProps) {
  const editor = useEditor({ doc, schema: editorNodes });
  const editorRef = useRef<NoteEditorHandle>(null);
  const [findOpen, setFindOpen] = useState(false);

  useLayoutEffect(() => {
    onMounted?.(editor.getSnapshot().blockCount);
    // Only on mount of this note instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      timer = undefined;
      saveDoc(noteId, doc);
      onMeta(noteId, { title: deriveTitle(doc), updatedAt: Date.now() });
    };
    const handler = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(persist, 350);
    };
    doc.on("update", handler);
    return () => {
      doc.off("update", handler);
      if (timer) {
        clearTimeout(timer);
        persist(); // flush a pending save before unmount (e.g. fast note switch)
      }
    };
  }, [doc, noteId, onMeta]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <NoteEditor
        ref={editorRef}
        editor={editor}
        autoFocus
        placeholder="Write, or press / for commands…"
        maxWidth={720}
        className="min-h-0 flex-1"
        blockRenderers={blockRenderers}
        atomRenderers={atomRenderers}
        onLinkShortcut={() => {
          const url = window.prompt("Link URL", editor.getActiveLink() ?? "");
          if (url === null) return; // cancelled
          if (url.trim()) editor.setLink(url);
          else editor.removeLink();
          editorRef.current?.focus();
        }}
        keymap={{
          "Mod-f": () => {
            setFindOpen(true);
            return true;
          },
        }}
      />
      <FindBar editor={editor} editorRef={editorRef} open={findOpen} onClose={() => setFindOpen(false)} />
      <SelectionMenu editor={editor} editorRef={editorRef} />
      <SlashMenu editor={editor} editorRef={editorRef} />
      <MentionMenu editor={editor} editorRef={editorRef} />
    </div>
  );
}
