export class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
  }
}
export const now = () => new Date().toISOString();
export const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
export function integer(
  value,
  name = "id",
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new HttpError(400, `${name} 无效`);
  return n;
}
export function text(value, name, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new HttpError(400, `${name}不能为空且不能超过 ${max} 个字符`);
  return value.trim();
}
export async function body(request) {
  if (Number(request.headers.get("Content-Length")) > 65536)
    throw new HttpError(413, "请求过大");
  const raw = await request.text();
  if (raw.length > 65536) throw new HttpError(413, "请求过大");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "请求格式错误");
  }
}
export const all = async (db, sql, ...args) =>
  (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
export const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first();
export const run = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();
export async function required(db, table, id) {
  const row = await first(db, `SELECT * FROM ${table} WHERE id=?`, integer(id));
  if (!row) throw new HttpError(404, "记录不存在");
  return row;
}
export function dateWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || ""))
    throw new HttpError(400, "日期无效");
  const start = new Date(`${date}T00:00:00+08:00`);
  if (
    !Number.isFinite(+start) ||
    new Date(+start + 8 * 3600000).toISOString().slice(0, 10) !== date
  )
    throw new HttpError(400, "日期无效");
  return [start.toISOString(), new Date(+start + 86400000).toISOString()];
}
export const localDate = (offset = 0) =>
  new Date(Date.now() + 8 * 3600000 + offset * 86400000)
    .toISOString()
    .slice(0, 10);
export function safeUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "链接无效");
  }
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !h.includes(".") ||
    /^[\d.]+$/.test(h) ||
    h.includes(":") ||
    h.startsWith("[") ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(h) ||
    h.endsWith(".workers.dev") ||
    h.endsWith(".caryaenergy.com")
  )
    throw new HttpError(400, "只支持公开新闻网站的 HTTPS 链接");
  u.hash = "";
  for (const k of [...u.searchParams.keys()])
    if (k.startsWith("utm_") || ["fbclid", "gclid"].includes(k))
      u.searchParams.delete(k);
  return u.toString();
}
export async function fetchPublic(raw, maxBytes = 2000000) {
  let url = safeUrl(raw);
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent": "CaryaNews/1.0 (+https://news.caryaenergy.com)",
      },
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      url = safeUrl(new URL(r.headers.get("Location"), url));
      continue;
    }
    if (!r.ok) throw new Error(`新闻来源返回 HTTP ${r.status}`);
    if (Number(r.headers.get("Content-Length")) > maxBytes)
      throw new Error("来源内容过大");
    const reader = r.body.getReader();
    let size = 0,
      chunks = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maxBytes) throw new Error("来源内容过大");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return { text: new TextDecoder().decode(out), url };
  }
  throw new Error("来源重定向过多");
}
export function matches(article, keyword) {
  return [article.title, article.description].some((s) =>
    (s || "").toLowerCase().includes(keyword.toLowerCase()),
  );
}
export async function withLock(env, name, fn) {
  const owner = crypto.randomUUID();
  const time = Date.now();
  const r = await run(
    env.DB,
    "INSERT INTO job_locks(name,owner,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE job_locks.expires_at<?",
    name,
    owner,
    time + 15 * 60000,
    time,
  );
  if (!r.meta.changes) throw new HttpError(409, "任务正在运行，请稍后再试");
  try {
    return await fn();
  } finally {
    await run(
      env.DB,
      "DELETE FROM job_locks WHERE name=? AND owner=?",
      name,
      owner,
    );
  }
}
