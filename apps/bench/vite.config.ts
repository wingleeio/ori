import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

// Alias the ori packages to their TypeScript sources so the benchmark measures
// the current source (identical to the published packages). The competitor
// editors are used from their published npm builds.
const pkg = (name: string) => path.resolve(__dirname, `../../packages/${name}/src/index.ts`);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@wingleeio\/ori-pretext$/, replacement: pkg("pretext") },
      { find: /^@wingleeio\/ori-core$/, replacement: pkg("core") },
      { find: /^@wingleeio\/ori-react$/, replacement: pkg("react") },
    ],
    dedupe: ["yjs", "react", "react-dom"],
  },
  server: { port: 5175 },
});
