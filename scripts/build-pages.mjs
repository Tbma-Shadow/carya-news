import fs from "node:fs";
fs.mkdirSync("pages", { recursive: true });
fs.cpSync("frontend/dist", "pages", { recursive: true });
fs.copyFileSync("build/worker.mjs", "pages/_worker.js");
fs.writeFileSync(
  "pages/_routes.json",
  JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }),
);
const config = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
fs.mkdirSync('pages-deploy', { recursive: true });
fs.writeFileSync('pages-deploy/wrangler.json', JSON.stringify({ name: config.name, pages_build_output_dir:'../pages', compatibility_date:config.compatibility_date, compatibility_flags:config.compatibility_flags, d1_databases:config.d1_databases.map(db => ({...db,migrations_dir:'../migrations'})), vars:config.vars, ai:config.ai }, null, 2));
// Keep Wrangler's ancestor search inside this deployment, even when another
// project higher in the workspace has a generated deploy configuration.
fs.mkdirSync('pages-deploy/.wrangler/deploy', { recursive: true });
fs.writeFileSync('pages-deploy/.wrangler/deploy/config.json', JSON.stringify({configPath:'../../wrangler.json'}));
