import { HttpError } from "./common.mjs";
const uncertain =
  /\b(?:reportedly|reported|according\s+to|sources\s+say|may|might|could|considering|seeks|plans|planned|expected|proposed|alleged)\b|不确定|潜在|据报道|报道称|消息称|可能|或将|(?<![模虚])拟(?![合态])|计划|预计|提议|据称/i;
const currency =
  "(?:[A-Z]{1,3}\\$|\\p{Sc}|USD|EUR|GBP|CNY|RMB|JPY|AUD|CAD|CHF|HKD|INR|美元|欧元|英镑|人民币|日元|澳元|加元|港元|元)";
const number = "[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const magnitude =
  "(?:trillion|billion|million|thousand|hundred|crore|lakh|bn|mn|tn|[kmbt](?![A-Za-z])|万亿|千亿|百亿|十亿|亿|千万|百万|十万|万|千|百|十)";
function amounts(text) {
  const re = new RegExp(
    `(${currency})\\s*(${number})\\s*(${magnitude})?|(${number})\\s*(${magnitude})?\\s*(${currency})`,
    "giu",
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
    const units = { thousand:1e3, million:1e6, billion:1e9, trillion:1e12, hundred:100, crore:1e7, lakh:1e5, 十:10, 百:100, 千:1e3, 万:1e4, 十万:1e5, 百万:1e6, 千万:1e7, 亿:1e8, 十亿:1e9, 百亿:1e10, 千亿:1e11, 万亿:1e12 };
    const currencies = { '$':'USD', 'US$':'USD', '美元':'USD', '€':'EUR', '欧元':'EUR', '£':'GBP', '英镑':'GBP', '人民币':'CNY', '元':'CNY', RMB:'CNY', '澳元':'AUD', 'A$':'AUD', '加元':'CAD', '港元':'HKD', '日元':'JPY' };
    const currencyName = m[1] || m[6];
    const scale = units[labels[mag] || mag] || 1;
    return `${currencies[currencyName] || currencyName}:${Number((Number((m[2] || m[4]).replaceAll(',', '')) * scale).toPrecision(12))}`;
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
export function validateMonetaryTranslation(original, translated) {
  const allowed = new Set(amounts(original));
  if (amounts(translated).some(amount => !allowed.has(amount)))
    throw new HttpError(502, '译文中的金额未通过校验，将稍后重试');
}
