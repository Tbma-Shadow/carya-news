import { first, run, json, HttpError } from "./common.mjs";
const encoder = new TextEncoder();
export async function digest(s) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
function cookies(r) {
  return Object.fromEntries(
    (r.headers.get("Cookie") || "")
      .split(";")
      .map((x) => x.trim().split(/=(.*)/s).slice(0, 2)),
  );
}
function cookie(name, value, maxAge, request) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function current(request, env) {
  const token = cookies(request).carya_news_session;
  if (!token) return null;
  return first(
    env.DB,
    "SELECT username FROM sessions WHERE token_hash=? AND expires_at>?",
    await digest(token),
    Date.now(),
  );
}
export async function checkCsrf(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new HttpError(403, "请求来源不匹配");
  const token = cookies(request).carya_news_csrf;
  if (
    !token ||
    token.length !== 64 ||
    request.headers.get("X-CSRF-TOKEN") !== token
  )
    throw new HttpError(403, "页面凭证已过期，请刷新后重试");
}
export async function authRoute(request, env, path) {
  if (path === "/api/auth/csrf" && request.method === "GET") {
    const token =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    return json({ token, headerName: "X-CSRF-TOKEN" }, 200, {
      "Set-Cookie": cookie("carya_news_csrf", token, 86400, request),
    });
  }
  if (path === "/api/auth/login" && request.method === "POST") {
    if (!env.ADMIN_PASSWORD || !env.ADMIN_USERNAME)
      throw new HttpError(503, "管理员尚未配置登录账号");
    const key = await digest(
      request.headers.get("CF-Connecting-IP") || "local",
    );
    const time = Date.now();
    await run(env.DB, "DELETE FROM login_attempts WHERE expires_at<?", time);
    const attempt = await first(
      env.DB,
      "SELECT * FROM login_attempts WHERE key=?",
      key,
    );
    if (attempt?.attempts >= 10)
      throw new HttpError(429, "尝试次数过多，请 15 分钟后重试");
    const raw = await request.text();
    if (raw.length > 2048) throw new HttpError(400, "登录信息过长");
    const form = new URLSearchParams(raw);
    const valid =
      (await digest(form.get("username") || "")) ===
        (await digest(env.ADMIN_USERNAME)) &&
      (await digest(form.get("password") || "")) ===
        (await digest(env.ADMIN_PASSWORD));
    if (!valid) {
      await run(
        env.DB,
        "INSERT INTO login_attempts(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1",
        key,
        time + 15 * 60000,
      );
      throw new HttpError(401, "用户名或密码错误");
    }
    await run(env.DB, "DELETE FROM login_attempts WHERE key=?", key);
    await run(env.DB, "DELETE FROM sessions WHERE expires_at<?", time);
    const token = crypto.randomUUID() + crypto.randomUUID();
    await run(
      env.DB,
      "INSERT INTO sessions VALUES(?,?,?)",
      await digest(token),
      env.ADMIN_USERNAME,
      time + 7 * 86400000,
    );
    return json({ authenticated: true, username: env.ADMIN_USERNAME }, 200, {
      "Set-Cookie": cookie("carya_news_session", token, 7 * 86400, request),
    });
  }
  if (path === "/api/auth/me" && request.method === "GET") {
    const user = await current(request, env);
    if (!user) throw new HttpError(401, "请先登录");
    return json({ authenticated: true, username: user.username });
  }
  if (path === "/api/auth/logout" && request.method === "POST") {
    await run(
      env.DB,
      "DELETE FROM sessions WHERE token_hash=?",
      await digest(cookies(request).carya_news_session || ""),
    );
    return new Response(null, {
      status: 204,
      headers: {
        "Set-Cookie": cookie("carya_news_session", "", 0, request),
        "Cache-Control": "no-store",
      },
    });
  }
  return null;
}
