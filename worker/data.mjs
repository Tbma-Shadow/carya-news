import {
  all,
  first,
  run,
  required,
  now,
  matches,
  integer,
  text,
  safeUrl,
  HttpError,
} from "./common.mjs";
export function sourceDto(r) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    type: r.type,
    priority: r.priority,
    language: r.language,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export function keywordDto(r) {
  return {
    id: r.id,
    keyword: r.keyword,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export async function watchlistDto(db, r) {
  return {
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    keywords: (
      await all(
        db,
        "SELECT * FROM keywords WHERE watchlist_id=? ORDER BY id",
        r.id,
      )
    ).map(keywordDto),
  };
}
export async function articleDto(db, r) {
  const source = await required(db, "sources", r.source_id);
  const keywords = await all(
    db,
    "SELECT k.keyword FROM keywords k JOIN watchlists w ON w.id=k.watchlist_id WHERE k.enabled=1 AND w.enabled=1 ORDER BY lower(k.keyword),k.keyword",
  );
  return {
    id: r.id,
    source: { id: source.id, name: source.name },
    url: r.url,
    publishedAt: r.published_at,
    collectedAt: r.collected_at,
    original: {
      language: source.language,
      title: r.title,
      description: r.description,
      content: r.content,
    },
    translation: r.translation ? JSON.parse(r.translation) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: [
      ...new Map(
        keywords
          .filter((k) => matches(r, k.keyword))
          .map((k) => [k.keyword.toLowerCase(), k.keyword]),
      ).values(),
    ],
  };
}
export async function matchArticle(db, article) {
  const keys = await all(
    db,
    "SELECT k.* FROM keywords k JOIN watchlists w ON w.id=k.watchlist_id WHERE k.enabled=1 AND w.enabled=1",
  );
  const selected = keys.filter((k) => matches(article, k.keyword));
  if (selected.length)
    await db.batch(
      selected.map((k) =>
        db
          .prepare("INSERT OR IGNORE INTO article_keyword_matches VALUES(?,?)")
          .bind(article.id, k.id),
      ),
    );
}
export async function matchKeyword(db, id) {
  await run(db, `INSERT OR IGNORE INTO article_keyword_matches(article_id,keyword_id) SELECT a.id,k.id FROM articles a JOIN keywords k ON k.id=? JOIN watchlists w ON w.id=k.watchlist_id WHERE k.enabled=1 AND w.enabled=1 AND (instr(lower(a.title),lower(k.keyword))>0 OR instr(lower(coalesce(a.description,'')),lower(k.keyword))>0)`, id);
}
export async function ingest(db, data) {
  const url = safeUrl(data.url);
  const t = now();
  await required(db, "sources", data.sourceId);
  const title = text(data.title, "标题", 2000);
  let published = data.publishedAt ? new Date(data.publishedAt) : null;
  if (published && !Number.isFinite(+published)) published = null;
  const inserted = await run(
    db,
    "INSERT OR IGNORE INTO articles(source_id,url,title,description,content,published_at,collected_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    data.sourceId,
    url,
    title,
    data.description || null,
    data.content || null,
    published?.toISOString() || null,
    t,
    t,
    t,
  );
  const row = await first(db, "SELECT * FROM articles WHERE url=?", url);
  await matchArticle(db, row);
  return { row, saved: !!inserted.meta.changes };
}
export async function articlePage(db, params) {
  const page = integer(params.get("page") ?? 0, "page", 0, 1000000),
    size = integer(params.get("size") ?? 20, "size", 1, 100);
  const where = [],
    args = [];
  if (params.has("sourceId")) {
    where.push("a.source_id=?");
    args.push(integer(params.get("sourceId")));
  }
  if (params.get("keyword")) {
    where.push(
      "(instr(lower(a.title),lower(?))>0 OR instr(lower(coalesce(a.description,'')),lower(?))>0 OR instr(coalesce(json_extract(a.translation,'$.title'),''),?)>0 OR instr(coalesce(json_extract(a.translation,'$.description'),''),?)>0)",
    );
    args.push(...Array(4).fill(params.get("keyword")));
  }
  if (params.has("keywordId")) {
    where.push(
      "EXISTS(SELECT 1 FROM article_keyword_matches m JOIN keywords k ON k.id=m.keyword_id JOIN watchlists w ON w.id=k.watchlist_id WHERE m.article_id=a.id AND k.id=? AND k.enabled=1 AND w.enabled=1)",
    );
    args.push(integer(params.get("keywordId")));
  }
  const condition = where.length ? " WHERE " + where.join(" AND ") : "";
  const count = await first(
    db,
    "SELECT count(*) AS n FROM articles a" + condition,
    ...args,
  );
  const rows = await all(
    db,
    "SELECT a.* FROM articles a" +
      condition +
      " ORDER BY coalesce(a.published_at,a.collected_at) DESC,a.id DESC LIMIT ? OFFSET ?",
    ...args,
    size,
    page * size,
  );
  return {
    content: await Promise.all(rows.map((r) => articleDto(db, r))),
    page,
    size,
    totalElements: count.n,
    totalPages: Math.ceil(count.n / size),
    first: page === 0,
    last: (page + 1) * size >= count.n,
  };
}
export async function createSource(db, data) {
  if (
    !["RSS", "API", "WEBSITE"].includes(data.type) ||
    !["LOW", "MEDIUM", "HIGH"].includes(data.priority) ||
    (data.language && !["EN", "ZH_CN"].includes(data.language))
  )
    throw new HttpError(400, "来源类型、优先级或语言无效");
  const t = now();
  const result = await run(
    db,
    "INSERT INTO sources(name,url,type,priority,language,content_enrichment_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
    text(data.name, "来源名称"),
    safeUrl(data.url),
    data.type,
    data.priority,
    data.language || "EN",
    data.contentEnrichmentEnabled ? 1 : 0,
    t,
    t,
  );
  return sourceDto(await required(db, "sources", result.meta.last_row_id));
}
export async function patchNamed(db, table, id, data, key) {
  const current = await required(db, table, id);
  if (data.enabled !== undefined && typeof data.enabled !== "boolean")
    throw new HttpError(400, "enabled 必须为布尔值");
  const value = data[key] === undefined ? current[key] : text(data[key], key);
  await run(
    db,
    `UPDATE ${table} SET ${key}=?,enabled=?,updated_at=? WHERE id=?`,
    value,
    data.enabled === undefined ? current.enabled : Number(data.enabled),
    now(),
    current.id,
  );
  if (
    table === "keywords" &&
    data.keyword !== undefined &&
    data.keyword !== current.keyword
  )
    await run(
      db,
      "DELETE FROM article_keyword_matches WHERE keyword_id=?",
      current.id,
    );
  if (table === 'keywords') await matchKeyword(db, current.id);
  return required(db, table, current.id);
}
