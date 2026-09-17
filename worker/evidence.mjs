import { HttpError } from "./common.mjs";
const uncertain =
  /\b(?:reportedly|reported|according\s+to|sources\s+say|may|might|could|considering|seeks|plans|planned|expected|proposed|alleged)\b|据报道|报道称|消息称|可能|或将|(?<![模虚])拟(?![合态])|计划|预计|提议|据称/i;
const currency =
  "(?:[A-Z]{1,3}\\$|\\p{Sc}|USD|EUR|GBP|CNY|RMB|JPY|AUD|CAD|CHF|HKD|INR|美元|欧元|英镑|人民币|日元|澳元|加元|港元|元)";
const number = "[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const magnitude =
  "(?:trillion|billion|million|thousand|hundred|crore|lakh|bn|mn|tn|[kmbt](?![A-Za-z])|万亿|千亿|百亿|十亿|亿|千万|百万|十万|万|千|百|十)";
function amounts(text) {
  const re = new RegExp(
    `(${currency})\\s*(${number})\\s*(${magnitude})?|(${number})\\s*(${magnitude})?\\s*(${currency})`,
    "gu",
  );
  const labels = {
    k: "thousand",
    m: "million",
    mn: "million",
    b: "billion",
    bn: "billion",
    t: "trillion",
    tn: "trillion",
  };
  return [
    ...String(text || "")
      .normalize("NFKC")
      .matchAll(re),
  ].map((m) => {
    const mag = (m[3] || m[5] || "").toLowerCase();
    return `${m[1] || m[6]}:${Number((m[2] || m[4]).replaceAll(",", ""))}:${labels[mag] || mag}`;
  });
}
export function evidenceGuard(result, items) {
  const byId = new Map(items.map((a) => [a.articleId, a]));
  let hasUncertain = false;
  for (const event of result.events) {
    const sources = event.supportingArticleIds.map((id) => byId.get(id));
    const allUncertain = sources.every((a) =>
      uncertain.test((a.title || "") + " " + (a.description || "")),
    );
    if (allUncertain) {
      hasUncertain = true;
      if (!uncertain.test(event.title + " " + event.summary))
        throw new HttpError(502, "AI 分析未保留原文的不确定性，未保存");
    }
    const allowed = new Set(
      sources.flatMap((a) =>
        amounts((a.title || "") + " " + (a.description || "")),
      ),
    );
    if (amounts(event.title + " " + event.summary).some((a) => !allowed.has(a)))
      throw new HttpError(502, "AI 分析中的金额与引用文章不一致，未保存");
  }
  // Conservative global check: do not accept an unqualified headline or overview
  // when the generated analysis contains an event supported only by uncertain reports.
  if (
    hasUncertain &&
    (!uncertain.test(result.headline) || !uncertain.test(result.overview))
  )
    throw new HttpError(502, "AI 标题或概述未保留消息的不确定性，未保存");
}
