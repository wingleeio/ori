import type { Marks, ResolvedFont, Typography } from "./types";

/** Sensible default typography for a paragraph block. */
export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily:
    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  monoFamily:
    '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.7,
  letterSpacing: 0,
};

/**
 * A stable string identity for a {@link Typography} value. Any change to a
 * field that affects measurement changes the key, which drives cache
 * invalidation in `@wingleeio/ori-core`.
 */
export function typographyKey(t: Typography): string {
  return [
    t.fontFamily,
    t.monoFamily,
    t.fontSize,
    t.fontWeight,
    t.lineHeight,
    t.letterSpacing,
  ].join("");
}

/** The pixel line-height of a block, constant across inline marks. */
export function lineHeightPx(t: Typography): number {
  return Math.round(t.fontSize * t.lineHeight);
}

/**
 * Resolve a concrete, measurable font for a run given the block typography and
 * the run's inline marks. Code spans use the mono family at a slightly smaller
 * size, but the line box height stays constant so mixed lines don't jitter.
 */
export function resolveFont(base: Typography, marks: Marks = {}): ResolvedFont {
  const italic = !!marks.italic;
  const weight = marks.bold ? 700 : base.fontWeight;
  const family = marks.code ? base.monoFamily : base.fontFamily;
  const size = marks.code ? Math.round(base.fontSize * 0.92) : base.fontSize;
  const style = italic ? "italic " : "";
  return {
    css: `${style}${weight} ${size}px ${family}`,
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    italic,
    lineHeight: lineHeightPx(base),
    letterSpacing: base.letterSpacing,
  };
}
