import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getArticleTranslationView,
  recoverArticleTranslation,
} from "../src/features/articles/articleTranslationRecovery.ts";
import type { ArticleResponse } from "../src/types/articles.ts";
const article: ArticleResponse = {
  id: 1,
  source: { id: 1, name: "Test" },
  url: "https://example.com",
  publishedAt: null,
  collectedAt: "2026-09-17",
  createdAt: "2026-09-17",
  updatedAt: "2026-09-17",
  original: {
    language: "EN",
    title: "Battery",
    description: null,
    content: "Original",
  },
  translation: null,
  tags: [],
};
test("falls back to original content and only offers recovery for English", () => {
  assert.equal(getArticleTranslationView(article).primaryTitle, "Battery");
  assert.equal(
    getArticleTranslationView(article).needsTranslationRecovery,
    true,
  );
  assert.equal(
    getArticleTranslationView({
      ...article,
      original: { ...article.original, language: "ZH_CN" },
    }).needsTranslationRecovery,
    false,
  );
});
test("missing provider is reported and actual article is reloaded", async () => {
  const result = await recoverArticleTranslation(1, {
    backfill: async () => ({
      articleId: 1,
      metadataTranslationStatus: "NOT_AVAILABLE",
      contentExtractionStatus: "SUCCESS",
      contentTranslationStatus: "NOT_AVAILABLE",
      overallStatus: "PARTIAL_SUCCESS",
    }),
    reload: async () => article,
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.article, article);
});
