import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import worker from "../worker/index.mjs";
import { safeUrl, dateWindow } from "../worker/common.mjs";
import { parseFeed, relevant } from "../worker/providers.mjs";
import { validateAnalysis } from "../worker/briefs.mjs";
import { evidenceGuard } from "../worker/evidence.mjs";
function environment() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    fs.readFileSync(
      new URL("../migrations/0001_initial.sql", import.meta.url),
      "utf8",
    ),
  );
  const prepare = (sql) => {
    let args = [];
    const statement = () => db.prepare(sql);
    return {
      bind(...values) {
        args = values;
        return this;
      },
      async all() {
        return { results: statement().all(...args) };
      },
      async first() {
        return statement().get(...args) || null;
      },
      async run() {
        const r = statement().run(...args);
        return {
          meta: {
            changes: Number(r.changes),
            last_row_id: Number(r.lastInsertRowid),
          },
        };
      },
    };
  };
  return {
    DB: {
      prepare,
      async batch(items) {
        db.exec("BEGIN");
        try {
          const out = [];
          for (const item of items) out.push(await item.run());
          db.exec("COMMIT");
          return out;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
    ADMIN_PASSWORD: "test-password-only",
    ASSETS: { fetch: () => new Response("asset") },
    db,
  };
}
function client(env) {
  let cookies = {};
  let csrf = "";
  return {
    async request(path, method = "GET", data, extra = {}) {
      const headers = {
        Cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        Origin: "https://news.example.com",
        ...extra,
      };
      if (method !== "GET") headers["X-CSRF-TOKEN"] = csrf;
      let body;
      if (data !== undefined) {
        if (path === "/api/auth/login") {
          body = new URLSearchParams(data);
          headers["Content-Type"] = "application/x-www-form-urlencoded";
        } else {
          body = JSON.stringify(data);
          headers["Content-Type"] = "application/json";
        }
      }
      const r = await worker.fetch(
        new Request("https://news.example.com" + path, {
          method,
          headers,
          body,
        }),
        env,
      );
      for (const c of r.headers.getSetCookie()) {
        const [k, v] = c.split(";")[0].split("=");
        cookies[k] = v;
      }
      const raw = await r.text();
      const value = raw ? JSON.parse(raw) : null;
      if (path === "/api/auth/csrf") csrf = value.token;
      return { status: r.status, data: value, headers: r.headers };
    },
    async login() {
      await this.request("/api/auth/csrf");
      return this.request("/api/auth/login", "POST", {
        password: env.ADMIN_PASSWORD,
      });
    },
  };
}
test("authentication, CSRF, separate sessions and logout", async () => {
  const env = environment(),
    a = client(env),
    b = client(env);
  assert.equal((await a.request("/api/articles")).status, 401);
  assert.equal((await a.request("/api/auth/login", "POST", {})).status, 403);
  assert.equal((await a.login()).status, 200);
  assert.equal((await b.login()).status, 200);
  assert.equal(
    (
      await a.request(
        "/api/watchlists",
        "POST",
        { name: "bad" },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal((await a.request("/api/auth/logout", "POST")).status, 204);
  assert.equal((await a.request("/api/articles")).status, 401);
  assert.equal((await b.request("/api/articles")).status, 200);
  env.db.close();
});
test("missing configuration fails closed and login attempts are limited", async () => {
  const env = environment(),
    a = client(env);
  await a.request("/api/auth/csrf");
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await a.request("/api/auth/login", "POST", {
          username: "test-user",
          password: "wrong",
        })
      ).status,
      401,
    );
  assert.equal((await a.request("/api/auth/login", "POST", {})).status, 429);
  env.ADMIN_PASSWORD = "";
  assert.equal((await a.request("/api/auth/login", "POST", {})).status, 503);
  env.db.close();
});
test("shared CRUD, uniqueness, feed pagination and Shanghai brief window", async () => {
  const env = environment(),
    a = client(env),
    b = client(env);
  await a.login();
  await b.login();
  let r = await a.request("/api/watchlists", "POST", { name: "储能" });
  const w = r.data.id;
  const k = (
    await a.request(`/api/watchlists/${w}/keywords`, "POST", {
      keyword: "battery",
    })
  ).data.id;
  assert.equal(
    (await b.request("/api/watchlists")).data[0].keywords[0].keyword,
    "battery",
  );
  assert.equal(
    (
      await a.request(`/api/watchlists/${w}/keywords`, "POST", {
        keyword: "BATTERY",
      })
    ).status,
    409,
  );
  const source = (
    await a.request("/api/sources", "POST", {
      name: "Test source",
      url: "https://example.org/feed",
      type: "RSS",
      priority: "HIGH",
    })
  ).data.id;
  for (const [i, time] of [
    "2026-09-16T15:59:59Z",
    "2026-09-16T16:00:00Z",
    "2026-09-17T15:59:59Z",
    "2026-09-17T16:00:00Z",
  ].entries()) {
    assert.equal(
      (
        await a.request("/api/articles", "POST", {
          sourceId: source,
          title: `Battery storage ${i}`,
          url: `https://example.org/news/${i}`,
          publishedAt: time,
        })
      ).status,
      201,
    );
  }
  const page = (await b.request("/api/articles?size=2&page=1")).data;
  assert.equal(page.totalElements, 4);
  assert.equal(page.content.length, 2);
  assert.equal(page.last, true);
  assert.deepEqual(page.content[0].tags, ["battery"]);
  assert.equal((await a.request("/api/articles?size=0")).status, 400);
  const brief = (
    await a.request("/api/daily-briefs/generate", "POST", {
      watchlistId: w,
      date: "2026-09-17",
    })
  ).data;
  assert.equal(brief.itemCount, 2);
  assert.equal(brief.windowStart, "2026-09-16T16:00:00.000Z");
  assert.equal(brief.items[0].matchingKeywordCount, 1);
  await b.request(`/api/keywords/${k}`, "PATCH", { enabled: false });
  assert.deepEqual((await a.request("/api/articles")).data.content[0].tags, []);
  await b.request(`/api/watchlists/${w}`, "DELETE");
  assert.equal((await a.request("/api/watchlists")).data.length, 0);
  assert.equal(
    env.db.prepare("SELECT COUNT(*) n FROM daily_briefs").get().n,
    0,
  );
  env.db.close();
});
test("missing providers are explicit; user data is not fabricated", async () => {
  const env = environment(),
    a = client(env);
  await a.login();
  const w = (await a.request("/api/watchlists", "POST", { name: "BESS" })).data
    .id;
  assert.equal(
    (
      await a.request("/api/watchlist-discovery/run", "POST", {
        watchlistId: w,
        from: "2026-09-16",
        to: "2026-09-17",
      })
    ).status,
    503,
  );
  assert.equal(
    (await a.request("/api/daily-briefs/1/analysis/generate", "POST")).status,
    503,
  );
  assert.equal((await a.request("/api/articles")).data.totalElements, 0);
  env.db.close();
});
test("RSS normalizes HTML, rejects external entities, filters irrelevant items", () => {
  const rows = parseFeed(
    "<rss><channel><item><title>Battery storage</title><link>https://example.org/a</link><description><![CDATA[<p>Clean <b>energy</b></p>]]></description></item></channel></rss>",
  );
  assert.equal(rows[0].description, "Clean energy");
  assert.equal(relevant(rows[0]), true);
  assert.equal(
    relevant({ title: "New phone battery", description: "" }),
    false,
  );
  assert.throws(() => parseFeed("<!DOCTYPE rss><rss/>"));
});
test("URLs and dates reject unsafe or invalid values", () => {
  for (const value of [
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://user:pass@example.com",
    "https://localhost",
    "https://a.internal",
    "https://news.caryaenergy.com/api",
  ])
    assert.throws(() => safeUrl(value));
  assert.equal(
    safeUrl("https://example.org/a?utm_source=x&b=1#top"),
    "https://example.org/a?b=1",
  );
  assert.throws(() => dateWindow("2026-02-31"));
  assert.throws(() => dateWindow("invalid"));
});
test("AI output cannot reference nonexistent articles", () => {
  const brief = { items: [{ articleId: 1 }] },
    result = {
      headline: "Headline",
      overview: "Summary",
      events: [
        {
          title: "Title",
          summary: "Summary",
          whyItMatters: "推断：示例",
          supportingArticleIds: [2],
        },
      ],
    };
  assert.throws(() => validateAnalysis(result, brief));
  result.events[0].supportingArticleIds = [1];
  assert.equal(validateAnalysis(result, brief).events[0].rank, 1);
});
test("AI monetary guard and uncertain reporting survive migration", () => {
  const items = [
    {
      articleId: 1,
      title: "Company plans $10 million battery plant",
      description: "Proposed facility",
    },
  ];
  const result = {
    headline: "Company plans plant",
    overview: "The proposed plant may proceed.",
    events: [
      {
        title: "Company plans plant",
        summary: "The planned investment is $10 million.",
        supportingArticleIds: [1],
      },
    ],
  };
  assert.doesNotThrow(() => evidenceGuard(result, items));
  result.events[0].summary = "The planned investment is $10 billion.";
  assert.throws(() => evidenceGuard(result, items));
  result.events[0].summary = "The investment is $10 million.";
  result.events[0].title = "Company builds plant";
  assert.throws(() => evidenceGuard(result, items));
});

test("passphrase-only sign-in matches tools case handling and rejects empty input", async () => {
  const env = environment(), a = client(env);
  await a.request('/api/auth/csrf');
  assert.equal((await a.request('/api/auth/login','POST',{password:''})).status,401);
  assert.equal((await a.request('/api/auth/login','POST',{password:env.ADMIN_PASSWORD.toUpperCase()})).status,200);
  assert.equal((await a.request('/api/auth/me')).data.authenticated,true);
  env.db.close();
});
