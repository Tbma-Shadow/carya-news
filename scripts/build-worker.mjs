import { build } from "../frontend/node_modules/rolldown/dist/index.mjs";
await build({
  input: "worker/index.mjs",
  platform: "browser",
  output: {
    file: "build/worker.mjs",
    format: "esm",
    inlineDynamicImports: true,
  },
  resolve: { conditionNames: ["worker", "browser", "import", "default"] },
});
