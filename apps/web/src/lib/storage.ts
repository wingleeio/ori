import {
  base64ToBytes,
  bytesToBase64,
  docFromUpdate,
  encodeDoc,
  snapshotBlocks,
} from "@wingleeio/ori-core";
import type * as Y from "yjs";

export interface NoteMeta {
  id: string;
  title: string;
  updatedAt: number;
  /**
   * For demo "long notes": the recipe size used to generate the doc on demand.
   * Such notes are not persisted until edited — see `App.ensureDoc`.
   */
  blocks?: number;
}

const INDEX_KEY = "ori.notes.index.v4";
const docKey = (id: string) => `ori.notes.doc.${id}`;

export function loadIndex(): NoteMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as NoteMeta[]) : [];
  } catch {
    return [];
  }
}

export function saveIndex(list: NoteMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list));
}

export function hasDoc(id: string): boolean {
  return localStorage.getItem(docKey(id)) !== null;
}

export function loadDoc(id: string): Y.Doc {
  const raw = localStorage.getItem(docKey(id));
  return docFromUpdate(raw ? base64ToBytes(raw) : null);
}

export function saveDoc(id: string, doc: Y.Doc): void {
  try {
    localStorage.setItem(docKey(id), bytesToBase64(encodeDoc(doc)));
  } catch (err) {
    // localStorage quota is easily hit with many large notes — fail soft.
    console.warn("Ori: could not persist note (storage full?)", err);
  }
}

export function removeDoc(id: string): void {
  localStorage.removeItem(docKey(id));
}

/** Derive a human title from the first non-empty block. */
export function deriveTitle(doc: Y.Doc): string {
  for (const block of snapshotBlocks(doc)) {
    const line = block.text.trim().split("\n")[0];
    if (line) return line.slice(0, 80);
  }
  return "Untitled";
}

export function genNoteId(): string {
  return `n_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
