import fs from "node:fs";
fs.mkdirSync("pages", { recursive: true });
fs.cpSync("frontend/dist", "pages", { recursive: true });
fs.copyFileSync("build/worker.mjs", "pages/_worker.js");
fs.writeFileSync(
  "pages/_routes.json",
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }),
);
