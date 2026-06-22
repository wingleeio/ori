import { createNoteDoc } from "@wingleeio/ori-core";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { EditorPane } from "@/components/EditorPane";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { generateNote, longNoteMetas, stressDoc, welcomeDoc } from "@/lib/seed";
import {
  deriveTitle,
  genNoteId,
  hasDoc,
  loadDoc,
  loadIndex,
  removeDoc,
  saveDoc,
  saveIndex,
  type NoteMeta,
} from "@/lib/storage";

/** Seed demo notes on first run; otherwise restore the saved index. */
function bootstrap(): NoteMeta[] {
  const existing = loadIndex();
  if (existing.length > 0) return existing;

  const now = Date.now();
  const welcomeId = genNoteId();
  const stressId = genNoteId();
  const welcome = welcomeDoc();
  const stress = stressDoc(2000);
  saveDoc(welcomeId, welcome);
  saveDoc(stressId, stress);

  const index: NoteMeta[] = [
    { id: welcomeId, title: deriveTitle(welcome), updatedAt: now },
    { id: stressId, title: deriveTitle(stress), updatedAt: now - 1000, blocks: 2002 },
    // 100 long notes — docs generated lazily on open (not persisted up front).
    ...longNoteMetas(100, now - 2000),
  ];
  saveIndex(index);
  return index;
}

export function App() {
  const [notes, setNotes] = useState<NoteMeta[]>(bootstrap);
  const [activeId, setActiveId] = useState<string>(() => notes[0]?.id ?? "");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [load, setLoad] = useState<{ ms: number; blocks: number } | null>(null);

  const docCache = useRef(new Map<string, Y.Doc>());
  const openStart = useRef(0);
  // Refs so the global key handler doesn't need to re-subscribe constantly.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  /** Get the active doc: from cache, then storage, else generate from recipe. */
  const ensureDoc = useCallback((meta: NoteMeta): Y.Doc => {
    const cache = docCache.current;
    const cached = cache.get(meta.id);
    if (cached) return cached;
    // Keep only one note Y.Doc in memory (per the design) — also makes each
    // visit a real load, so the timing badge is honest.
    cache.clear();
    let doc: Y.Doc;
    if (hasDoc(meta.id)) doc = loadDoc(meta.id);
    else if (meta.blocks) doc = generateNote(meta);
    else doc = createNoteDoc();
    cache.set(meta.id, doc);
    return doc;
  }, []);

  const selectNote = useCallback((id: string) => {
    openStart.current = performance.now();
    setActiveId(id);
  }, []);

  const updateMeta = useCallback((id: string, patch: Partial<NoteMeta>) => {
    setNotes((prev) =>
      prev
        .map((n) => (n.id === id ? { ...n, ...patch } : n))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }, []);

  const handleMounted = useCallback((blocks: number) => {
    if (openStart.current > 0) setLoad({ ms: performance.now() - openStart.current, blocks });
  }, []);

  useEffect(() => {
    saveIndex(notes);
  }, [notes]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Option/Alt + ↑/↓ jumps to the previous/next note from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const list = notesRef.current;
      const idx = list.findIndex((n) => n.id === activeIdRef.current);
      if (idx < 0) return;
      const nextIdx =
        e.key === "ArrowDown" ? Math.min(idx + 1, list.length - 1) : Math.max(idx - 1, 0);
      const next = list[nextIdx];
      if (next && next.id !== activeIdRef.current) selectNote(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectNote]);

  const createNote = useCallback(() => {
    const id = genNoteId();
    const doc = createNoteDoc();
    docCache.current.set(id, doc);
    saveDoc(id, doc);
    setNotes((prev) => [{ id, title: "Untitled", updatedAt: Date.now() }, ...prev]);
    setActiveId(id);
  }, []);

  // Stable identity (reads live state via refs) so memoized note rows aren't
  // invalidated on every selection — keeping the sidebar off the open path.
  const deleteNote = useCallback((id: string) => {
    removeDoc(id);
    docCache.current.delete(id);
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (activeIdRef.current === id) {
      const remaining = notesRef.current.filter((n) => n.id !== id);
      setActiveId(remaining[0]?.id ?? "");
    }
  }, []);

  const activeMeta = notes.find((n) => n.id === activeId) ?? null;
  const activeDoc = activeMeta ? ensureDoc(activeMeta) : null;

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        notes={notes}
        activeId={activeId}
        onSelect={selectNote}
        onCreate={createNote}
        onDelete={deleteNote}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <main className="relative flex min-w-0 flex-1 flex-col">
        {activeDoc && activeMeta ? (
          <EditorPane
            key={activeMeta.id}
            noteId={activeMeta.id}
            doc={activeDoc}
            onMeta={updateMeta}
            onMounted={handleMounted}
          />
        ) : (
          <div className="grid flex-1 place-items-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <FileText className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">No note selected</p>
              <Button size="sm" onClick={createNote}>
                Create a note
              </Button>
            </div>
          </div>
        )}

        {load ? (
          <div className="pointer-events-none absolute bottom-4 right-4 rounded-full bg-card/70 px-3 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border/40 backdrop-blur">
            opened{" "}
            <span className="font-medium tabular-nums text-foreground">
              {load.blocks.toLocaleString()}
            </span>{" "}
            blocks in{" "}
            <span className="font-medium tabular-nums text-foreground">{load.ms.toFixed(0)} ms</span>
          </div>
        ) : null}
      </main>
    </div>
  );
}
