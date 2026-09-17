import type {
  ArticleResponse,
  ArticlePostProcessingBackfillResponse,
} from "../../types/articles";
export type TranslationRecoveryStatus =
  "idle" | "submitting" | "success" | "partial" | "unavailable" | "error";
export function getArticleTranslationView(article: ArticleResponse) {
  const translatedTitle = article.translation?.title?.trim() || null;
  const hasChineseTranslation = Boolean(
    translatedTitle ||
    article.translation?.description ||
    article.translation?.content,
  );
  return {
    hasChineseTranslation,
    needsTranslationRecovery:
      article.original.language === "EN" &&
      (!translatedTitle ||
        Boolean(article.original.content && !article.translation?.content)),
    originalDescription: article.original.description,
    originalContent: article.original.content,
    primaryTitle: translatedTitle || article.original.title,
    primaryDescription:
      article.translation?.description || article.original.description,
    primaryContent: article.translation?.content || article.original.content,
    translatedTitle,
  };
}
export async function recoverArticleTranslation(
  id: number,
  actions: {
    backfill: (id: number) => Promise<ArticlePostProcessingBackfillResponse>;
    reload: (id: number) => Promise<ArticleResponse>;
  },
): Promise<{
  article: ArticleResponse | null;
  status: TranslationRecoveryStatus;
}> {
  try {
    const result = await actions.backfill(id);
    const article = await actions.reload(id);
    const status =
      result.metadataTranslationStatus === "NOT_AVAILABLE"
        ? "unavailable"
        : result.overallStatus === "SUCCESS"
          ? "success"
          : result.overallStatus === "PARTIAL_SUCCESS"
            ? "partial"
            : "error";
    return { article, status };
  } catch {
    return { article: null, status: "error" };
  }
}
export function getTranslationRecoveryMessage(
  status: TranslationRecoveryStatus,
) {
  return {
    idle: "",
    submitting: "正在提取正文并补充译文…",
    success: "译文已更新。",
    partial: "已补充部分内容，其余内容暂未获取。",
    unavailable: "翻译服务尚未配置，请联系管理员。",
    error: "补翻译失败，请稍后重试。",
  }[status];
}
