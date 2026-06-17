import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2021",
  treeshake: true,
  external: ["react", "react-dom", "yjs", "@wingleeio/ori-core", "@wingleeio/ori-pretext"],
});
