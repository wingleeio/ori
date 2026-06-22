/** A realistic ~14-word sentence so every block wraps to a couple of lines —
 *  identical content is fed to every editor for a fair comparison. */
export const SENTENCE =
  "The quiet coastline maps a folded chart of measured lines, marks, and mentions.";

export function paragraphs(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${i + 1}. ${SENTENCE}`);
}
