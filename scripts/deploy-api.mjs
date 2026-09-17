// Uses the same static-assets upload API and content hashes as Wrangler.
// This path avoids Windows sandbox limitations in Wrangler's esbuild subprocess.
import fs from "node:fs";
import path from "node:path";
import { hash } from "blake3-wasm";
const config = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
const token =
  process.env.CLOUDFLARE_API_TOKEN ||
  fs
    .readFileSync(
      path.join(process.env.XDG_CONFIG_HOME, ".wrangler/config/default.toml"),
      "utf8",
    )
    .match(/oauth_token\s*=\s*"([^"]+)"/)?.[1];
if (!token) throw new Error("Cloudflare login required");
const base = `/accounts/${config.account_id}/workers`;
export async function api(endpoint, method = "GET", body, auth = token) {
  const headers = { Authorization: `Bearer ${auth}` };
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const r = await fetch("https://api.cloudflare.com/client/v4" + endpoint, {
    method,
    headers,
    body,
  });
  const j = await r.json();
  if (!j.success) throw new Error(JSON.stringify(j.errors));
  return j.result;
}
const root = config.assets.directory,
  manifest = {},
  files = {};
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else {
      const bytes = fs.readFileSync(file);
      const id = hash(bytes.toString("base64") + path.extname(file).slice(1))
        .toString("hex")
        .slice(0, 32);
      manifest["/" + path.relative(root, file).split(path.sep).join("/")] = {
        hash: id,
        size: bytes.length,
      };
      files[id] = { bytes, file };
    }
  }
}
walk(root);
const session = await api(
  `${base}/scripts/${config.name}/assets-upload-session`,
  "POST",
  { manifest },
);
let jwt = session.jwt;
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
for (const bucket of session.buckets) {
  const form = new FormData();
  for (const id of bucket) {
    const item = files[id];
    form.append(
      id,
      new File([item.bytes.toString("base64")], id, {
        type: types[path.extname(item.file)] || "application/octet-stream",
      }),
      id,
    );
  }
  const uploaded = await api(
    `${base}/assets/upload?base64=true`,
    "POST",
    form,
    session.jwt,
  );
  if (uploaded.jwt) jwt = uploaded.jwt;
}
const bindings = [
  { name: 'AI', type: 'ai' },
  { name: "DB", type: "d1", id: config.d1_databases[0].database_id },
  { name: "ASSETS", type: "assets" },
  ...Object.entries(config.vars).map(([name, text]) => ({
    name,
    type: "plain_text",
    text,
  })),
];
const form = new FormData();
form.set(
  "metadata",
  JSON.stringify({
    main_module: "worker.mjs",
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
    bindings,
    keep_bindings: ["secret_text"],
    assets: {
      jwt,
      config: {
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*"],
      },
    },
    observability: config.observability,
  }),
);
form.set(
  "worker.mjs",
  new File([fs.readFileSync(config.main)], "worker.mjs", {
    type: "application/javascript+module",
  }),
);
const deployed = await api(`${base}/scripts/${config.name}`, "PUT", form);
await api(`${base}/scripts/${config.name}/subdomain`, "POST", {
  enabled: true,
  previews_enabled: false,
});
await api(
  `${base}/scripts/${config.name}/schedules`,
  "PUT",
  config.triggers.crons.map((cron) => ({ cron })),
);
const subdomain = await api(`${base}/subdomain`);
console.log(
  JSON.stringify({
    name: config.name,
    version: deployed.id,
    url: `https://${config.name}.${subdomain.subdomain}.workers.dev`,
    assets: Object.keys(manifest).length,
  }),
);
