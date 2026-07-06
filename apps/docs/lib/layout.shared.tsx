import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

const navTitle = (
  <span className="ff-display inline-flex items-baseline gap-1.5 text-xl font-semibold tracking-tight">
    Ori
    <span className="size-1.5 translate-y-[-1px] rounded-full bg-fd-primary" />
  </span>
);

/** Shared options for the docs sidebar layout (no nav links — the page tree is enough). */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: navTitle },
    // The site ships one theme — black — so a light/dark toggle is noise.
    themeSwitch: { enabled: false },
  };
}

/** Landing-page navbar: keep a single link to the docs. */
export function homeOptions(): BaseLayoutProps {
  return {
    nav: { title: navTitle },
    links: [{ text: "Docs", url: "/docs", active: "nested-url" }],
    themeSwitch: { enabled: false },
  };
}
