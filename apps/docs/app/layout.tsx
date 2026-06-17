import "./global.css";
import { RootProvider } from "fumadocs-ui/provider";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const DESCRIPTION =
  "A local-first, virtualized note editor: Y.Doc is canonical state, Pretext computes layout, and only on-screen blocks ever become DOM.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Ori — a virtualized note editor",
    template: "%s · Ori",
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Ori",
    title: "Ori — a virtualized note editor",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "Ori — a virtualized note editor",
    description: DESCRIPTION,
  },
};

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..700&family=Hanken+Grotesk:wght@400..700&family=JetBrains+Mono:wght@400;500;600&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
