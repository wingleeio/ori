import { createMDX } from "fumadocs-mdx/next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  // The live demo's EditorController owns long-lived Yjs subscriptions; StrictMode's
  // dev-only mount/unmount/remount would tear them down. (Prod is unaffected.)
  reactStrictMode: false,
  transpilePackages: ["@wingleeio/ori-react", "@wingleeio/ori-core", "@wingleeio/ori-pretext"],
  webpack: (cfg) => {
    // Dedupe yjs to one instance so `instanceof Y.Text/Y.Map` checks inside
    // @wingleeio/ori-core match the docs app's Y.Doc.
    cfg.resolve.alias = {
      ...cfg.resolve.alias,
      yjs: path.resolve(dir, "node_modules/yjs"),
    };
    return cfg;
  },
};

export default withMDX(config);
