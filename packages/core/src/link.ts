/**
 * Link URL handling — shared by the editor's link commands and clipboard
 * import so no path can write an unsafe URL into the document.
 */

/** Schemes a link mark may carry. Everything else (javascript:, data:, …) is rejected. */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

/**
 * Normalize user/imported input into a safe link URL.
 *
 * - Explicit schemes are allowlisted (`http`, `https`, `mailto`, `tel`);
 *   anything else — notably `javascript:` and `data:` — returns `null`.
 * - Relative URLs (starting with `/`, `#`, `?` or `.`) pass through.
 * - Bare domains (`example.com/docs`) are prefixed with `https://`.
 * - Empty or non-URL-shaped text returns `null`.
 */
export function sanitizeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (scheme) return SAFE_SCHEMES.has(scheme[1].toLowerCase()) ? url : null;
  if (/^[/#?.]/.test(url)) return url;
  if (!/\s/.test(url) && url.includes(".")) return `https://${url}`;
  return null;
}
