import * as Y from "yjs";

/** Encode the full document state as a binary Yjs update. */
export function encodeDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Apply a binary Yjs update (local restore or remote sync) to a doc. */
export function applyUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update);
}

/** Build a `Y.Doc` and hydrate it from a stored update, if any. */
export function docFromUpdate(update?: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc();
  if (update && update.byteLength > 0) Y.applyUpdate(doc, update);
  return doc;
}

/** Base64-encode bytes (browser-safe, no Node Buffer dependency). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decode a base64 string into bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
