import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const pkg = (name: string) =>
  path.resolve(__dirname, `../../packages/${name}/src/index.ts`);

// Alias the workspace packages to their TypeScript sources for instant HMR
// without a separate build step. The @wingleeio/ori-* aliases are exact-match
// (regex) so subpath imports like `@wingleeio/ori-react/styles.css` still
// resolve via package exports. yjs/react are deduped so `instanceof` checks
// inside @wingleeio/ori-core see the same constructors as the app.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${path.resolve(__dirname, "src")}/$1` },
      { find: /^@wingleeio\/ori-pretext$/, replacement: pkg("pretext") },
      { find: /^@wingleeio\/ori-core$/, replacement: pkg("core") },
      { find: /^@wingleeio\/ori-react$/, replacement: pkg("react") },
    ],
    dedupe: ["yjs", "react", "react-dom"],
  },
  server: {
    port: 5173,
  },
});
