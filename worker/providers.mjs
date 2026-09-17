import { XMLParser } from "fast-xml-parser";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import {
  all,
  first,
  run,
  required,
  now,
  safeUrl,
  fetchPublic,
  matches,
  dateWindow,
  HttpError,
  withLock,
} from "./common.mjs";
import { ingest, createSource } from "./data.mjs";
import { translateChinese, TRANSLATION_VERSION } from './ai.mjs';
export function plain(value) {
  const { document } = parseHTML(
    `<html><body>${String(value || "")}</body></html>`,
  );
  document
    .querySelectorAll("script,style,nav,footer")
    .forEach((e) => e.remove());
  return document.body.textContent.replace(/\s+/g, " ").trim();
}
export function parseFeed(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("不支持包含外部实体的 RSS");
  const p = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
  });
  const tree = p.parse(xml);
  const raw = tree.rss?.channel?.item || tree.feed?.entry || [];
  return (Array.isArray(raw) ? raw : [raw])
    .slice(0, 100)
    .map((x) => {
      const links = Array.isArray(x.link) ? x.link : [x.link];
      const link =
        links.find(
          (l) => typeof l === "string" || l?.["@_rel"] === "alternate",
        ) || links[0];
      return {
        title: plain(x.title?.["#text"] || x.title),
        url: typeof link === "string" ? link : link?.["@_href"],
        description: plain(
          x.description || x.summary?.["#text"] || x.summary || "",
        ),
        content: null,
        publishedAt: x.pubDate || x.published || x.updated || null,
      };
    })
    .filter((x) => x.title && x.url);
}
export async function providerJson(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  if (!r.ok)
    throw new HttpError(
      r.status === 429 ? 429 : 502,
      `外部服务返回 HTTP ${r.status}`,
    );
  return r.json();
}
export async function discover(env, keyword, from, to, limit) {
  const start = dateWindow(from)[0],
    end = dateWindow(to)[1];
  if (new Date(start) >= new Date(end))
    throw new HttpError(400, "起止日期无效");
  const provider = env.NEWS_DISCOVERY_PROVIDER || "none";
  let rows;
  if (provider === "rss") {
    rows = [];
    let succeeded = 0;
    for (const source of await all(
      env.DB,
      "SELECT * FROM sources WHERE enabled=1 AND type='RSS' ORDER BY id",
    )) {
      try {
        const feed = parseFeed((await fetchPublic(source.url)).text);
        rows.push(
          ...feed
            .filter((a) => matches(a, keyword))
            .map((a) => ({
              ...a,
              sourceId: source.id,
              sourceName: source.name,
              language: source.language,
            })),
        );
        succeeded++;
      } catch {
        /* One blocked publisher must not hide other publishers. */
      }
    }
    if (!succeeded) throw new HttpError(502, "RSS 来源暂时不可用");
  } else if (provider === "brave" && env.BRAVE_SEARCH_API_KEY) {
    const q = new URLSearchParams({
      q: keyword,
      country: "ALL",
      count: String(Math.min(limit, 50)),
      freshness: `${from}to${to}`,
    });
    const j = await providerJson(
      "https://api.search.brave.com/res/v1/news/search?" + q,
      {
        headers: {
          "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
          Accept: "application/json",
        },
      },
    );
    rows = (j.results || []).map((x) => ({
      title: x.title,
      url: x.url,
      description: plain(x.description),
      publishedAt: x.page_age || null,
      sourceName: x.meta_url?.hostname || null,
      language: "EN",
    }));
  } else if (provider === "gnews" && env.GNEWS_API_KEY) {
    const q = new URLSearchParams({
      q: keyword,
      lang: "en",
      max: String(Math.min(limit, 10)),
      from: start,
      to: end,
      apikey: env.GNEWS_API_KEY,
    });
    const j = await providerJson("https://gnews.io/api/v4/search?" + q);
    rows = (j.articles || []).map((x) => ({
      title: x.title,
      url: x.url,
      description: plain(x.description),
      publishedAt: x.publishedAt,
      sourceName: x.source?.name,
      language: "EN",
    }));
  } else
    throw new HttpError(503, "新闻检索未配置，请设置 Brave 或 GNews 服务密钥");
  return rows
    .filter(
      (x) =>
        !x.publishedAt ||
        (+new Date(x.publishedAt) >= +new Date(start) &&
          +new Date(x.publishedAt) < +new Date(end)),
    )
    .slice(0, limit);
}
async function translate(env, texts) {
  if (env.AI) {
    const out = [];
    for (const text of texts) out.push(await translateChinese(env, text));
    return out;
  }
  if (!env.DEEPL_API_KEY) throw new HttpError(503, "翻译服务未配置");
  const base =
    env.DEEPL_BASE_URL === "https://api.deepl.com"
      ? "https://api.deepl.com"
      : "https://api-free.deepl.com";
  const j = await providerJson(base + "/v2/translate", {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: texts,
      source_lang: "EN",
      target_lang: "ZH-HANS",
    }),
  });
  if (!Array.isArray(j.translations) || j.translations.length !== texts.length)
    throw new Error("翻译响应不完整");
  return j.translations.map((x) => x.text);
}
export async function postProcess(
  env,
  id,
  { metadata = true, extract = true, contentTranslation = true } = {},
) {
  const a = await required(env.DB, "articles", id),
    source = await required(env.DB, "sources", a.source_id);
  let content = a.content;
  const translation = a.translation
    ? JSON.parse(a.translation)
    : { language: "ZH_CN", title: null, description: null, content: null };
  if (env.AI && translation.version !== TRANSLATION_VERSION) {
    translation.title = null; translation.description = null; translation.content = null;
    translation.version = TRANSLATION_VERSION;
  }
  const result = {
    articleId: a.id,
    metadataTranslationStatus: "NOT_AVAILABLE",
    contentExtractionStatus: "NOT_AVAILABLE",
    contentTranslationStatus: "NOT_AVAILABLE",
    overallStatus: "FAILED",
  };
  if (extract) {
    if (content) result.contentExtractionStatus = "SUCCESS";
    else if (source.content_enrichment_enabled) {
      try {
        const response = await fetchPublic(a.url);
        const { document } = parseHTML(response.text);
        const parsed = new Readability(document).parse();
        content = parsed?.textContent?.trim() || null;
        if (!content) throw new Error("没有可提取的正文");
        content = content.slice(0, 100000);
        result.contentExtractionStatus = "SUCCESS";
      } catch {
        result.contentExtractionStatus = "FAILED";
      }
    }
  }
  if (source.language === "ZH_CN") {
    result.metadataTranslationStatus = "NOT_AVAILABLE";
    result.contentTranslationStatus = "NOT_AVAILABLE";
  } else if (env.AI || env.DEEPL_API_KEY) {
    if (metadata) {
      try {
        if (!translation.title) translation.title = (await translate(env, [a.title]))[0];
        if (a.description && !translation.description) translation.description = (await translate(env, [a.description]))[0];
        result.metadataTranslationStatus = "SUCCESS";
      } catch {
        result.metadataTranslationStatus = "FAILED";
      }
    }
    if (contentTranslation && content) {
      try {
        const chunks = translation.content ? [] : content.match(/[\s\S]{1,12000}/g) || [];
        const translated = [];
        for (const chunk of chunks)
          translated.push(...(await translate(env, [chunk])));
        if (translated.length) translation.content = translated.join("\n\n");
        result.contentTranslationStatus = "SUCCESS";
      } catch {
        result.contentTranslationStatus = "FAILED";
      }
    }
  }
  await run(
    env.DB,
    "UPDATE articles SET content=?,translation=?,updated_at=?,translation_attempted_at=? WHERE id=?",
    content,
    translation.title || translation.content
      ? JSON.stringify(translation)
      : a.translation,
    now(),
    now(),
    a.id,
  );
  const statuses = [
    result.metadataTranslationStatus,
    result.contentExtractionStatus,
    result.contentTranslationStatus,
  ];
  result.overallStatus = statuses.every((s) => s === "SUCCESS")
    ? "SUCCESS"
    : statuses.includes("SUCCESS")
      ? "PARTIAL_SUCCESS"
      : "FAILED";
  return result;
}
const counters = [
  "discovered",
  "relevanceRejected",
  "saved",
  "duplicates",
  "keywordMatchesCreated",
  "keywordMatchesExisting",
  "skippedUnsupportedLanguage",
  "skippedInvalidUrl",
];
export async function discoveryRun(env, request) {
  const watchlist = await required(env.DB, "watchlists", request.watchlistId);
  if (!watchlist.enabled) throw new HttpError(409, "关注列表已停用");
  dateWindow(request.from);
  dateWindow(request.to);
  const limit = Number(request.limitPerKeyword ?? 5);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new HttpError(400, "每个关键词的条数应为 1–50");
  if (
    env.NEWS_DISCOVERY_PROVIDER !== "rss" &&
    (!["brave", "gnews"].includes(env.NEWS_DISCOVERY_PROVIDER) ||
      !(env.NEWS_DISCOVERY_PROVIDER === "brave"
        ? env.BRAVE_SEARCH_API_KEY
        : env.GNEWS_API_KEY))
  )
    throw new HttpError(503, "新闻检索未配置，请设置 Brave 或 GNews 服务密钥");
  return withLock(env, "discovery", async () => {
    const keys = await all(
      env.DB,
      "SELECT * FROM keywords WHERE watchlist_id=? AND enabled=1 ORDER BY id",
      watchlist.id,
    );
    if (keys.length > 20)
      throw new HttpError(
        400,
        "每次最多处理 20 个启用的关键词，请拆分关注列表",
      );
    const out = {
      watchlistId: watchlist.id,
      watchlistName: watchlist.name,
      keywordsProcessed: 0,
      keywordsFailed: 0,
      ...Object.fromEntries(counters.map((k) => [k, 0])),
      postProcessingAttempted: 0,
      metadataTranslationSucceeded: 0,
      metadataTranslationFailed: 0,
      contentExtractionSucceeded: 0,
      contentExtractionFailed: 0,
      contentTranslationSucceeded: 0,
      contentTranslationFailed: 0,
      failedKeywords: [],
      keywordResults: [],
    };
    for (const key of keys) {
      const kr = {
        keywordId: key.id,
        keyword: key.keyword,
        ...Object.fromEntries(counters.map((k) => [k, 0])),
        failure: null,
      };
      try {
        const found = await discover(
          env,
          key.keyword,
          request.from,
          request.to,
          limit,
        );
        kr.discovered = found.length;
        for (const candidate of found) {
          if (!matches(candidate, key.keyword)) {
            kr.relevanceRejected++;
            continue;
          }
          let url;
          try {
            url = safeUrl(candidate.url);
          } catch {
            kr.skippedInvalidUrl++;
            continue;
          }
          const site = new URL(url).origin;
          let source = candidate.sourceId
            ? await required(env.DB, "sources", candidate.sourceId)
            : await first(env.DB, "SELECT * FROM sources WHERE url=?", site);
          if (!source) {
            try {
              await createSource(env.DB, {
                name: candidate.sourceName || new URL(site).hostname,
                url: site,
                type: "WEBSITE",
                priority: "MEDIUM",
                language: candidate.language,
                contentEnrichmentEnabled: true,
              });
            } catch (e) {
              if (!String(e.message).includes("UNIQUE")) throw e;
            }
            source = await first(
              env.DB,
              "SELECT * FROM sources WHERE url=?",
              site,
            );
          }
          const previous = await first(
            env.DB,
            "SELECT m.article_id FROM article_keyword_matches m JOIN articles a ON a.id=m.article_id WHERE a.url=? AND m.keyword_id=?",
            url,
            key.id,
          );
          const stored = await ingest(env.DB, {
            ...candidate,
            url,
            sourceId: source.id,
          });
          kr[stored.saved ? "saved" : "duplicates"]++;
          kr[previous ? "keywordMatchesExisting" : "keywordMatchesCreated"]++;
          if (stored.saved) {
            out.postProcessingAttempted++;
            const p = await postProcess(env, stored.row.id, { contentTranslation: false });
            for (const [step, target] of [
              ["metadataTranslationStatus", "metadataTranslation"],
              ["contentExtractionStatus", "contentExtraction"],
              ["contentTranslationStatus", "contentTranslation"],
            ])
              if (p[step] !== "NOT_AVAILABLE")
                out[
                  target + (p[step] === "SUCCESS" ? "Succeeded" : "Failed")
                ]++;
          }
        }
        out.keywordsProcessed++;
      } catch (e) {
        kr.failure = e instanceof HttpError ? e.message : "新闻来源暂时不可用";
        out.keywordsFailed++;
        out.failedKeywords.push({
          keywordId: key.id,
          keyword: key.keyword,
          message: kr.failure,
        });
      }
      for (const c of counters) out[c] += kr[c];
      out.keywordResults.push(kr);
    }
    return out;
  });
}
const strong = [
  "energy storage",
  "battery storage",
  "battery energy storage",
  "bess",
  "grid battery",
  "grid-battery",
  "grid-scale battery",
  "home battery",
  "long-duration energy storage",
  "ldes",
  "thermal energy storage",
  "flow battery",
  "sodium-ion battery",
  "energy storage system",
  "grid-scale storage",
  "stationary battery",
  "stationary storage",
  "utility-scale battery",
  "residential battery",
];
const weak = [
  "battery",
  "lfp",
  "lithium-ion",
  "virtual power plant",
  "vpp",
  "pcs",
  "power conversion",
  "grid-forming",
  "behind-the-meter",
];
export function relevant(a) {
  const value = (a.title + " " + (a.description || "")).toLowerCase();
  return (
    strong.some((k) => value.includes(k)) ||
    weak.filter((k) => value.includes(k)).length >= 3
  );
}
export async function syncRss(env, sourceId) {
  return withLock(env, "rss", async () => {
    const sources = sourceId
      ? [await required(env.DB, "sources", sourceId)]
      : await all(
          env.DB,
          "SELECT * FROM sources WHERE enabled=1 AND type='RSS' ORDER BY id",
        );
    const result = {
      collected: 0,
      filteredOut: 0,
      saved: 0,
      duplicates: 0,
      translated: 0,
      translationFailed: 0,
      contentFetched: 0,
      contentFetchFailed: 0,
      contentTranslated: 0,
      contentTranslationFailed: 0,
      failedSources: 0,
    };
    for (const source of sources) {
      if (!source.enabled || source.type !== "RSS") continue;
      try {
        const feed = parseFeed((await fetchPublic(source.url)).text);
        for (const article of feed) {
          result.collected++;
          if (!relevant(article)) {
            result.filteredOut++;
            continue;
          }
          try {
            const saved = await ingest(env.DB, {
              ...article,
              sourceId: source.id,
            });
            result[saved.saved ? "saved" : "duplicates"]++;
            if (saved.saved) {
              const p = await postProcess(env, saved.row.id, { contentTranslation: false });
              for (const [s, ok, fail] of [
                [
                  "metadataTranslationStatus",
                  "translated",
                  "translationFailed",
                ],
                [
                  "contentExtractionStatus",
                  "contentFetched",
                  "contentFetchFailed",
                ],
                [
                  "contentTranslationStatus",
                  "contentTranslated",
                  "contentTranslationFailed",
                ],
              ])
                if (p[s] !== "NOT_AVAILABLE")
                  result[p[s] === "SUCCESS" ? ok : fail]++;
            }
          } catch {
            result.filteredOut++;
          }
        }
      } catch {
        result.failedSources++;
      }
    }
    return result;
  });
}
