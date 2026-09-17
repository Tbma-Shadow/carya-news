import {
  all,
  first,
  run,
  required,
  body,
  integer,
  text,
  now,
  json,
  HttpError,
  localDate,
  dateWindow,
  withLock,
} from "./common.mjs";
import { authRoute, current, checkCsrf } from "./auth.mjs";
import { generateWeekly, getWeekly, weeklyDto } from './weekly.mjs';
import { translatePending } from './translation-jobs.mjs';
import {
  sourceDto,
  keywordDto,
  watchlistDto,
  articleDto,
  articlePage,
  createSource,
  ingest,
  patchNamed,
  matchKeyword,
} from "./data.mjs";
import { discoveryRun, discover, postProcess, syncRss } from "./providers.mjs";
import {
  generateBrief,
  briefDto,
  analyzeBrief,
  analysisDto,
} from "./briefs.mjs";
const noContent = () => new Response(null, { status: 204 });
async function api(request, env) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  await checkCsrf(request);
  const auth = await authRoute(request, env, path);
  if (auth) return auth;
  if (!(await current(request, env))) throw new HttpError(401, "请先登录");
  if (path === "/api/health" && method === "GET") return json({ status: "UP" });
  if (path === "/api/system/schedules" && method === "GET")
    return json({
      newsDiscovery: {
        enabled: env.NEWS_DISCOVERY_SCHEDULER_ENABLED === "true",
        cron: "0 0 8 * * *",
        zone: "Asia/Shanghai",
        dailyTime: "08:00",
      },
      dailyBrief: {
        enabled: false,
        cron: "0 10 8 * * *",
        zone: "Asia/Shanghai",
        dailyTime: "08:10",
      },
      weeklyBrief: {
        enabled: env.WEEKLY_BRIEF_SCHEDULER_ENABLED === 'true',
        cron: '10 0 * * MON', zone: 'Asia/Shanghai', dailyTime: '08:10', dayOfWeek: 'MONDAY',
      },
    });
  if (path === "/api/sources") {
    if (method === "GET")
      return json(
        (await all(env.DB, "SELECT * FROM sources ORDER BY id")).map(sourceDto),
      );
    if (method === "POST")
      return json(await createSource(env.DB, await body(request)), 201);
  }
  let match = path.match(/^\/api\/sources\/(\d+)$/);
  if (match && method === "GET")
    return json(sourceDto(await required(env.DB, "sources", match[1])));
  if (path === "/api/articles") {
    if (method === "GET")
      return json(await articlePage(env.DB, url.searchParams));
    if (method === "POST") {
      const result = await ingest(env.DB, await body(request));
      if (!result.saved) throw new HttpError(409, "这篇文章已存在");
      const a = await articleDto(env.DB, result.row);
      return json(
        {
          id: a.id,
          ...a.original,
          url: a.url,
          publishedAt: a.publishedAt,
          collectedAt: a.collectedAt,
          sourceId: a.source.id,
          sourceName: a.source.name,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        },
        201,
      );
    }
  }
  match = path.match(/^\/api\/articles\/(\d+)$/);
  if (match && method === "GET")
    return json(
      await articleDto(env.DB, await required(env.DB, "articles", match[1])),
    );
  if (path === "/api/articles/post-processing/backfill" && method === "POST") {
    const data = await body(request);
    if (!Array.isArray(data.articleIds) || data.articleIds.length !== 1)
      throw new HttpError(400, "每次指定一篇文章");
    return json(
      await withLock(env, `article:${data.articleIds[0]}`, () =>
        postProcess(env, integer(data.articleIds[0])),
      ),
    );
  }
  if (
    [
      "/api/articles/content-backfill",
      "/api/translations/backfill",
      "/api/translations/content-backfill",
    ].includes(path) &&
    method === "POST"
  ) {
    const contentOnly = path === "/api/articles/content-backfill",
      metadata = path === "/api/translations/backfill";
    if (!contentOnly && !env.DEEPL_API_KEY && !env.AI)
      throw new HttpError(503, "翻译服务未配置");
    const limit = integer(
      url.searchParams.get("limit") || (metadata ? 20 : contentOnly ? 5 : 1),
      "limit",
      1,
      20,
    );
    const condition = contentOnly
      ? "a.content IS NULL AND s.content_enrichment_enabled=1"
      : metadata
        ? "s.language='EN' AND (json_extract(a.translation,'$.title') IS NULL OR (a.description IS NOT NULL AND json_extract(a.translation,'$.description') IS NULL))"
        : "s.language='EN' AND a.content IS NOT NULL AND (a.translation IS NULL OR json_extract(a.translation,'$.content') IS NULL)";
    return json(
      await withLock(env, "backfill", async () => {
        const selected = await all(
          env.DB,
          "SELECT a.id FROM articles a JOIN sources s ON s.id=a.source_id WHERE " +
            condition +
            " ORDER BY a.id LIMIT ?",
          limit,
        );
        let success = 0;
        for (const a of selected) {
          const r = await withLock(env, `article:${a.id}`, () => postProcess(env, a.id, {
            metadata,
            extract: contentOnly,
            contentTranslation: !contentOnly && !metadata,
          }));
          if (
            r[
              contentOnly
                ? "contentExtractionStatus"
                : metadata
                  ? "metadataTranslationStatus"
                  : "contentTranslationStatus"
            ] === "SUCCESS"
          )
            success++;
        }
        return {
          selected: selected.length,
          [contentOnly ? "fetched" : "translated"]: success,
          failed: selected.length - success,
        };
      }),
    );
  }
  if (path === "/api/watchlists") {
    if (method === "GET")
      return json(
        await Promise.all(
          (await all(env.DB, "SELECT * FROM watchlists ORDER BY id")).map((r) =>
            watchlistDto(env.DB, r),
          ),
        ),
      );
    if (method === "POST") {
      const data = await body(request),
        t = now();
      const result = await run(
        env.DB,
        "INSERT INTO watchlists(name,created_at,updated_at) VALUES(?,?,?)",
        text(data.name, "关注列表名称"),
        t,
        t,
      );
      return json(
        await watchlistDto(
          env.DB,
          await required(env.DB, "watchlists", result.meta.last_row_id),
        ),
        201,
      );
    }
  }
  match = path.match(/^\/api\/watchlists\/(\d+)$/);
  if (match) {
    const id = integer(match[1]);
    if (method === "GET")
      return json(
        await watchlistDto(env.DB, await required(env.DB, "watchlists", id)),
      );
    if (method === "PATCH")
      return json(
        await watchlistDto(
          env.DB,
          await patchNamed(
            env.DB,
            "watchlists",
            id,
            await body(request),
            "name",
          ),
        ),
      );
    if (method === "DELETE") {
      await required(env.DB, "watchlists", id);
      await run(env.DB, "DELETE FROM watchlists WHERE id=?", id);
      return noContent();
    }
  }
  match = path.match(/^\/api\/watchlists\/(\d+)\/keywords$/);
  if (match && method === "POST") {
    const id = integer(match[1]);
    await required(env.DB, "watchlists", id);
    const data = await body(request),
      t = now();
    const result = await run(
      env.DB,
      "INSERT INTO keywords(watchlist_id,keyword,created_at,updated_at) VALUES(?,?,?,?)",
      id,
      text(data.keyword, "关键词"),
      t,
      t,
    );
    await matchKeyword(env.DB, result.meta.last_row_id);
    return json(
      keywordDto(await required(env.DB, "keywords", result.meta.last_row_id)),
      201,
    );
  }
  match = path.match(/^\/api\/keywords\/(\d+)$/);
  if (match) {
    const id = integer(match[1]);
    if (method === "PATCH")
      return json(
        keywordDto(
          await patchNamed(
            env.DB,
            "keywords",
            id,
            await body(request),
            "keyword",
          ),
        ),
      );
    if (method === "DELETE") {
      await required(env.DB, "keywords", id);
      await run(env.DB, "DELETE FROM keywords WHERE id=?", id);
      return noContent();
    }
  }
  if (path === "/api/watchlist-discovery/run" && method === "POST")
    return json(await discoveryRun(env, await body(request)));
  if (path === "/api/discovery/preview" && method === "GET") {
    const keyword = text(url.searchParams.get("keyword"), "关键词");
    const results = await discover(
      env,
      keyword,
      url.searchParams.get("from") || localDate(-1),
      url.searchParams.get("to") || localDate(),
      integer(url.searchParams.get("limit") || 20, "limit", 1, 50),
    );
    return json({
      provider:
        env.NEWS_DISCOVERY_PROVIDER === "brave"
          ? "brave-news"
          : env.NEWS_DISCOVERY_PROVIDER,
      keyword,
      count: results.length,
      results: results.map((a) => ({
        ...a,
        languageCode: a.language === "ZH_CN" ? "zh" : "en",
      })),
    });
  }
  if (path === "/api/news-sync" && method === "POST")
    return json(await syncRss(env));
  match = path.match(/^\/api\/news-sync\/sources\/(\d+)$/);
  if (match && method === "POST")
    return json(await syncRss(env, integer(match[1])));
  if (path === "/api/daily-briefs/generate" && method === "POST")
    throw new HttpError(410, '日报已停用，请使用每周总结');
  if (path === '/api/weekly-briefs/generate' && method === 'POST')
    return json(await generateWeekly(env, await body(request)));
  if (path === '/api/weekly-briefs' && method === 'GET')
    return json(await getWeekly(env, url.searchParams.get('watchlistId'), url.searchParams.get('date')));
  if (path === '/api/weekly-briefs/history' && method === 'GET')
    return json((await all(env.DB, 'SELECT * FROM weekly_briefs WHERE watchlist_id=? ORDER BY week_start DESC LIMIT 52', integer(url.searchParams.get('watchlistId')))).map(weeklyDto));
  if (path === "/api/daily-briefs" && method === "GET") {
    const id = integer(url.searchParams.get("watchlistId")),
      date = url.searchParams.get("date");
    dateWindow(date);
    const row = await first(
      env.DB,
      "SELECT * FROM daily_briefs WHERE watchlist_id=? AND brief_date=?",
      id,
      date,
    );
    if (!row) throw new HttpError(404, "当日简报尚未生成");
    return json(briefDto(row));
  }
  match = path.match(/^\/api\/daily-briefs\/(\d+)$/);
  if (match && method === "GET")
    return json(briefDto(await required(env.DB, "daily_briefs", match[1])));
  match = path.match(/^\/api\/daily-briefs\/(\d+)\/analysis(\/generate)?$/);
  if (match) {
    const id = integer(match[1]);
    if (match[2] && method === "POST") return json(await analyzeBrief(env, id));
    if (!match[2] && method === "GET") {
      await required(env.DB, "daily_briefs", id);
      return json(
        analysisDto(
          await first(env.DB, "SELECT * FROM analyses WHERE brief_id=?", id),
        ),
      );
    }
  }
  throw new HttpError(404, "接口不存在");
}
export default {
  async fetch(request, env) {
    try {
      let response;
      if (new URL(request.url).pathname.startsWith("/api/"))
        response = await api(request, env);
      else response = await env.ASSETS.fetch(request);
      const secured = new Response(response.body, response);
      secured.headers.set("X-Content-Type-Options", "nosniff");
      secured.headers.set("Referrer-Policy", "same-origin");
      secured.headers.set("X-Frame-Options", "DENY");
      secured.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
      return secured;
    } catch (e) {
      if (e instanceof HttpError) return json({ detail: e.message }, e.status);
      if (/UNIQUE constraint/i.test(e.message))
        return json({ detail: "这条记录已存在" }, 409);
      console.error("Carya News request failed", e.name);
      return json({ detail: "服务暂时不可用，请稍后重试" }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const execute = async (kind, fn) => {
          try {
            const result = await fn();
            await run(
              env.DB,
              "INSERT INTO job_runs(kind,status,summary,created_at) VALUES(?,?,?,?)",
              kind,
              "SUCCESS",
              JSON.stringify(result),
              now(),
            );
          } catch (e) {
            await run(
              env.DB,
              "INSERT INTO job_runs(kind,status,summary,created_at) VALUES(?,?,?,?)",
              kind,
              "FAILED",
              e instanceof HttpError ? e.message : "任务执行失败",
              now(),
            );
          }
        };
        if (event.cron === "0 12 * * *")
          await execute("rss", () => syncRss(env));
        if (
          event.cron === "0 0 * * *" &&
          env.NEWS_DISCOVERY_SCHEDULER_ENABLED === "true"
        ) {
          for (const w of await all(
            env.DB,
            "SELECT id FROM watchlists WHERE enabled=1",
          ))
            await execute("discovery", () =>
              discoveryRun(env, {
                watchlistId: w.id,
                from: localDate(-1),
                to: localDate(),
                limitPerKeyword: 20,
              }),
            );
        }
        if (
          ['10 0 * * MON','10 1 * * MON','10 2 * * MON'].includes(event.cron) &&
          env.WEEKLY_BRIEF_SCHEDULER_ENABLED === "true"
        ) {
          for (const w of await all(
            env.DB,
            "SELECT id FROM watchlists WHERE enabled=1",
          ))
            await execute("weekly-brief", async () => {
              const report = await generateWeekly(env, { watchlistId: w.id }, { scheduled: true });
              if (report.summaryStatus !== 'READY') throw new HttpError(503, report.summaryError);
              return { id: report.id, weekStart: report.weekStart, itemCount: report.itemCount };
            });
        }
        if (event.cron === '20 * * * *') await execute('translation', () => translatePending(env));
        await run(
          env.DB,
          "DELETE FROM sessions WHERE expires_at<?",
          Date.now(),
        );
        await run(
          env.DB,
          "DELETE FROM job_runs WHERE created_at<?",
          new Date(Date.now() - 30 * 86400000).toISOString(),
        );
      })(),
    );
  },
};
