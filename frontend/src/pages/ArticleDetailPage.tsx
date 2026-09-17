import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { backfillArticlePostProcessing, getArticle } from '../api/articles'
import { ApiError } from '../api/client'
import {
  getArticleTranslationView,
  getTranslationRecoveryMessage,
  recoverArticleTranslation,
} from '../features/articles/articleTranslationRecovery.ts'
import { formatArticleDate } from '../features/articles/formatArticleDate'
import type { ArticleResponse } from '../types/articles'
import type { TranslationRecoveryStatus } from '../features/articles/articleTranslationRecovery.ts'

type LoadStatus = 'loading' | 'success' | 'not-found' | 'error'

export function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const articleId = Number(id)
  const isValidArticleId = Number.isSafeInteger(articleId) && articleId > 0
  const [article, setArticle] = useState<ArticleResponse | null>(null)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [recoveryStatus, setRecoveryStatus] = useState<TranslationRecoveryStatus>('idle')

  useEffect(() => {
    setArticle(null)
    setRecoveryStatus('idle')

    if (!isValidArticleId) {
      setStatus('not-found')
      return
    }

    const controller = new AbortController()
    setStatus('loading')

    getArticle(articleId, controller.signal)
      .then((response) => {
        setArticle(response)
        setStatus('success')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setStatus(error instanceof ApiError && error.status === 404 ? 'not-found' : 'error')
      })

    return () => controller.abort()
  }, [articleId, isValidArticleId])

  async function handleTranslationRecovery() {
    if (!article || recoveryStatus === 'submitting') return

    setRecoveryStatus('submitting')
    const outcome = await recoverArticleTranslation(article.id, {
      backfill: backfillArticlePostProcessing,
      reload: getArticle,
    })
    if (outcome.article) setArticle(outcome.article)
    setRecoveryStatus(outcome.status)
  }

  return (
    <main className="page-shell">
      <div className="article-detail-page">
        <Link className="article-detail__back" to="/">
          ← 返回资讯列表
        </Link>

        <div className="article-detail__state" aria-live="polite" aria-busy={status === 'loading'}>
          {status === 'loading' && <p className="status-message">正在加载资讯…</p>}
          {status === 'not-found' && <p className="status-message">未找到这篇资讯。</p>}
          {status === 'error' && (
            <p className="status-message status-message--error">资讯加载失败，请稍后重试。</p>
          )}
          {status === 'success' && article && (
            <ArticleDetail
              article={article}
              recoveryStatus={recoveryStatus}
              onRecoverTranslation={handleTranslationRecovery}
            />
          )}
        </div>
      </div>
    </main>
  )
}

function ArticleDetail({
  article,
  recoveryStatus,
  onRecoverTranslation,
}: {
  article: ArticleResponse
  recoveryStatus: TranslationRecoveryStatus
  onRecoverTranslation: () => void
}) {
  const {
    hasChineseTranslation,
    needsTranslationRecovery,
    originalDescription,
    originalContent,
    primaryTitle,
    primaryDescription,
    primaryContent,
    translatedTitle,
  } = getArticleTranslationView(article)
  const originalLanguage = article.original.language === 'ZH_CN' ? 'zh-CN' : 'en'
  const primaryTitleLanguage =
    hasChineseTranslation && translatedTitle ? 'zh-CN' : originalLanguage
  const primaryDescriptionLanguage = article.translation?.description ? 'zh-CN' : originalLanguage
  const primaryContentLanguage = article.translation?.content ? 'zh-CN' : originalLanguage
  const timestamp = article.publishedAt ?? article.collectedAt
  const recoveryMessage = getTranslationRecoveryMessage(recoveryStatus)

  return (
    <article className="article-detail">
      <header className="article-detail__header">
        <div className="article-detail__metadata">
          <span>{article.source.name}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={timestamp}>{formatArticleDate(timestamp)}</time>
        </div>

        <h1 lang={primaryTitleLanguage}>{primaryTitle}</h1>
        {originalLanguage === 'en' && <p className="article-list-item__translation-status">{article.translation?.content ? '机器翻译 · 可在文末对照英文原文' : '中文译文正在陆续补充，未完成的部分暂显示原文。'}</p>}
      </header>

      {primaryDescription && (
        <section className="article-detail__summary" aria-labelledby="article-summary-heading">
          <h2 id="article-summary-heading">摘要</h2>
          <p lang={primaryDescriptionLanguage}>{primaryDescription}</p>
        </section>
      )}

      {primaryContent && (
        <section className="article-detail__body" aria-label="文章正文">
          <ArticleParagraphs content={primaryContent} language={primaryContentLanguage} />
        </section>
      )}

      <div className="article-detail__actions">
        <a
          className="article-detail__external-link"
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          查看原文 ↗
        </a>

        {needsTranslationRecovery && (
          <button
            className="button button--secondary"
            type="button"
            disabled={recoveryStatus === 'submitting'}
            onClick={onRecoverTranslation}
          >
            {recoveryStatus === 'submitting' ? '正在补翻译...' : '补翻译'}
          </button>
        )}
      </div>

      <div className="article-detail__recovery-status" aria-live="polite">
        {recoveryMessage && (
          <p className={recoveryStatus === 'error' ? 'article-detail__recovery-error' : undefined}>
            {recoveryMessage}
          </p>
        )}
      </div>

      {hasChineseTranslation && (
        <details className="article-detail__original">
          <summary>查看英文原文</summary>
          <div className="article-detail__original-content" lang="en">
            <h2>{article.original.title}</h2>
            {originalDescription && <p>{originalDescription}</p>}
            {originalContent && (
              <ArticleParagraphs content={originalContent} language="en" />
            )}
          </div>
        </details>
      )}
    </article>
  )
}

function ArticleParagraphs({ content, language }: { content: string; language: string }) {
  const paragraphs = content
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  return (
    <div className="article-detail__paragraphs" lang={language}>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}
