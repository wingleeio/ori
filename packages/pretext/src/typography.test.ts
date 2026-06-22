import { describe, expect, it } from "vitest";
import { DEFAULT_TYPOGRAPHY, lineHeightPx, resolveFont, typographyKey } from "./typography";

describe("typography", () => {
  it("lineHeightPx is the exact (unrounded) fontSize * lineHeight", () => {
    expect(lineHeightPx({ ...DEFAULT_TYPOGRAPHY, fontSize: 16, lineHeight: 1.7 })).toBeCloseTo(27.2, 5);
    expect(lineHeightPx({ ...DEFAULT_TYPOGRAPHY, fontSize: 20, lineHeight: 1.5 })).toBe(30);
  });

  it("typographyKey changes when any measured field changes", () => {
    const base = DEFAULT_TYPOGRAPHY;
    const k = typographyKey(base);
    expect(typographyKey({ ...base })).toBe(k);
    expect(typographyKey({ ...base, fontSize: 17 })).not.toBe(k);
    expect(typographyKey({ ...base, fontWeight: 500 })).not.toBe(k);
    expect(typographyKey({ ...base, lineHeight: 1.6 })).not.toBe(k);
    expect(typographyKey({ ...base, letterSpacing: 1 })).not.toBe(k);
    expect(typographyKey({ ...base, fontFamily: "Other" })).not.toBe(k);
  });

  it("resolveFont applies marks and keeps line height constant", () => {
    const base = DEFAULT_TYPOGRAPHY;
    expect(resolveFont(base, {}).fontWeight).toBe(base.fontWeight);
    expect(resolveFont(base, { bold: true }).fontWeight).toBe(700);
    expect(resolveFont(base, { italic: true }).italic).toBe(true);

    const code = resolveFont(base, { code: true });
    expect(code.fontFamily).toBe(base.monoFamily);
    expect(code.fontSize).toBeLessThan(base.fontSize);

    expect(resolveFont(base, { bold: true }).lineHeight).toBe(resolveFont(base, {}).lineHeight);
    expect(resolveFont(base, { code: true }).css).toContain("px");
  });
});
